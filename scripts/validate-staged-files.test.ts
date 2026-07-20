// @vitest-environment node

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const validatorPath = resolve(process.cwd(), "scripts/validate-staged-files.mjs");
const validatorModule = await import(pathToFileURL(validatorPath).href) as {
  blockedStagedPath(path: string): string | null;
  detectedSecretKind(line: string): string | null;
};
const { blockedStagedPath, detectedSecretKind } = validatorModule;
const temporaryDirectories: string[] = [];

function makeRepository() {
  const directory = mkdtempSync(join(tmpdir(), "resume-os-staged-files-"));
  temporaryDirectories.push(directory);
  runGit(directory, ["init", "--quiet"]);
  runGit(directory, ["config", "user.name", "Resume OS Test"]);
  runGit(directory, ["config", "user.email", "resume-os-test@example.invalid"]);
  return directory;
}

function runGit(directory: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd: directory,
    encoding: "utf8"
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

function validateStagedFiles(repository: string) {
  return spawnSync(process.execPath, [validatorPath], {
    cwd: repository,
    encoding: "utf8"
  });
}

function validateCiChanges(repository: string, beforeSha: string, headSha: string) {
  return spawnSync(process.execPath, [validatorPath, "--ci"], {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...process.env,
      EVENT_NAME: "push",
      BEFORE_SHA: beforeSha,
      HEAD_SHA: headSha,
    },
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("staged path and secret classification", () => {
  it.each([
    [".env.local", "local environment file"],
    ["config/.env.production", "local environment file"],
    ["private/id_ed25519", "private-key or certificate container"],
    ["certificates/client.p12", "private-key or certificate container"],
    [".next/cache/output", "generated or local-state directory"],
    ["packages/app/node_modules/library/index.js", "generated or local-state directory"],
    [".DS_Store", "operating-system metadata"]
  ])("blocks %s", (path, reason) => {
    expect(blockedStagedPath(path)).toBe(reason);
  });

  it.each([".env.example", "docs/environment.md", "tests/fixtures/public-certificate.crt"])(
    "allows %s",
    (path) => expect(blockedStagedPath(path)).toBeNull()
  );

  it("recognizes common secret formats without exposing their values", () => {
    expect(detectedSecretKind(`OPENAI_KEY=${"sk-" + "a".repeat(32)}`)).toBe("OpenAI-compatible key");
    expect(detectedSecretKind(`AWS_KEY=${"AKIA" + "A".repeat(16)}`)).toBe("AWS access key");
    expect(detectedSecretKind(`SLACK_TOKEN=${"xoxb-" + "a".repeat(32)}`)).toBe("Slack token");
    expect(detectedSecretKind("safe-placeholder")).toBeNull();
  });
});

describe("pre-commit staged-file validation", () => {
  it("accepts a clean staged source file and runs ESLint", () => {
    const repository = makeRepository();
    writeFileSync(
      join(repository, "eslint.config.mjs"),
      "export default [{ rules: { 'no-debugger': 'error' } }];\n",
      "utf8"
    );
    writeFileSync(join(repository, "clean.js"), "const answer = 42;\nvoid answer;\n", "utf8");
    runGit(repository, ["add", "clean.js"]);

    const result = validateStagedFiles(repository);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Validated 1 staged file.");
  });

  it("ignores unstaged source changes when linting the index snapshot", () => {
    const repository = makeRepository();
    writeFileSync(
      join(repository, "eslint.config.mjs"),
      "export default [{ rules: { 'no-debugger': 'error' } }];\n",
      "utf8"
    );
    writeFileSync(join(repository, "partial.js"), "const staged = true;\nvoid staged;\n", "utf8");
    runGit(repository, ["add", "partial.js"]);
    writeFileSync(join(repository, "partial.js"), "debugger;\n", "utf8");

    const result = validateStagedFiles(repository);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Validated 1 staged file.");
  });

  it("rejects Git whitespace errors", () => {
    const repository = makeRepository();
    writeFileSync(join(repository, "notes.txt"), "trailing whitespace  \n", "utf8");
    runGit(repository, ["add", "notes.txt"]);

    const result = validateStagedFiles(repository);

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("trailing whitespace");
  });

  it("rejects an ignored local environment file that was force-added", () => {
    const repository = makeRepository();
    writeFileSync(join(repository, ".gitignore"), ".env*\n!.env.example\n", "utf8");
    writeFileSync(join(repository, ".env.local"), "SAFE_TEST_VALUE=placeholder\n", "utf8");
    runGit(repository, ["add", "-f", ".env.local"]);

    const result = validateStagedFiles(repository);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(".env.local: local environment file");
  });

  it("rejects secret-like additions without printing the matching value", () => {
    const repository = makeRepository();
    const syntheticKey = "sk-" + "z".repeat(32);
    writeFileSync(join(repository, "config.txt"), `AI_KEY=${syntheticKey}  \n`, "utf8");
    runGit(repository, ["add", "config.txt"]);

    const result = validateStagedFiles(repository);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("config.txt: OpenAI-compatible key");
    expect(result.stderr).not.toContain(syntheticKey);
  });

  it("rejects an ESLint violation in a staged source path", () => {
    const repository = makeRepository();
    writeFileSync(
      join(repository, "eslint.config.mjs"),
      "export default [{ rules: { 'no-debugger': 'error' } }];\n",
      "utf8"
    );
    writeFileSync(join(repository, "bad.js"), "debugger;\n", "utf8");
    runGit(repository, ["add", "bad.js"]);
    writeFileSync(join(repository, "bad.js"), "const fixedInWorkingTree = true;\n", "utf8");

    const result = validateStagedFiles(repository);

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("no-debugger");
  });
});

describe("CI change-policy validation", () => {
  it("checks every new commit rather than only the final tree", () => {
    const repository = makeRepository();
    runGit(repository, ["commit", "--allow-empty", "--quiet", "-m", "feat(test): add baseline"]);
    const beforeSha = runGit(repository, ["rev-parse", "HEAD"]);
    const syntheticKey = "sk-" + "q".repeat(32);
    writeFileSync(join(repository, "temporary.txt"), `AI_KEY=${syntheticKey}\n`, "utf8");
    runGit(repository, ["add", "temporary.txt"]);
    runGit(repository, ["commit", "--quiet", "-m", "test(security): add synthetic fixture"]);
    runGit(repository, ["rm", "--quiet", "temporary.txt"]);
    runGit(repository, ["commit", "--quiet", "-m", "test(security): remove synthetic fixture"]);
    const headSha = runGit(repository, ["rev-parse", "HEAD"]);

    const result = validateCiChanges(repository, beforeSha, headSha);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("OpenAI-compatible key");
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(syntheticKey);
  });

  it("accepts a clean pushed commit", () => {
    const repository = makeRepository();
    runGit(repository, ["commit", "--allow-empty", "--quiet", "-m", "feat(test): add baseline"]);
    const beforeSha = runGit(repository, ["rev-parse", "HEAD"]);
    writeFileSync(join(repository, "README.md"), "# Safe fixture\n", "utf8");
    runGit(repository, ["add", "README.md"]);
    runGit(repository, ["commit", "--quiet", "-m", "docs(test): add safe fixture"]);
    const headSha = runGit(repository, ["rev-parse", "HEAD"]);

    const result = validateCiChanges(repository, beforeSha, headSha);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Validated change policy for 1 commit.");
  });
});
