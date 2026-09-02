import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

// Unauthenticated on purpose — a health check a load balancer can reach. It therefore says only
// whether the database answered. It used to return error.message, and a Postgres connection
// error carries the host, port, database name, role and SSL details, all to anyone who asked.
// The detail still goes to the server log, where an operator can read it.
export async function GET() {
  try {
    await db.execute(sql`select 1 as ok`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[health] database check failed:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
