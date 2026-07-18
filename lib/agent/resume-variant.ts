import { resumeVariantSchema, type ResumeVariant } from './domain-store'
import {
  applyResumeChanges,
  type ResumeChangeFact,
  type ResumeChangeRequirement,
  type ResumeChangeSet
} from './resume-change-set'
import type { ResumeData } from '@/lib/resume-model'

export type CreateResumeVariantInput = {
  id: string
  sourceDraftId: string
  targetJobId: string
  name: string
  resume: ResumeData
  changeSet: ResumeChangeSet
  acceptedIds: Iterable<string>
  now: string
  facts: readonly ResumeChangeFact[]
  requirements: readonly ResumeChangeRequirement[]
}

/**
 * Creates a validated target-job variant without mutating the source resume or
 * performing persistence. The caller owns the explicit IndexedDB write.
 */
export function createResumeVariant(input: CreateResumeVariantInput): ResumeVariant {
  const data = applyResumeChanges(
    input.resume,
    input.changeSet,
    input.acceptedIds,
    { facts: input.facts, requirements: input.requirements }
  )

  return resumeVariantSchema.parse({
    id: input.id,
    sourceDraftId: input.sourceDraftId,
    targetJobId: input.targetJobId,
    name: input.name,
    data,
    createdAt: input.now,
    updatedAt: input.now
  })
}
