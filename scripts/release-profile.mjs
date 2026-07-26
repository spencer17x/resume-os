import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const LEGACY_NODE_VERSION = '22'
const LEGACY_QUALITY_SCRIPTS = [
  'typecheck',
  'lint',
  'test',
  'test:production-extraction',
]

function requireExactVersion(value, label) {
  if (typeof value !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(value)) {
    throw new Error(`${label} must be an exact numeric version`)
  }
  return value
}

export function resolveReleaseProfile({ nvmrc, packageJson }) {
  if (!packageJson || typeof packageJson !== 'object' || Array.isArray(packageJson)) {
    throw new Error('package.json must contain an object')
  }

  const nodeVersion =
    nvmrc === undefined
      ? LEGACY_NODE_VERSION
      : requireExactVersion(nvmrc.trim(), '.nvmrc')
  const packageManager = packageJson.packageManager
  const match =
    typeof packageManager === 'string'
      ? /^pnpm@([0-9]+\.[0-9]+\.[0-9]+)$/.exec(packageManager)
      : null
  if (!match) {
    throw new Error('packageManager must pin an exact pnpm version')
  }

  const scripts =
    packageJson.scripts &&
    typeof packageJson.scripts === 'object' &&
    !Array.isArray(packageJson.scripts)
      ? packageJson.scripts
      : {}
  if (typeof scripts.check === 'string' && scripts.check.length > 0) {
    return {
      nodeVersion,
      pnpmVersion: match[1],
      qualityProfile: 'check',
      qualityScripts: ['check'],
    }
  }

  const missing = LEGACY_QUALITY_SCRIPTS.filter(
    (name) => typeof scripts[name] !== 'string' || scripts[name].length === 0,
  )
  if (missing.length > 0) {
    throw new Error(`Unsupported legacy release; missing scripts: ${missing.join(', ')}`)
  }

  return {
    nodeVersion,
    pnpmVersion: match[1],
    qualityProfile: 'legacy',
    qualityScripts: [...LEGACY_QUALITY_SCRIPTS],
  }
}

function resolveCheckedOutRelease() {
  const nvmrc = existsSync('.nvmrc') ? readFileSync('.nvmrc', 'utf8') : undefined
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
  return resolveReleaseProfile({ nvmrc, packageJson })
}

function writeGitHubOutput(profile) {
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath) {
    throw new Error('GITHUB_OUTPUT is required')
  }
  appendFileSync(
    outputPath,
    [
      `node_version=${profile.nodeVersion}`,
      `pnpm_version=${profile.pnpmVersion}`,
      `quality_profile=${profile.qualityProfile}`,
      '',
    ].join('\n'),
  )
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  writeGitHubOutput(resolveCheckedOutRelease())
}
