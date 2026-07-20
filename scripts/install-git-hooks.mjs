#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedHooksPath = ".githooks";

function runGit(args) {
  return spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const repository = runGit(["rev-parse", "--show-toplevel"]);
if (repository.status !== 0) {
  console.log("[git-hooks] Skipped: this installation is not inside a Git checkout.");
  process.exit(0);
}

const configuredPath = runGit(["config", "--local", "--get", "core.hooksPath"]);
const currentHooksPath = configuredPath.status === 0 ? configuredPath.stdout.trim() : "";
const expectedAbsolutePath = resolve(repositoryRoot, expectedHooksPath);
const currentAbsolutePath = currentHooksPath ? resolve(repositoryRoot, currentHooksPath) : "";

if (currentHooksPath && currentAbsolutePath !== expectedAbsolutePath) {
  console.warn(
    `[git-hooks] Skipped: core.hooksPath is already set to ${currentHooksPath}. ` +
      `Integrate scripts/validate-commit-message.mjs with that hook path manually.`,
  );
  process.exit(0);
}

if (!currentHooksPath) {
  const configured = runGit(["config", "--local", "core.hooksPath", expectedHooksPath]);
  if (configured.status !== 0) {
    console.error(configured.stderr.trim() || "[git-hooks] Could not configure core.hooksPath.");
    process.exit(1);
  }
}

if (process.platform !== "win32") {
  chmodSync(resolve(repositoryRoot, expectedHooksPath, "commit-msg"), 0o755);
}

console.log(`[git-hooks] Conventional Commit validation enabled from ${expectedHooksPath}.`);
