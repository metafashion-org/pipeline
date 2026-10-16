import assert from "node:assert";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { personnel } from "@/lib/db/schema/personnel";
import { PriorityError, setCardPriority, type PriorityNotice, type PriorityNotifier } from "../priority-service";

const PREFIX = "TEST-PRIORITY-";

async function cleanup() {
  const rows = await db.select({ id: assets.id }).from(assets).where(like(assets.sku, `${PREFIX}%`));
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, ids));
    await db.delete(assets).where(inArray(assets.id, ids));
  }
  await db.delete(personnel).where(like(personnel.email, "test-priority-%"));
}

async function test() {
  console.log("Verifying priority marks, who may set them, and the artist's Discord messages...");
  await cleanup();
  const [artist] = await db.insert(personnel).values({ name: "Priority Artist", email: "test-priority-artist@example.com", roles: ["artist"], status: "Active", discordUserId: "111" }).returning();
  const [lead] = await db.insert(personnel).values({ name: "Priority Lead", email: "test-priority-lead@example.com", roles: ["manager"], status: "Active" }).returning();
  const [other] = await db.insert(personnel).values({ name: "Other Artist", email: "test-priority-other@example.com", roles: ["artist"], status: "Active" }).returning();
  const [card] = await db.insert(assets).values({ sku: `${PREFIX}HAT`, itemName: "Priority hat", currentStatus: "in_production", currentArtistId: artist.id }).returning();

  const sent: PriorityNotice[] = [];
  const notifier: PriorityNotifier = async (n) => {
    sent.push(n);
    return { dm: true, channel: true };
  };

  await assert.rejects(setCardPriority(card.sku, { priority: true }, { personnelId: other.id, isTeam: false }, notifier), PriorityError, "An artist can't mark someone else's card");

  assert.deepStrictEqual(await setCardPriority(card.sku, { priority: true, note: " Due Friday " }, { personnelId: lead.id, isTeam: true }, notifier), { dm: true, channel: true });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].markedByName, "Priority Lead");
  assert.strictEqual(sent[0].note, "Due Friday");
  const [marked] = await db.select().from(assets).where(eq(assets.id, card.id));
  assert.ok(marked.priorityAt && marked.priorityBy === lead.id && marked.priorityNote === "Due Friday");

  await setCardPriority(card.sku, { priority: true }, { personnelId: lead.id, isTeam: true }, notifier);
  assert.strictEqual(sent.length, 1, "Marking an already-priority card doesn't message again");

  await setCardPriority(card.sku, { priority: false }, { personnelId: artist.id, isTeam: false }, notifier);
  const [cleared] = await db.select().from(assets).where(eq(assets.id, card.id));
  assert.strictEqual(cleared.priorityAt, null, "The artist clears the mark on their own card");

  await setCardPriority(card.sku, { priority: true }, { personnelId: artist.id, isTeam: false }, notifier);
  assert.strictEqual(sent.length, 1, "An artist marking their own card isn't messaged");
  console.log("Confirmed priority cards");
}

test()
  .then(async () => {
    await cleanup();
    console.log("✓ All priority assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
