export type ReleaseProfile = {
  nodeVersion: string
  pnpmVersion: string
  qualityProfile: 'check' | 'legacy'
  qualityScripts: string[]
}

export function resolveReleaseProfile(input: {
  nvmrc?: string
  packageJson: unknown
}): ReleaseProfile
