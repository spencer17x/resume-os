# Resume Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Resume Studio slice: local multi-draft resume data production, AI parsing/generation/chat completion, and Agent/Three.js/Book/Classic/Timeline display routes powered by the active draft.

**Architecture:** The home route becomes a client-side Studio that manages browser-local resume drafts. Server routes only perform AI and file text extraction work. Display routes render a client component that reads the active draft from a shared provider and falls back to the built-in sample resume.

**Tech Stack:** Next.js App Router, TypeScript, next-intl, Tailwind CSS v4, AI SDK OpenAI-compatible provider, Zod, mammoth, pdf-parse, Three.js, @react-three/fiber, @react-three/drei, Vitest.

---

## Current Repo Notes

- Existing locale routes live under `app/[locale]`.
- Existing i18n files are `messages/zh.json` and `messages/en.json`.
- Existing static resume data is in `data/resume.ts`.
- Existing AI helper is `lib/agent/openai.ts`.
- Existing chat prompt helper is `lib/agent/prompt.ts`.
- Existing route pages are mostly server components.
- The current worktree may contain unrelated local changes in `package.json` and `next-env.d.ts`; do not revert them. Work with the current file contents.

## File Structure

Create or modify these units:

- `package.json`: add runtime dependencies and `test` script.
- `vitest.config.ts`: unit test configuration.
- `lib/resume-model.ts`: generalized resume types, schema, normalization, draft helpers.
- `lib/resume-model.test.ts`: model and draft helper tests.
- `lib/resume-sample.ts`: converts built-in locale sample data into normalized `ResumeData`.
- `lib/resume-store.ts`: local draft persistence helpers that are testable without React.
- `lib/resume-store.test.ts`: local draft persistence helper tests.
- `components/resume-draft-provider.tsx`: client context and hook for active draft state.
- `components/resume-shell.tsx`: route wrapper that provides sample data to client display components.
- `lib/agent/resume-prompts.ts`: strict JSON prompts for parse, generate, chat update, and Q&A with active draft.
- `lib/agent/json.ts`: AI JSON parsing helper.
- `app/api/resume/extract-text/route.ts`: extracts text from PDF, DOCX, TXT uploads.
- `app/api/resume/parse/route.ts`: parses text into structured resume data.
- `app/api/resume/generate/route.ts`: generates simulated resume data.
- `app/api/resume/chat/route.ts`: updates current resume data from a user instruction.
- `app/api/chat/route.ts`: accept optional resume data context.
- `components/resume-studio/resume-studio.tsx`: home Studio orchestrator.
- `components/resume-studio/source-panel.tsx`: upload/paste/AI generation controls.
- `components/resume-studio/draft-list.tsx`: local draft management.
- `components/resume-studio/resume-preview.tsx`: structured active resume preview.
- `components/resume-studio/route-gallery.tsx`: route cards for Agent, 3D, Book, Classic, Timeline.
- `app/[locale]/page.tsx`: render the Studio.
- `components/agent/resume-agent-client.tsx`: agent chat page UI.
- `app/[locale]/agent/page.tsx`: render Agent client page with sample fallback.
- `components/resume-3d/resume-orbit.tsx`: Three.js canvas scene.
- `components/resume-3d/resume-orbit-page.tsx`: 3D route UI shell and detail panel.
- `app/[locale]/3d/page.tsx`: render the 3D route.
- `components/book/resume-book.tsx`: book flip UI.
- `app/[locale]/book/page.tsx`: render the Book route.
- `components/resume-display/classic-resume.tsx`: client classic resume display.
- `components/resume-display/timeline-resume.tsx`: client timeline display.
- `components/resume-display/projects-resume.tsx`: optional client projects display.
- `components/resume-display/terminal-resume.tsx`: optional client terminal display.
- `app/[locale]/classic/page.tsx`: use client classic display.
- `app/[locale]/timeline/page.tsx`: use client timeline display.
- `app/[locale]/projects/page.tsx`: use client projects display with the active draft.
- `app/[locale]/terminal/page.tsx`: use client terminal display with the active draft.
- `messages/zh.json` and `messages/en.json`: add Studio, 3D, Book, draft, upload, AI, and error copy.
- `app/globals.css`: add reusable animation classes and reduced-motion handling.

---

### Task 1: Dependencies And Test Harness

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Add dependencies**

Run:

```bash
corepack pnpm@10.33.0 add zod mammoth pdf-parse three @react-three/fiber @react-three/drei
corepack pnpm@10.33.0 add -D vitest jsdom @types/pdf-parse
```

Expected:

- `pnpm-lock.yaml` changes.
- `package.json` keeps `"packageManager": "pnpm@10.33.0"`.

- [ ] **Step 2: Add the test script**

In `package.json`, keep existing scripts and add:

```json
{
  "scripts": {
    "test": "vitest run"
  }
}
```

If the file already has `"dev": "next dev -p 3001"`, keep it.

- [ ] **Step 3: Create Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['**/*.test.ts', '**/*.test.tsx']
  },
  resolve: {
    alias: {
      '@': new URL('.', import.meta.url).pathname
    }
  }
})
```

- [ ] **Step 4: Run test command**

Run:

```bash
corepack pnpm@10.33.0 test
```

Expected:

- It may report no tests found before Task 2, or it may pass if Vitest treats the empty set as no work. If it exits nonzero only because no tests exist, continue to Task 2 and rerun after tests are added.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "chore: add resume studio dependencies"
```

---

### Task 2: Resume Model, Normalization, And Sample Adapter

**Files:**
- Create: `lib/resume-model.ts`
- Create: `lib/resume-model.test.ts`
- Create: `lib/resume-sample.ts`
- Modify: `data/resume.ts`

- [ ] **Step 1: Write failing model tests**

Create `lib/resume-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  createResumeDraft,
  normalizeResumeData,
  resumeDataSchema,
  type ResumeData
} from './resume-model'

describe('resume model', () => {
  it('normalizes missing optional arrays and metadata', () => {
    const normalized = normalizeResumeData({
      profile: {
        name: 'Ada Lovelace',
        title: 'AI Engineer',
        summary: ['Builds agent systems'],
        tags: ['AI']
      },
      skills: [{ group: 'AI', items: ['RAG'] }],
      experiences: [],
      projects: [],
      openSource: []
    })

    expect(normalized.profile.links).toEqual([])
    expect(normalized.education).toEqual([])
    expect(normalized.certifications).toEqual([])
    expect(normalized.awards).toEqual([])
    expect(normalized.languages).toEqual([])
    expect(normalized.metadata.source).toBe('sample')
    expect(normalized.metadata.locale).toBe('zh')
    expect(normalized.metadata.updatedAt).toMatch(/T/)
  })

  it('keeps known project ids and fills missing project arrays', () => {
    const normalized = normalizeResumeData({
      profile: { name: 'Ada', title: 'Engineer', summary: [], tags: [] },
      skills: [],
      experiences: [],
      projects: [{ id: 'p1', name: 'Agent OS', type: 'Personal', tags: ['AI'], summary: 'Demo' }],
      openSource: []
    })

    expect(normalized.projects[0]).toMatchObject({
      id: 'p1',
      name: 'Agent OS',
      highlights: []
    })
  })

  it('creates a draft with stable metadata', () => {
    const data: ResumeData = normalizeResumeData({
      profile: { name: 'Ada', title: 'Engineer', summary: [], tags: [] },
      skills: [],
      experiences: [],
      projects: [],
      openSource: []
    })

    const draft = createResumeDraft(data, {
      id: 'draft-1',
      name: 'Ada Resume',
      source: 'ai-generated',
      now: '2026-07-06T00:00:00.000Z'
    })

    expect(draft.id).toBe('draft-1')
    expect(draft.name).toBe('Ada Resume')
    expect(draft.source).toBe('ai-generated')
    expect(draft.data.metadata.source).toBe('ai-generated')
    expect(draft.createdAt).toBe('2026-07-06T00:00:00.000Z')
  })

  it('validates normalized data with zod', () => {
    const data = normalizeResumeData({
      profile: { name: 'Ada', title: 'Engineer', summary: [], tags: [] },
      skills: [],
      experiences: [],
      projects: [],
      openSource: []
    })

    expect(() => resumeDataSchema.parse(data)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
corepack pnpm@10.33.0 test lib/resume-model.test.ts
```

Expected:

- FAIL because `lib/resume-model.ts` does not exist.

- [ ] **Step 3: Implement the model**

Create `lib/resume-model.ts`:

