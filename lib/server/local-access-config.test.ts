import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type PackageJson = {
  packageManager?: string
  scripts?: Record<string, string>
}

describe('local AI process scripts', () => {
  const packageJson = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf8')
  ) as PackageJson

  it('keeps the workspace on pnpm 11.17.0', () => {
    expect(packageJson.packageManager).toBe('pnpm@11.17.0')
  })

  it('defines check as typecheck, unit tests, and a production build', () => {
    expect(packageJson.scripts?.check).toBe('node scripts/check.mjs')
    const checkScript = readFileSync(join(process.cwd(), 'scripts/check.mjs'), 'utf8')
    expect(checkScript).toContain("run('typecheck')")
    expect(checkScript).toContain("run('test')")
    expect(checkScript).toContain("run('build')")
  })

  it.each(['dev', 'start'])('binds %s to loopback and explicitly enables local-only mode', (scriptName) => {
    const script = packageJson.scripts?.[scriptName]
    expect(script).toContain('RESUME_OS_LOCAL_ONLY=1')
    expect(script).toMatch(/(?:--hostname|-H) 127\.0\.0\.1/)
  })

  it('provides a public server script that does not enable local-only mode', () => {
    const script = packageJson.scripts?.['start:server']
    expect(script).toContain('--hostname 0.0.0.0')
    expect(script).not.toContain('RESUME_OS_LOCAL_ONLY')
  })

  it('defines a built-server document extraction smoke', () => {
    const script = packageJson.scripts?.['test:production-extraction']
    expect(script).toContain('next build')
    expect(script).toContain('scripts/smoke-document-extraction.mjs')
  })
})
