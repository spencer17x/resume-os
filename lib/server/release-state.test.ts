import { describe, expect, it } from 'vitest'
import { evaluateReleaseState, releaseStateMatrix } from '../../scripts/release-state.mjs'

const expectedSha = 'a'.repeat(40)
const otherSha = 'b'.repeat(40)
const expectedTag = 'v1.2.3'
const publishedRelease = {
  draft: false,
  prerelease: false,
  tagName: expectedTag,
  url: `https://github.com/example/repo/releases/tag/${expectedTag}`
}

describe('release state matrix', () => {
  it.each([
    {
      label: 'missing tag and release',
      input: { release: null, tagSha: null },
      state: 'missing',
      action: 'create'
    },
    {
      label: 'mismatched tag target',
      input: { release: publishedRelease, tagSha: otherSha },
      state: 'mismatch',
      action: 'reject'
    },
    {
      label: 'orphan tag without release',
      input: { release: null, tagSha: expectedSha },
      state: 'orphan-tag',
      action: 'publish'
    },
    {
      label: 'orphan release without tag',
      input: { release: publishedRelease, tagSha: null },
      state: 'orphan-release',
      action: 'reject'
    },
    {
      label: 'draft release',
      input: { release: { ...publishedRelease, draft: true }, tagSha: expectedSha },
      state: 'draft',
      action: 'reject'
    },
    {
      label: 'prerelease',
      input: { release: { ...publishedRelease, prerelease: true }, tagSha: expectedSha },
      state: 'prerelease',
      action: 'reject'
    },
    {
      label: 'idempotent published release',
      input: { release: publishedRelease, tagSha: expectedSha },
      state: 'idempotent',
      action: 'noop'
    }
  ])('$label → $state/$action', ({ action, input, state }) => {
    expect(
      evaluateReleaseState({
        expectedSha,
        expectedTag,
        ...input
      })
    ).toMatchObject({ action, state })
  })

  it('keeps the documented matrix aligned with every tested state', () => {
    expect(releaseStateMatrix.map(({ state }) => state)).toEqual([
      'missing',
      'mismatch',
      'orphan-tag',
      'orphan-release',
      'draft',
      'prerelease',
      'idempotent'
    ])
  })
})
