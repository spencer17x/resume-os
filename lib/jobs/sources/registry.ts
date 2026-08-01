import type { JobSource } from '../job-domain'
import { createGreenhouseAdapter } from './greenhouse'
import { createLeverAdapter } from './lever'
import type { JobSourceAdapter, JobSourceAdapterDependencies } from './types'

export function createJobSourceRegistry(
  dependencies: JobSourceAdapterDependencies = {}
): ReadonlyMap<JobSource['kind'], JobSourceAdapter> {
  const adapters = [
    createGreenhouseAdapter(dependencies),
    createLeverAdapter(dependencies)
  ]
  return new Map(adapters.map((adapter) => [adapter.kind, adapter]))
}

export function recognizeJobSourceUrl(
  value: string,
  registry = createJobSourceRegistry()
) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  for (const adapter of registry.values()) {
    const recognized = adapter.recognizeUrl(url)
    if (recognized) return { kind: adapter.kind, ...recognized }
  }
  return null
}
