import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveReleaseProfile } from '../../scripts/release-profile.mjs'

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
    expect(workflow).toContain('DISPATCH_REF: ${{ github.ref }}')
    expect(workflow).toContain('[ "$DISPATCH_REF" != "refs/heads/main" ]')
    expect(workflow).toContain('git merge-base --is-ancestor "$release_sha" origin/main')
    expect(workflow).toContain('New release commit must be titled chore(release): $RELEASE_TAG.')
    expect(workflow).toContain(
      'cp scripts/release-profile.mjs "$RUNNER_TEMP/release-profile.mjs"'
    )
    expect(workflow).toContain('run: node "$RUNNER_TEMP/release-profile.mjs"')
    expect(workflow).toContain('corepack "pnpm@$PNPM_VERSION" check')
    expect(workflow).toContain('corepack "pnpm@$PNPM_VERSION" typecheck')
    expect(workflow).toContain('corepack "pnpm@$PNPM_VERSION" lint')
    expect(workflow).toContain('corepack "pnpm@$PNPM_VERSION" test')
    expect(workflow).toContain('corepack "pnpm@$PNPM_VERSION" test:production-extraction')
    expect(workflow).toContain(
      'node-version: ${{ needs.quality-release.outputs.node_version }}'
    )
    expect(workflow).toContain('name: Publish tag and GitHub Release')
    expect(workflow).toContain('contents: write')
    expect(workflow).not.toContain('release_exists: ${{ steps.result.outputs.release_exists }}')
    expect(workflow).not.toContain('tag_exists: ${{ steps.result.outputs.tag_exists }}')
  })

  it('selects the current and legacy release quality profiles', () => {
    const current = resolveReleaseProfile({
      nvmrc: readFileSync(join(process.cwd(), '.nvmrc'), 'utf8'),
      packageJson: JSON.parse(
        readFileSync(join(process.cwd(), 'package.json'), 'utf8')
      ) as unknown,
    })
    const legacy = resolveReleaseProfile({
      packageJson: {
        packageManager: 'pnpm@10.33.0',
        scripts: {
          typecheck: 'tsc --noEmit',
          lint: 'eslint .',
          test: 'vitest run',
          'test:production-extraction': 'next build && node scripts/smoke.mjs',
        },
      },
    })

    expect(current).toEqual({
      nodeVersion: '24.18.0',
      pnpmVersion: '11.17.0',
      qualityProfile: 'check',
      qualityScripts: ['check'],
    })
    expect(legacy).toEqual({
      nodeVersion: '22',
      pnpmVersion: '10.33.0',
      qualityProfile: 'legacy',
      qualityScripts: [
        'typecheck',
        'lint',
        'test',
        'test:production-extraction',
      ],
    })
  })

  it('rejects malformed or incomplete release profiles', () => {
    expect(() =>
      resolveReleaseProfile({
        nvmrc: '',
        packageJson: {
          packageManager: 'pnpm@11',
          scripts: { check: 'node scripts/check.mjs' },
        },
      })
    ).toThrow('.nvmrc must be an exact numeric version')
    expect(() =>
      resolveReleaseProfile({
        packageJson: {
          packageManager: 'pnpm@10.33.0',
          scripts: {
            typecheck: 'tsc --noEmit',
            lint: 'eslint .',
            test: 'vitest run',
          },
        },
      })
    ).toThrow('Unsupported legacy release; missing scripts: test:production-extraction')
  })

  it('revalidates the published release before exposing deployment secrets', () => {
    const workflow = readFileSync(
      join(process.cwd(), '.github', 'workflows', 'release.yml'),
      'utf8'
    )
    const revalidation = workflow.indexOf(
      '- name: Revalidate published tag and Release before deployment'
    )
    const secretAccess = workflow.indexOf('- name: Verify deployment secrets')

    expect(revalidation).toBeGreaterThan(-1)
    expect(secretAccess).toBeGreaterThan(revalidation)
    expect(workflow.slice(revalidation, secretAccess)).toContain('--expect-published')
  })
})
