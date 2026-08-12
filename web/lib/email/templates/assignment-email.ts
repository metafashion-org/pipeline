export interface AssignmentEmailBriefField {
  key: string;
  displayName: string;
  value: string;
}

export interface AssignmentEmailData {
  sku: string;
  itemName: string;
  category?: string | null;
  artistName: string;
  feeAmount?: string | null;
  mannequinRig?: string | null;
  technicalSpecs?: string | null;
  recolours?: string | null;
  refImageUrls?: string[];
  wipInstruction?: string;
  // Admin-toggleable via curation_field_config.includeInArtistEmail (P3-T9) —
  // rendered as extra rows in the spec table, with no code change required
  // to add/remove a field from future emails.
  briefFields?: AssignmentEmailBriefField[];
}

export function formatAssignmentEmailSubject(data: { sku: string; itemName: string }): string {
  // Live sheet format: "Meta Fashion Assignment | {SKU} | {Item Name}"
  return `Meta Fashion Assignment | ${data.sku} | ${data.itemName}`;
}

export function renderAssignmentEmailHtml(data: AssignmentEmailData): string {
  const refLinksHtml = (data.refImageUrls || [])
    .map((url) => `<li><a href="${url}" target="_blank" style="color: #2563eb;">${url}</a></li>`)
    .join("");

  const briefFieldRowsHtml = (data.briefFields || [])
    .map(
      (field, i) => `
      <tr style="${i % 2 === 0 ? "background: #f4f4f5;" : ""}">
        <td style="padding: 8px; font-weight: bold; width: 35%;">${field.displayName}</td>
        <td style="padding: 8px;">${field.value}</td>
      </tr>`
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${formatAssignmentEmailSubject(data)}</title>
</head>
<body style="font-family: Arial, sans-serif; background-color: #f4f4f5; color: #18181b; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; padding: 24px; border-radius: 8px; border: 1px solid #e4e4e7;">
    <h2 style="color: #09090b; border-b: 2px solid #2563eb; padding-bottom: 8px; margin-top: 0;">
      Meta Fashion Assignment
    </h2>
    <p>Hi <strong>${data.artistName}</strong>,</p>
    <p>You have been assigned a new 3D Digital Asset item for production.</p>
    
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr style="background: #f4f4f5;">
        <td style="padding: 8px; font-weight: bold; width: 35%;">SKU ID</td>
        <td style="padding: 8px; font-family: monospace;">${data.sku}</td>
      </tr>
      <tr>
        <td style="padding: 8px; font-weight: bold;">Item Name</td>
        <td style="padding: 8px;">${data.itemName}</td>
      </tr>
      <tr style="background: #f4f4f5;">
        <td style="padding: 8px; font-weight: bold;">Category</td>
        <td style="padding: 8px;">${data.category || "N/A"}</td>
      </tr>
      <tr>
        <td style="padding: 8px; font-weight: bold;">Production Fee</td>
        <td style="padding: 8px;">${data.feeAmount ? `$${data.feeAmount}` : "As agreed"}</td>
      </tr>
      ${briefFieldRowsHtml}
    </table>

    ${refLinksHtml ? `
    <h4 style="margin-bottom: 6px;">Reference & Moodboard Links:</h4>
    <ul style="padding-left: 20px; margin-top: 0;">
      ${refLinksHtml}
    </ul>
    ` : ""}

    <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 12px; margin: 16px 0; font-size: 13px; color: #991b1b;">
      <strong>IMPORTANT WARNING:</strong> Do NOT upload the final asset directly to Roblox yourself. All assets must be submitted through the Meta Fashion Pipeline for Roblox Publisher review and upload.
    </div>

    <p style="font-size: 13px; color: #52525b;">
      Please reply directly to this email thread with WIP updates, questions, or revision requests.
    </p>

    <p style="margin-top: 24px; font-size: 12px; color: #71717a; border-top: 1px solid #e4e4e7; padding-top: 12px;">
      Meta Fashion Digital Assets Pipeline &bull; Automated System
    </p>
  </div>
</body>
</html>
  `.trim();
}
