import assert from "node:assert";
import { parseRobloxCatalogLink, parseRobloxLinkLines, splitRobloxLinkText } from "../roblox-links";

// The Uploader Queue takes one Roblox link per line and has to say which line is wrong before it records anything. Every case below is what an uploader can actually paste in: the real catalog URL they copied from the browser, that URL with a share query string still on it, a Roblox link to something that is not a catalog item, and a link to somewhere else entirely.

const REAL_LINK = "https://www.roblox.com/catalog/116109904627748/Birthday-Time-Fedora";

function testSingleLinkParsing() {
  console.log("Verifying single Roblox catalog link parsing...");

  const parsed = parseRobloxCatalogLink(REAL_LINK);
  assert.notStrictEqual(typeof parsed, "string", `The reference link must validate, got: ${parsed}`);
  if (typeof parsed === "string") return;
  assert.strictEqual(parsed.assetId, "116109904627748", "The catalog id must come from the link's path");
  assert.strictEqual(parsed.slug, "Birthday-Time-Fedora", "The item name segment must be read out for display");
  assert.strictEqual(parsed.url, REAL_LINK, "A clean link must be stored unchanged");

  // Share and referral parameters are on every link copied out of a logged-in browser session. Two links to the same item must not be stored as two different strings.
  const withQuery = parseRobloxCatalogLink(`${REAL_LINK}?refPageId=abc-123#comments`);
  assert.notStrictEqual(typeof withQuery, "string", "A link with a query string is still a valid link");
  if (typeof withQuery !== "string") {
    assert.strictEqual(withQuery.url, REAL_LINK, "The query string and fragment must be dropped before storing");
  }

  // Roblox redirects a link with no name segment, so accept it and just have no slug to show.
  const noSlug = parseRobloxCatalogLink("https://www.roblox.com/catalog/116109904627748");
  assert.notStrictEqual(typeof noSlug, "string", "A catalog link without the name segment is valid");
  if (typeof noSlug !== "string") {
    assert.strictEqual(noSlug.assetId, "116109904627748", "The id must still be read without a name segment");
    assert.strictEqual(noSlug.slug, null, "There is no name segment to report");
  }

  // Whitespace comes free with any paste.
  assert.notStrictEqual(typeof parseRobloxCatalogLink(`  ${REAL_LINK}  `), "string", "Surrounding whitespace must not fail a link");

  // roblox.com without the www, and the mobile host, are the same item.
  assert.notStrictEqual(typeof parseRobloxCatalogLink("https://roblox.com/catalog/1/Hat"), "string", "roblox.com without www is a Roblox address");
  assert.notStrictEqual(typeof parseRobloxCatalogLink("https://m.roblox.com/catalog/1/Hat"), "string", "m.roblox.com is a Roblox address");

  console.log("✓ Valid catalog links parse and normalise as expected");
}

function testRejections() {
  console.log("Verifying links that must be rejected...");

  const rejected: [string, string][] = [
    ["", "an empty line"],
    ["   ", "whitespace only"],
    ["Birthday Time Fedora", "free text that is not a URL"],
    ["www.roblox.com/catalog/116109904627748", "a bare host with no scheme, which is not a parseable URL"],
    ["https://www.roblox.com/games/1818/Classic-Crossroads", "a Roblox link that is not a catalog item"],
    ["https://www.roblox.com/catalog/", "a catalog link with no id"],
    ["https://www.roblox.com/catalog/not-a-number/Hat", "a non-numeric id"],
    ["https://www.roblox.com/catalog/0116109904627748/Hat", "a zero-padded id, which Roblox never issues"],
    ["https://roblox.com.evil.example/catalog/1/Hat", "a lookalike host"],
    ["https://www.example.com/catalog/116109904627748/Hat", "the right path on the wrong site"],
    ["ftp://www.roblox.com/catalog/1/Hat", "a protocol that is not http or https"],
  ];

  for (const [input, description] of rejected) {
    const result = parseRobloxCatalogLink(input);
    assert.strictEqual(typeof result, "string", `Must reject ${description}: ${JSON.stringify(input)}`);
    assert.ok((result as string).length > 0, `The rejection of ${description} must carry a reason`);
  }

  console.log("✓ Every invalid shape is rejected with a reason");
}

function testPerLineValidation() {
  console.log("Verifying per-line validation across a whole list...");

  const lines = [
    REAL_LINK,
    "not a link",
    "",
    "https://www.roblox.com/catalog/222222222/Second-Item",
    "https://www.roblox.com/catalog/116109904627748/Birthday-Time-Fedora",
  ];
  const { valid, invalid } = parseRobloxLinkLines(lines);

  assert.strictEqual(valid.length, 2, "Two distinct catalog links must validate");
  assert.deepStrictEqual(valid.map((v) => v.line), [1, 4], "Line numbers must be 1-based positions in the input");
  assert.deepStrictEqual(valid.map((v) => v.assetId), ["116109904627748", "222222222"], "Each valid line carries its own id");

  // Line 3 is blank and is skipped rather than reported; line 2 is junk and line 5 repeats line 1.
  assert.strictEqual(invalid.length, 2, "Only the junk line and the duplicate are reported");
  assert.deepStrictEqual(invalid.map((i) => i.line), [2, 5], "A blank line is skipped, not reported as an error");
  assert.ok(invalid[1].reason.includes("line 1"), `A duplicate must name the line it repeats, got: ${invalid[1].reason}`);

  // The blank line still occupies its position, so the numbering an uploader sees matches what the API reports back.
  assert.strictEqual(valid[1].line, 4, "A skipped blank line must not shift later line numbers");

  const allGood = parseRobloxLinkLines([REAL_LINK]);
  assert.strictEqual(allGood.invalid.length, 0, "A single good link must produce no errors");

  console.log("✓ Validation is applied per line, with line numbers that survive blanks");
}

function testTextSplitting() {
  console.log("Verifying pasted multi-line text splits into one link per line...");

  const pasted = `${REAL_LINK}\r\nhttps://www.roblox.com/catalog/222222222/Second-Item\n\n   \nhttps://www.roblox.com/catalog/333333333/Third-Item`;
  const lines = splitRobloxLinkText(pasted);
  assert.strictEqual(lines.length, 3, "Blank and whitespace-only lines must be dropped from a paste");
  assert.strictEqual(lines[0], REAL_LINK, "Windows line endings must not leave a trailing carriage return");

  console.log("✓ Pasted text becomes one candidate link per line");
}

testSingleLinkParsing();
testRejections();
testPerLineValidation();
testTextSplitting();
console.log("✓ All Roblox link assertions passed cleanly!");
process.exit(0);
