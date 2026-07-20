#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCiCommitRange } from "./validate-commit-message.mjs";

const LINTABLE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const BLOCKED_DIRECTORY_NAMES = new Set([".next", ".vercel", ".worktrees", "node_modules", "out"]);
const BLOCKED_KEY_EXTENSIONS = new Set([".jks", ".key", ".keystore", ".p12", ".pem", ".pfx"]);
const BLOCKED_KEY_NAMES = new Set(["id_dsa", "id_ecdsa", "id_ed25519", "id_rsa"]);
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SECRET_PATTERNS = [
  { label: "private key", pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/ },
  { label: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/ },
  { label: "GitLab token", pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { label: "npm token", pattern: /\bnpm_[A-Za-z0-9]{30,}\b/ },
  { label: "OpenAI-compatible key", pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/ },
  { label: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { label: "Stripe live key", pattern: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  { label: "Google API key", pattern: /\bAIza[A-Za-z0-9_-]{35}\b/ },
  { label: "AWS access key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
];

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function runGit(args, options = {}) {
  const result = run("git", args, options);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "Unknown Git error.";
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout;
}

export function blockedStagedPath(path) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = normalized.split("/");
  const fileName = basename(normalized);
  const lowerFileName = fileName.toLowerCase();

  if (segments.some((segment) => BLOCKED_DIRECTORY_NAMES.has(segment.toLowerCase()))) {
    return "generated or local-state directory";
  }
  if (lowerFileName.startsWith(".env") && lowerFileName !== ".env.example") {
    return "local environment file";
  }
  if (lowerFileName === ".ds_store") return "operating-system metadata";
  if (
    BLOCKED_KEY_NAMES.has(lowerFileName)
    || BLOCKED_KEY_EXTENSIONS.has(extname(lowerFileName))
  ) {
    return "private-key or certificate container";
  }
  return null;
}

export function detectedSecretKind(line) {
  return SECRET_PATTERNS.find(({ pattern }) => pattern.test(line))?.label ?? null;
}

function stagedPaths() {
  return runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"])
    .split("\0")
    .filter(Boolean);
}

function secretFindingsFromDiff(diff) {
  const findings = [];
  let currentPath = "<unknown>";

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      currentPath = line.slice(6);
      continue;
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const kind = detectedSecretKind(line.slice(1));
    if (kind) findings.push({ path: currentPath, kind });
  }

  return findings;
}

function stagedSecretFindings() {
  return secretFindingsFromDiff(runGit([
    "diff",
    "--cached",
    "--no-ext-diff",
    "--unified=0",
    "--no-color",
    "--diff-filter=ACMR",
  ]));
}

function reportBlockedPaths(paths, label = "staged changes") {
  const blocked = paths
    .map((path) => ({ path, reason: blockedStagedPath(path) }))
    .filter(({ reason }) => reason !== null);
  if (blocked.length === 0) return true;

  console.error(`Blocked files detected in ${label}:`);
  blocked.forEach(({ path, reason }) => console.error(`  ${path}: ${reason}`));
  console.error("Remove these files from Git and keep local or sensitive data outside the repository.");
  return false;
}

function reportSecretFindings(findings, label = "staged additions") {
  if (findings.length === 0) return true;
  console.error(`Potential secrets detected in ${label}:`);
  findings.forEach(({ path, kind }) => console.error(`  ${path}: ${kind}`));
  console.error("The matching values are intentionally hidden. Remove or replace them before continuing.");
  return false;
}

function sanitizedWhitespaceOutput(output) {
  return output
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("+") && !line.startsWith("-"))
    .join("\n");
}

function validateWhitespace(diffArguments, label) {
  const result = run("git", ["diff", "--check", ...diffArguments]);
  if (result.status === 0) return true;

  console.error(`Whitespace or conflict-marker errors detected in ${label}:`);
  const details = sanitizedWhitespaceOutput(`${result.stdout}\n${result.stderr}`);
  console.error(details || "  Git reported an unsafe diff without printable details.");
  return false;
}

async function lintStagedPaths(paths) {
  const lintable = paths.filter((path) => LINTABLE_EXTENSIONS.has(extname(path).toLowerCase()));
  if (lintable.length === 0) return true;

  const { ESLint } = await import("eslint");
  const eslint = new ESLint({ cwd: process.cwd() });
  const results = [];
  for (const path of lintable) {
    const stagedSource = runGit(["show", `:${path}`]);
    results.push(...await eslint.lintText(stagedSource, { filePath: path }));
  }

  const output = (await eslint.loadFormatter("stylish")).format(results);
  if (output) process.stdout.write(output);
  return results.every((result) => result.errorCount === 0);
}

function emptyTreeHash() {
  return runGit(["hash-object", "-t", "tree", "--stdin"], {
    input: "",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function firstParentOrEmptyTree(hash) {
  const [, firstParent] = runGit(["rev-list", "--parents", "-n", "1", hash])
    .trim()
    .split(/\s+/);
  return firstParent ?? emptyTreeHash();
}

function changedPathsForCommit(hash, base) {
  return runGit([
    "diff",
    "--name-only",
    "--diff-filter=ACMR",
    "-z",
    base,
    hash,
  ]).split("\0").filter(Boolean);
}

function secretFindingsForCommit(hash, base) {
  return secretFindingsFromDiff(runGit([
    "diff",
    "--no-ext-diff",
    "--unified=0",
    "--no-color",
    "--diff-filter=ACMR",
    base,
    hash,
  ]));
}

export function commitHashesInRange(range) {
  return runGit(["rev-list", "--reverse", range])
    .split(/\r?\n/)
    .filter(Boolean);
}

export function validateCommitChanges(hashes, label) {
  if (hashes.length === 0) {
    console.log(`No commit changes found in ${label}.`);
    return true;
  }

  let valid = true;
  for (const hash of hashes) {
    if (!FULL_SHA_PATTERN.test(hash)) {
      throw new Error(`Expected a full commit SHA, received: ${hash}`);
    }
    const commitLabel = `commit ${hash.slice(0, 12)}`;
    const base = firstParentOrEmptyTree(hash);
    const pathsValid = reportBlockedPaths(changedPathsForCommit(hash, base), commitLabel);
    const secretsValid = reportSecretFindings(secretFindingsForCommit(hash, base), commitLabel);
    const whitespaceValid = validateWhitespace([base, hash], commitLabel);
    valid = pathsValid && secretsValid && whitespaceValid && valid;
  }

  if (valid) {
    console.log(`Validated change policy for ${hashes.length} commit${hashes.length === 1 ? "" : "s"}.`);
  }
  return valid;
}

async function validateStagedFiles() {
  const paths = stagedPaths();
  const pathsValid = reportBlockedPaths(paths);
  const secretsValid = reportSecretFindings(stagedSecretFindings());
  const whitespaceValid = validateWhitespace(["--cached"], "staged changes");
  if (!pathsValid || !secretsValid || !whitespaceValid) return false;
  if (!await lintStagedPaths(paths)) return false;
  console.log(`Validated ${paths.length} staged file${paths.length === 1 ? "" : "s"}.`);
  return true;
}

function ciCommitRange() {
  return resolveCiCommitRange(
    {
      eventName: process.env.EVENT_NAME,
      beforeSha: process.env.BEFORE_SHA,
      baseSha: process.env.BASE_SHA,
      headSha: process.env.HEAD_SHA,
    },
    (revision) => run("git", ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`], {
      stdio: "ignore",
    }).status === 0,
  );
}

function printUsage() {
  console.error(
    "Usage: node scripts/validate-staged-files.mjs [--staged] | --range <base..head> | --ci",
  );
}

async function main(argv) {
  const [mode, value, ...extra] = argv;
  if (extra.length > 0) {
    printUsage();
    return 2;
  }

  try {
    if (mode === undefined || (mode === "--staged" && value === undefined)) {
      return await validateStagedFiles() ? 0 : 1;
    }
    if (mode === "--range" && value) {
      return validateCommitChanges(commitHashesInRange(value), value) ? 0 : 1;
    }
    if (mode === "--ci" && value === undefined) {
      const range = ciCommitRange();
      console.log(`Validating change policy in ${range}.`);
      return validateCommitChanges(commitHashesInRange(range), range) ? 0 : 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  printUsage();
  return 2;
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) process.exitCode = await main(process.argv.slice(2));
