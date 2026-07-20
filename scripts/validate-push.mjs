#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateCommitHashes } from "./validate-commit-message.mjs";
import { validateCommitChanges } from "./validate-staged-files.mjs";

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const ZERO_SHA_PATTERN = /^0{40}$/;
const PROTECTED_BRANCH_REFS = new Set(["refs/heads/main"]);
const RELEASE_TAG_PATTERN = /^refs\/tags\/v\d+\.\d+\.\d+$/;

function runGit(args, options = {}) {
  return spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function gitOutput(args) {
  const result = runGit(args);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "Unknown Git error.";
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout;
}

function gitCommitExists(revision) {
  return runGit(["rev-parse", "--verify", "--quiet", `${revision}^{commit}`], {
    stdio: "ignore",
  }).status === 0;
}

export function parsePushUpdates(input) {
  return input.split(/\r?\n/).filter(Boolean).map((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4) {
      throw new Error(`Invalid pre-push update: ${line}`);
    }
    const [localRef, localSha, remoteRef, remoteSha] = fields;
    if (!FULL_SHA_PATTERN.test(localSha) || !FULL_SHA_PATTERN.test(remoteSha)) {
      throw new Error(`Invalid pre-push object ID: ${line}`);
    }
    return { localRef, localSha, remoteRef, remoteSha };
  });
}

export function pushedCommitHashes(remoteName, updates) {
  if (!remoteName.trim()) throw new Error("The pre-push remote name is empty.");
  const hashes = new Set();

  for (const { localSha, remoteSha } of updates) {
    if (ZERO_SHA_PATTERN.test(localSha) || !gitCommitExists(localSha)) continue;

    const revisions = [localSha, "--not"];
    if (!ZERO_SHA_PATTERN.test(remoteSha) && gitCommitExists(remoteSha)) {
      revisions.push(remoteSha);
    }
    revisions.push(`--remotes=${remoteName}`);
    const updateHashes = gitOutput(["rev-list", "--reverse", ...revisions])
      .split(/\r?\n/)
      .filter(Boolean);
    updateHashes.forEach((hash) => hashes.add(hash));
  }

  return [...hashes];
}

function mergeCommitsIntroducedToBranch(remoteName, localSha, remoteSha) {
  const revisions = ["rev-list", "--min-parents=2", localSha];
  if (!ZERO_SHA_PATTERN.test(remoteSha) && gitCommitExists(remoteSha)) {
    revisions.push(`^${remoteSha}`);
  } else {
    revisions.push("--not", `--remotes=${remoteName}`);
  }
  return gitOutput(revisions).split(/\r?\n/).filter(Boolean);
}

function validateProtectedRefs(remoteName, updates) {
  const errors = [];

  for (const { localSha, remoteRef, remoteSha } of updates) {
    if (PROTECTED_BRANCH_REFS.has(remoteRef)) {
      if (ZERO_SHA_PATTERN.test(localSha)) {
        errors.push(`${remoteRef} must not be deleted.`);
      } else {
        if (!ZERO_SHA_PATTERN.test(remoteSha)) {
          if (!gitCommitExists(remoteSha)) {
            errors.push(`Cannot verify the current ${remoteRef} commit locally; fetch the remote and retry.`);
          } else {
            const ancestor = runGit(["merge-base", "--is-ancestor", remoteSha, localSha], {
              stdio: "ignore",
            });
            if (ancestor.status === 1) {
              errors.push(`${remoteRef} must not be force-pushed or updated non-fast-forward.`);
            } else if (ancestor.status !== 0) {
              errors.push(`Could not verify fast-forward safety for ${remoteRef}.`);
            }
          }
        }
        if (mergeCommitsIntroducedToBranch(remoteName, localSha, remoteSha).length > 0) {
          errors.push(`${remoteRef} requires a linear history and must not introduce merge commits.`);
        }
      }
    }

    if (RELEASE_TAG_PATTERN.test(remoteRef) && !ZERO_SHA_PATTERN.test(remoteSha)) {
      errors.push(`${remoteRef} is immutable and must not be moved or deleted.`);
    }
  }

  if (errors.length === 0) {
    console.log("Validated protected branch and release-tag updates.");
    return true;
  }

  console.error("Unsafe protected ref updates detected:");
  errors.forEach((error) => console.error(`  ${error}`));
  return false;
}

function printUsage() {
  console.error("Usage: node scripts/validate-push.mjs <remote-name> [remote-location]");
}

function main(argv) {
  const [remoteName, _remoteLocation, ...extra] = argv;
  if (!remoteName || extra.length > 0) {
    printUsage();
    return 2;
  }

  try {
    const updates = parsePushUpdates(readFileSync(0, "utf8"));
    const hashes = pushedCommitHashes(remoteName, updates);
    const refsValid = validateProtectedRefs(remoteName, updates);
    const messagesValid = validateCommitHashes(hashes, `push to ${remoteName}`);
    const changesValid = validateCommitChanges(hashes, `push to ${remoteName}`);
    return refsValid && messagesValid && changesValid ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) process.exitCode = main(process.argv.slice(2));
