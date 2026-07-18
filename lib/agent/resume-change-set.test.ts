import { describe, expect, it } from 'vitest'
import { normalizeResumeData } from '@/lib/resume-model'
import {
  ResumeChangeSetError,
  applyResumeChanges,
  isResumeChangeApplicable,
  parseModelResumeChangeSet,
  parseResumeChangeSet,
  resumeChangeBlockReason,
  validateResumeChangeEvidence,
  validateResumeChangesAgainstApprovedPlan,
  validateResumeChanges,
  RESUME_CHANGE_SET_JSON_SCHEMA,
  resumeChangeSetSchema,
  type ResumeChangeEvidence
} from './resume-change-set'

function resume() {
  return normalizeResumeData({
    profile: {
      name: 'Ada Lovelace',
      title: 'Engineer',
      summary: ['Builds reliable systems'],
      tags: ['TypeScript'],
      links: [{ label: 'GitHub', url: 'https://github.com/ada' }]
    },
    targetRole: 'AI Engineer',
    skills: [{ group: 'Engineering', items: ['TypeScript', 'React'] }],
    experiences: [{
      company: 'Analytical Engines',
      role: 'Engineer',
      period: '2024 - Present',
      tags: ['Platform'],
      bullets: ['Owned delivery']
    }],
    projects: [{
      id: 'resume-os',
      name: 'Resume OS',
      type: 'Product',
      tags: ['AI'],
      summary: 'Resume workspace',
      highlights: ['Structured data']
    }],
    education: [{ school: 'University', details: ['Computer Science'] }],
    certifications: ['Cloud'],
    awards: ['Builder Award'],
    languages: ['English'],
    openSource: ['Maintainer'],
    metadata: { source: 'paste', locale: 'en', updatedAt: '2026-07-13T00:00:00.000Z' }
  })
}

function change(overrides: Partial<{
  id: string
  path: string
  original: unknown
  proposed: unknown
  reason: string
  needsConfirmation: boolean
  evidence: ResumeChangeEvidence
}> = {}) {
  return {
    id: 'change-1',
    path: 'experiences.0.bullets.0',
    original: 'Owned delivery',
    proposed: 'Owned platform delivery across product teams',
    reason: 'Clarifies scope',
    needsConfirmation: false,
    evidence: {
      requirementIds: ['requirement-1'],
      factIds: ['fact-1'],
      matchType: 'direct' as const,
      support: 'verified' as const,
      confidence: 0.9,
      transformation: 'rewrite' as const
    },
    ...overrides
  }
}

