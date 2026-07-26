import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type ReleaseConfig = {
  git?: {
    commitMessage?: string
    push?: boolean
    requireBranch?: string
    tag?: boolean
  }
  github?: {
    release?: boolean
  }
}

const require = createRequire(import.meta.url)

describe('release process', () => {
  it('prepares a checked release PR without pushing or tagging protected main', () => {
    const config = require(join(process.cwd(), '.release-it.cjs')) as ReleaseConfig

    expect(config.git?.requireBranch).toBe('release/*')
    expect(config.git?.commitMessage).toBe('chore(release): v${version}')
    expect(config.git?.commitMessage).not.toContain('[skip ci]')
    expect(config.git?.tag).toBe(false)
    expect(config.git?.push).toBe(false)
    expect(config.github?.release).toBe(false)
  })

  it('publishes only an exact checked main revision through the manual workflow', () => {
    const workflow = readFileSync(
      join(process.cwd(), '.github', 'workflows', 'release.yml'),
      'utf8'
    )

    expect(workflow).toContain('description: Full main commit SHA produced by the merged release PR')
    expect(workflow).toContain('git merge-base --is-ancestor "$release_sha" origin/main')
    expect(workflow).toContain('New release commit must be titled chore(release): $release_tag.')
    expect(workflow).toContain('run: pnpm check')
    expect(workflow).toContain('name: Publish tag and GitHub Release')
    expect(workflow).toContain('contents: write')
  })
})
