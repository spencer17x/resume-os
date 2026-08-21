import { describe, expect, it } from 'vitest'
import {
  MAX_JOB_DESCRIPTION_LENGTH,
  applicationRecordSchema,
  createJobInputFingerprint,
  createStableJobDomainId,
  jobPostingSchema,
  jobRecommendationSchema,
  jobSearchProfileSchema,
  jobSourceSchema,
  type ApplicationRecord,
  type JobPosting,
  type JobRecommendation,
  type JobSearchProfile,
  type JobSource
} from './job-domain'

const now = '2026-08-01T08:00:00.000Z'

const source: JobSource = {
  id: 'job-source-greenhouse-example',
  kind: 'greenhouse',
  label: 'Example careers',
  sourceKey: 'example',
  enabled: true,
  createdAt: now,
  updatedAt: now
}

const profile: JobSearchProfile = {
  id: 'job-search-profile-1',
  name: 'Staff frontend roles',
  titles: ['Staff Frontend Engineer'],
  adjacentTitles: ['Design Systems Engineer'],
  locations: ['Shanghai', 'Remote'],
  excludedLocations: [],
  workplaceTypes: ['remote', 'hybrid'],
  employmentTypes: ['full-time'],
  requiredTerms: ['TypeScript'],
  preferredTerms: ['design systems'],
  excludedTerms: [],
  maximumAgeDays: 30,
  createdAt: now,
  updatedAt: now
}

const posting: JobPosting = {
  id: 'job-posting-1',
  sourceId: source.id,
  externalId: '12345',
  canonicalUrl: 'https://boards.greenhouse.io/example/jobs/12345',
  applyUrl: 'https://boards.greenhouse.io/example/jobs/12345',
  title: 'Staff Frontend Engineer',
  company: 'Example Co',
  description: 'Lead a TypeScript design system across product teams.',
  locale: 'en',
  location: 'Remote',
  workplaceType: 'remote',
  employmentType: 'full-time',
  firstSeenAt: now,
  lastCheckedAt: now,
  status: 'open',
  contentHash: 'fnv1a64:posting-1'
}

const recommendation: JobRecommendation = {
  id: 'job-recommendation-1',
  postingId: posting.id,
  searchProfileId: profile.id,
  sourceDraftId: 'draft-1',
  rubricVersion: 'job-seeker-agent-job-relevance-v1',
  inputFingerprint: 'fnv1a64:recommendation-1',
  eligibility: 'eligible',
  preliminaryScore: 86,
  reasons: [{ code: 'title-match', contribution: 40, evidenceRefs: ['fact-1'] }],
  createdAt: now,
  updatedAt: now
}

const application: ApplicationRecord = {
  id: 'application-1',
  postingId: posting.id,
  sourceDraftId: 'draft-1',
  status: 'saved',
  notes: '',
  createdAt: now,
  updatedAt: now
}

