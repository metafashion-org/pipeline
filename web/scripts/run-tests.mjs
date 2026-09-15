#!/usr/bin/env node
// Finds every *.test.ts file under app/, lib/, components/__tests__/ directories and hands the
// explicit file list to tsx --test.
//
// This used to be a single glob string passed straight to `node:test`'s own CLI glob matching
// ("{app,lib,components}/**/__tests__/*.test.ts"). That relies on the installed Node version's
// support for glob-pattern positional arguments to --test, which is newer than CI's pinned Node
// 20 — so the pattern (braces or not) silently matched zero files there, and pnpm test failed
// before running a single test on every PR. Resolving the file list ourselves with
// fs.readdirSync's recursive option (stable since Node 20.1) and passing explicit paths sidesteps
// that version dependency entirely: every Node version can run an explicit list of files.

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

function findTestFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      found.push(join(entry.parentPath ?? entry.path, entry.name));
    }
  }
  return found;
}

const files = ["app", "lib", "components"].flatMap(findTestFiles);

if (files.length === 0) {
  console.error("No *.test.ts files found under app/, lib/, components/ — expected at least one.");
  process.exit(1);
}

// Invoked as `node <tsx cli.mjs> ...` (process.execPath, no shell) rather than spawning the
// "tsx" shell command. shell:true builds one command-line string for cmd.exe on Windows, and
// cmd.exe treats "(" and ")" as special characters — which this repo's own file paths contain
// (app/(shell)/...), so every run failed there before a single test ran. Resolving tsx's real
// CLI entry point and running it directly through node sidesteps the shell entirely, which also
// avoids relying on a PATH-shimmed "tsx" command existing at all.
//
// tsx's package.json "exports" doesn't expose "./dist/cli.mjs" for require.resolve — only
// "tsx/package.json" itself is guaranteed resolvable — so the bin path is read out of the
// package's own declared "bin" field and joined against where that package.json actually lives.
const require = createRequire(import.meta.url);
const tsxPkgPath = require.resolve("tsx/package.json");
const tsxPkg = JSON.parse(readFileSync(tsxPkgPath, "utf8"));
const tsxCli = join(dirname(tsxPkgPath), tsxPkg.bin);

const result = spawnSync(process.execPath, [tsxCli, "--test", "--test-concurrency=1", ...files], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
