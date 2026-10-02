import assert from "node:assert";
import { eq, inArray, like, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { auditLog } from "@/lib/db/schema/audit_log";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { artistProfiles } from "@/lib/db/schema/artist_profiles";
import { artistProfileFiles } from "@/lib/db/schema/artist_profile_files";
import { artistProfileChangeRequests } from "@/lib/db/schema/artist_profile_change_requests";
import { checkDetails, maskNumber, normaliseDetails, type ArtistDetailsInput } from "../details-rules";
import {
  ArtistDetailsError,
  decideArtistDetailsChange,
  getOwnArtistDetails,
  listArtistDetailsForTeam,
  recordArtistFile,
  requestArtistDetailsChange,
  revealArtistDetails,
  saveFirstArtistDetails,
} from "../details-service";

const ARTIST_EMAIL = "test-details-artist@example.com";
const OTHER_EMAIL = "test-details-other@example.com";
const PAYER_EMAIL = "test-details-payer@example.com";
const EMAILS = [ARTIST_EMAIL, OTHER_EMAIL, PAYER_EMAIL];
const ARTIST_NAME = "Details Test Artist";

async function cleanup() {
  const people = await db.select({ id: personnel.id }).from(personnel).where(inArray(personnel.email, EMAILS));
  const ids = people.map((p) => p.id);
  // Team notices go to the real team inbox address, so they're found by the artist's name in the subject.
  await db.delete(emailQueue).where(or(inArray(emailQueue.toEmail, EMAILS), like(emailQueue.subject, `%${ARTIST_NAME}%`)));
  if (ids.length === 0) return;
  await db.delete(auditLog).where(or(inArray(auditLog.entityId, ids), inArray(auditLog.actorId, ids)));
  await db.delete(artistProfileChangeRequests).where(inArray(artistProfileChangeRequests.personnelId, ids));
  await db.delete(artistProfiles).where(inArray(artistProfiles.personnelId, ids));
  await db.delete(artistProfileFiles).where(inArray(artistProfileFiles.personnelId, ids));
  await db.delete(personnel).where(inArray(personnel.email, EMAILS));
}

const EMPTY: ArtistDetailsInput = {
  mobile: null,
  upiId: null,
  accountHolderName: null,
  bankAccountNumber: null,
  ifsc: null,
  bankName: null,
  panNumber: null,
  portfolioLinks: null,
  aadhaarFileId: null,
  panFileId: null,
  chequeFileId: null,
  resumeFileId: null,
  ipAgreementFileId: null,
  ndaUrl: null,
  ndaFileId: null,
};

function testRules() {
  console.log("Verifying the format checks and masking...");
  const filled = normaliseDetails({
    ...EMPTY,
    mobile: "+91 98765 43210",
    upiId: " Name@OKAXIS ",
    accountHolderName: "Test",
    bankAccountNumber: "1234 5678 9012",
    ifsc: "sbin0001234",
    bankName: "SBI",
    panNumber: "abcde1234f",
    aadhaarFileId: "a",
    panFileId: "b",
    chequeFileId: "c",
  });
  assert.strictEqual(filled.mobile, "9876543210");
  assert.strictEqual(filled.upiId, "name@okaxis");
  assert.strictEqual(filled.bankAccountNumber, "123456789012");
  assert.strictEqual(checkDetails(filled), null);
  assert.strictEqual(checkDetails({ ...filled, ndaUrl: "https://drive.google.com/file/d/x" }), null, "A link alone is enough for the NDA");
  assert.match(checkDetails({ ...filled, ndaUrl: "my nda" }) ?? "", /NDA link/);
  assert.match(checkDetails({ ...filled, chequeFileId: null }) ?? "", /Cancelled cheque/);
  assert.match(checkDetails({ ...filled, ifsc: "SBIN1234" }) ?? "", /IFSC/);
  assert.strictEqual(maskNumber("123456789012"), "••••••••9012");
  assert.strictEqual(maskNumber(null), null);
  console.log("Confirmed the rules");
}

async function testSaveChangeApprove() {
  console.log("Verifying save once, change with a reason, approve, and the logged full view...");
  await cleanup();
  const [artist] = await db.insert(personnel).values({ name: ARTIST_NAME, email: ARTIST_EMAIL, roles: ["artist"] }).returning();
  const [other] = await db.insert(personnel).values({ name: "Details Other", email: OTHER_EMAIL, roles: ["artist"] }).returning();
  const [payer] = await db.insert(personnel).values({ name: "Details Payer", email: PAYER_EMAIL, roles: ["admin"] }).returning();

  const doc = (personnelId: string, kind: "aadhaar" | "pan" | "cheque" | "nda") =>
    recordArtistFile({ personnelId, kind, fileName: `${kind}.pdf`, mimeType: "application/pdf", bytes: Buffer.from(kind), driveUrl: null, uploadedBy: personnelId });
  const [aadhaar, pan, cheque, nda] = await Promise.all([doc(artist.id, "aadhaar"), doc(artist.id, "pan"), doc(artist.id, "cheque"), doc(artist.id, "nda")]);
  const othersFile = await doc(other.id, "cheque");

  const details: ArtistDetailsInput = {
    ...EMPTY,
    mobile: "9876543210",
    upiId: "artist@okaxis",
    accountHolderName: "Details Test Artist",
    bankAccountNumber: "123456789012",
    ifsc: "SBIN0001234",
    bankName: "SBI",
    panNumber: "ABCDE1234F",
    aadhaarFileId: aadhaar.id,
    panFileId: pan.id,
    chequeFileId: cheque.id,
    ndaUrl: "https://drive.google.com/file/d/nda",
    ndaFileId: nda.id,
  };

  await assert.rejects(() => saveFirstArtistDetails(artist.id, { ...details, chequeFileId: othersFile.id }, artist.id), ArtistDetailsError, "Another artist's file is refused");
  await saveFirstArtistDetails(artist.id, details, artist.id);
  await assert.rejects(() => saveFirstArtistDetails(artist.id, details, artist.id), ArtistDetailsError, "A second save is refused");

  const own = await getOwnArtistDetails(artist.id);
  assert.ok(own.submittedAt);
  assert.strictEqual(own.details.ndaUrl, "https://drive.google.com/file/d/nda");
  assert.strictEqual(own.details.ndaFileId, nda.id);

  const listed = (await listArtistDetailsForTeam()).find((r) => r.id === artist.id);
  assert.strictEqual(listed?.state, "saved");
  assert.strictEqual(listed?.maskedAccount, "••••••••9012", "The list only shows the last 4 digits");

  const moved = { ...details, bankAccountNumber: "999988887777", ifsc: "HDFC0000001", bankName: "HDFC" };
  await assert.rejects(() => requestArtistDetailsChange(artist.id, moved, "  ", artist.id), ArtistDetailsError, "A reason is required");
  await assert.rejects(() => requestArtistDetailsChange(artist.id, details, "no change", artist.id), ArtistDetailsError, "Nothing changed is refused");
  await requestArtistDetailsChange(artist.id, moved, "Moved to HDFC", artist.id);
  await assert.rejects(() => requestArtistDetailsChange(artist.id, moved, "again", artist.id), ArtistDetailsError, "Only one change waits at a time");

  const beforeApproval = await getOwnArtistDetails(artist.id);
  assert.strictEqual(beforeApproval.details.bankAccountNumber, "123456789012", "The old account stays in use until approval");
  assert.ok(beforeApproval.pendingChange);

  const revealed = await revealArtistDetails(artist.id, payer.id);
  assert.strictEqual(revealed.details.bankAccountNumber, "123456789012");
  assert.strictEqual(revealed.pendingValues?.bankAccountNumber, "999988887777");
  const [reveal] = await db.select().from(auditLog).where(eq(auditLog.action, "revealArtistDetails"));
  assert.ok(reveal, "Opening full details is logged");
  assert.ok(!JSON.stringify(reveal.payload).includes("1234"), "The log never carries the numbers");

  await decideArtistDetailsChange(beforeApproval.pendingChange!.id, true, null, payer.id);
  const after = await getOwnArtistDetails(artist.id);
  assert.strictEqual(after.details.bankAccountNumber, "999988887777");
  assert.strictEqual(after.details.ifsc, "HDFC0000001");
  assert.strictEqual(after.pendingChange, null);
  await assert.rejects(() => decideArtistDetailsChange(beforeApproval.pendingChange!.id, false, null, payer.id), ArtistDetailsError, "A decided change can't be decided again");

  const teamEmails = await db.select().from(emailQueue).where(like(emailQueue.subject, `%${ARTIST_NAME}%`));
  assert.ok(teamEmails.length >= 2, "The team is emailed on the save and on the change request");
  assert.ok(teamEmails.every((e) => e.toEmail === "vkydlabs@gmail.com" && (e.ccEmails ?? []).includes("arjun@metafashion.in")));
  console.log("Confirmed save, change and approval");
}

async function run() {
  testRules();
  await testSaveChangeApprove();
}

run()
  .then(async () => {
    await cleanup();
    console.log("✓ All artist details assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
