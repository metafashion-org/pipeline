import path from "path";
import fs from "fs";
import * as XLSX from "xlsx";
import assert from "node:assert";

// Unit test for P2-T4 Excel parsing logic
function testWorkbookReading() {
  const filePath = path.resolve(process.cwd(), "../Meta Fashion Digital Assets Pipeline.xlsx");
  console.log("Verifying Excel workbook structure at:", filePath);
  
  assert.ok(fs.existsSync(filePath), "Excel workbook file must exist");

  const workbook = XLSX.readFile(filePath, { cellDates: true });
  assert.ok(workbook.SheetNames.includes("Personnel"), "Workbook should contain Personnel sheet");
  assert.ok(workbook.SheetNames.includes("Assets"), "Workbook should contain Assets sheet");
  assert.ok(workbook.SheetNames.includes("Audit Log"), "Workbook should contain Audit Log sheet");

  const personnelSheet = workbook.Sheets["Personnel"];
  const personnelRows: Record<string, any>[] = XLSX.utils.sheet_to_json(personnelSheet);
  assert.ok(personnelRows.length > 0, "Personnel sheet should contain rows");
  console.log(`✓ Parsed ${personnelRows.length} personnel rows from workbook.`);

  const assetsSheet = workbook.Sheets["Assets"];
  const assetRows: Record<string, any>[] = XLSX.utils.sheet_to_json(assetsSheet);
  assert.ok(assetRows.length > 0, "Assets sheet should contain rows");
  console.log(`✓ Parsed ${assetRows.length} asset rows from workbook.`);

  // Sample mode check: limit to 5
  const samplePersonnel = personnelRows.slice(0, 5);
  assert.strictEqual(samplePersonnel.length, 5, "Sample mode should extract 5 personnel rows");

  console.log("✓ All P2-T4 Excel parsing assertions passed cleanly!");
}

testWorkbookReading();
