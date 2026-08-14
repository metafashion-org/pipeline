import { db } from "./client";
import { personnel } from "./schema/personnel";
import { assets } from "./schema/assets";

// Deterministic fixtures for e2e tests: three personnel spanning roles (admin, artist, publisher)
// and five assets spread across different kanban statuses, so a freshly seeded board has cards to
// render. IDs and emails are fixed so tests can assert on specific rows. Safe to re-run: rows that
// already exist (matched by the unique email/sku) are left untouched.

const ADMIN_ID = "11111111-1111-1111-1111-111111111001";
const ARTIST_ID = "11111111-1111-1111-1111-111111111002";
const PUBLISHER_ID = "11111111-1111-1111-1111-111111111003";

export const E2E_PERSONNEL = [
  { id: ADMIN_ID, name: "E2E Admin", email: "e2e-admin@example.test", roles: ["admin"] },
  { id: ARTIST_ID, name: "E2E Artist", email: "e2e-artist@example.test", roles: ["artist"] },
  { id: PUBLISHER_ID, name: "E2E Publisher", email: "e2e-publisher@example.test", roles: ["publisher"] },
];

export const E2E_ASSETS = [
  { id: "22222222-2222-2222-2222-222222222001", sku: "E2E-SKU-001", itemName: "E2E Unassigned Hoodie", currentStatus: "unassigned", currentArtistId: null },
  { id: "22222222-2222-2222-2222-222222222002", sku: "E2E-SKU-002", itemName: "E2E In-Progress Jacket", currentStatus: "in_progress", currentArtistId: ARTIST_ID },
  { id: "22222222-2222-2222-2222-222222222003", sku: "E2E-SKU-003", itemName: "E2E In-Review Cap", currentStatus: "in_review", currentArtistId: ARTIST_ID },
  { id: "22222222-2222-2222-2222-222222222004", sku: "E2E-SKU-004", itemName: "E2E Uploaded Sneakers", currentStatus: "uploaded_to_roblox", currentArtistId: ARTIST_ID },
  { id: "22222222-2222-2222-2222-222222222005", sku: "E2E-SKU-005", itemName: "E2E Paid Backpack", currentStatus: "payment_done", currentArtistId: ARTIST_ID },
];

export async function seedE2eFixtures() {
  console.log("Seeding e2e personnel fixtures...");
  await db.insert(personnel).values(E2E_PERSONNEL).onConflictDoNothing({ target: personnel.email });

  console.log("Seeding e2e asset fixtures...");
  await db.insert(assets).values(E2E_ASSETS).onConflictDoNothing({ target: assets.sku });

  console.log("E2E fixture seeding complete!");
}

// Allow direct execution via CLI
if (require.main === module) {
  seedE2eFixtures()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("E2E fixture seeding failed:", err);
      process.exit(1);
    });
}