```ts
import { z } from 'zod'

export const resumeLocaleSchema = z.enum(['zh', 'en'])

export const resumeSourceSchema = z.enum([
  'sample',
  'upload',
  'paste',
  'ai-generated',
  'ai-chat'
])

const linkSchema = z.object({
  label: z.string().default(''),
  url: z.string().default('')
})

const profileSchema = z.object({
  name: z.string().default(''),
  englishName: z.string().optional(),
  title: z.string().default(''),
  location: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  github: z.string().optional(),
  blog: z.string().optional(),
  links: z.array(linkSchema).default([]),
  summary: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([])
})

const skillGroupSchema = z.object({
  group: z.string().default(''),
  items: z.array(z.string()).default([])
})

const experienceSchema = z.object({
  company: z.string().default(''),
  role: z.string().default(''),
  period: z.string().default(''),
  location: z.string().optional(),
  tags: z.array(z.string()).default([]),
  bullets: z.array(z.string()).default([])
})

const projectSchema = z.object({
  id: z.string().default(''),
  name: z.string().default(''),
  type: z.string().default(''),
  tags: z.array(z.string()).default([]),
  summary: z.string().default(''),
  highlights: z.array(z.string()).default([])
})

const educationSchema = z.object({
  school: z.string().default(''),
  degree: z.string().optional(),
  major: z.string().optional(),
  period: z.string().optional(),
  details: z.array(z.string()).default([])
})

const metadataSchema = z.object({
  source: resumeSourceSchema.default('sample'),
  locale: resumeLocaleSchema.default('zh'),
  updatedAt: z.string().default(() => new Date().toISOString())
})

export const resumeDataSchema = z.object({
  profile: profileSchema.default({}),
  targetRole: z.string().optional(),
  skills: z.array(skillGroupSchema).default([]),
  experiences: z.array(experienceSchema).default([]),
  projects: z.array(projectSchema).default([]),
  education: z.array(educationSchema).default([]),
  certifications: z.array(z.string()).default([]),
  awards: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  openSource: z.array(z.string()).default([]),
  metadata: metadataSchema.default({})
})

export type ResumeLocale = z.infer<typeof resumeLocaleSchema>
export type ResumeSource = z.infer<typeof resumeSourceSchema>
export type ResumeData = z.infer<typeof resumeDataSchema>

export type ResumeDraft = {
  id: string
  name: string
  source: ResumeSource
  createdAt: string
  updatedAt: string
  data: ResumeData
}

export type ResumeDraftState = {
  activeDraftId: string | null
  drafts: ResumeDraft[]
}

export function normalizeResumeData(
  input: unknown,
  options: {
    source?: ResumeSource
    locale?: ResumeLocale
    now?: string
  } = {}
) {
  const parsed = resumeDataSchema.parse(input)
  const source = options.source ?? parsed.metadata.source
  const locale = options.locale ?? parsed.metadata.locale
  const updatedAt = options.now ?? parsed.metadata.updatedAt ?? new Date().toISOString()

  return resumeDataSchema.parse({
    ...parsed,
    profile: {
      ...parsed.profile,
      links: normalizeLinks(parsed.profile)
    },
    metadata: {
      source,
      locale,
      updatedAt
    }
  })
}

function normalizeLinks(profile: ResumeData['profile']) {
  const links = [...profile.links]

  if (profile.github && !links.some((link) => link.url === profile.github)) {
    links.push({ label: 'GitHub', url: profile.github })
  }

  if (profile.blog && !links.some((link) => link.url === profile.blog)) {
    links.push({ label: 'Blog', url: profile.blog })
  }

  return links.filter((link) => link.url)
}

export function createResumeDraft(
  data: ResumeData,
  options: {
    id?: string
    name?: string
    source?: ResumeSource
    now?: string
  } = {}
): ResumeDraft {
  const now = options.now ?? new Date().toISOString()
  const source = options.source ?? data.metadata.source
  const normalizedData = normalizeResumeData(data, {
    source,
    locale: data.metadata.locale,
    now
  })

  return {
    id: options.id ?? globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}`,
    name: options.name ?? defaultDraftName(normalizedData),
    source,
    createdAt: now,
    updatedAt: now,
    data: normalizedData
  }
}

export function defaultDraftName(data: ResumeData) {
  const name = data.profile.name || 'Untitled Resume'
  const title = data.targetRole || data.profile.title
  return title ? `${name} - ${title}` : name
}
```

- [ ] **Step 4: Add the sample adapter**

Create `lib/resume-sample.ts`:

```ts
import { getResumeData } from '@/data/resume'
import type { Locale } from '@/i18n/routing'
import { normalizeResumeData } from './resume-model'

export function getSampleResumeData(locale: Locale) {
  const data = getResumeData(locale)

  return normalizeResumeData(
    {
      ...data,
      profile: {
        ...data.profile,
        links: [
          { label: 'GitHub', url: data.profile.github },
          { label: 'Blog', url: data.profile.blog }
        ]
      },
      education: [],
      certifications: [],
      awards: [],
      languages: locale === 'zh' ? ['中文', 'English'] : ['Chinese', 'English'],
      metadata: {
        source: 'sample',
        locale,
        updatedAt: '2026-07-06T00:00:00.000Z'
      }
    },
    { source: 'sample', locale, now: '2026-07-06T00:00:00.000Z' }
  )
}
```

- [ ] **Step 5: Keep current data exports compatible**

In `data/resume.ts`, keep the existing exported shape and add empty fields only if TypeScript requires them. Do not remove `englishName`, `github`, or `blog`; the adapter maps them into generalized links.

- [ ] **Step 6: Run tests**

Run:

```bash
corepack pnpm@10.33.0 test lib/resume-model.test.ts
corepack pnpm@10.33.0 typecheck
```

Expected:

- PASS for model tests.
- PASS typecheck.

- [ ] **Step 7: Commit**

```bash
git add lib/resume-model.ts lib/resume-model.test.ts lib/resume-sample.ts data/resume.ts
git commit -m "feat: add normalized resume model"
```

---

### Task 3: Local Draft Store And Provider

**Files:**
- Create: `lib/resume-store.ts`
- Create: `lib/resume-store.test.ts`
- Create: `components/resume-draft-provider.tsx`
- Create: `components/resume-shell.tsx`

- [ ] **Step 1: Write failing store tests**

Create `lib/resume-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createResumeDraft, normalizeResumeData } from './resume-model'
import {
  addDraft,
  deleteDraft,
  getActiveDraft,
  renameDraft,
  setActiveDraft
} from './resume-store'

const resume = normalizeResumeData({
  profile: { name: 'Ada', title: 'Engineer', summary: [], tags: [] },
  skills: [],
  experiences: [],
  projects: [],
  openSource: []
})

