#!/usr/bin/env node
// Refuses to proceed unless DATABASE_URL resolves to localhost or 127.0.0.1, so the test-DB scripts
// can never accidentally run migrations or seeds against a real database. Input: the DATABASE_URL
// env var. Output: exits 0 and prints the host if it's local, exits 1 with an error message otherwise.

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("assert-local-db: DATABASE_URL is not set");
  process.exit(1);
}

let host;
try {
  host = new URL(url).hostname;
} catch {
  console.error(`assert-local-db: DATABASE_URL is not a valid URL: ${url}`);
  process.exit(1);
}

if (host !== "localhost" && host !== "127.0.0.1") {
  console.error(`assert-local-db: refusing to proceed — DATABASE_URL host is "${host}", not localhost/127.0.0.1`);
  process.exit(1);
}

console.log(`assert-local-db: OK (host is ${host})`);
