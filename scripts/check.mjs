import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const nextEnvPath = resolve('next-env.d.ts')
const originalNextEnv = readFileSync(nextEnvPath)
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function run(script) {
  const result = spawnSync(pnpm, [script], { stdio: 'inherit' })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`pnpm ${script} failed with exit code ${result.status}`)
  }
}

try {
  run('typecheck')
  run('test')
  run('build')
} finally {
  const generatedNextEnv = readFileSync(nextEnvPath)
  if (!generatedNextEnv.equals(originalNextEnv)) {
    writeFileSync(nextEnvPath, originalNextEnv)
  }
}
