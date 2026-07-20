// @vitest-environment node

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const validatorPath = resolve(process.cwd(), "scripts/validate-commit-message.mjs");
const temporaryDirectories: string[] = [];

function makeTemporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "resume-os-commit-message-"));
  temporaryDirectories.push(directory);
  return directory;
}

function validateMessage(message: string) {
  const directory = makeTemporaryDirectory();
  const messagePath = join(directory, "COMMIT_EDITMSG");
  writeFileSync(messagePath, message, "utf8");

  return spawnSync(process.execPath, [validatorPath, "--file", messagePath], {
    encoding: "utf8",
  });
}

function validateSubject(subject: string) {
  return spawnSync(process.execPath, [validatorPath, "--subject", subject], {
    encoding: "utf8",
  });
}

function runGit(directory: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd: directory,
    encoding: "utf8",
  });

  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("commit message file validation", () => {
  it.each([
    "feat(agent): support Chinese local AI tasks",
    "fix: reject stale results",
    "feat(agent)!: migrate persisted runs",
    "chore(release): v0.2.0 [skip ci]",
    "revert: restore provider validation",
  ])("accepts %s", (subject) => {
    const result = validateMessage(`${subject}\n`);
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    ["Support Chinese local AI tasks", "not a valid Conventional Commit"],
    ["feature(agent): support Chinese local AI tasks", "not a valid Conventional Commit"],
    ["FEAT(agent): support Chinese local AI tasks", "not a valid Conventional Commit"],
    ["feat(Agent): support Chinese local AI tasks", "not a valid Conventional Commit"],
    [" feat(agent): support Chinese local AI tasks", "must not start or end with whitespace"],
    ["fix(agent): reject stale results.", "must not end with a period"],
    ["", "is empty"],
  ])("rejects %s", (subject, expectedError) => {
    const result = validateMessage(`${subject}\n`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(expectedError);
  });

  it("uses only the first-line subject and handles a byte-order mark", () => {
    const result = validateMessage(
      "\uFEFFfeat(agent): support Chinese local AI tasks\n\nBREAKING CHANGE: migrate preferences",
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it("uses the same subject policy for pull request titles", () => {
    expect(validateSubject("feat(settings): unify AI provider selection").status).toBe(0);

    const invalid = validateSubject("feature(settings): unify AI provider selection");
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("not a valid Conventional Commit");
  });

  it("rejects subjects longer than 100 characters", () => {
    const result = validateSubject(`fix(ci): ${"a".repeat(92)}`);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must not exceed 100 characters");
  });
});

describe("CI commit range validation", () => {
  it("rejects an invalid commit added by a push", () => {
    const repository = makeTemporaryDirectory();
    runGit(repository, ["init", "--quiet"]);
    runGit(repository, ["config", "user.name", "Resume OS Test"]);
    runGit(repository, ["config", "user.email", "resume-os-test@example.invalid"]);
    runGit(repository, ["commit", "--allow-empty", "--quiet", "-m", "feat(test): add baseline"]);
    const beforeSha = runGit(repository, ["rev-parse", "HEAD"]);
    runGit(repository, ["commit", "--allow-empty", "--quiet", "-m", "Invalid follow-up"]);
    const headSha = runGit(repository, ["rev-parse", "HEAD"]);

    const result = spawnSync(process.execPath, [validatorPath, "--ci"], {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...process.env,
        EVENT_NAME: "push",
        BEFORE_SHA: beforeSha,
        HEAD_SHA: headSha,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid follow-up");
  });

  it("accepts every Conventional Commit added by a pull request", () => {
    const repository = makeTemporaryDirectory();
    runGit(repository, ["init", "--quiet"]);
    runGit(repository, ["config", "user.name", "Resume OS Test"]);
    runGit(repository, ["config", "user.email", "resume-os-test@example.invalid"]);
    runGit(repository, ["commit", "--allow-empty", "--quiet", "-m", "chore(test): add baseline"]);
    const baseSha = runGit(repository, ["rev-parse", "HEAD"]);
    runGit(repository, ["commit", "--allow-empty", "--quiet", "-m", "test(release): cover validation"]);
    runGit(repository, ["commit", "--allow-empty", "--quiet", "-m", "ci(release): validate commit range"]);
    const headSha = runGit(repository, ["rev-parse", "HEAD"]);

    const result = spawnSync(process.execPath, [validatorPath, "--ci"], {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...process.env,
        EVENT_NAME: "pull_request",
        BASE_SHA: baseSha,
        HEAD_SHA: headSha,
      },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Validated 2 Conventional Commit messages");
  });
});