describe('resume store reducers', () => {
  it('adds the first draft and makes it active', () => {
    const draft = createResumeDraft(resume, { id: 'd1', now: '2026-07-06T00:00:00.000Z' })
    const state = addDraft({ activeDraftId: null, drafts: [] }, draft)

    expect(state.activeDraftId).toBe('d1')
    expect(state.drafts).toHaveLength(1)
  })

  it('renames a draft', () => {
    const draft = createResumeDraft(resume, { id: 'd1' })
    const state = renameDraft({ activeDraftId: 'd1', drafts: [draft] }, 'd1', 'New Name')

    expect(state.drafts[0].name).toBe('New Name')
  })

  it('sets active draft only when it exists', () => {
    const draft = createResumeDraft(resume, { id: 'd1' })
    const state = setActiveDraft({ activeDraftId: null, drafts: [draft] }, 'missing')

    expect(state.activeDraftId).toBeNull()
  })

  it('deletes active draft and selects the next available draft', () => {
    const d1 = createResumeDraft(resume, { id: 'd1' })
    const d2 = createResumeDraft(resume, { id: 'd2' })
    const state = deleteDraft({ activeDraftId: 'd1', drafts: [d1, d2] }, 'd1')

    expect(state.activeDraftId).toBe('d2')
    expect(state.drafts.map((draft) => draft.id)).toEqual(['d2'])
  })

  it('returns active draft', () => {
    const d1 = createResumeDraft(resume, { id: 'd1' })
    const state = { activeDraftId: 'd1', drafts: [d1] }

    expect(getActiveDraft(state)?.id).toBe('d1')
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
corepack pnpm@10.33.0 test lib/resume-store.test.ts
```

Expected:

- FAIL because `lib/resume-store.ts` does not exist.

- [ ] **Step 3: Implement store helpers**

Create `lib/resume-store.ts`:

```ts
import { createResumeDraft, normalizeResumeData, type ResumeDraft, type ResumeDraftState } from './resume-model'

export const RESUME_DRAFT_STORAGE_KEY = 'resume-os:drafts:v1'

export const emptyDraftState: ResumeDraftState = {
  activeDraftId: null,
  drafts: []
}

export function readDraftState(storage: Storage | undefined): ResumeDraftState {
  if (!storage) return emptyDraftState

  const raw = storage.getItem(RESUME_DRAFT_STORAGE_KEY)
  if (!raw) return emptyDraftState

  try {
    const parsed = JSON.parse(raw) as ResumeDraftState
    return {
      activeDraftId: parsed.activeDraftId ?? null,
      drafts: Array.isArray(parsed.drafts)
        ? parsed.drafts.map((draft) => ({
            ...draft,
            data: normalizeResumeData(draft.data, {
              source: draft.source,
              locale: draft.data.metadata.locale,
              now: draft.updatedAt
            })
          }))
        : []
    }
  } catch {
    return emptyDraftState
  }
}

export function writeDraftState(storage: Storage | undefined, state: ResumeDraftState) {
  if (!storage) return
  storage.setItem(RESUME_DRAFT_STORAGE_KEY, JSON.stringify(state))
}

export function addDraft(state: ResumeDraftState, draft: ResumeDraft): ResumeDraftState {
  return {
    activeDraftId: draft.id,
    drafts: [draft, ...state.drafts.filter((item) => item.id !== draft.id)]
  }
}

export function upsertDraft(state: ResumeDraftState, draft: ResumeDraft): ResumeDraftState {
  const exists = state.drafts.some((item) => item.id === draft.id)
  if (!exists) return addDraft(state, draft)

  return {
    activeDraftId: draft.id,
    drafts: state.drafts.map((item) => (item.id === draft.id ? draft : item))
  }
}

export function createDraftFromResume(
  state: ResumeDraftState,
  data: Parameters<typeof createResumeDraft>[0],
  options: Parameters<typeof createResumeDraft>[1] = {}
) {
  return addDraft(state, createResumeDraft(data, options))
}

export function renameDraft(state: ResumeDraftState, id: string, name: string): ResumeDraftState {
  const trimmed = name.trim()
  if (!trimmed) return state

  return {
    ...state,
    drafts: state.drafts.map((draft) =>
      draft.id === id ? { ...draft, name: trimmed, updatedAt: new Date().toISOString() } : draft
    )
  }
}

export function setActiveDraft(state: ResumeDraftState, id: string | null): ResumeDraftState {
  if (id === null) return { ...state, activeDraftId: null }
  if (!state.drafts.some((draft) => draft.id === id)) return state
  return { ...state, activeDraftId: id }
}

export function deleteDraft(state: ResumeDraftState, id: string): ResumeDraftState {
  const drafts = state.drafts.filter((draft) => draft.id !== id)
  const activeDraftId = state.activeDraftId === id ? drafts[0]?.id ?? null : state.activeDraftId
  return { activeDraftId, drafts }
}

export function getActiveDraft(state: ResumeDraftState) {
  return state.drafts.find((draft) => draft.id === state.activeDraftId) ?? null
}
```

- [ ] **Step 4: Create the React provider**

Create `components/resume-draft-provider.tsx`:

```tsx
'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import type { ResumeData, ResumeDraft, ResumeDraftState } from '@/lib/resume-model'
import {
  addDraft,
  deleteDraft,
  emptyDraftState,
  getActiveDraft,
  readDraftState,
  renameDraft,
  setActiveDraft,
  upsertDraft,
  writeDraftState
} from '@/lib/resume-store'

type ResumeDraftContextValue = {
  sample: ResumeData
  activeResume: ResumeData
  activeDraft: ResumeDraft | null
  drafts: ResumeDraft[]
  hasHydrated: boolean
  addResumeDraft: (draft: ResumeDraft) => void
  updateResumeDraft: (draft: ResumeDraft) => void
  renameResumeDraft: (id: string, name: string) => void
  deleteResumeDraft: (id: string) => void
  setActiveResumeDraft: (id: string | null) => void
}

const ResumeDraftContext = createContext<ResumeDraftContextValue | null>(null)

export function ResumeDraftProvider({
  children,
  sample
}: {
  children: ReactNode
  sample: ResumeData
}) {
  const [state, setState] = useState<ResumeDraftState>(emptyDraftState)
  const [hasHydrated, setHasHydrated] = useState(false)

  useEffect(() => {
    setState(readDraftState(window.localStorage))
    setHasHydrated(true)
  }, [])

  useEffect(() => {
    if (hasHydrated) writeDraftState(window.localStorage, state)
  }, [hasHydrated, state])

  const activeDraft = getActiveDraft(state)
  const activeResume = activeDraft?.data ?? sample

  const commitState = useCallback((next: ResumeDraftState) => {
    setState(next)
  }, [])

  const value = useMemo<ResumeDraftContextValue>(() => ({
    sample,
    activeResume,
    activeDraft,
    drafts: state.drafts,
    hasHydrated,
    addResumeDraft: (draft) => commitState(addDraft(state, draft)),
    updateResumeDraft: (draft) => commitState(upsertDraft(state, draft)),
    renameResumeDraft: (id, name) => commitState(renameDraft(state, id, name)),
    deleteResumeDraft: (id) => commitState(deleteDraft(state, id)),
    setActiveResumeDraft: (id) => commitState(setActiveDraft(state, id))
  }), [activeDraft, activeResume, commitState, hasHydrated, sample, state])

  return <ResumeDraftContext.Provider value={value}>{children}</ResumeDraftContext.Provider>
}

export function useResumeDrafts() {
  const value = useContext(ResumeDraftContext)
  if (!value) {
    throw new Error('useResumeDrafts must be used within ResumeDraftProvider')
  }
  return value
}
```

- [ ] **Step 5: Create a shell helper for route pages**

Create `components/resume-shell.tsx`:

```tsx
import type { ReactNode } from 'react'
import { ResumeDraftProvider } from '@/components/resume-draft-provider'
import { getSampleResumeData } from '@/lib/resume-sample'
import type { Locale } from '@/i18n/routing'

export function ResumeShell({
  children,
  locale
}: {
  children: ReactNode
  locale: Locale
}) {
  return (
    <ResumeDraftProvider sample={getSampleResumeData(locale)}>
      {children}
    </ResumeDraftProvider>
  )
}
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
corepack pnpm@10.33.0 test lib/resume-store.test.ts
corepack pnpm@10.33.0 typecheck
```

Expected:

- PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/resume-store.ts lib/resume-store.test.ts components/resume-draft-provider.tsx components/resume-shell.tsx
git commit -m "feat: add local resume draft store"
```

---

### Task 4: AI Prompting And JSON Helpers

**Files:**
- Create: `lib/agent/resume-prompts.ts`
- Create: `lib/agent/json.ts`
- Create: `lib/agent/json.test.ts`
- Modify: `lib/agent/openai.ts`
- Modify: `lib/agent/prompt.ts`

- [ ] **Step 1: Write JSON helper tests**

Create `lib/agent/json.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseAIJson } from './json'

describe('parseAIJson', () => {
  it('parses raw JSON', () => {
    expect(parseAIJson('{"name":"Ada"}')).toEqual({ name: 'Ada' })
  })

  it('parses fenced JSON', () => {
    const text = '```json\n{"name":"Ada"}\n```'
    expect(parseAIJson(text)).toEqual({ name: 'Ada' })
  })

  it('throws a useful error on invalid JSON', () => {
    expect(() => parseAIJson('not json')).toThrow('AI response was not valid JSON')
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
corepack pnpm@10.33.0 test lib/agent/json.test.ts
```

Expected:

- FAIL because `lib/agent/json.ts` does not exist.

- [ ] **Step 3: Implement JSON helper**

Create `lib/agent/json.ts`:

```ts
export function parseAIJson(text: string): unknown {
  const trimmed = text.trim()
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    return JSON.parse(unfenced)
  } catch {
    throw new Error('AI response was not valid JSON')
  }
}
```

- [ ] **Step 4: Add resume prompts**

Create `lib/agent/resume-prompts.ts`:

```ts
import type { Locale } from '@/i18n/routing'
import type { ResumeData } from '@/lib/resume-model'

const schemaRules = [
  'Return only valid JSON. Do not wrap the JSON in Markdown.',
  'Use this shape: profile, targetRole, skills, experiences, projects, education, certifications, awards, languages, openSource, metadata.',
  'Every array field must be present. Use [] when unknown.',
  'Do not fabricate specific companies, schools, dates, or metrics when parsing a real resume.',
  'metadata.source must match the requested source.',
  'metadata.locale must match the requested locale.',
  'metadata.updatedAt must be an ISO timestamp.'
].join('\n')

export function buildResumeParsePrompt({
  text,
  locale,
  targetRole,
  now
}: {
  text: string
  locale: Locale
  targetRole?: string
  now: string
}) {
  const language = locale === 'zh' ? 'Chinese' : 'English'

  return [
    'You are Resume Studio, a strict resume parsing agent.',
    `Respond in ${language} for human-readable values when the source language allows it.`,
    schemaRules,
    `metadata.source: "upload"`,
    `metadata.locale: "${locale}"`,
    `metadata.updatedAt: "${now}"`,
    targetRole ? `targetRole: "${targetRole}"` : 'Infer targetRole only if clearly implied.',
    '',
    'Resume text:',
    text
  ].join('\n')
}

export function buildResumeGeneratePrompt({
  locale,
  targetRole,
  seniority,
  style,
  now
}: {
  locale: Locale
  targetRole: string
  seniority: string
  style?: string
  now: string
}) {
  const language = locale === 'zh' ? 'Chinese' : 'English'

  return [
    'You are Resume Studio, a resume data generation agent.',
    `Generate a realistic simulated resume in ${language}.`,
    schemaRules,
    `metadata.source: "ai-generated"`,
    `metadata.locale: "${locale}"`,
    `metadata.updatedAt: "${now}"`,
    `Target role: ${targetRole}`,
    `Seniority or background: ${seniority}`,
    `Style: ${style || 'productized, concise, technically credible'}`
  ].join('\n')
}

export function buildResumeChatPrompt({
  locale,
  currentResume,
  message,
  now
}: {
  locale: Locale
  currentResume: ResumeData
  message: string
  now: string
}) {
  const language = locale === 'zh' ? 'Chinese' : 'English'

  return [
    'You are Resume Studio, a resume editing agent.',
    `Respond in ${language}.`,
    'Update the current resume according to the user request.',
    'Return only JSON with this shape: {"resume": ResumeData, "explanation": string}.',
    schemaRules,
    `Set resume.metadata.source to "ai-chat".`,
    `Set resume.metadata.locale to "${locale}".`,
    `Set resume.metadata.updatedAt to "${now}".`,
    '',
    'Current resume JSON:',
    JSON.stringify(currentResume, null, 2),
    '',
    'User request:',
    message
  ].join('\n')
}

export function buildResumeQuestionPrompt({
  locale,
  resume,
  message
}: {
  locale: Locale
  resume: ResumeData
  message: string
}) {
  const language = locale === 'zh' ? 'Chinese' : 'English'

  return [
    'You are Resume OS, an AI Resume Agent.',
    'Answer only based on the provided structured resume data.',
    'Do not fabricate companies, metrics, titles, education, projects, dates, or outcomes.',
    'If the data does not contain the answer, say that it is not shown in the current resume data.',
    'Be concise, recruiter-friendly, and technically credible.',
    `Respond in ${language}.`,
    '',
    'Resume data:',
    JSON.stringify(resume, null, 2),
    '',
    `User question: ${message}`
  ].join('\n')
}
```

- [ ] **Step 5: Keep OpenAI helper provider-compatible**

Modify `lib/agent/openai.ts` so it exports both text generation and JSON resume callers through the same configured provider:

```ts
export async function generateAgentText(prompt: string) {
  const config = getRequiredOpenAIConfig()
  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL
  })

  const { text } = await generateText({
    model: openai(config.model),
    prompt,
    temperature: 0.2,
    maxRetries: 1
  })

  return {
    model: config.model,
    text
  }
}
```

Do not hard-code a provider-specific model. Keep reading `OPENAI_MODEL`.

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
corepack pnpm@10.33.0 test lib/agent/json.test.ts
corepack pnpm@10.33.0 typecheck
```

Expected:

- PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/agent/resume-prompts.ts lib/agent/json.ts lib/agent/json.test.ts lib/agent/openai.ts lib/agent/prompt.ts
git commit -m "feat: add resume ai prompt helpers"
```

---

### Task 5: Resume AI And File Extraction API Routes

**Files:**
- Create: `app/api/resume/extract-text/route.ts`
- Create: `app/api/resume/parse/route.ts`
- Create: `app/api/resume/generate/route.ts`
- Create: `app/api/resume/chat/route.ts`
- Modify: `app/api/chat/route.ts`

- [ ] **Step 1: Implement file text extraction API**

Create `app/api/resume/extract-text/route.ts`:

```ts
import mammoth from 'mammoth'
import pdf from 'pdf-parse'

export const runtime = 'nodejs'

const maxBytes = 5 * 1024 * 1024

export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get('file')

  if (!(file instanceof File)) {
    return Response.json({ error: 'file is required' }, { status: 400 })
  }

  if (file.size > maxBytes) {
    return Response.json({ error: 'file is too large' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const name = file.name.toLowerCase()
  const type = file.type

  try {
    let text = ''

    if (type === 'text/plain' || name.endsWith('.txt')) {
      text = buffer.toString('utf8')
    } else if (type === 'application/pdf' || name.endsWith('.pdf')) {
      const result = await pdf(buffer)
      text = result.text
    } else if (
      type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      name.endsWith('.docx')
    ) {
      const result = await mammoth.extractRawText({ buffer })
      text = result.value
    } else {
      return Response.json({ error: 'unsupported file type' }, { status: 400 })
    }

    const trimmed = text.trim()
    if (!trimmed) {
      return Response.json({ error: 'no text could be extracted' }, { status: 400 })
    }

    return Response.json({ text: trimmed })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to extract file text'
    return Response.json({ error: message }, { status: 400 })
  }
}
```

- [ ] **Step 2: Implement parse route**

Create `app/api/resume/parse/route.ts`:

```ts
import { isLocale } from '@/i18n/routing'
import { parseAIJson } from '@/lib/agent/json'
import { createAgentErrorResponse, generateAgentText } from '@/lib/agent/openai'
import { buildResumeParsePrompt } from '@/lib/agent/resume-prompts'
import { normalizeResumeData } from '@/lib/resume-model'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const locale = typeof body.locale === 'string' && isLocale(body.locale) ? body.locale : 'zh'
  const targetRole = typeof body.targetRole === 'string' ? body.targetRole.trim() : undefined

  if (!text) {
    return Response.json({ error: 'text is required' }, { status: 400 })
  }

  try {
    const now = new Date().toISOString()
    const { model, text: aiText } = await generateAgentText(
      buildResumeParsePrompt({ text, locale, targetRole, now })
    )
    const resume = normalizeResumeData(parseAIJson(aiText), { source: 'upload', locale, now })
    return Response.json({ resume, model })
  } catch (error) {
    return createAgentErrorResponse(error)
  }
}
```

- [ ] **Step 3: Implement generate route**

Create `app/api/resume/generate/route.ts`:

```ts
import { isLocale } from '@/i18n/routing'
import { parseAIJson } from '@/lib/agent/json'
import { createAgentErrorResponse, generateAgentText } from '@/lib/agent/openai'
import { buildResumeGeneratePrompt } from '@/lib/agent/resume-prompts'
import { normalizeResumeData } from '@/lib/resume-model'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const locale = typeof body.locale === 'string' && isLocale(body.locale) ? body.locale : 'zh'
  const targetRole = typeof body.targetRole === 'string' ? body.targetRole.trim() : ''
  const seniority = typeof body.seniority === 'string' ? body.seniority.trim() : ''
  const style = typeof body.style === 'string' ? body.style.trim() : undefined

  if (!targetRole || !seniority) {
    return Response.json({ error: 'targetRole and seniority are required' }, { status: 400 })
  }

  try {
    const now = new Date().toISOString()
    const { model, text } = await generateAgentText(
      buildResumeGeneratePrompt({ locale, targetRole, seniority, style, now })
    )
    const resume = normalizeResumeData(parseAIJson(text), { source: 'ai-generated', locale, now })
    return Response.json({ resume, model })
  } catch (error) {
    return createAgentErrorResponse(error)
  }
}
```

- [ ] **Step 4: Implement resume chat route**

Create `app/api/resume/chat/route.ts`:

```ts
import { isLocale } from '@/i18n/routing'
import { parseAIJson } from '@/lib/agent/json'
import { createAgentErrorResponse, generateAgentText } from '@/lib/agent/openai'
import { buildResumeChatPrompt } from '@/lib/agent/resume-prompts'
import { normalizeResumeData, resumeDataSchema } from '@/lib/resume-model'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const locale = typeof body.locale === 'string' && isLocale(body.locale) ? body.locale : 'zh'
  const message = typeof body.message === 'string' ? body.message.trim() : ''

  if (!message) {
    return Response.json({ error: 'message is required' }, { status: 400 })
  }

  const currentResume = resumeDataSchema.safeParse(body.resume)
  if (!currentResume.success) {
    return Response.json({ error: 'resume is required' }, { status: 400 })
  }

  try {
    const now = new Date().toISOString()
    const { model, text } = await generateAgentText(
      buildResumeChatPrompt({ locale, currentResume: currentResume.data, message, now })
    )
    const parsed = parseAIJson(text) as { resume?: unknown; explanation?: unknown }
    const resume = normalizeResumeData(parsed.resume, { source: 'ai-chat', locale, now })
    const explanation = typeof parsed.explanation === 'string' ? parsed.explanation : ''
    return Response.json({ resume, explanation, model })
  } catch (error) {
    return createAgentErrorResponse(error)
  }
}
```

- [ ] **Step 5: Extend existing chat route with optional resume context**

Modify `app/api/chat/route.ts` to parse optional `resume`:

```ts
import { isLocale } from '@/i18n/routing'
import { createAgentErrorResponse, generateAgentText } from '@/lib/agent/openai'
import { buildResumeQuestionPrompt } from '@/lib/agent/resume-prompts'
import { getSampleResumeData } from '@/lib/resume-sample'
import { normalizeResumeData, resumeDataSchema } from '@/lib/resume-model'

export async function POST(request: Request) {
  const { locale: requestedLocale, message, resume } = await request.json().catch(() => ({ message: '' }))

  if (!message || typeof message !== 'string') {
    return Response.json({ error: 'message is required' }, { status: 400 })
  }

  const locale = typeof requestedLocale === 'string' && isLocale(requestedLocale) ? requestedLocale : 'zh'
  const parsedResume = resumeDataSchema.safeParse(resume)
  const resumeContext = parsedResume.success
    ? normalizeResumeData(parsedResume.data, {
        source: parsedResume.data.metadata.source,
        locale,
        now: parsedResume.data.metadata.updatedAt
      })
    : getSampleResumeData(locale)

  try {
    const { model, text } = await generateAgentText(
      buildResumeQuestionPrompt({ locale, resume: resumeContext, message })
    )
    return Response.json({ answer: text, locale, model })
  } catch (error) {
    return createAgentErrorResponse(error)
  }
}
```

- [ ] **Step 6: Run API typecheck**

Run:

```bash
corepack pnpm@10.33.0 typecheck
```

Expected:

- PASS.

- [ ] **Step 7: Run AI smoke checks if credentials are configured**

Use the existing key and model config without printing secrets:

```bash
set -a; source .env; set +a
curl -sS --max-time 30 http://127.0.0.1:3001/api/resume/generate \
  -H 'Content-Type: application/json' \
  -d '{"locale":"zh","targetRole":"AI Agent Engineer","seniority":"5 years frontend and full-stack experience"}'
```

Expected:

- If the dev server is running and `OPENAI_MODEL` points to a supported model, JSON includes `resume` and `model`.
- If the model is unsupported, JSON includes an understandable `error`. Do not print or log the API key.

- [ ] **Step 8: Commit**

```bash
git add app/api/resume app/api/chat/route.ts
git commit -m "feat: add resume ai api routes"
```

---

### Task 6: Studio I18n Copy And Home Studio Components

**Files:**
- Modify: `messages/zh.json`
- Modify: `messages/en.json`
- Create: `components/resume-studio/resume-studio.tsx`
- Create: `components/resume-studio/source-panel.tsx`
- Create: `components/resume-studio/draft-list.tsx`
- Create: `components/resume-studio/resume-preview.tsx`
- Create: `components/resume-studio/route-gallery.tsx`
- Modify: `app/[locale]/page.tsx`

- [ ] **Step 1: Add i18n keys**

Add a `studio` namespace to `messages/zh.json`:

```json
{
  "studio": {
    "title": "Resume Studio",
    "subtitle": "上传、解析、生成并管理你的结构化简历数据。",
    "activeDraft": "当前简历",
    "sampleFallback": "正在使用内置示例简历",
    "uploadTitle": "上传简历",
    "uploadHint": "支持 PDF、DOCX、TXT，文件只用于抽取文本，不会长期保存。",
    "pasteTitle": "粘贴文本",
    "pastePlaceholder": "粘贴简历原文...",
    "parseButton": "解析为简历数据",
    "generateTitle": "AI 一键生成",
    "targetRole": "目标岗位",
    "seniority": "资历方向",
    "style": "风格",
    "generateButton": "生成模拟简历",
    "chatTitle": "和 AI 补全简历",
    "chatPlaceholder": "例如：补充一个 Agentic RAG 项目经历...",
    "chatButton": "更新当前简历",
    "drafts": "本地草稿",
    "rename": "重命名",
    "delete": "删除",
    "setActive": "设为当前",
    "preview": "结构化预览",
    "routes": "展示方式",
    "loading": "处理中...",
    "error": "请求失败",
    "emptyDrafts": "还没有本地草稿。"
  }
}
```

Add matching English strings to `messages/en.json`:

```json
{
  "studio": {
    "title": "Resume Studio",
    "subtitle": "Upload, parse, generate, and manage structured resume data.",
    "activeDraft": "Active Resume",
    "sampleFallback": "Using the built-in sample resume",
    "uploadTitle": "Upload Resume",
    "uploadHint": "Supports PDF, DOCX, and TXT. Files are only used for text extraction.",
    "pasteTitle": "Paste Text",
    "pastePlaceholder": "Paste raw resume text...",
    "parseButton": "Parse Resume Data",
    "generateTitle": "AI Generate",
    "targetRole": "Target Role",
    "seniority": "Seniority",
    "style": "Style",
    "generateButton": "Generate Simulated Resume",
    "chatTitle": "Complete With AI",
    "chatPlaceholder": "Example: add an Agentic RAG project experience...",
    "chatButton": "Update Active Resume",
    "drafts": "Local Drafts",
    "rename": "Rename",
    "delete": "Delete",
    "setActive": "Set Active",
    "preview": "Structured Preview",
    "routes": "Display Routes",
    "loading": "Processing...",
    "error": "Request failed",
    "emptyDrafts": "No local drafts yet."
  }
}
```

Also add nav labels for `studio`, `threeD`, and `book` in both files.

- [ ] **Step 2: Create route gallery**

Create `components/resume-studio/route-gallery.tsx`:

```tsx
'use client'

import { Bot, BookOpen, Boxes, FileText, GitBranch } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

const routes = [
  { href: '/agent', key: 'agent', icon: Bot },
  { href: '/3d', key: 'threeD', icon: Boxes },
  { href: '/book', key: 'book', icon: BookOpen },
  { href: '/classic', key: 'classic', icon: FileText },
  { href: '/timeline', key: 'timeline', icon: GitBranch }
] as const

export function RouteGallery() {
  const nav = useTranslations('nav')
  const studio = useTranslations('studio')

  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold text-fog">{studio('routes')}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {routes.map(({ href, key, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group resume-card relative overflow-hidden rounded-2xl p-4 transition hover:-translate-y-1 hover:border-accent/45"
          >
            <div className="absolute inset-x-4 top-3 h-px bg-accent/30 opacity-0 transition group-hover:opacity-100" />
            <Icon className="text-accent-soft transition group-hover:scale-110" size={22} />
            <p className="mt-4 font-semibold text-fog">{nav(key)}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Create draft list**

Create `components/resume-studio/draft-list.tsx`:

```tsx
'use client'

import { Pencil, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useResumeDrafts } from '@/components/resume-draft-provider'

export function DraftList() {
  const t = useTranslations('studio')
  const { activeDraft, drafts, deleteResumeDraft, renameResumeDraft, setActiveResumeDraft } = useResumeDrafts()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')

  if (!drafts.length) {
    return <p className="rounded-2xl border border-line p-4 text-sm text-muted">{t('emptyDrafts')}</p>
  }

  return (
    <div className="space-y-3">
      {drafts.map((draft) => {
        const isActive = activeDraft?.id === draft.id
        return (
          <article key={draft.id} className="rounded-2xl border border-line bg-panel/35 p-4">
            {editingId === draft.id ? (
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  renameResumeDraft(draft.id, name)
                  setEditingId(null)
                }}
              >
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-line bg-panel-strong px-3 py-2 text-sm text-fog outline-none focus:border-accent/55"
                />
                <button className="rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-ink" type="submit">
                  OK
                </button>
              </form>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setActiveResumeDraft(draft.id)}
                  className="min-w-0 text-left"
                >
                  <p className={isActive ? 'font-semibold text-accent-soft' : 'font-semibold text-fog'}>{draft.name}</p>
                  <p className="mt-1 text-xs text-muted">{draft.source} · {new Date(draft.updatedAt).toLocaleString()}</p>
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    aria-label={t('rename')}
                    onClick={() => {
                      setEditingId(draft.id)
                      setName(draft.name)
                    }}
                    className="rounded-xl border border-line p-2 text-muted hover:text-accent-soft"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label={t('delete')}
                    onClick={() => deleteResumeDraft(draft.id)}
                    className="rounded-xl border border-line p-2 text-muted hover:text-red-300"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Create resume preview**

Create `components/resume-studio/resume-preview.tsx`:

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { useResumeDrafts } from '@/components/resume-draft-provider'

export function ResumePreview() {
  const t = useTranslations('studio')
  const { activeDraft, activeResume } = useResumeDrafts()

  return (
    <section className="resume-card rounded-3xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-fog">{t('preview')}</h2>
          <p className="mt-1 text-sm text-muted">
            {activeDraft ? activeDraft.name : t('sampleFallback')}
          </p>
        </div>
        <span className="rounded-full border border-accent/20 px-3 py-1 text-xs text-accent-soft">
          {activeResume.metadata.source}
        </span>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <div>
          <p className="text-sm text-muted">Profile</p>
          <p className="mt-2 font-semibold text-fog">{activeResume.profile.name}</p>
          <p className="mt-1 text-sm text-muted">{activeResume.profile.title}</p>
        </div>
        <div>
          <p className="text-sm text-muted">Skills</p>
          <p className="mt-2 font-semibold text-fog">{activeResume.skills.length}</p>
        </div>
        <div>
          <p className="text-sm text-muted">Projects</p>
          <p className="mt-2 font-semibold text-fog">{activeResume.projects.length}</p>
        </div>
      </div>
      <pre className="mt-5 max-h-80 overflow-auto rounded-2xl bg-ink/70 p-4 text-xs leading-5 text-accent-soft">
        {JSON.stringify(activeResume, null, 2)}
      </pre>
    </section>
  )
}
```

- [ ] **Step 5: Create source panel**

Create `components/resume-studio/source-panel.tsx` with upload, paste, generate, and chat actions. The component must call APIs and create/update drafts:

```tsx
'use client'

import { Bot, FileUp, Sparkles, Wand2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { useResumeDrafts } from '@/components/resume-draft-provider'
import type { Locale } from '@/i18n/routing'
import { createResumeDraft, type ResumeData, type ResumeSource } from '@/lib/resume-model'

type Status = { state: 'idle' | 'loading' | 'error' | 'success'; message: string }

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Request failed')
  }
  return data as T
}

export function SourcePanel() {
  const t = useTranslations('studio')
  const locale = useLocale() as Locale
  const { activeDraft, activeResume, addResumeDraft, updateResumeDraft } = useResumeDrafts()
  const [rawText, setRawText] = useState('')
  const [targetRole, setTargetRole] = useState('AI Agent Engineer')
  const [seniority, setSeniority] = useState('5 years frontend and full-stack experience')
  const [style, setStyle] = useState('')
  const [chatMessage, setChatMessage] = useState('')
  const [status, setStatus] = useState<Status>({ state: 'idle', message: '' })

  function saveResume(resume: ResumeData, source: ResumeSource) {
    const draft = createResumeDraft(resume, { source })
    addResumeDraft(draft)
  }

  async function parseText(text: string, source: ResumeSource) {
    setStatus({ state: 'loading', message: t('loading') })
    const data = await requestJson<{ resume: ResumeData }>('/api/resume/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale, text, targetRole })
    })
    saveResume(data.resume, source)
    setStatus({ state: 'success', message: 'OK' })
  }

  async function handleFile(file: File | null) {
    if (!file) return
    setStatus({ state: 'loading', message: t('loading') })
    const formData = new FormData()
    formData.append('file', file)
    const extracted = await requestJson<{ text: string }>('/api/resume/extract-text', {
      method: 'POST',
      body: formData
    })
    await parseText(extracted.text, 'upload')
  }

  async function handleGenerate() {
    setStatus({ state: 'loading', message: t('loading') })
    const data = await requestJson<{ resume: ResumeData }>('/api/resume/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale, targetRole, seniority, style })
    })
    saveResume(data.resume, 'ai-generated')
    setStatus({ state: 'success', message: 'OK' })
  }

  async function handleChat() {
    setStatus({ state: 'loading', message: t('loading') })
    const data = await requestJson<{ resume: ResumeData; explanation: string }>('/api/resume/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale, resume: activeResume, message: chatMessage })
    })
    const draft = createResumeDraft(data.resume, {
      id: activeDraft?.id,
      name: activeDraft?.name,
      source: 'ai-chat'
    })
    updateResumeDraft(draft)
    setStatus({ state: 'success', message: data.explanation || 'OK' })
  }

  return (
    <section className="resume-card rounded-3xl p-6">
      <h2 className="text-xl font-semibold text-fog">{t('title')}</h2>
      <p className="mt-2 text-sm leading-6 text-muted">{t('subtitle')}</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <label className="rounded-2xl border border-dashed border-line p-4 text-sm text-muted">
          <FileUp className="mb-3 text-accent-soft" size={22} />
          <span className="block font-semibold text-fog">{t('uploadTitle')}</span>
          <span className="mt-1 block">{t('uploadHint')}</span>
          <input
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="mt-4 block w-full text-sm"
            onChange={(event) => {
              handleFile(event.target.files?.[0] ?? null).catch((error) =>
                setStatus({ state: 'error', message: error instanceof Error ? error.message : t('error') })
              )
            }}
          />
        </label>

        <div className="rounded-2xl border border-line p-4">
          <div className="flex items-center gap-2 text-fog">
            <Wand2 size={19} className="text-accent-soft" />
            <h3 className="font-semibold">{t('pasteTitle')}</h3>
          </div>
          <textarea
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            placeholder={t('pastePlaceholder')}
            className="mt-3 min-h-32 w-full resize-y rounded-2xl border border-line bg-panel-strong px-3 py-2 text-sm text-fog outline-none focus:border-accent/55"
          />
          <button
            type="button"
            className="mt-3 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-ink"
            onClick={() => parseText(rawText, 'paste').catch((error) =>
              setStatus({ state: 'error', message: error instanceof Error ? error.message : t('error') })
            )}
          >
            {t('parseButton')}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line p-4">
          <div className="flex items-center gap-2 text-fog">
            <Sparkles size={19} className="text-gold" />
            <h3 className="font-semibold">{t('generateTitle')}</h3>
          </div>
          <input value={targetRole} onChange={(event) => setTargetRole(event.target.value)} className="mt-3 w-full rounded-xl border border-line bg-panel-strong px-3 py-2 text-sm text-fog" placeholder={t('targetRole')} />
          <input value={seniority} onChange={(event) => setSeniority(event.target.value)} className="mt-3 w-full rounded-xl border border-line bg-panel-strong px-3 py-2 text-sm text-fog" placeholder={t('seniority')} />
          <input value={style} onChange={(event) => setStyle(event.target.value)} className="mt-3 w-full rounded-xl border border-line bg-panel-strong px-3 py-2 text-sm text-fog" placeholder={t('style')} />
          <button type="button" onClick={() => handleGenerate().catch((error) => setStatus({ state: 'error', message: error instanceof Error ? error.message : t('error') }))} className="mt-3 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-ink">
            {t('generateButton')}
          </button>
        </div>

        <div className="rounded-2xl border border-line p-4">
          <div className="flex items-center gap-2 text-fog">
            <Bot size={19} className="text-accent-soft" />
            <h3 className="font-semibold">{t('chatTitle')}</h3>
          </div>
          <textarea value={chatMessage} onChange={(event) => setChatMessage(event.target.value)} placeholder={t('chatPlaceholder')} className="mt-3 min-h-32 w-full resize-y rounded-2xl border border-line bg-panel-strong px-3 py-2 text-sm text-fog" />
          <button type="button" onClick={() => handleChat().catch((error) => setStatus({ state: 'error', message: error instanceof Error ? error.message : t('error') }))} className="mt-3 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-ink">
            {t('chatButton')}
          </button>
        </div>
      </div>

      {status.message ? (
        <p className={status.state === 'error' ? 'mt-4 text-sm text-red-300' : 'mt-4 text-sm text-accent-soft'}>
          {status.message}
        </p>
      ) : null}
    </section>
  )
}
```

- [ ] **Step 6: Create Studio orchestrator**

Create `components/resume-studio/resume-studio.tsx`:

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { DraftList } from './draft-list'
import { ResumePreview } from './resume-preview'
import { RouteGallery } from './route-gallery'
import { SourcePanel } from './source-panel'

export function ResumeStudio() {
  const t = useTranslations('studio')

  return (
    <div>
      <section className="grid items-start gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <div>
          <h1 className="max-w-4xl text-5xl font-semibold tracking-tight text-fog md:text-7xl">
            {t('title')}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted">{t('subtitle')}</p>
          <div className="mt-8 resume-card rounded-3xl p-6">
            <h2 className="text-xl font-semibold text-fog">{t('drafts')}</h2>
            <div className="mt-4">
              <DraftList />
            </div>
          </div>
        </div>
        <SourcePanel />
      </section>
      <div className="mt-8">
        <ResumePreview />
      </div>
      <RouteGallery />
    </div>
  )
}
```

- [ ] **Step 7: Modify home page**

Modify `app/[locale]/page.tsx` to keep the header controls, then render:

```tsx
<ResumeShell locale={locale}>
  <ResumeStudio />
</ResumeShell>
```

Remove the old hero sections from the home page or move them into secondary content below the Studio only if they do not distract from the first-screen production workflow.

- [ ] **Step 8: Run checks**

Run:

```bash
corepack pnpm@10.33.0 lint
corepack pnpm@10.33.0 typecheck
```

Expected:

- PASS.

- [ ] **Step 9: Commit**

```bash
git add messages/zh.json messages/en.json components/resume-studio app/[locale]/page.tsx
git commit -m "feat: build resume studio home"
```

---

### Task 7: Agent Route Reads Active Draft

**Files:**
- Create: `components/agent/resume-agent-client.tsx`
- Modify: `app/[locale]/agent/page.tsx`

- [ ] **Step 1: Create Agent client**

Create `components/agent/resume-agent-client.tsx`:

```tsx
'use client'

import { Bot, Send } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { useResumeDrafts } from '@/components/resume-draft-provider'
import type { Locale } from '@/i18n/routing'

type Message = { role: 'user' | 'assistant'; content: string }

export function ResumeAgentClient() {
  const locale = useLocale() as Locale
  const t = useTranslations('agent')
  const prompts = t.raw('prompts') as string[]
  const { activeDraft, activeResume } = useResumeDrafts()
  const [input, setInput] = useState(prompts[0] ?? '')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function sendMessage(message = input) {
    const trimmed = message.trim()
    if (!trimmed) return

    setLoading(true)
    setError('')
    setMessages((current) => [...current, { role: 'user', content: trimmed }])

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale, message: trimmed, resume: activeResume })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Request failed')
      setMessages((current) => [...current, { role: 'assistant', content: data.answer || '' }])
      setInput('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="grid min-h-[70vh] gap-6 lg:grid-cols-[0.36fr_0.64fr]">
      <aside className="resume-card rounded-3xl p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-accent/12 p-3 text-accent-soft">
            <Bot size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-fog">{t('title')}</h1>
            <p className="text-sm text-muted">{activeDraft?.name ?? activeResume.profile.name}</p>
          </div>
        </div>
        <p className="mt-5 text-sm leading-6 text-muted">{activeResume.profile.summary.join(' ')}</p>
        <div className="mt-6 space-y-2">
          {prompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => {
                setInput(prompt)
                sendMessage(prompt).catch(() => undefined)
              }}
              className="w-full rounded-2xl border border-line bg-panel/30 p-3 text-left text-sm text-muted transition hover:border-accent/45 hover:text-accent-soft"
            >
              {prompt}
            </button>
          ))}
        </div>
      </aside>

      <div className="resume-card flex rounded-3xl p-6">
        <div className="flex min-h-0 w-full flex-col">
          <div className="flex-1 space-y-4 overflow-auto pr-1">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={message.role === 'user' ? 'ml-auto max-w-[82%] rounded-2xl bg-accent px-4 py-3 text-sm text-ink' : 'max-w-[82%] rounded-2xl bg-panel-strong px-4 py-3 text-sm leading-6 text-fog'}
              >
                {message.content}
              </div>
            ))}
            {error ? <p className="rounded-2xl border border-red-400/20 p-4 text-sm text-red-300">{error}</p> : null}
          </div>
          <form
            className="mt-5 flex gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              sendMessage().catch(() => undefined)
            }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              className="min-w-0 flex-1 rounded-2xl border border-line bg-panel-strong px-4 py-3 text-sm text-fog outline-none focus:border-accent/55"
            />
            <button type="submit" disabled={loading} className="rounded-2xl bg-accent px-4 py-3 text-ink disabled:cursor-wait disabled:opacity-70">
              <Send size={18} />
            </button>
          </form>
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Modify Agent page**

Modify `app/[locale]/agent/page.tsx`:

```tsx
import { setRequestLocale } from 'next-intl/server'
import { ResumeAgentClient } from '@/components/agent/resume-agent-client'
import { ResumeShell } from '@/components/resume-shell'
import { Link } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'

export default async function AgentPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-10">
      <Link href="/" className="mb-8 inline-block text-sm text-muted hover:text-accent-soft">← Resume Studio</Link>
      <ResumeShell locale={locale}>
        <ResumeAgentClient />
      </ResumeShell>
    </main>
  )
}
```

- [ ] **Step 3: Run checks**

Run:

```bash
corepack pnpm@10.33.0 lint
corepack pnpm@10.33.0 typecheck
```

Expected:

- PASS.

- [ ] **Step 4: Commit**

```bash
git add components/agent/resume-agent-client.tsx app/[locale]/agent/page.tsx
git commit -m "feat: connect agent page to active resume"
```

---

### Task 8: Three.js 3D Route

**Files:**
- Create: `components/resume-3d/resume-orbit.tsx`
- Create: `components/resume-3d/resume-orbit-page.tsx`
- Create: `app/[locale]/3d/page.tsx`
- Modify: `messages/zh.json`
- Modify: `messages/en.json`

- [ ] **Step 1: Add 3D i18n keys**

Add `threeD` namespace:

```json
{
  "threeD": {
    "back": "返回 Resume Studio",
    "title": "3D Resume Orbit",
    "description": "用 Three.js 查看技能、项目和经历的关系。",
    "profile": "候选人",
    "skills": "技能",
    "projects": "项目",
    "experience": "经历"
  }
}
```

English:

```json
{
  "threeD": {
    "back": "Back to Resume Studio",
    "title": "3D Resume Orbit",
    "description": "Explore skills, projects, and experience through a Three.js graph.",
    "profile": "Profile",
    "skills": "Skills",
    "projects": "Projects",
    "experience": "Experience"
  }
}
```

- [ ] **Step 2: Create Three.js scene**

Create `components/resume-3d/resume-orbit.tsx`:

```tsx
'use client'

import { OrbitControls, Text } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import type { Group } from 'three'
import type { ResumeData } from '@/lib/resume-model'

type NodeKind = 'profile' | 'skill' | 'project' | 'experience'

type OrbitNode = {
  id: string
  label: string
  kind: NodeKind
  position: [number, number, number]
  detail: string
}

function buildNodes(resume: ResumeData): OrbitNode[] {
  const nodes: OrbitNode[] = [
    {
      id: 'profile',
      label: resume.profile.name || 'Profile',
      kind: 'profile',
      position: [0, 0, 0],
      detail: resume.profile.title
    }
  ]

  resume.skills.flatMap((group) => group.items.slice(0, 3).map((item) => `${group.group}: ${item}`)).slice(0, 10).forEach((label, index, items) => {
    const angle = (Math.PI * 2 * index) / Math.max(items.length, 1)
    nodes.push({
      id: `skill-${index}`,
      label,
      kind: 'skill',
      position: [Math.cos(angle) * 3, Math.sin(angle) * 0.7, Math.sin(angle) * 3],
      detail: label
    })
  })

  resume.projects.slice(0, 6).forEach((project, index, items) => {
    const angle = (Math.PI * 2 * index) / Math.max(items.length, 1)
    nodes.push({
      id: `project-${project.id || index}`,
      label: project.name,
      kind: 'project',
      position: [Math.cos(angle) * 5, 1.2, Math.sin(angle) * 5],
      detail: project.summary
    })
  })

  resume.experiences.slice(0, 5).forEach((experience, index, items) => {
    const angle = (Math.PI * 2 * index) / Math.max(items.length, 1)
    nodes.push({
      id: `experience-${index}`,
      label: experience.company,
      kind: 'experience',
      position: [Math.cos(angle) * 6.6, -1.4, Math.sin(angle) * 6.6],
      detail: `${experience.role} · ${experience.period}`
    })
  })

  return nodes
}

function colorFor(kind: NodeKind) {
  if (kind === 'profile') return '#1dd6bd'
  if (kind === 'project') return '#e7c56d'
  if (kind === 'experience') return '#f87171'
  return '#b7f7ea'
}

function OrbitGraph({
  nodes,
  onSelect
}: {
  nodes: OrbitNode[]
  onSelect: (node: OrbitNode) => void
}) {
  const groupRef = useRef<Group>(null)

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.08
  })

  return (
    <group ref={groupRef}>
      {nodes.map((node) => (
        <group key={node.id} position={node.position}>
          <mesh onClick={() => onSelect(node)}>
            <sphereGeometry args={[node.kind === 'profile' ? 0.44 : 0.24, 32, 32]} />
            <meshStandardMaterial color={colorFor(node.kind)} emissive={colorFor(node.kind)} emissiveIntensity={0.2} />
          </mesh>
          <Text
            position={[0, 0.45, 0]}
            fontSize={node.kind === 'profile' ? 0.22 : 0.14}
            maxWidth={2}
            anchorX="center"
            anchorY="middle"
            color="#e7edf3"
          >
            {node.label}
          </Text>
        </group>
      ))}
    </group>
  )
}

export function ResumeOrbit({
  resume,
  onSelect
}: {
  resume: ResumeData
  onSelect: (node: { label: string; kind: NodeKind; detail: string }) => void
}) {
  const nodes = useMemo(() => buildNodes(resume), [resume])

  return (
    <Canvas camera={{ position: [0, 4, 10], fov: 52 }} dpr={[1, 1.7]}>
      <color attach="background" args={['#05070d']} />
      <ambientLight intensity={0.75} />
      <pointLight position={[5, 5, 5]} intensity={1.6} color="#1dd6bd" />
      <pointLight position={[-5, -4, -5]} intensity={1.1} color="#e7c56d" />
      <OrbitGraph nodes={nodes} onSelect={onSelect} />
      <OrbitControls enablePan={false} minDistance={5} maxDistance={15} />
    </Canvas>
  )
}
```

- [ ] **Step 3: Create page shell**

Create `components/resume-3d/resume-orbit-page.tsx`:

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useResumeDrafts } from '@/components/resume-draft-provider'
import { ResumeOrbit } from './resume-orbit'

type SelectedNode = { label: string; kind: string; detail: string }

export function ResumeOrbitPage() {
  const t = useTranslations('threeD')
  const { activeResume } = useResumeDrafts()
  const [selected, setSelected] = useState<SelectedNode>({
    label: activeResume.profile.name,
    kind: t('profile'),
    detail: activeResume.profile.title
  })

  return (
    <section className="grid min-h-[76vh] gap-5 lg:grid-cols-[1fr_320px]">
      <div className="resume-card overflow-hidden rounded-3xl">
        <div className="h-[62vh] min-h-[460px] lg:h-[76vh]">
          <ResumeOrbit resume={activeResume} onSelect={setSelected} />
        </div>
      </div>
      <aside className="resume-card rounded-3xl p-6">
        <p className="text-sm text-accent-soft">{selected.kind}</p>
        <h1 className="mt-2 text-2xl font-semibold text-fog">{selected.label}</h1>
        <p className="mt-4 text-sm leading-6 text-muted">{selected.detail}</p>
      </aside>
    </section>
  )
}
```

- [ ] **Step 4: Create route page**

Create `app/[locale]/3d/page.tsx`:

```tsx
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ResumeOrbitPage } from '@/components/resume-3d/resume-orbit-page'
import { ResumeShell } from '@/components/resume-shell'
import { Link } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'

export default async function ThreeDPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'threeD' })

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-10">
      <Link href="/" className="mb-6 inline-block text-sm text-muted hover:text-accent-soft">← {t('back')}</Link>
      <div className="mb-6">
        <h1 className="text-4xl font-semibold text-fog">{t('title')}</h1>
        <p className="mt-2 text-muted">{t('description')}</p>
      </div>
      <ResumeShell locale={locale}>
        <ResumeOrbitPage />
      </ResumeShell>
    </main>
  )
}
```

- [ ] **Step 5: Verify canvas**

Run:

```bash
corepack pnpm@10.33.0 lint
corepack pnpm@10.33.0 typecheck
corepack pnpm@10.33.0 build
```

Then inspect `http://localhost:3001/zh/3d` in the browser:

- Canvas is nonblank.
- Nodes are visible.
- Drag rotates the scene.
- Scroll zooms the scene within limits.
- Clicking a node updates the detail panel.
- Mobile viewport keeps canvas and detail readable.

- [ ] **Step 6: Commit**

```bash
git add components/resume-3d app/[locale]/3d/page.tsx messages/zh.json messages/en.json
git commit -m "feat: add three dimensional resume route"
```

---

### Task 9: Book Route

**Files:**
- Create: `components/book/resume-book.tsx`
- Create: `app/[locale]/book/page.tsx`
- Modify: `messages/zh.json`
- Modify: `messages/en.json`
- Modify: `app/globals.css`

- [ ] **Step 1: Add Book copy**

Add `book` namespace:

```json
{
  "book": {
    "back": "返回 Resume Studio",
    "title": "Resume Book",
    "description": "像翻书一样浏览结构化简历章节。",
    "previous": "上一页",
    "next": "下一页",
    "chapters": "章节"
  }
}
```

English:

```json
{
  "book": {
    "back": "Back to Resume Studio",
    "title": "Resume Book",
    "description": "Browse structured resume sections with a book-like page turn.",
    "previous": "Previous",
    "next": "Next",
    "chapters": "Chapters"
  }
}
```

- [ ] **Step 2: Add global book motion styles**

Append to `app/globals.css`:

```css
.resume-book-page {
  transform-style: preserve-3d;
  transition: transform 520ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 280ms ease;
}

.resume-book-page[data-active='false'] {
  opacity: 0;
  pointer-events: none;
  transform: rotateY(-16deg) translateX(-12px);
}

.resume-book-page[data-active='true'] {
  opacity: 1;
  transform: rotateY(0deg) translateX(0);
}

@media (prefers-reduced-motion: reduce) {
  .resume-book-page {
    transition: none;
  }
}
```

- [ ] **Step 3: Create Book component**

Create `components/book/resume-book.tsx`:

```tsx
'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'
import { useResumeDrafts } from '@/components/resume-draft-provider'

export function ResumeBook() {
  const t = useTranslations('book')
  const { activeResume } = useResumeDrafts()
  const [page, setPage] = useState(0)

  const pages = useMemo(() => [
    {
      title: 'Profile',
      body: [activeResume.profile.name, activeResume.profile.title, ...activeResume.profile.summary]
    },
    {
      title: 'Skills',
      body: activeResume.skills.map((group) => `${group.group}: ${group.items.join(', ')}`)
    },
    {
      title: 'Experience',
      body: activeResume.experiences.map((item) => `${item.company} · ${item.role} · ${item.period}`)
    },
    {
      title: 'Projects',
      body: activeResume.projects.map((project) => `${project.name}: ${project.summary}`)
    },
    {
      title: 'Education',
      body: activeResume.education.map((item) => `${item.school} ${item.degree ?? ''} ${item.major ?? ''}`.trim())
    },
    {
      title: 'Open Source',
      body: activeResume.openSource
    }
  ].filter((item) => item.body.length), [activeResume])

  const current = pages[page] ?? pages[0]

  return (
    <section className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <aside className="resume-card rounded-3xl p-5">
        <p className="text-sm text-accent-soft">{t('chapters')}</p>
        <div className="mt-4 space-y-2">
          {pages.map((item, index) => (
            <button
              key={item.title}
              type="button"
              onClick={() => setPage(index)}
              className={index === page ? 'w-full rounded-2xl bg-accent px-3 py-2 text-left text-sm font-semibold text-ink' : 'w-full rounded-2xl border border-line px-3 py-2 text-left text-sm text-muted hover:text-accent-soft'}
            >
              {item.title}
            </button>
          ))}
        </div>
      </aside>

      <div className="resume-card relative min-h-[620px] overflow-hidden rounded-3xl p-6 md:p-10">
        <div className="absolute inset-y-8 left-1/2 w-px bg-line/70" />
        {pages.map((item, index) => (
          <article
            key={item.title}
            data-active={index === page}
            className="resume-book-page absolute inset-6 rounded-2xl bg-panel p-8 shadow-2xl md:inset-10"
          >
            <p className="text-sm text-gold">Page {index + 1}</p>
            <h2 className="mt-3 text-4xl font-semibold text-fog">{item.title}</h2>
            <div className="mt-8 space-y-4 text-base leading-8 text-muted">
              {item.body.map((line) => <p key={line}>{line}</p>)}
            </div>
          </article>
        ))}
        <div className="absolute bottom-6 right-6 flex gap-2">
          <button type="button" onClick={() => setPage(Math.max(0, page - 1))} className="rounded-full border border-line p-3 text-fog">
            <ChevronLeft size={18} />
          </button>
          <button type="button" onClick={() => setPage(Math.min(pages.length - 1, page + 1))} className="rounded-full bg-accent p-3 text-ink">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Create Book page**

Create `app/[locale]/book/page.tsx`:

```tsx
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ResumeBook } from '@/components/book/resume-book'
import { ResumeShell } from '@/components/resume-shell'
import { Link } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'

