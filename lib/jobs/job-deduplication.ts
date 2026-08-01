import type { JobPosting } from './job-domain'

export type JobDuplicateSuggestion = {
  postingIds: [string, string]
  reason: 'same-canonical-url' | 'same-content-and-identity'
}

export function findJobDuplicateSuggestions(postings: readonly JobPosting[]) {
  const suggestions: JobDuplicateSuggestion[] = []
  for (let leftIndex = 0; leftIndex < postings.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < postings.length; rightIndex += 1) {
      const left = postings[leftIndex]
      const right = postings[rightIndex]
      if (left.id === right.id) continue
      const postingIds = [left.id, right.id].sort(compareStrings) as [string, string]
      if (normalizeUrl(left.canonicalUrl) === normalizeUrl(right.canonicalUrl)) {
        suggestions.push({ postingIds, reason: 'same-canonical-url' })
        continue
      }
      if (
        left.contentHash === right.contentHash
        && normalizeText(left.company) === normalizeText(right.company)
        && normalizeText(left.title) === normalizeText(right.title)
        && normalizeText(left.location ?? '') === normalizeText(right.location ?? '')
      ) {
        suggestions.push({ postingIds, reason: 'same-content-and-identity' })
      }
    }
  }
  return suggestions.sort((left, right) => (
    compareStrings(left.postingIds[0], right.postingIds[0])
    || compareStrings(left.postingIds[1], right.postingIds[1])
  ))
}

function normalizeUrl(value: string) {
  const url = new URL(value)
  url.hash = ''
  url.searchParams.sort()
  return url.toString().replace(/\/$/u, '')
}

function normalizeText(value: string) {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ')
}

function compareStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}
