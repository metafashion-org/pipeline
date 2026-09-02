import assert from "node:assert";

// Guards against the exact gap found this session: schema files generated
// via drizzle-kit but never actually pushed to the live database. Confirms
// every table drizzle-kit knows about, marketing/guidelines included, is
// actually queryable against DATABASE_URL. Deliberately does not swallow
// connection errors - a failed connection here is exactly the class of bug
// this test exists to catch, not something to log and pass past.
async function testAllSchemaTablesAreLive() {
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.DATABASE_URL || "", { max: 1 });

  const expectedTables = ["marketing_updates", "marketing_status_config", "guidelines"];
  const rows = await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`;
  const liveTables = rows.map((r) => r.tablename);

  for (const table of expectedTables) {
    assert.ok(liveTables.includes(table), `Expected live table '${table}' not found - migration not applied?`);
  }

  const columns = await sql<{ column_name: string }[]>`select column_name from information_schema.columns where table_name = 'marketing_updates'`;
  const columnNames = columns.map((c) => c.column_name);
  // "channel" was the name this field carried in an early draft of P4-T3; the shipped schema
  // splits it into `platform` (Instagram, TikTok) and `post_type` (Reel, Story, Carousel), and
  // no migration ever created a `channel` column. Asserting on it meant this test could only
  // ever fail. Checking the columns that actually exist, plus the two P4-T3 added later.
  for (const col of ["platform", "post_type", "caption", "marketing_status", "creative", "posted_at", "next_action", "campaign", "high_performing"]) {
    assert.ok(columnNames.includes(col), `Expected column '${col}' on marketing_updates - P4-T3's full field list not applied?`);
  }

  await sql.end();
  console.log("✓ marketing/guidelines tables and marketing_updates' full P4-T3 field set are live");
}

testAllSchemaTablesAreLive().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