export default async function BookPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'book' })

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-10">
      <Link href="/" className="mb-6 inline-block text-sm text-muted hover:text-accent-soft">← {t('back')}</Link>
      <div className="mb-6">
        <h1 className="text-4xl font-semibold text-fog">{t('title')}</h1>
        <p className="mt-2 text-muted">{t('description')}</p>
      </div>
      <ResumeShell locale={locale}>
        <ResumeBook />
      </ResumeShell>
    </main>
  )
}
```

- [ ] **Step 5: Run checks and browser QA**

Run:

```bash
corepack pnpm@10.33.0 lint
corepack pnpm@10.33.0 typecheck
```

Browser checks:

- `/zh/book` renders.
- Next and previous buttons flip sections.
- Chapter buttons work.
- Mobile viewport has no unreadable overlap.

- [ ] **Step 6: Commit**

```bash
git add components/book app/[locale]/book/page.tsx app/globals.css messages/zh.json messages/en.json
git commit -m "feat: add book resume route"
```

---

### Task 10: Classic, Timeline, Projects, Terminal Read Active Draft

**Files:**
- Create: `components/resume-display/classic-resume.tsx`
- Create: `components/resume-display/timeline-resume.tsx`
- Create: `components/resume-display/projects-resume.tsx`
- Create: `components/resume-display/terminal-resume.tsx`
- Modify: `app/[locale]/classic/page.tsx`
- Modify: `app/[locale]/timeline/page.tsx`
- Modify: `app/[locale]/projects/page.tsx`
- Modify: `app/[locale]/terminal/page.tsx`

- [ ] **Step 1: Create Classic client display**

Create `components/resume-display/classic-resume.tsx` by moving the existing classic page markup into a client component and replacing `getResumeData(locale)` with `useResumeDrafts().activeResume`.

Required component signature:

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { useResumeDrafts } from '@/components/resume-draft-provider'

export function ClassicResume() {
  const t = useTranslations('classic')
  const { activeResume } = useResumeDrafts()
  const separator = activeResume.metadata.locale === 'zh' ? '、' : ', '
  const colon = activeResume.metadata.locale === 'zh' ? '：' : ': '

  return (
    <section className="rounded-3xl bg-white p-8 text-slate-950 shadow-2xl md:p-12">
      <header className="border-b border-slate-200 pb-6">
        <h1 className="text-4xl font-bold">{activeResume.profile.name}</h1>
        <p className="mt-2 text-lg text-slate-700">{activeResume.profile.title}</p>
        <p className="mt-3 text-sm text-slate-500">
          {[activeResume.profile.location, activeResume.profile.email, activeResume.profile.phone].filter(Boolean).join(' · ')}
        </p>
      </header>
      <section className="mt-8">
        <h2 className="text-xl font-bold">{t('summary')}</h2>
        <div className="mt-3 space-y-2 text-sm leading-7 text-slate-700">
          {activeResume.profile.summary.map((item) => <p key={item}>{item}</p>)}
        </div>
      </section>
      <section className="mt-8">
        <h2 className="text-xl font-bold">{t('skills')}</h2>
        <div className="mt-3 space-y-3 text-sm text-slate-700">
          {activeResume.skills.map((group) => (
            <p key={group.group}><strong>{group.group}{colon}</strong>{group.items.join(separator)}</p>
          ))}
        </div>
      </section>
      <section className="mt-8">
        <h2 className="text-xl font-bold">{t('experience')}</h2>
        <div className="mt-4 space-y-6">
          {activeResume.experiences.map((item) => (
            <article key={`${item.company}-${item.period}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-bold">{item.company} - {item.role}</h3>
                <p className="text-sm text-slate-500">{item.period}</p>
              </div>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-7 text-slate-700">
                {item.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </section>
      <section className="mt-8">
        <h2 className="text-xl font-bold">{t('projects')}</h2>
        <div className="mt-4 space-y-6">
          {activeResume.projects.map((project) => (
            <article key={project.id || project.name}>
              <h3 className="font-bold">{project.name}</h3>
              <p className="mt-1 text-sm text-slate-500">{t('keywords')}{colon}{project.tags.join(separator)}</p>
              <p className="mt-2 text-sm leading-7 text-slate-700">{project.summary}</p>
            </article>
          ))}
        </div>
      </section>
    </section>
  )
}
```

- [ ] **Step 2: Modify Classic page**

Use:

```tsx
<ResumeShell locale={locale}>
  <ClassicResume />
