import assert from "node:assert";
import { parseDriveRefs, extractDriveFileId, driveThumbnailUrl } from "../drive-links";

// Every input below is a real shape observed in the live `assets.reference_images` column,
// which was populated by copying Google Sheet cells verbatim during the sheet import.
// The messy cases (multiple comma-joined URLs in one cell, free text where a link was expected)
// are the reason this parser exists at all rather than the UI reading externalId directly.

function testDriveLinkParsing() {
  console.log("Verifying Drive reference parsing...");

  // Single open?id= URL, the most common live shape.
  const single = parseDriveRefs([
    { provider: "drive", externalId: "https://drive.google.com/open?id=1uxOojyuNuRWkewqbO4xSMg5tZdimpMxh" },
  ]);
  assert.strictEqual(single.length, 1, "One URL must yield one ref");
  assert.strictEqual(single[0].fileId, "1uxOojyuNuRWkewqbO4xSMg5tZdimpMxh", "File id must be extracted from open?id=");

  // One cell holding three comma-joined URLs must become three separate refs.
  const multi = parseDriveRefs([
    {
      provider: "drive",
      externalId:
        "https://drive.google.com/open?id=1WrUBzb0J5T1EhJM73LSMX7UCg3bB-Lb0, https://drive.google.com/open?id=1ay57QlXm8kRNQGFCx05wItCSfs7A2kqw, https://drive.google.com/open?id=1W8_nj4CiFd5g8RY9_Ta_4g20ZTP87sl2",
    },
  ]);
  assert.strictEqual(multi.length, 3, "A comma-joined cell must split into one ref per URL");
  assert.ok(multi.every((r) => r.fileId), "Every URL in a multi-link cell must yield a file id");

  // Free text that is not a link must be dropped entirely, not rendered as a broken image.
  assert.deepStrictEqual(
    parseDriveRefs([{ provider: "drive", externalId: "Will share as we work!" }]),
    [],
    "Free text must yield no refs"
  );
  assert.deepStrictEqual(
    parseDriveRefs([{ provider: "drive", externalId: "Non-PBR 2D View Static Accessories" }]),
    [],
    "Descriptive text must yield no refs"
  );

  // Empty / absent / wrong-typed column values must not throw.
  assert.deepStrictEqual(parseDriveRefs([]), [], "Empty array must yield no refs");
  assert.deepStrictEqual(parseDriveRefs(null), [], "Null column must yield no refs");
  assert.deepStrictEqual(parseDriveRefs("not an array"), [], "Non-array column must yield no refs");

  // A folder link is a real link but not a previewable file: it must survive with fileId null.
  const folder = parseDriveRefs([
    { provider: "drive", externalId: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv" },
  ]);
  assert.strictEqual(folder.length, 1, "A folder link must still be surfaced");
  assert.strictEqual(folder[0].fileId, null, "A folder link must not be treated as a previewable file");

  // The /file/d/<id>/view share form must also resolve.
  assert.strictEqual(
    extractDriveFileId("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view?usp=sharing"),
    "1AbCdEfGhIjKlMnOpQrStUv",
    "File id must be extracted from the /file/d/ share form"
  );

  // The same URL repeated across entries must be shown once, not twice.
  const deduped = parseDriveRefs([
    { provider: "drive", externalId: "https://drive.google.com/open?id=1uxOojyuNuRWkewqbO4xSMg5tZdimpMxh" },
    { provider: "drive", externalId: "https://drive.google.com/open?id=1uxOojyuNuRWkewqbO4xSMg5tZdimpMxh" },
  ]);
  assert.strictEqual(deduped.length, 1, "Duplicate URLs must be collapsed");

  // References render straight from Drive's public thumbnail endpoint, with no proxy or credentials in the path.
  assert.strictEqual(
    driveThumbnailUrl("1uxOoj"),
    "https://drive.google.com/thumbnail?id=1uxOoj&sz=w640",
    "Thumbnail URL must target Drive's credential-free thumbnail endpoint"
  );

  console.log("✓ All Drive reference parsing assertions passed cleanly!");
}

testDriveLinkParsing();
process.exit(0);
