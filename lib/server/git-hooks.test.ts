import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const fixtures: string[] = []
const isolatedGitEnv = { ...process.env }

for (const name of execFileSync('git', ['rev-parse', '--local-env-vars'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean)) {
  delete isolatedGitEnv[name]
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'resume-os-hook-'))
  fixtures.push(root)
  execFileSync('git', ['init', '--quiet'], {
    cwd: root,
    env: isolatedGitEnv,
  })

  const hooksDirectory = join(root, '.githooks')
  mkdirSync(hooksDirectory)
  const hook = join(hooksDirectory, 'pre-commit')
  copyFileSync(join(process.cwd(), '.githooks', 'pre-commit'), hook)
  chmodSync(hook, 0o755)

  return { hook, root }
}

function stage(root: string, relativePath: string, content: string) {
  const path = join(root, relativePath)
  writeFileSync(path, content)
  execFileSync('git', ['add', '--', relativePath], {
    cwd: root,
    env: isolatedGitEnv,
  })
  return path
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true })
  }
})

describe('pre-commit shell validation', () => {
  it('rejects invalid staged syntax even when the working tree contains a valid fix', () => {
    const { hook, root } = createFixture()
    const relativePath = 'script with spaces.sh'
    const path = stage(root, relativePath, '#!/usr/bin/env bash\nif then\n')
    writeFileSync(path, '#!/usr/bin/env bash\nexit 0\n')

    const result = spawnSync(hook, {
      cwd: root,
      encoding: 'utf8',
      env: isolatedGitEnv,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('staged shell syntax is invalid')
  })

  it('ignores unstaged syntax errors when the staged shell snapshot is valid', () => {
    const { hook, root } = createFixture()
    const relativePath = 'script\nwith-newline.sh'
    const path = stage(root, relativePath, '#!/usr/bin/env bash\nexit 0\n')
    writeFileSync(path, '#!/usr/bin/env bash\nif then\n')

    const result = spawnSync(hook, {
      cwd: root,
      encoding: 'utf8',
      env: isolatedGitEnv,
    })

    expect(result.status).toBe(0)
  })
})
