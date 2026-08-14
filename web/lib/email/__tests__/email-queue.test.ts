import assert from "node:assert";
import { formatAssignmentEmailSubject, renderAssignmentEmailHtml } from "../templates/assignment-email";

function testEmailTemplatesAndQueue() {
  console.log("Verifying assignment email templates and subject formatting...");

  // 1. Subject format check
  const subject = formatAssignmentEmailSubject({ sku: "MF-101", itemName: "Cyber Helmet" });
  assert.strictEqual(
    subject,
    "Meta Fashion Assignment | MF-101 | Cyber Helmet",
    "Subject format must match live sheet standard"
  );

  // 2. HTML template check
  const html = renderAssignmentEmailHtml({
    sku: "MF-101",
    itemName: "Cyber Helmet",
    category: "Headwear",
    artistName: "Bob Smith",
    feeAmount: "200",
    refImageUrls: ["https://example.com/ref1.jpg"],
  });

  assert.ok(html.includes("MF-101"), "HTML body must contain SKU");
  assert.ok(html.includes("Cyber Helmet"), "HTML body must contain Item Name");
  assert.ok(html.includes("Bob Smith"), "HTML body must contain Artist Name");
  assert.ok(html.includes("IMPORTANT WARNING"), "HTML body must contain warning against early upload");

  console.log("✓ All P2-T17/P2-T18 email template & subject formatting assertions passed cleanly!");
}

testEmailTemplatesAndQueue();