describe('job domain schemas', () => {
  it('parses bounded Job Radar entities', () => {
    expect(jobSourceSchema.parse(source)).toEqual(source)
    expect(jobSearchProfileSchema.parse(profile)).toEqual(profile)
    expect(jobPostingSchema.parse(posting)).toEqual(posting)
    expect(jobRecommendationSchema.parse(recommendation)).toEqual(recommendation)
    expect(applicationRecordSchema.parse(application)).toEqual(application)
  })

  it('requires remote sources to use a bounded safe source key', () => {
    expect(jobSourceSchema.safeParse({ ...source, sourceKey: undefined }).success).toBe(false)
    expect(jobSourceSchema.safeParse({ ...source, sourceKey: 'https://evil.example/path' }).success).toBe(false)
    expect(jobSourceSchema.safeParse({
      ...source,
      kind: 'manual',
      sourceKey: undefined
    }).success).toBe(true)
  })

  it('rejects duplicate search terms and impossible timestamp ordering', () => {
    expect(jobSearchProfileSchema.safeParse({
      ...profile,
      titles: ['Staff Engineer', 'Staff Engineer']
    }).success).toBe(false)
    expect(jobSearchProfileSchema.safeParse({
      ...profile,
      updatedAt: '2026-07-31T08:00:00.000Z'
    }).success).toBe(false)
    expect(jobSearchProfileSchema.safeParse({
      ...profile,
      platforms: ['greenhouse', 'greenhouse']
    }).success).toBe(false)
  })

  it('keeps older stored search profiles valid while accepting platform scope', () => {
    expect(jobSearchProfileSchema.parse(profile)).toEqual(profile)
    expect(jobSearchProfileSchema.parse({
      ...profile,
      platforms: ['greenhouse', 'lever', 'boss'],
      preferredCompanies: ['Example']
    })).toMatchObject({ platforms: ['greenhouse', 'lever', 'boss'], preferredCompanies: ['Example'] })
    expect(jobSearchProfileSchema.parse({
      ...profile,
      blockedCompanies: ['Blocked Co'],
      experienceLevels: ['3-5 years'],
      educationLevels: ['Bachelor'],
      industries: ['Internet'],
      companySizes: ['100-499'],
      financingStages: ['Series B'],
      minimumMonthlySalary: 25_000,
      maximumMonthlySalary: 45_000
    })).toMatchObject({ minimumMonthlySalary: 25_000, maximumMonthlySalary: 45_000 })
    expect(jobSearchProfileSchema.safeParse({
      ...profile,
      minimumMonthlySalary: 50_000,
      maximumMonthlySalary: 30_000
    }).success).toBe(false)
  })

  it('requires HTTPS job URLs without embedded credentials', () => {
    expect(() => jobPostingSchema.safeParse({
      ...posting,
      applyUrl: 'not a URL'
    })).not.toThrow()
    expect(jobPostingSchema.safeParse({
      ...posting,
      applyUrl: 'not a URL'
    }).success).toBe(false)
    expect(jobPostingSchema.safeParse({
      ...posting,
      applyUrl: 'http://boards.greenhouse.io/example/jobs/12345'
    }).success).toBe(false)
    expect(jobPostingSchema.safeParse({
      ...posting,
      applyUrl: 'https://user:secret@boards.greenhouse.io/example/jobs/12345'
    }).success).toBe(false)
  })

  it('rejects oversized descriptions and invalid compensation ranges', () => {
    expect(jobPostingSchema.safeParse({
      ...posting,
      description: 'x'.repeat(MAX_JOB_DESCRIPTION_LENGTH + 1)
    }).success).toBe(false)
    expect(jobPostingSchema.safeParse({
      ...posting,
      compensation: { minimum: 200_000, maximum: 100_000, currency: 'USD' }
    }).success).toBe(false)
  })

  it('requires eligible recommendations to carry an explainable preliminary score', () => {
    expect(jobRecommendationSchema.safeParse({
      ...recommendation,
      preliminaryScore: undefined
    }).success).toBe(false)
    expect(jobRecommendationSchema.safeParse({
      ...recommendation,
      reasons: [{ code: 'duplicate-evidence', contribution: 5, evidenceRefs: ['fact-1', 'fact-1'] }]
    }).success).toBe(false)
  })

  it('requires a target job for variants and a timestamp for post-submission states', () => {
    expect(applicationRecordSchema.safeParse({
      ...application,
      resumeVariantId: 'variant-1'
    }).success).toBe(false)
    expect(applicationRecordSchema.safeParse({
      ...application,
      status: 'applied'
    }).success).toBe(false)
    expect(applicationRecordSchema.safeParse({
      ...application,
      status: 'applied',
      submittedAt: now
    }).success).toBe(true)
  })
})

describe('job domain identity helpers', () => {
  it('creates stable normalized IDs and fingerprints', () => {
    expect(createStableJobDomainId('posting', ['Greenhouse', ' Example ', '123'])).toBe(
      createStableJobDomainId('posting', ['greenhouse', 'example', '123'])
    )
    expect(createJobInputFingerprint({ title: 'Staff Engineer', tags: ['typescript'] })).toBe(
      createJobInputFingerprint({ title: 'Staff Engineer', tags: ['typescript'] })
    )
  })

  it('rejects empty identity parts and unserializable fingerprint inputs', () => {
    expect(() => createStableJobDomainId('posting', [''])).toThrow(TypeError)
    expect(() => createJobInputFingerprint(undefined)).toThrow(TypeError)
  })
})
