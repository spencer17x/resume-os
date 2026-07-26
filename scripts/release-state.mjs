#!/usr/bin/env node
import { fileURLToPath } from 'node:url'

const COMMIT_SHA = /^[0-9a-f]{40}$/i
const RELEASE_TAG = /^v[0-9]+\.[0-9]+\.[0-9]+$/

export const releaseStateMatrix = [
  {
    state: 'missing',
    action: 'create',
    meaning: 'Neither the tag nor a Release exists; create both after validation.'
  },
  {
    state: 'mismatch',
    action: 'reject',
    meaning: 'The remote tag or Release identity does not match the requested revision.'
  },
  {
    state: 'orphan-tag',
    action: 'publish',
    meaning: 'The exact tag exists without a Release; publish from the verified tag.'
  },
  {
    state: 'orphan-release',
    action: 'reject',
    meaning: 'A Release exists without its immutable remote tag.'
  },
  {
    state: 'draft',
    action: 'reject',
    meaning: 'The existing Release is a draft and is not deployable.'
  },
  {
    state: 'prerelease',
    action: 'reject',
    meaning: 'The existing Release is a prerelease and is not deployable.'
  },
  {
    state: 'idempotent',
    action: 'noop',
    meaning: 'The exact immutable tag and published Release already exist.'
  }
]

function result(state, action, reason, releaseUrl = '') {
  return { action, reason, releaseUrl, state }
}

export function evaluateReleaseState({
  expectedSha,
  expectedTag,
  release = null,
  tagSha = null
}) {
  if (!COMMIT_SHA.test(expectedSha)) {
    return result('invalid-input', 'reject', 'Expected SHA must be a full commit SHA.')
  }
  if (!RELEASE_TAG.test(expectedTag)) {
    return result('invalid-input', 'reject', 'Expected tag must match vX.Y.Z.')
  }

  const normalizedExpectedSha = expectedSha.toLowerCase()
  const normalizedTagSha = tagSha?.toLowerCase() ?? null

  if (normalizedTagSha && !COMMIT_SHA.test(normalizedTagSha)) {
    return result('invalid-remote', 'reject', 'Remote tag did not resolve to a commit SHA.')
  }
  if (normalizedTagSha && normalizedTagSha !== normalizedExpectedSha) {
    return result(
      'mismatch',
      'reject',
      `Remote tag points to ${normalizedTagSha}, not ${normalizedExpectedSha}.`
    )
  }
  if (!normalizedTagSha && release) {
    return result(
      'orphan-release',
      'reject',
      'A GitHub Release exists but its remote tag is missing.'
    )
  }
  if (!normalizedTagSha && !release) {
    return result(
      'missing',
      'create',
      'The tag and GitHub Release are both missing and may be created.'
    )
  }
  if (normalizedTagSha && !release) {
    return result(
      'orphan-tag',
      'publish',
      'The exact tag exists without a GitHub Release.'
    )
  }

  if (
    typeof release.draft !== 'boolean' ||
    typeof release.prerelease !== 'boolean' ||
    typeof release.tagName !== 'string'
  ) {
    return result('invalid-remote', 'reject', 'GitHub returned malformed Release metadata.')
  }
  if (release.tagName !== expectedTag) {
    return result(
      'mismatch',
      'reject',
      `GitHub Release uses tag ${release.tagName}, not ${expectedTag}.`
    )
  }
  if (release.draft) {
    return result('draft', 'reject', 'Draft GitHub Releases are not deployable.')
  }
  if (release.prerelease) {
    return result('prerelease', 'reject', 'Prerelease GitHub Releases are not deployable.')
  }

  return result(
    'idempotent',
    'noop',
    'The exact published GitHub Release already exists.',
    release.url ?? ''
  )
}

async function githubGet(path, { allowMissing = false } = {}) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('GH_TOKEN or GITHUB_TOKEN is required')
  }

  const baseUrl = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '')
  const response = await fetch(`${baseUrl}/${path.replace(/^\/+/, '')}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'resume-os-release-state',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })

  if (allowMissing && response.status === 404) {
    return null
  }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`GitHub API ${response.status}: ${body || response.statusText}`)
  }
  return response.json()
}

async function resolveRemoteTagSha(repository, tag) {
  const repositoryPath = repository.split('/').map(encodeURIComponent).join('/')
  const reference = await githubGet(
    `repos/${repositoryPath}/git/ref/tags/${encodeURIComponent(tag)}`,
    { allowMissing: true }
  )
  if (!reference) {
    return null
  }

  let object = reference.object
  for (let depth = 0; depth < 8; depth += 1) {
    if (object?.type === 'commit' && COMMIT_SHA.test(object.sha)) {
      return object.sha.toLowerCase()
    }
    if (object?.type !== 'tag' || !COMMIT_SHA.test(object.sha)) {
      throw new Error(`Tag ${tag} did not resolve to a commit`)
    }
    const annotatedTag = await githubGet(
      `repos/${repositoryPath}/git/tags/${encodeURIComponent(object.sha)}`
    )
    object = annotatedTag.object
  }

  throw new Error(`Tag ${tag} exceeded the annotation resolution limit`)
}

async function findRelease(repository, tag) {
  const repositoryPath = repository.split('/').map(encodeURIComponent).join('/')

  for (let page = 1; page <= 100; page += 1) {
    const releases = await githubGet(
      `repos/${repositoryPath}/releases?per_page=100&page=${page}`
    )
    if (!Array.isArray(releases)) {
      throw new Error('GitHub returned malformed release-list metadata')
    }

    const release = releases.find((candidate) => candidate.tag_name === tag)
    if (release) {
      return {
        draft: release.draft,
        prerelease: release.prerelease,
        tagName: release.tag_name,
        url: release.html_url
      }
    }
    if (releases.length < 100) {
      return null
    }
  }

  throw new Error('GitHub release lookup exceeded 100 pages')
}

export async function inspectGithubReleaseState({ expectedSha, expectedTag, repository }) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new Error('Repository must use owner/name format')
  }

  const [tagSha, release] = await Promise.all([
    resolveRemoteTagSha(repository, expectedTag),
    findRelease(repository, expectedTag)
  ])

  return evaluateReleaseState({ expectedSha, expectedTag, release, tagSha })
}

function readArgument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const assessment = await inspectGithubReleaseState({
    expectedSha: readArgument('--sha') ?? '',
    expectedTag: readArgument('--tag') ?? '',
    repository: readArgument('--repo') ?? ''
  })
  process.stdout.write(`${JSON.stringify(assessment)}\n`)

  if (assessment.action === 'reject') {
    throw new Error(`${assessment.state}: ${assessment.reason}`)
  }
  if (process.argv.includes('--expect-published') && assessment.state !== 'idempotent') {
    throw new Error(`Expected a published release, found ${assessment.state}`)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`[release-state] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
