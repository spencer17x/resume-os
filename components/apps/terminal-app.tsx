'use client'

import { Play, TerminalSquare } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useResumeDraft } from '@/components/resume-draft-provider'
import type { Locale } from '@/i18n/routing'
import type { ResumeData } from '@/lib/resume-model'

const COMMANDS = ['whoami', 'skills', 'projects', 'help'] as const
type Command = typeof COMMANDS[number]
type HistoryEntry = { id: number; input: string; lines: string[]; error: boolean }

export function TerminalApp() {
  const locale = useLocale() as Locale
  const t = useTranslations('terminal')
  const { activeDraft, activeResume } = useResumeDraft()
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [announcement, setAnnouncement] = useState({ id: 0, text: '' })
  const separator = locale === 'zh' ? '、' : ', '

  function run(inputValue: string) {
    const normalized = inputValue.trim().toLowerCase()
    if (!normalized) return
    const command = COMMANDS.find((value) => value === normalized) ?? 'unknown'
    const result = commandResult(command, normalized, activeResume, separator, {
      help: t('commandsHelp'),
      unknown: t('unknownCommand', { command: normalized }),
      noSkills: t('noSkills'),
      noProjects: t('noProjects')
    })
    setHistory((current) => [...current, {
      id: (current.at(-1)?.id ?? 0) + 1,
      input: normalized,
      lines: result.lines,
      error: result.error
    }])
    setAnnouncement((current) => ({ id: current.id + 1, text: result.lines.join(' ') }))
    setInput('')
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    run(input)
  }

  return (
    <section className="terminal-app" role="region" aria-label={t('regionLabel')}>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement.text && <span key={announcement.id}>{announcement.text}</span>}
      </p>
      <header className="terminal-app__titlebar">
        <div aria-hidden="true"><span /><span /><span /></div>
        <p><TerminalSquare size={14} aria-hidden="true" />{t('title')}</p>
        <span>{activeDraft?.name ?? t('sampleResume')} · {activeResume.profile.name}</span>
      </header>
      <nav className="terminal-app__commands" aria-label={t('commandShortcuts')}>
        {COMMANDS.map((command) => (
          <button type="button" key={command} onClick={() => run(command)} aria-label={t('runCommand', { command })}>
            <Play size={12} aria-hidden="true" />{command}
          </button>
        ))}
      </nav>
      <div className="terminal-app__output" aria-label={t('output')}>
        <p className="terminal-app__welcome">{t('welcome')}</p>
        {history.map((entry) => (
          <div className="terminal-app__entry" key={entry.id}>
            <p><span>resume@os</span>:~$ {entry.input}</p>
            <div className={entry.error ? 'terminal-app__error' : 'terminal-app__result'}>
              {entry.lines.map((line, index) => <p key={`entry-${entry.id}-line-${index}`}>{line}</p>)}
            </div>
          </div>
        ))}
      </div>
      <form className="terminal-app__input" onSubmit={submit}>
        <label htmlFor="resume-terminal-command" className="sr-only">{t('commandInput')}</label>
        <span aria-hidden="true">resume@os:~$</span>
        <input
          id="resume-terminal-command"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t('placeholder')}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" aria-label={t('runInput')}><Play size={15} aria-hidden="true" /></button>
      </form>
    </section>
  )
}

function commandResult(
  command: Command | 'unknown',
  input: string,
  resume: ResumeData,
  separator: string,
  messages: { help: string; unknown: string; noSkills: string; noProjects: string }
): { lines: string[]; error: boolean } {
  const { profile, projects, skills } = resume
  if (command === 'whoami') {
    return {
      lines: [`${[profile.name, profile.englishName].filter(Boolean).join(' / ')} - ${profile.title || resume.targetRole || ''}`],
      error: false
    }
  }
  if (command === 'skills') {
    return {
      lines: skills.length > 0
        ? skills.map((group) => `${group.group}: ${group.items.join(separator)}`)
        : [messages.noSkills],
      error: false
    }
  }
  if (command === 'projects') {
    return {
      lines: projects.length > 0
        ? projects.map((project) => `- ${project.name}: ${project.tags.join(separator)}`)
        : [messages.noProjects],
      error: false
    }
  }
  if (command === 'help') return { lines: [messages.help], error: false }
  return { lines: [messages.unknown || input], error: true }
}
