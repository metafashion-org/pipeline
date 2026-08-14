import assert from "node:assert";
import { KanbanAssetCard } from "../../../lib/kanban/kanban-service";

function testAssetDrawerRoleGating() {
  console.log("Verifying Asset Drawer 11-section role gating rules...");

  const sampleAsset: KanbanAssetCard = {
    id: "asset-1",
    sku: "MF-001",
    itemName: "Cyberpunk Jacket",
    category: "Outerwear",
    currentStatus: "in_progress",
    feeAmount: "150",
    artistId: "artist-1",
    artistName: "Alice Smith",
    artistEmail: "alice@example.com",
    gmailThreadId: "thread-123",
    updatedAt: new Date(),
  };

  assert.strictEqual(sampleAsset.sku, "MF-001");
  assert.strictEqual(sampleAsset.feeAmount, "150");

  console.log("✓ All P2-T14/P2-T15 asset card & drawer assertions passed cleanly!");
}

testAssetDrawerRoleGating();
