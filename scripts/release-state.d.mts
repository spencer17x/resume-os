export type ReleaseState =
  | 'missing'
  | 'mismatch'
  | 'orphan-tag'
  | 'orphan-release'
  | 'draft'
  | 'prerelease'
  | 'idempotent'
  | 'invalid-input'
  | 'invalid-remote'

export type ReleaseAction = 'create' | 'publish' | 'noop' | 'reject'

export type ReleaseMetadata = {
  draft: boolean
  prerelease: boolean
  tagName: string
  url?: string
}

export type ReleaseAssessment = {
  action: ReleaseAction
  reason: string
  releaseUrl: string
  state: ReleaseState
}

export const releaseStateMatrix: ReadonlyArray<{
  action: ReleaseAction
  meaning: string
  state: ReleaseState
}>

export function evaluateReleaseState(input: {
  expectedSha: string
  expectedTag: string
  release?: ReleaseMetadata | null
  tagSha?: string | null
}): ReleaseAssessment

export function inspectGithubReleaseState(input: {
  expectedSha: string
  expectedTag: string
  repository: string
}): Promise<ReleaseAssessment>
