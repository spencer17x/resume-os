// @vitest-environment node

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const validatorPath = resolve(process.cwd(), "scripts/validate-push.mjs");
const ZERO_SHA = "0".repeat(40);
const temporaryDirectories: string[] = [];

function makeRepository() {
  const directory = mkdtempSync(join(tmpdir(), "resume-os-push-policy-"));
  temporaryDirectories.push(directory);
  runGit(directory, ["init", "--quiet", "--initial-branch=main"]);
  runGit(directory, ["config", "user.name", "Resume OS Test"]);
  runGit(directory, ["config", "user.email", "resume-os-test@example.invalid"]);
  return directory;
}

function runGit(directory: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd: directory,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

function commitEmpty(repository: string, subject: string) {
  runGit(repository, ["commit", "--allow-empty", "--quiet", "-m", subject]);
  return runGit(repository, ["rev-parse", "HEAD"]);
}

function validatePush(repository: string, updates: string, remoteName = "origin") {
  return spawnSync(process.execPath, [validatorPath, remoteName, "git@example.invalid:resume-os.git"], {
    cwd: repository,
    encoding: "utf8",
    input: updates,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("pre-push policy", () => {
  it("rejects an invalid commit introduced by an existing branch update", () => {
    const repository = makeRepository();
    const remoteSha = commitEmpty(repository, "feat(test): add baseline");
    const localSha = commitEmpty(repository, "Invalid pushed commit");

    const result = validatePush(
      repository,
      `refs/heads/main ${localSha} refs/heads/main ${remoteSha}\n`,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid pushed commit");
  });

  it("validates only commits not already reachable from the target remote for a new branch", () => {
    const repository = makeRepository();
    const remoteSha = commitEmpty(repository, "Legacy baseline");
    runGit(repository, ["update-ref", "refs/remotes/origin/main", remoteSha]);
    const localSha = commitEmpty(repository, "fix(test): validate new branch");

    const result = validatePush(
      repository,
      `refs/heads/feature ${localSha} refs/heads/feature ${ZERO_SHA}\n`,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Validated 1 Conventional Commit message.");
    expect(result.stdout).toContain("Validated change policy for 1 commit.");
  });

  it("does not revalidate history already reachable through another target-remote ref", () => {
    const repository = makeRepository();
    const remoteSha = commitEmpty(repository, "feat(test): add baseline");
    const legacyRemoteSha = commitEmpty(repository, "Legacy remote commit");
    runGit(repository, ["update-ref", "refs/remotes/origin/legacy", legacyRemoteSha]);
    const localSha = commitEmpty(repository, "fix(test): add push validation");

    const result = validatePush(
      repository,
      `refs/heads/main ${localSha} refs/heads/main ${remoteSha}\n`,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Validated 1 Conventional Commit message.");
  });

  it("allows ordinary branch deletion updates without validating history", () => {
    const repository = makeRepository();
    const remoteSha = commitEmpty(repository, "Legacy baseline");

    const result = validatePush(
      repository,
      `(delete) ${ZERO_SHA} refs/heads/legacy ${remoteSha}\n`,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("No commits found in push to origin.");
  });

  it("rejects deletion and non-fast-forward updates of main", () => {
    const repository = makeRepository();
    const baseSha = commitEmpty(repository, "feat(test): add baseline");
    const remoteSha = commitEmpty(repository, "fix(test): add remote change");

    const deletion = validatePush(
      repository,
      `(delete) ${ZERO_SHA} refs/heads/main ${remoteSha}\n`,
    );
    expect(deletion.status).toBe(1);
    expect(deletion.stderr).toContain("refs/heads/main must not be deleted");

    runGit(repository, ["checkout", "--quiet", "--detach", baseSha]);
    const localSha = commitEmpty(repository, "fix(test): add divergent change");
    const nonFastForward = validatePush(
      repository,
      `HEAD ${localSha} refs/heads/main ${remoteSha}\n`,
    );
    expect(nonFastForward.status).toBe(1);
    expect(nonFastForward.stderr).toContain("must not be force-pushed");
  });

  it("rejects merge commits introduced to main", () => {
    const repository = makeRepository();
    const remoteSha = commitEmpty(repository, "feat(test): add baseline");
    runGit(repository, ["branch", "feature"]);
    commitEmpty(repository, "fix(test): advance main");
    runGit(repository, ["checkout", "--quiet", "feature"]);
    commitEmpty(repository, "fix(test): advance feature");
    runGit(repository, ["checkout", "--quiet", "main"]);
    runGit(repository, ["merge", "--quiet", "--no-ff", "-m", "feat(test): merge feature", "feature"]);
    const localSha = runGit(repository, ["rev-parse", "HEAD"]);

    const result = validatePush(
      repository,
      `refs/heads/main ${localSha} refs/heads/main ${remoteSha}\n`,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("requires a linear history");
  });

  it("allows a new release tag but rejects moving or deleting an existing one", () => {
    const repository = makeRepository();
    const remoteSha = commitEmpty(repository, "feat(test): add baseline");
    runGit(repository, ["update-ref", "refs/remotes/origin/main", remoteSha]);
    const localSha = commitEmpty(repository, "fix(test): add release change");

    const created = validatePush(
      repository,
      `refs/tags/v1.0.0 ${localSha} refs/tags/v1.0.0 ${ZERO_SHA}\n`,
    );
    expect(created.status, created.stderr).toBe(0);

    const moved = validatePush(
      repository,
      `refs/tags/v1.0.0 ${localSha} refs/tags/v1.0.0 ${remoteSha}\n`,
    );
    expect(moved.status).toBe(1);
    expect(moved.stderr).toContain("refs/tags/v1.0.0 is immutable");

    const deleted = validatePush(
      repository,
      `(delete) ${ZERO_SHA} refs/tags/v1.0.0 ${remoteSha}\n`,
    );
    expect(deleted.status).toBe(1);
    expect(deleted.stderr).toContain("refs/tags/v1.0.0 is immutable");
  });

  it("rejects secret-like content anywhere in outgoing commit history without printing it", () => {
    const repository = makeRepository();
    const remoteSha = commitEmpty(repository, "feat(test): add baseline");
    runGit(repository, ["update-ref", "refs/remotes/origin/main", remoteSha]);
    const syntheticKey = "sk-" + "z".repeat(32);
    writeFileSync(join(repository, "config.txt"), `AI_KEY=${syntheticKey}\n`, "utf8");
    runGit(repository, ["add", "config.txt"]);
    commitEmpty(repository, "test(security): add synthetic credential fixture");
    runGit(repository, ["rm", "--quiet", "config.txt"]);
    const localSha = commitEmpty(repository, "test(security): remove synthetic credential fixture");

    const result = validatePush(
      repository,
      `refs/heads/main ${localSha} refs/heads/main ${remoteSha}\n`,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("OpenAI-compatible key");
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(syntheticKey);
  });
});