function expectChangeError(run: () => unknown, code: string) {
  try {
    run()
    throw new Error(`Expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(ResumeChangeSetError)
    expect((error as ResumeChangeSetError).code).toBe(code)
  }
}

const verifiedContext = {
  facts: [{
    id: 'fact-1',
    text: [
      'Owned platform delivery across product teams',
      'Builds reliable AI systems',
      'React architecture',
      'Agent-powered resume workspace',
      'Computer Science and systems',
      'English professional',
      'Lead Platform Engineer revised Rust',
      'https://github.com/new'
    ].join('. '),
    verification: 'document-backed' as const
  }],
  requirements: [{ id: 'requirement-1' }]
}

describe('resume change sets', () => {
  it('parses the documented contract and applies allowed leaf paths', () => {
    const set = resumeChangeSetSchema.parse({
      summary: 'Sharper impact language',
      changes: [
        change(),
        change({ id: 'change-2', path: 'profile.summary.0', original: 'Builds reliable systems', proposed: 'Builds reliable AI systems' }),
        change({ id: 'change-3', path: 'skills.0.items.1', original: 'React', proposed: 'React architecture' }),
        change({ id: 'change-4', path: 'projects.0.summary', original: 'Resume workspace', proposed: 'Agent-powered resume workspace' }),
        change({ id: 'change-5', path: 'education.0.details.0', original: 'Computer Science', proposed: 'Computer Science and systems' }),
        change({ id: 'change-6', path: 'languages.0', original: 'English', proposed: 'English (professional)' })
      ],
      questions: ['What team size can be verified?']
    })

    const next = applyResumeChanges(resume(), set, set.changes.map(({ id }) => id), verifiedContext)
    expect(next.profile.summary[0]).toBe('Builds reliable AI systems')
    expect(next.skills[0].items[1]).toBe('React architecture')
    expect(next.experiences[0].bullets[0]).toContain('product teams')
    expect(next.projects[0].summary).toContain('Agent-powered')
    expect(next.education[0].details[0]).toContain('systems')
    expect(next.languages[0]).toContain('professional')
  })

  it.each([
    '__proto__.polluted',
    'profile.__proto__.polluted',
    'profile.prototype.name',
    'profile.constructor.name',
    'experiences[0].role',
    'experiences..role',
    '.profile.name',
    'profile.name.',
    'metadata.source',
    'unknown.value'
  ])('rejects unsafe or malformed path %s', (path) => {
    expect(() => parseResumeChangeSet({ summary: 'Unsafe', changes: [change({ path })] }))
      .toThrow(ResumeChangeSetError)
  })

  it('rejects out-of-range indexes and structural creation', () => {
    const data = resume()
    expectChangeError(() => applyResumeChanges(data, parseResumeChangeSet({
      summary: 'Bad index',
      changes: [change({ path: 'experiences.4.role', original: undefined, proposed: 'Lead' })]
    }), ['change-1'], verifiedContext), 'UNSUPPORTED_PATH')

    expectChangeError(() => parseResumeChangeSet({
      summary: 'Structural replacement',
      changes: [change({ path: 'skills.0.items', original: ['TypeScript', 'React'], proposed: ['TypeScript'] })]
    }), 'UNSUPPORTED_PATH')
  })

  it('rejects duplicate IDs, duplicate paths, and conflicting paths', () => {
    expectChangeError(() => parseResumeChangeSet({
      summary: 'Duplicate ID',
      changes: [change(), change({ path: 'profile.title' })]
    }), 'DUPLICATE_CHANGE')

    expectChangeError(() => parseResumeChangeSet({
      summary: 'Duplicate path',
      changes: [change(), change({ id: 'change-2' })]
    }), 'DUPLICATE_CHANGE')

    expectChangeError(() => parseModelResumeChangeSet({
      summary: 'Order-dependent structural conflict',
      changes: [change({
        path: 'projects', original: ['resume-os'], proposed: ['resume-os'],
        evidence: {
          requirementIds: ['requirement-1'], factIds: ['fact-1'], matchType: 'direct',
          support: 'verified', confidence: 1, transformation: 'reorder'
        }
      }), change({
        id: 'change-2', path: 'projects.0.summary',
        original: 'Resume workspace', proposed: 'Agent-powered resume workspace'
      })]
    }), 'DUPLICATE_CHANGE')
  })

  it('selectively applies accepted IDs without mutating the original', () => {
    const original = resume()
    const set = parseResumeChangeSet({
      summary: 'Two suggestions',
      changes: [change(), change({
        id: 'change-2', path: 'profile.summary.0',
        original: 'Builds reliable systems', proposed: 'Builds reliable AI systems'
      })]
    })

    const next = applyResumeChanges(original, set, ['change-2'], verifiedContext)
    expect(next.profile.summary[0]).toBe('Builds reliable AI systems')
    expect(next.experiences[0].bullets[0]).toBe('Owned delivery')
    expect(original.profile.summary[0]).toBe('Builds reliable systems')
    expect(next).not.toBe(original)
  })

  it('rejects a stale change when original no longer deeply equals the resume value', () => {
    const set = parseResumeChangeSet({
      summary: 'Stale',
      changes: [change({ original: 'Different old value' })]
    })

    expectChangeError(() => applyResumeChanges(resume(), set, ['change-1'], verifiedContext), 'ORIGINAL_MISMATCH')
  })

  it('requires proposed values to match the existing safe leaf type', () => {
    const set = parseResumeChangeSet({
      summary: 'Wrong type',
      changes: [change({ proposed: { value: 'Injected object' } })]
    })

    expectChangeError(() => applyResumeChanges(resume(), set, ['change-1'], verifiedContext), 'INVALID_VALUE')
  })

  it('rejects creation of a missing optional string leaf', () => {
    const set = parseResumeChangeSet({
      summary: 'Create missing field',
      changes: [change({
        path: 'profile.location', original: undefined, proposed: 'London'
      })]
    })

    expectChangeError(() => applyResumeChanges(resume(), set, ['change-1'], verifiedContext), 'INVALID_VALUE')
  })

  it('normalizes an existing profile link edit without creating array structure', () => {
    const before = (Object.prototype as { polluted?: unknown }).polluted
    const set = parseResumeChangeSet({
      summary: 'Normalize',
      changes: [change({
        id: 'change-2', path: 'profile.links.0.url',
        original: 'https://github.com/ada', proposed: 'https://github.com/new'
      })]
    })
    const next = applyResumeChanges(resume(), set, ['change-2'], verifiedContext)

    expect(next.profile.links).toEqual([{ label: 'GitHub', url: 'https://github.com/new' }])
    expect((Object.prototype as { polluted?: unknown }).polluted).toBe(before)
  })

  it('rejects a link edit when normalization would recreate a github alias link', () => {
    const original = resume()
    original.profile.github = 'https://github.com/ada'
    const set = parseResumeChangeSet({
      summary: 'Edit canonical link',
      changes: [change({
        path: 'profile.links.0.url',
        original: 'https://github.com/ada',
        proposed: 'https://github.com/new'
      })]
    })

    expectChangeError(
      () => applyResumeChanges(original, set, ['change-1'], verifiedContext),
      'HIDDEN_NORMALIZATION_CHANGE'
    )
    expect(original.profile.links).toEqual([{ label: 'GitHub', url: 'https://github.com/ada' }])
  })

  it('exposes reusable validation for safe dry-runs', () => {
    const original = resume()
    const set = parseResumeChangeSet({
      summary: 'Dry run',
      changes: [change()]
    })

    const validated = validateResumeChanges(original, set, ['change-1'], verifiedContext)
    expect(validated.experiences[0].bullets[0]).toContain('product teams')
    expect(original.experiences[0].bullets[0]).toBe('Owned delivery')
  })

  it('rejects direct github and blog aliases without creating links', () => {
    for (const alias of ['github', 'blog']) {
      const original = resume()
      const linksBefore = structuredClone(original.profile.links)
      expectChangeError(() => parseResumeChangeSet({
        summary: 'Alias edit',
        changes: [change({
          path: `profile.${alias}`,
          original: undefined,
          proposed: `https://example.com/${alias}`
        })]
      }), 'UNSUPPORTED_PATH')
      expect(original.profile.links).toEqual(linksBefore)
    }
  })

  it('rejects combined alias and existing-link edits without unintended link creation', () => {
    const original = resume()
    const linksBefore = structuredClone(original.profile.links)
    expectChangeError(() => parseResumeChangeSet({
      summary: 'Conflicting aliases',
      changes: [
        change({ path: 'profile.github', original: undefined, proposed: 'https://github.com/new' }),
        change({
          id: 'change-2', path: 'profile.links.0.url',
          original: 'https://github.com/ada', proposed: 'https://github.com/other'
        })
      ]
    }), 'UNSUPPORTED_PATH')
    expect(original.profile.links).toEqual(linksBefore)
  })

  it('rejects targetRole because it is outside the approved path families', () => {
    expectChangeError(() => parseResumeChangeSet({
      summary: 'Unsupported target',
      changes: [change({ path: 'targetRole', original: 'AI Engineer', proposed: 'Platform Engineer' })]
    }), 'UNSUPPORTED_PATH')
  })

  it('migrates legacy stored changes to explicit unsupported evidence without making them applicable', () => {
    const legacy = change()
    const { evidence: _evidence, ...withoutEvidence } = legacy
    const set = parseResumeChangeSet({
      summary: 'Stored before evidence metadata existed',
      changes: [withoutEvidence]
    })

    expect(set.changes[0].evidence).toEqual({
      requirementIds: [],
      factIds: [],
      matchType: 'gap',
      support: 'unsupported',
      confidence: 0,
      transformation: 'rewrite'
    })
    expect(isResumeChangeApplicable(set.changes[0])).toBe(false)
    expectChangeError(
      () => applyResumeChanges(resume(), set, ['change-1']),
      'UNSUPPORTED_EVIDENCE'
    )
  })

  it('requires evidence on every new model change instead of applying the legacy migration', () => {
    const legacy = change()
    const { evidence: _evidence, ...withoutEvidence } = legacy
    expectChangeError(() => parseModelResumeChangeSet({
      summary: 'Missing evidence', changes: [withoutEvidence]
    }), 'INVALID_CHANGE_SET')
  })

  it('reads legacy scoreImpact data but rejects it as new model output', () => {
    const stored = {
      summary: 'Stored before deterministic scoring',
      changes: [change({
        evidence: {
          requirementIds: ['requirement-1'], factIds: ['fact-1'], matchType: 'direct',
          support: 'verified', confidence: 0.9, transformation: 'rewrite', scoreImpact: 12
        }
      })]
    }

    expect(parseResumeChangeSet(stored).changes[0].evidence.scoreImpact).toBe(12)
    expectChangeError(() => parseModelResumeChangeSet(stored), 'INVALID_CHANGE_SET')
    expect(RESUME_CHANGE_SET_JSON_SCHEMA.properties.changes.items.properties.evidence.properties)
      .not.toHaveProperty('scoreImpact')
  })

  it('requires applicable changes, including new claims, to cite requirements and facts', () => {
    const supported = parseModelResumeChangeSet({
      summary: 'Valid references require validation context', changes: [change()]
    })
    expectChangeError(
      () => applyResumeChanges(resume(), supported, ['change-1']),
      'EVIDENCE_REFERENCE_INVALID'
    )

    expectChangeError(() => parseModelResumeChangeSet({
      summary: 'Unsupported metric',
      changes: [change({
        proposed: 'Led 20 engineers and doubled throughput',
        evidence: {
          requirementIds: ['requirement-1'], factIds: [], matchType: 'direct',
          support: 'verified', confidence: 0.7, transformation: 'rewrite'
        }
      })]
    }), 'INVALID_CHANGE_SET')

    expectChangeError(() => parseModelResumeChangeSet({
      summary: 'Duplicate references',
      changes: [change({
        evidence: {
          requirementIds: ['requirement-1', 'requirement-1'],
          factIds: ['fact-1', 'fact-1'], matchType: 'direct',
          support: 'verified', confidence: 0.7, transformation: 'rewrite'
        }
      })]
    }), 'INVALID_CHANGE_SET')
  })

  it.each([
    'Led 24 platform engineers',
    'Led dozens of engineers',
    'Owned Kubernetes delivery',
    'Led delivery'
  ])('rejects unsupported English claim content: %s', (proposed) => {
    const set = parseModelResumeChangeSet({
      summary: 'Unrelated evidence',
      changes: [change({ proposed })]
    })

    expectChangeError(() => validateResumeChangeEvidence(set, {
      facts: [{
        id: 'fact-1', text: 'Maintained internal documentation',
        verification: 'document-backed'
      }],
      requirements: [{ id: 'requirement-1' }]
    }), 'EVIDENCE_REFERENCE_INVALID')
  })

  it('rejects cross-source metric binding and removing a negation without positive evidence', () => {
    const metricSwap = parseModelResumeChangeSet({
      summary: 'Unsafe metric binding',
      changes: [change({
        original: 'Led a 5-person platform team',
        proposed: 'Led a 40-person platform team'
      })]
    })
    expectChangeError(() => validateResumeChangeEvidence(metricSwap, {
      facts: [{
        id: 'fact-1', text: 'Reduced latency by 40%', verification: 'document-backed'
      }],
      requirements: [{ id: 'requirement-1' }]
    }), 'EVIDENCE_REFERENCE_INVALID')

    const removedNegation = parseModelResumeChangeSet({
      summary: 'Unsafe negation removal',
      changes: [change({
        original: 'Did not own production delivery',
        proposed: 'Owned production delivery'
      })]
    })
    expectChangeError(() => validateResumeChangeEvidence(removedNegation, {
      facts: [{
        id: 'fact-1', text: 'Maintained internal documentation',
        verification: 'document-backed'
      }],
      requirements: [{ id: 'requirement-1' }]
    }), 'EVIDENCE_REFERENCE_INVALID')

    for (const [original, proposed] of [
      ['Didn’t own production delivery', 'Own production delivery'],
      ['并非负责平台交付', '负责平台交付']
    ]) {
      const variant = parseModelResumeChangeSet({
        summary: 'Unsafe alternate negation removal',
        changes: [change({ original, proposed })]
      })
      expectChangeError(() => validateResumeChangeEvidence(variant, {
        facts: [{
          id: 'fact-1', text: 'Maintained internal documentation',
          verification: 'document-backed'
        }],
        requirements: [{ id: 'requirement-1' }]
      }), 'EVIDENCE_REFERENCE_INVALID')
    }

    const internalMetricRebinding = parseModelResumeChangeSet({
      summary: 'Unsafe internal metric binding',
      changes: [change({
        original: 'Led delivery across 40 projects and a 5 person platform team',
        proposed: 'Led delivery across a 40 person platform team'
      })]
    })
    expectChangeError(() => validateResumeChangeEvidence(internalMetricRebinding, {
      facts: [{
        id: 'fact-1', text: 'Maintained internal documentation',
        verification: 'document-backed'
      }],
      requirements: [{ id: 'requirement-1' }]
    }), 'EVIDENCE_REFERENCE_INVALID')

    const internalRelationRebinding = parseModelResumeChangeSet({
      summary: 'Unsafe relation binding',
      changes: [change({
        path: 'experiences.0.bullets', original: ['Owned delivery'],
        proposed: ['Owned delivery', 'Led platform delivery'],
        evidence: {
          requirementIds: ['requirement-1'], factIds: ['fact-1'], matchType: 'direct',
          support: 'verified', confidence: 0.9, transformation: 'add-from-fact'
        }
      })]
    })
    expectChangeError(() => validateResumeChangeEvidence(internalRelationRebinding, {
      facts: [{
        id: 'fact-1', text: 'Led documentation sessions and supported platform delivery',
        verification: 'document-backed'
      }],
      requirements: [{ id: 'requirement-1' }]
    }), 'EVIDENCE_REFERENCE_INVALID')
  })

  it('uses one supporting fact per claim and supports a mixed trusted provenance set', () => {
    const set = parseModelResumeChangeSet({
      summary: 'One fully supported claim',
      changes: [change({
        original: 'Owned delivery',
        proposed: 'Owned reliable platform delivery',
        evidence: {
          requirementIds: ['requirement-1'], factIds: ['fact-1', 'fact-2'],
          matchType: 'direct', support: 'user-confirmed', confidence: 0.9,
          transformation: 'rewrite'
        }
      })]
    })
    expect(validateResumeChangeEvidence(set, {
      facts: [{
        id: 'fact-1', text: 'Owned reliable platform delivery',
        verification: 'document-backed'
      }, {
        id: 'fact-2', text: 'Maintained internal documentation',
        verification: 'user-confirmed'
      }],
      requirements: [{ id: 'requirement-1' }]
    })).toEqual(set)
  })

  it('rejects contradictory unsupported evidence metadata', () => {
    expectChangeError(() => parseModelResumeChangeSet({
      summary: 'Contradictory unsupported evidence',
      changes: [change({
        evidence: {
          requirementIds: ['requirement-1'], factIds: ['fact-1'], matchType: 'direct',
          support: 'unsupported', confidence: 1, transformation: 'rewrite'
        }
      })]
    }), 'INVALID_CHANGE_SET')
  })

  it.each([
    '支持数十个团队',
    '推动交付效率翻倍',
    '主导 Kubernetes 平台交付',
    '主导平台交付'
  ])('rejects unsupported Chinese claim content: %s', (proposed) => {
    const set = parseModelResumeChangeSet({
      summary: '无关证据',
      changes: [change({ original: '负责交付', proposed })]
    })

    expectChangeError(() => validateResumeChangeEvidence(set, {
      facts: [{
        id: 'fact-1', text: '维护内部文档', verification: 'document-backed'
      }],
      requirements: [{ id: 'requirement-1' }]
    }), 'EVIDENCE_REFERENCE_INVALID')
  })

  it('accepts claim words supplied by the original value or the cited fact text', () => {
    const set = parseModelResumeChangeSet({
      summary: 'Fact-backed rewrite',
      changes: [change({
        original: 'Improved latency by 24%',
        proposed: 'Reduced platform latency by 24%'
      })]
    })

    expect(validateResumeChangeEvidence(set, {
      facts: [{
        id: 'fact-1', text: 'Reduced platform latency by 24%',
        verification: 'document-backed'
      }],
      requirements: [{ id: 'requirement-1' }]
    })).toEqual(set)
  })

  it('rejects wording reorders that are not supported in-order by one source', () => {
    const set = parseModelResumeChangeSet({
      summary: 'Wording-only rewrite',
      changes: [change({
        original: 'Owned TypeScript delivery for 24 teams',
        proposed: 'TypeScript delivery owned for 24 teams'
      })]
    })

    expectChangeError(() => validateResumeChangeEvidence(set, {
      facts: [{
        id: 'fact-1', text: 'Maintained internal documentation',
        verification: 'document-backed'
      }],
      requirements: [{ id: 'requirement-1' }]
    }), 'EVIDENCE_REFERENCE_INVALID')
  })

  it('accepts Chinese claim content supplied by the cited fact text', () => {
    const set = parseModelResumeChangeSet({
      summary: '事实支持的改写',
      changes: [change({
        original: '负责交付', proposed: '主导可靠平台交付'
      })]
    })

    expect(validateResumeChangeEvidence(set, {
      facts: [{
        id: 'fact-1', text: '主导可靠平台交付', verification: 'document-backed'
      }],
      requirements: [{ id: 'requirement-1' }]
    })).toEqual(set)
  })

  it.each([
    'profile.name',
    'profile.title',
    'experiences.0.company',
    'experiences.0.role',
    'experiences.0.period',
    'education.0.school'
  ])('keeps protected identity, employer, title, and date path %s out of automatic apply', (path) => {
    const current = path === 'profile.name' ? 'Ada Lovelace'
      : path === 'profile.title' ? 'Engineer'
        : path === 'experiences.0.company' ? 'Analytical Engines'
          : path === 'experiences.0.role' ? 'Engineer'
            : path === 'experiences.0.period' ? '2024 - Present'
              : 'University'
    const set = parseModelResumeChangeSet({
      summary: 'Protected field',
      changes: [change({ path, original: current, proposed: `${current} revised` })]
    })

    expect(isResumeChangeApplicable(set.changes[0])).toBe(false)
    expectChangeError(() => applyResumeChanges(resume(), set, ['change-1'], verifiedContext), 'PROTECTED_FIELD')
  })

  it('allows add-from-fact only on narrative leaves with an actual verified or user-confirmed fact', () => {
    const set = parseModelResumeChangeSet({
      summary: 'Use a confirmed fact',
      changes: [change({
        path: 'experiences.0.bullets',
        original: ['Owned delivery'],
        proposed: ['Owned delivery', 'Owned platform delivery for three product teams'],
        evidence: {
          requirementIds: ['requirement-1'], factIds: ['fact-1'], matchType: 'direct',
          support: 'user-confirmed', confidence: 1, transformation: 'add-from-fact'
        }
      })]
    })

    expectChangeError(() => applyResumeChanges(resume(), set, ['change-1'], {
      facts: [{
        id: 'fact-1', text: 'Owned platform delivery for three product teams',
        verification: 'imported'
      }],
      requirements: [{ id: 'requirement-1' }]
    }), 'EVIDENCE_REFERENCE_INVALID')
    expect(applyResumeChanges(resume(), set, ['change-1'], {
      facts: [{
        id: 'fact-1', text: 'Owned platform delivery for three product teams',
        verification: 'user-confirmed'
      }],
      requirements: [{ id: 'requirement-1' }]
    }).experiences[0].bullets).toEqual([
      'Owned delivery',
      'Owned platform delivery for three product teams'
    ])

    const original = resume()
    applyResumeChanges(original, set, ['change-1'], {
      facts: [{
        id: 'fact-1', text: 'Owned platform delivery for three product teams',
        verification: 'user-confirmed'
      }],
      requirements: [{ id: 'requirement-1' }]
    })
    expect(original.experiences[0].bullets).toEqual(['Owned delivery'])

    const duplicate = parseModelResumeChangeSet({
      summary: 'Duplicate existing claim',
      changes: [change({
        path: 'experiences.0.bullets', original: ['Owned delivery'],
        proposed: ['Owned delivery', 'Owned delivery'],
        evidence: {
          requirementIds: ['requirement-1'], factIds: ['fact-1'], matchType: 'direct',
          support: 'user-confirmed', confidence: 1, transformation: 'add-from-fact'
        }
      })]
    })
    expectChangeError(() => applyResumeChanges(resume(), duplicate, ['change-1'], {
      facts: [{
        id: 'fact-1', text: 'Maintained internal documentation',
        verification: 'user-confirmed'
      }],
      requirements: [{ id: 'requirement-1' }]
    }), 'INVALID_VALUE')

    const wrongPathInput = {
      summary: 'Not a narrative insertion',
      changes: [change({
        path: 'skills.0.items.0', original: 'TypeScript', proposed: 'Rust',
        evidence: {
          requirementIds: ['requirement-1'], factIds: ['fact-1'], matchType: 'direct',
          support: 'verified', confidence: 1, transformation: 'add-from-fact'
        }
      })]
    }
    expectChangeError(() => parseModelResumeChangeSet(wrongPathInput), 'INVALID_CHANGE_SET')
    const wrongPath = parseResumeChangeSet(wrongPathInput)
    expectChangeError(() => applyResumeChanges(resume(), wrongPath, ['change-1'], verifiedContext), 'UNSUPPORTED_TRANSFORMATION')
  })

  it('blocks index-based reorder changes until stable item IDs are available', () => {
    const input = {
      summary: 'Unsafe reorder',
      changes: [change({
        evidence: {
          requirementIds: ['requirement-1'], factIds: ['fact-1'], matchType: 'direct',
          support: 'verified', confidence: 1, transformation: 'reorder'
        }
      })]
    }
    expectChangeError(() => parseModelResumeChangeSet(input), 'INVALID_CHANGE_SET')
    const set = parseResumeChangeSet(input)
    expectChangeError(() => applyResumeChanges(resume(), set, ['change-1'], verifiedContext), 'UNSUPPORTED_TRANSFORMATION')
  })

  it('rejects new remove operations and keeps legacy remove data non-applicable', () => {
    const input = {
      summary: 'Unsafe automatic removal',
      changes: [change({
        proposed: '',
        evidence: {
          requirementIds: ['requirement-1'], factIds: ['fact-1'], matchType: 'direct',
          support: 'verified', confidence: 1, transformation: 'remove'
        }
      })]
    }
    expectChangeError(() => parseModelResumeChangeSet(input), 'INVALID_CHANGE_SET')
    const legacy = parseResumeChangeSet(input)
    expect(resumeChangeBlockReason(legacy.changes[0])).toBe('UNSAFE_REMOVE')
    expectChangeError(
      () => applyResumeChanges(resume(), legacy, ['change-1'], verifiedContext),
      'UNSUPPORTED_TRANSFORMATION'
    )
  })

  it('reorders projects only through an exact permutation of unique stable IDs', () => {
    const original = resume()
    original.projects.push({
      ...structuredClone(original.projects[0]),
      id: 'second-project',
      name: 'Second Project',
      summary: 'A separate project'
    })
    const set = parseModelResumeChangeSet({
      summary: 'Put the most relevant project first',
      changes: [change({
        path: 'projects',
        original: ['resume-os', 'second-project'],
        proposed: ['second-project', 'resume-os'],
        evidence: {
          requirementIds: ['requirement-1'], factIds: ['fact-1'], matchType: 'direct',
          support: 'verified', confidence: 1, transformation: 'reorder'
        }
      })]
    })

    const next = applyResumeChanges(original, set, ['change-1'], verifiedContext)
    expect(next.projects.map(({ id }) => id)).toEqual(['second-project', 'resume-os'])
    expect(next.projects.map(({ name }) => name)).toEqual(['Second Project', 'Resume OS'])
    expect(original.projects.map(({ id }) => id)).toEqual(['resume-os', 'second-project'])

    for (const proposed of [
      ['resume-os', 'resume-os'],
      ['resume-os', 'unknown-project']
    ]) {
      const invalid = parseModelResumeChangeSet({
        summary: 'Invalid project order',
        changes: [change({
          path: 'projects', original: ['resume-os', 'second-project'], proposed,
          evidence: {
            requirementIds: ['requirement-1'], factIds: ['fact-1'], matchType: 'direct',
            support: 'verified', confidence: 1, transformation: 'reorder'
          }
        })]
      })
      expectChangeError(
        () => applyResumeChanges(original, invalid, ['change-1'], verifiedContext),
        'INVALID_VALUE'
      )
    }

    const duplicateIds = structuredClone(original)
    duplicateIds.projects[1].id = 'resume-os'
    const duplicateCurrent = parseModelResumeChangeSet({
      summary: 'Current IDs are not stable',
      changes: [change({
        path: 'projects', original: ['resume-os', 'resume-os'], proposed: ['resume-os', 'second-project'],
        evidence: {
          requirementIds: ['requirement-1'], factIds: ['fact-1'], matchType: 'direct',
          support: 'verified', confidence: 1, transformation: 'reorder'
        }
      })]
    })
    expectChangeError(
      () => applyResumeChanges(duplicateIds, duplicateCurrent, ['change-1'], verifiedContext),
      'UNSUPPORTED_TRANSFORMATION'
    )
  })

  it('does not cross-join a requirement from one plan item with a fact from another', () => {
    const crossJoined = parseModelResumeChangeSet({
      summary: 'Cross joined evidence',
      changes: [change({
        evidence: {
          requirementIds: ['requirement-1'], factIds: ['fact-2'], matchType: 'direct',
          support: 'verified', confidence: 0.8, transformation: 'rewrite'
        }
      })]
    })
    const plan = {
      approvedAt: '2026-07-16T08:00:00.000Z',
      items: [{
        requirementIds: ['requirement-1'], factIds: ['fact-1'], transformation: 'rewrite' as const
      }, {
        requirementIds: ['requirement-2'], factIds: ['fact-2'], transformation: 'rewrite' as const
      }]
    }
    const matches = [{ requirementId: 'requirement-1', factIds: ['fact-1'], status: 'direct' as const }, {
      requirementId: 'requirement-2', factIds: ['fact-2'], status: 'direct' as const
    }]

    expectChangeError(
      () => validateResumeChangesAgainstApprovedPlan(crossJoined, plan, matches),
      'INVALID_CHANGE_SET'
    )

    expectChangeError(
      () => validateResumeChangesAgainstApprovedPlan(crossJoined, {
        ...plan,
        items: [{
          requirementIds: ['requirement-1', 'requirement-2'],
          factIds: ['fact-1', 'fact-2'],
          transformation: 'rewrite'
        }]
      }, matches),
      'INVALID_CHANGE_SET'
    )
  })

  it('uses persisted requirement-match status and the weakest status across cited requirements', () => {
    const plan = {
      approvedAt: '2026-07-16T08:00:00.000Z',
      items: [{
        requirementIds: ['requirement-1', 'requirement-2'],
        factIds: ['fact-1', 'fact-2'],
        transformation: 'rewrite' as const
      }]
    }
    const matches = [{
      requirementId: 'requirement-1', factIds: ['fact-1'], status: 'direct' as const
    }, {
      requirementId: 'requirement-2', factIds: ['fact-2'], status: 'partial' as const
    }]
    const partialChange = {
      summary: 'Uses the weaker persisted match',
      changes: [change({
        evidence: {
          requirementIds: ['requirement-1', 'requirement-2'],
          factIds: ['fact-1', 'fact-2'],
          matchType: 'partial', support: 'verified', confidence: 0.8,
          transformation: 'rewrite'
        }
      })]
    }

    expect(validateResumeChangesAgainstApprovedPlan(partialChange, plan, matches))
      .toMatchObject({ changes: [{ evidence: { matchType: 'partial' } }] })
    expectChangeError(() => validateResumeChangesAgainstApprovedPlan({
      ...partialChange,
      changes: [change({
        evidence: { ...partialChange.changes[0].evidence, matchType: 'direct' }
      })]
    }, plan, matches), 'INVALID_CHANGE_SET')

    expect(validateResumeChangesAgainstApprovedPlan({
      summary: 'Keeps a cited gap review-only',
      changes: [change({
        evidence: {
          requirementIds: ['requirement-1', 'requirement-2'], factIds: [],
          matchType: 'gap', support: 'unsupported', confidence: 0,
          transformation: 'rewrite'
        }
      })]
    }, plan, [matches[0], { ...matches[1], status: 'gap' }]))
      .toMatchObject({ changes: [{ evidence: { matchType: 'gap', support: 'unsupported' } }] })
  })

  it('does not let a supported change borrow a gap or an ambiguous persisted match', () => {
    const plan = {
      approvedAt: '2026-07-16T08:00:00.000Z',
      items: [{
        requirementIds: ['requirement-1'], factIds: ['fact-1'], transformation: 'rewrite' as const
      }]
    }
    const supported = {
      summary: 'Claims direct support',
      changes: [change()]
    }

    expectChangeError(() => validateResumeChangesAgainstApprovedPlan(supported, plan, [{
      requirementId: 'requirement-1', factIds: ['fact-1'], status: 'gap'
    }]), 'INVALID_CHANGE_SET')
    expectChangeError(() => validateResumeChangesAgainstApprovedPlan(supported, plan, []), 'INVALID_CHANGE_SET')
    expectChangeError(() => validateResumeChangesAgainstApprovedPlan(supported, plan, [{
      requirementId: 'requirement-1', factIds: ['fact-1'], status: 'direct'
    }, {
      requirementId: 'requirement-1', factIds: ['fact-1'], status: 'direct'
    }]), 'INVALID_CHANGE_SET')
  })

  it('requires every cited requirement to have at least one cited supporting fact', () => {
    const plan = {
      approvedAt: '2026-07-16T08:00:00.000Z',
      items: [{
        requirementIds: ['requirement-1', 'requirement-2'],
        factIds: ['fact-1', 'fact-2'],
        transformation: 'rewrite' as const
      }]
    }
    const matches = [{
      requirementId: 'requirement-1', factIds: ['fact-1'], status: 'direct' as const
    }, {
      requirementId: 'requirement-2', factIds: ['fact-2'], status: 'direct' as const
    }]
    const missingSecondRequirementEvidence = parseModelResumeChangeSet({
      summary: 'Incomplete multi-requirement evidence',
      changes: [change({
        evidence: {
          requirementIds: ['requirement-1', 'requirement-2'],
          factIds: ['fact-1'],
          matchType: 'direct', support: 'verified', confidence: 0.8,
          transformation: 'rewrite'
        }
      })]
    })
    expectChangeError(
      () => validateResumeChangesAgainstApprovedPlan(
        missingSecondRequirementEvidence,
        plan,
        matches
      ),
      'INVALID_CHANGE_SET'
    )

    const fullyMapped = parseModelResumeChangeSet({
      summary: 'Complete multi-requirement evidence',
      changes: [change({
        evidence: {
          requirementIds: ['requirement-1', 'requirement-2'],
          factIds: ['fact-1', 'fact-2'],
          matchType: 'direct', support: 'verified', confidence: 0.8,
          transformation: 'rewrite'
        }
      })]
    })
    expect(() => validateResumeChangesAgainstApprovedPlan(fullyMapped, plan, matches)).not.toThrow()
  })

  it('enforces bounded IDs, paths, values, counts, and total AI output size', () => {
    expect(() => parseResumeChangeSet({
      summary: 'Bounds',
      changes: [change({ id: 'x'.repeat(81) })]
    })).toThrow(ResumeChangeSetError)
    expect(() => parseResumeChangeSet({
      summary: 'Bounds',
      changes: [change({ proposed: 'x'.repeat(12_001) })]
    })).toThrow(ResumeChangeSetError)
    expect(() => parseResumeChangeSet({
      summary: 'Bounds',
      changes: Array.from({ length: 51 }, (_, index) => change({ id: `change-${index}`, path: `profile.name` }))
    })).toThrow(ResumeChangeSetError)
    expect(() => parseResumeChangeSet({
      summary: 'x'.repeat(70_000),
      changes: []
    })).toThrow(ResumeChangeSetError)
  })
})
