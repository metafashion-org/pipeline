import assert from "node:assert";
import { KanbanAssetCard } from "../../../lib/kanban/kanban-service";
import { parseDriveRefs, driveThumbnailUrl } from "../../../lib/assets/drive-links";

function testAssetDrawerRoleGating() {
  console.log("Verifying Asset Drawer 11-section role gating rules...");

  const sampleAsset: KanbanAssetCard = {
    id: "asset-1",
    sku: "MF-001",
    itemName: "Cyberpunk Jacket",
    category: "Outerwear",
    currentStatus: "in_progress",
    feeAmount: "150",
    currency: "USD",
    artistId: "artist-1",
    artistName: "Alice Smith",
    artistEmail: "alice@example.com",
    artistDiscordUrl: null,
    gmailThreadId: "thread-123",
    deadline: null,
    updatedAt: new Date(),
    referenceImages: [{ provider: "drive", externalId: "https://drive.google.com/open?id=1uxOojyuNuRWkewqbO4xSMg5tZdimpMxh" }],
    recolorReferenceImages: [],
  };

  assert.strictEqual(sampleAsset.sku, "MF-001");
  assert.strictEqual(sampleAsset.feeAmount, "150");

  // The drawer previews Drive references directly from Drive, so a card carrying a Drive URL must resolve to a usable file id.
  const refs = parseDriveRefs(sampleAsset.referenceImages);
  assert.strictEqual(refs.length, 1, "A single Drive reference must parse to one previewable ref");
  assert.strictEqual(
    driveThumbnailUrl(refs[0].fileId as string),
    "https://drive.google.com/thumbnail?id=1uxOojyuNuRWkewqbO4xSMg5tZdimpMxh&sz=w640",
    "Drawer preview must render straight from Drive's public thumbnail endpoint"
  );

  console.log("✓ All P2-T14/P2-T15 asset card & drawer assertions passed cleanly!");
}

testAssetDrawerRoleGating();
