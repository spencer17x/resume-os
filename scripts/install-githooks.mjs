#!/usr/bin/env node
/**
 * Enable versioned .githooks without replacing a custom core.hooksPath.
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const hooksDir = join(root, '.githooks')

if (!existsSync(hooksDir)) {
  console.error('install-githooks: missing .githooks directory')
  process.exit(1)
}

for (const name of ['pre-commit', 'commit-msg', 'pre-push']) {
  const path = join(hooksDir, name)
  if (existsSync(path)) {
    chmodSync(path, 0o755)
  }
}

const validator = join(root, 'scripts', 'validate-commit-message.sh')
if (existsSync(validator)) {
  chmodSync(validator, 0o755)
}

let current = ''
try {
  current = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
} catch {
  current = ''
}

if (current && current !== '.githooks' && current !== hooksDir) {
  console.error(
    `install-githooks: core.hooksPath is already set to ${JSON.stringify(current)}.`
  )
  console.error('Refusing to overwrite a custom hooks path. Unset it first if intentional.')
  process.exit(1)
}

execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' })
console.log('Git hooks enabled from .githooks (pre-commit, commit-msg, pre-push).')
