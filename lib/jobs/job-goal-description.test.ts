import { describe, expect, it } from 'vitest'
import { analyzeJobGoalDescription } from './job-goal-description'

describe('job goal description', () => {
  it('derives bounded BOSS-style filters from a natural-language goal', () => {
    expect(analyzeJobGoalDescription(
      '想在杭州找全职 AI Agent工程师或AI全栈工程师，月薪 35K-60K，接受远程，偏好 TypeScript、React 和 RAG。'
    )).toEqual({
      titles: ['AI Agent工程师', 'AI全栈工程师', '全栈工程师'],
      locations: ['杭州'],
      minimumSalary: 35_000,
      maximumSalary: 60_000,
      workplaceTypes: ['remote'],
      employmentTypes: ['full-time'],
      preferredTerms: ['AI Agent', 'RAG', 'TypeScript', 'React', '远程']
    })
  })

  it('does not invent filters that were not stated', () => {
    expect(analyzeJobGoalDescription('希望找合适的机会')).toEqual({
      titles: [], locations: [], workplaceTypes: [], employmentTypes: [], preferredTerms: []
    })
  })
})
