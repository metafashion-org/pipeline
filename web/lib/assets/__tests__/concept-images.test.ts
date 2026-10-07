import assert from "node:assert";
import { addSecondaryConceptImages, joinConceptImages, removeSecondaryConceptImage, setMainConceptImage, splitConceptImages } from "../concept-images";
import { toFileStoreEntries } from "../file-store";

const MAIN = "https://drive.google.com/file/d/main111111111/view";
const SECOND = "https://drive.google.com/file/d/second222222/view";
const THIRD = "https://drive.google.com/file/d/third3333333/view";

function testConceptImages() {
  console.log("Verifying the main concept image is always the first reference...");
  assert.deepStrictEqual(splitConceptImages(`${MAIN}\n${SECOND}\n${THIRD}`), { main: MAIN, secondaryText: `${SECOND}\n${THIRD}` }, "The first line is the main image");
  assert.deepStrictEqual(splitConceptImages(""), { main: "", secondaryText: "" }, "Nothing yet");
  assert.deepStrictEqual(splitConceptImages(`\n${SECOND}`), { main: "", secondaryText: SECOND }, "A cleared main image stays empty while editing");
  assert.strictEqual(joinConceptImages(MAIN, `${SECOND}\n`), `${MAIN}\n${SECOND}\n`, "Secondary text keeps a new line being typed");

  assert.strictEqual(setMainConceptImage(SECOND, MAIN), `${MAIN}\n${SECOND}`, "A new main image goes first and keeps the rest");
  assert.strictEqual(setMainConceptImage(`${MAIN}\n${SECOND}`, THIRD), `${THIRD}\n${MAIN}\n${SECOND}`, "The old main image becomes the first secondary one");
  assert.strictEqual(setMainConceptImage(`${MAIN}\n${SECOND}\n${THIRD}`, THIRD), `${THIRD}\n${MAIN}\n${SECOND}`, "Making a secondary image main moves it, without repeating it");

  assert.strictEqual(addSecondaryConceptImages(MAIN, [SECOND, THIRD]), `${MAIN}\n${SECOND}\n${THIRD}`, "Secondary uploads go after the main image");
  assert.strictEqual(addSecondaryConceptImages("", [SECOND]), `\n${SECOND}`, "Without a main image the slot stays open for one");
  assert.strictEqual(removeSecondaryConceptImage(`${MAIN}\n${SECOND}\n${THIRD}`, SECOND), `${MAIN}\n${THIRD}`, "Removing a secondary image keeps the main one first");

  assert.deepStrictEqual(
    toFileStoreEntries(`${MAIN}\n${SECOND}`).map((e) => e.externalId),
    [MAIN, SECOND],
    "Saved with the main image first"
  );
  assert.deepStrictEqual(
    toFileStoreEntries(`\n${SECOND}\n${THIRD}`).map((e) => e.externalId),
    [SECOND, THIRD],
    "Saved without a main image, the first secondary image comes first"
  );
  console.log("Confirmed concept images");
}

try {
  testConceptImages();
  console.log("✓ All concept image assertions passed!");
  process.exit(0);
} catch (err) {
  console.error("Test failed:", err);
  process.exit(1);
}
