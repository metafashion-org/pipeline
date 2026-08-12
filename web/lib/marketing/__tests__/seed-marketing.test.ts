import { seedMarketingStatuses } from "../marketing-service";

async function runSeed() {
  console.log("Seeding marketing statuses...");
  try {
    await seedMarketingStatuses();
    console.log("✓ Marketing statuses seeded successfully!");
  } catch (err: any) {
    console.log("Seed result:", err.message);
  }
}

runSeed().then(() => process.exit(0));