</ResumeShell>
```

inside `app/[locale]/classic/page.tsx`.

- [ ] **Step 3: Create Timeline client display**

Create `components/resume-display/timeline-resume.tsx`:

```tsx
'use client'

import { useResumeDrafts } from '@/components/resume-draft-provider'

export function TimelineResume() {
  const { activeResume } = useResumeDrafts()

  return (
    <div className="mt-10 space-y-6">
      {activeResume.experiences.map((item) => (
        <article key={`${item.company}-${item.period}`} className="resume-card rounded-3xl p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold text-fog">{item.company}</h2>
              <p className="mt-1 text-muted">{item.role}</p>
            </div>
            <p className="rounded-full bg-gold/10 px-4 py-2 text-sm text-gold">{item.period}</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {item.tags.map((tag) => <span key={tag} className="rounded-full bg-panel-strong px-3 py-1 text-xs text-muted">{tag}</span>)}
          </div>
          <ul className="mt-5 space-y-3 text-sm leading-6 text-muted">
            {item.bullets.map((bullet) => <li key={bullet} className="border-l border-line pl-4">{bullet}</li>)}
          </ul>
        </article>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Modify Timeline page**

Use:

```tsx
<ResumeShell locale={locale}>
  <TimelineResume />
</ResumeShell>
```

- [ ] **Step 5: Convert Projects and Terminal**

Create `components/resume-display/projects-resume.tsx` and `components/resume-display/terminal-resume.tsx` using the same pattern:

```tsx
'use client'

import { useResumeDrafts } from '@/components/resume-draft-provider'

export function ProjectsResume() {
  const { activeResume } = useResumeDrafts()
  return (
    <div className="mt-10 grid gap-5 md:grid-cols-3">
      {activeResume.projects.map((project) => (
        <article key={project.id || project.name} className="resume-card rounded-3xl p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-accent-soft">{project.type}</p>
          <h2 className="mt-4 text-xl font-semibold text-fog">{project.name}</h2>
          <p className="mt-3 text-sm leading-6 text-muted">{project.summary}</p>
        </article>
      ))}
    </div>
  )
}
```

Terminal can render `activeResume.profile`, `activeResume.skills`, and `activeResume.projects` in the current terminal style.

- [ ] **Step 6: Run checks**

Run:

```bash
corepack pnpm@10.33.0 lint
corepack pnpm@10.33.0 typecheck
```

Expected:

- PASS.

- [ ] **Step 7: Commit**

```bash
git add components/resume-display app/[locale]/classic/page.tsx app/[locale]/timeline/page.tsx app/[locale]/projects/page.tsx app/[locale]/terminal/page.tsx
git commit -m "feat: connect display routes to active resume"
```

---

### Task 11: Navigation, Theme Polish, And Motion Details

**Files:**
- Modify: `app/[locale]/page.tsx`
- Modify: `messages/zh.json`
- Modify: `messages/en.json`
- Modify: `app/globals.css`

- [ ] **Step 1: Add nav labels**

Ensure `messages/zh.json` `nav` includes:

```json
{
  "studio": "Studio",
  "threeD": "3D",
  "book": "书本"
}
```

Ensure `messages/en.json` `nav` includes:

```json
{
  "studio": "Studio",
  "threeD": "3D",
  "book": "Book"
}
```

- [ ] **Step 2: Update homepage nav list**

In `app/[locale]/page.tsx`, include:

```ts
const navItems = [
  ['studio', '/'],
  ['agent', '/agent'],
  ['threeD', '/3d'],
  ['book', '/book'],
  ['classic', '/classic'],
  ['timeline', '/timeline']
] as const
```

- [ ] **Step 3: Add reusable motion utilities**

Append to `app/globals.css`:

```css
@keyframes resume-scan {
  0% { transform: translateY(-100%); opacity: 0; }
  30% { opacity: 1; }
  100% { transform: translateY(260%); opacity: 0; }
}

.resume-scan-line {
  animation: resume-scan 2.2s ease-in-out infinite;
}

@keyframes resume-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

.resume-float {
  animation: resume-float 4.5s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .resume-scan-line,
  .resume-float {
    animation: none;
  }
}
```

- [ ] **Step 4: Apply motion only where it helps**

Use `.resume-scan-line` in upload/processing areas and `.resume-float` only on decorative route cards or small status indicators. Do not animate large text blocks or form fields.

- [ ] **Step 5: Run checks**

Run:

```bash
corepack pnpm@10.33.0 lint
corepack pnpm@10.33.0 typecheck
```

Expected:

- PASS.

- [ ] **Step 6: Commit**

```bash
git add app/[locale]/page.tsx messages/zh.json messages/en.json app/globals.css
git commit -m "style: polish resume studio navigation and motion"
```

---

### Task 12: End-To-End Verification And Final Fixes

**Files:**
- Modify only files required by verification failures.

- [ ] **Step 1: Run full local checks**

Run:

```bash
corepack pnpm@10.33.0 test
corepack pnpm@10.33.0 lint
corepack pnpm@10.33.0 typecheck
corepack pnpm@10.33.0 build
```

Expected:

- All pass.

- [ ] **Step 2: Start dev server**

Run:

```bash
corepack pnpm@10.33.0 dev
```

Expected:

- Dev server listens on `http://localhost:3001` if the current `package.json` dev script is `next dev -p 3001`.

- [ ] **Step 3: Browser QA homepage**

Open:

```text
http://localhost:3001/zh
```

Verify:

- Page renders without console errors.
- Theme switch works.
- Language switch works.
- Upload panel accepts file selection.
- Paste text path creates a draft when AI provider succeeds.
- AI generation path creates a draft when provider succeeds.
- Draft list can rename, switch, and delete.
- Refresh preserves local drafts.

- [ ] **Step 4: Browser QA display routes**

Open:

```text
http://localhost:3001/zh/agent
http://localhost:3001/zh/3d
http://localhost:3001/zh/book
http://localhost:3001/zh/classic
http://localhost:3001/zh/timeline
```

Verify:

- All routes load.
- All routes read the active local draft.
- Routes fall back to sample data after clearing local storage.
- Agent can ask `/api/chat` with current resume context.
- 3D canvas is nonblank and interactive.
- Book page flips sections.

- [ ] **Step 5: Browser QA mobile**

Use a mobile viewport around `390x844` and verify:

- `/zh` has no horizontal overflow.
- `/zh/3d` keeps canvas and detail panel readable.
- `/zh/book` controls remain reachable.
- Buttons and text do not overlap.

- [ ] **Step 6: AI provider compatibility check**

Without printing secrets, confirm current model:

```bash
set -a; source .env; set +a
printf 'OPENAI_BASE_URL configured: %s\n' "$(test -n "$OPENAI_BASE_URL" && echo yes || echo no)"
printf 'OPENAI_MODEL=%s\n' "$OPENAI_MODEL"
```

If the model is `gpt-5-nano` against the Alibaba compatible endpoint, switch `.env` locally to a supported model such as:

```env
OPENAI_MODEL=qwen-plus
```

Do not commit `.env`.

- [ ] **Step 7: Commit final verification fixes**

If verification required code fixes:

```bash
git add <fixed-files>
git commit -m "fix: stabilize resume studio verification"
```

If no code fixes were required, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage:
  - Local multi-draft storage: Task 3 and Task 6.
  - PDF/DOCX/TXT/paste: Task 5 and Task 6.
  - AI parse/generate/chat: Task 4 and Task 5.
  - Generalized model: Task 2.
  - Agent route: Task 7.
  - Three.js route: Task 8.
  - Book route: Task 9.
  - Classic/Timeline active draft: Task 10.
  - i18n/theme/motion: Task 6, Task 9, Task 11.
  - Verification: Task 12.
- No cloud accounts, database, or auth are introduced.
- Original uploaded files are not persisted.
- OpenAI-compatible provider configuration remains environment-driven.
- All implementation tasks have explicit files, commands, and commit points.
