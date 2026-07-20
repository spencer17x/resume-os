#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ALLOWED_COMMIT_TYPES = [
  "feat",
  "fix",
  "docs",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];
export const MAX_COMMIT_SUBJECT_LENGTH = 100;

const COMMIT_SUBJECT_PATTERN = new RegExp(
  `^(${ALLOWED_COMMIT_TYPES.join("|")})(\\([a-z0-9._/-]+\\))?(!)?: \\S.*$`,
);
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const ZERO_SHA_PATTERN = /^0{40}$/;

const FORMAT_HELP = [
  "Expected: <type>(<optional-scope>): <imperative summary>",
  `Allowed types: ${ALLOWED_COMMIT_TYPES.join(", ")}`,
  `Maximum subject length: ${MAX_COMMIT_SUBJECT_LENGTH} characters`,
  "Examples:",
  "  feat(agent): support Chinese local AI tasks",
  "  fix(api): reject redirected provider requests",
].join("\n");

export function commitSubjectFromMessage(message) {
  return message.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
}

export function commitSubjectError(subject) {
  if (subject.length === 0) {
    return "The commit subject is empty.";
  }

  if (subject !== subject.trim()) {
    return "The commit subject must not start or end with whitespace.";
  }

  if (subject.length > MAX_COMMIT_SUBJECT_LENGTH) {
    return `The commit subject must not exceed ${MAX_COMMIT_SUBJECT_LENGTH} characters.`;
  }

  if (!COMMIT_SUBJECT_PATTERN.test(subject)) {
    return "The commit subject is not a valid Conventional Commit.";
  }

  if (subject.endsWith(".")) {
    return "The commit subject must not end with a period.";
  }

  return null;
}

export function resolveCiCommitRange(
  { eventName, beforeSha, baseSha, headSha },
  commitExists = () => true,
) {
  if (!FULL_SHA_PATTERN.test(headSha ?? "")) {
    throw new Error("HEAD_SHA must be a full 40-character Git commit SHA.");
  }

  if (eventName === "pull_request") {
    if (!FULL_SHA_PATTERN.test(baseSha ?? "")) {
      throw new Error("BASE_SHA must be a full 40-character Git commit SHA for pull requests.");
    }

    return `${baseSha}..${headSha}`;
  }

  if (eventName !== "push") {
    throw new Error(`Unsupported GitHub event: ${eventName || "<empty>"}.`);
  }

  if (
    FULL_SHA_PATTERN.test(beforeSha ?? "") &&
    !ZERO_SHA_PATTERN.test(beforeSha) &&
    commitExists(beforeSha)
  ) {
    return `${beforeSha}..${headSha}`;
  }

  const parentRevision = `${headSha}^`;
  return commitExists(parentRevision) ? `${parentRevision}..${headSha}` : headSha;
}

function runGit(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "Unknown Git error.";
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }

  return result.stdout;
}

function gitCommitExists(revision) {
  const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`], {
    encoding: "utf8",
    stdio: "ignore",
  });

  return result.status === 0;
}

export function validateSubjectOrReport(subject, label) {
  const error = commitSubjectError(subject);
  if (!error) {
    return true;
  }

  console.error(`Invalid commit message (${label}):`);
  console.error(`  ${subject || "<empty>"}`);
  console.error(`\n${error}\n${FORMAT_HELP}`);
  return false;
}

function validateMessageFile(filePath) {
  const message = readFileSync(resolve(filePath), "utf8");
  const subject = commitSubjectFromMessage(message);
  return validateSubjectOrReport(subject, filePath);
}

export function validateCommitHashes(hashes, label) {
  if (hashes.length === 0) {
    console.log(`No commits found in ${label}.`);
    return true;
  }

  let valid = true;

  for (const hash of hashes) {
    const subject = runGit(["show", "-s", "--format=%s", hash]).replace(/\r?\n$/, "");
    valid = validateSubjectOrReport(subject, hash.slice(0, 12)) && valid;
  }

  if (valid) {
    console.log(`Validated ${hashes.length} Conventional Commit message${hashes.length === 1 ? "" : "s"}.`);
  }

  return valid;
}

function validateCommitRange(range) {
  const hashes = runGit(["rev-list", "--reverse", range])
    .split(/\r?\n/)
    .filter(Boolean);
  return validateCommitHashes(hashes, range);
}

function printUsage() {
  console.error(
    "Usage: node scripts/validate-commit-message.mjs --file <commit-message-file> | --subject <subject> | --range <base..head> | --ci",
  );
}

function main(argv) {
  const [mode, value, ...extra] = argv;
  if (extra.length > 0) {
    printUsage();
    return 2;
  }

  try {
    if (mode === "--file" && value) {
      return validateMessageFile(value) ? 0 : 1;
    }

    if (mode === "--subject" && value !== undefined) {
      return validateSubjectOrReport(value, "subject") ? 0 : 1;
    }

    if (mode === "--range" && value) {
      return validateCommitRange(value) ? 0 : 1;
    }

    if (mode === "--ci" && value === undefined) {
      const range = resolveCiCommitRange(
        {
          eventName: process.env.EVENT_NAME,
          beforeSha: process.env.BEFORE_SHA,
          baseSha: process.env.BASE_SHA,
          headSha: process.env.HEAD_SHA,
        },
        gitCommitExists,
      );
      console.log(`Validating commit messages in ${range}.`);
      return validateCommitRange(range) ? 0 : 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  printUsage();
  return 2;
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  process.exitCode = main(process.argv.slice(2));
}
