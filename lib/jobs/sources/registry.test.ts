import { describe, expect, it } from 'vitest'
import { recognizeJobSourceUrl } from './registry'

describe('job source registry', () => {
  it('recognizes supported public job URLs and rejects arbitrary URLs', () => {
    expect(recognizeJobSourceUrl('https://boards.greenhouse.io/example/jobs/123')).toEqual({
      kind: 'greenhouse', sourceKey: 'example', externalId: '123'
    })
    expect(recognizeJobSourceUrl('https://jobs.lever.co/example/abc')).toEqual({
      kind: 'lever', sourceKey: 'example', externalId: 'abc'
    })
    expect(recognizeJobSourceUrl('https://example.com/jobs/123')).toBeNull()
    expect(recognizeJobSourceUrl('not a URL')).toBeNull()
  })
})
