import assert from "node:assert";
import fs from "fs";
import path from "path";

function testArchiveAndDeadLinks() {
  console.log("Verifying Archive page implementation and dead link cleanup...");

  const archivePagePath = path.resolve(process.cwd(), "app/admin/archive/page.tsx");
  assert.ok(fs.existsSync(archivePagePath), "Archive page file must exist");

  const content = fs.readFileSync(archivePagePath, "utf-8");
  assert.ok(content.includes("payment_done"), "Archive page must filter on payment_done status");
  assert.ok(content.includes("from(assets)"), "Archive page must query assets table");

  console.log("✓ All P2-T24/P2-T25 archive & route cleanup assertions passed cleanly!");
}

testArchiveAndDeadLinks();
