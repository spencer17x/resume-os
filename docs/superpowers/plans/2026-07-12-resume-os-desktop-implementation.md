# Resume OS Desktop Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved Resume OS multi-window desktop, iOS-style mobile shell, resume creation workflow, Agent change preview, and structured 3D/Book presentation applications.

**Architecture:** A client `DesktopShell` in the locale layout renders applications from a typed registry. A reducer and browser-local persistence own window state, while a separate resume provider owns drafts and version snapshots. Route descriptors open and focus singleton applications; mobile reuses the same registry and application components in a full-screen frame.

**Tech Stack:** Next.js App Router, React, TypeScript, next-intl, Tailwind CSS v4, react-rnd, Motion, Zod, Vercel AI SDK, Three.js, React Three Fiber, Vitest, Testing Library, Playwright.

---

## Current Repository State

- `lib/resume-model.ts`, its tests, and `lib/resume-sample.ts` are complete.
- Existing locale pages render standalone server-page UIs.
- Existing `/api/chat` and `/api/jd-match` call an OpenAI-compatible endpoint with server-only environment variables.
- Resume draft storage, Studio, 3D, Book, and the desktop shell are not implemented.
- `next-env.d.ts` contains an unrelated local modification. Do not stage or revert it.
- Use pnpm 10.33.0 through `corepack pnpm@10.33.0` for every package command.

## File Map

### Desktop Core

- `lib/desktop/types.ts`: window, geometry, application, and desktop state types.
- `lib/desktop/app-registry.ts`: application metadata and route lookup without component imports.
- `lib/desktop/reducer.ts`: pure desktop state transitions and geometry correction.
- `lib/desktop/persistence.ts`: versioned localStorage serialization and validation.
- `components/desktop/desktop-provider.tsx`: reducer context, persistence, and route synchronization.
- `components/desktop/desktop-route.tsx`: thin route descriptor that opens/focuses an application.
- `components/desktop/desktop-shell.tsx`: desktop/mobile responsive switch and application loader.
- `components/desktop/menu-bar.tsx`: active application menu and global controls.
- `components/desktop/desktop-surface.tsx`: wallpaper and desktop icons.
- `components/desktop/window-manager.tsx`: open window rendering and z-order.
- `components/desktop/app-window.tsx`: react-rnd window frame and traffic-light controls.
- `components/desktop/dock.tsx`: pinned/running application launcher.
- `components/desktop/mobile-home.tsx`: iOS-style app grid and mobile Dock.
- `components/desktop/mobile-app-frame.tsx`: mobile full-screen application navigation.
- `components/desktop/app-loader.tsx`: dynamic mapping from application ID to content component.
- `components/desktop/app-error-boundary.tsx`: per-application recovery boundary.
- `components/apps/placeholder-app.tsx`: temporary typed content used until each real application is migrated.

### Resume Data And Agent

- `lib/resume-store.ts`: browser-local draft and version-snapshot operations.
- `components/resume-draft-provider.tsx`: active draft context with sample fallback.
- `lib/agent/resume-change-set.ts`: structured Agent proposal schema and application logic.
- `lib/agent/resume-prompts.ts`: parse, generate, optimize, and JD prompts using active resume data.
- `lib/agent/json.ts`: strict model JSON extraction and validation.
- `app/api/resume/extract-text/route.ts`: PDF, DOCX, and TXT extraction.
- `app/api/resume/parse/route.ts`: resume text to normalized data.
- `app/api/resume/generate/route.ts`: simulated resume generation.
- `app/api/resume/optimize/route.ts`: structured Agent change-set generation.

### Applications

- `components/apps/resume-studio-app.tsx`: upload, paste, AI generation, drafts, and preview.
- `components/apps/resume-agent-app.tsx`: chat, diagnosis, optimization, and change preview.
- `components/apps/jd-match-app.tsx`: JD input and rendered report.
- `components/apps/classic-resume-app.tsx`: printable structured resume.
- `components/apps/projects-app.tsx`: project list/detail internal navigation.
- `components/apps/timeline-app.tsx`: animated career timeline.
- `components/apps/terminal-app.tsx`: terminal-style structured view.
- `components/apps/settings-app.tsx`: theme, language, motion, and layout reset.
- `components/apps/resume-3d-app.tsx`: lazy Three.js experience.
- `components/apps/resume-book-app.tsx`: CSS 3D page-turn experience.

### Tests And Assets

- `vitest.config.ts`, `vitest.setup.ts`: unit/component test setup.
- `playwright.config.ts`: desktop/mobile browser projects and local server.
- `tests/e2e/desktop.spec.ts`: window and route workflows.
- `tests/e2e/mobile.spec.ts`: iOS-style shell workflows.
- `tests/e2e/resume-flow.spec.ts`: draft and Agent workflows.
- `tests/e2e/showcase.spec.ts`: 3D Canvas and Book verification.
- `public/wallpapers/resume-os-dark.webp`, `public/wallpapers/resume-os-light.webp`: original Resume OS raster wallpapers.

---

### Task 1: Dependencies And Browser Test Harness

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `playwright.config.ts`
- Create: `tests/e2e/smoke.spec.ts`

- [ ] **Step 1: Install runtime and test dependencies with the pinned pnpm version**

Run:

```bash
corepack pnpm@10.33.0 add react-rnd motion mammoth pdf-parse three @react-three/fiber @react-three/drei
corepack pnpm@10.33.0 add -D jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom @playwright/test @types/three
```

Expected: `package.json` contains the listed packages and still contains `"packageManager": "pnpm@10.33.0"`.

- [ ] **Step 2: Add test scripts**

Set the scripts in `package.json` to include:

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "test:e2e:update": "playwright test --update-snapshots"
}
```

Keep `dev`, `build`, `start`, `lint`, and `typecheck` unchanged.

- [ ] **Step 3: Configure Vitest**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.ts', '**/*.test.tsx'],
    css: true
  },
  resolve: {
    alias: { '@': new URL('.', import.meta.url).pathname }
  }
})
```

Create `vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 4: Configure Playwright and write the initial smoke test**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:3001', trace: 'retain-on-failure' },
  webServer: {
    command: 'corepack pnpm@10.33.0 dev',
    url: 'http://127.0.0.1:3001',
    reuseExistingServer: true,
    timeout: 120_000
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } }
  ]
})
```

Create `tests/e2e/smoke.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test('loads the localized product', async ({ page }) => {
  await page.goto('/zh')
  await expect(page).toHaveTitle(/Resume/i)
  await expect(page.locator('body')).toBeVisible()
})
```

- [ ] **Step 5: Verify the harness**

Run:

```bash
corepack pnpm@10.33.0 test
corepack pnpm@10.33.0 exec playwright install chromium
corepack pnpm@10.33.0 test:e2e --project=desktop tests/e2e/smoke.spec.ts
```

Expected: existing model tests and the smoke browser test pass.

- [ ] **Step 6: Commit**

```bash
git add package.json vitest.config.ts vitest.setup.ts playwright.config.ts tests/e2e/smoke.spec.ts
git commit -m "test: add desktop browser harness"
```

---

### Task 2: Typed Application Registry

**Files:**
- Create: `lib/desktop/types.ts`
- Create: `lib/desktop/app-registry.ts`
- Create: `lib/desktop/app-registry.test.ts`

- [ ] **Step 1: Write failing registry tests**

Create `lib/desktop/app-registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { appRegistry, appIdFromPath, pathForApp } from './app-registry'

describe('app registry', () => {
  it('maps localized paths to stable application ids', () => {
    expect(appIdFromPath('/zh/agent')).toBe('agent')
    expect(appIdFromPath('/en/3d')).toBe('resume-3d')
    expect(appIdFromPath('/zh/projects/resume-os')).toBe('projects')
    expect(appIdFromPath('/zh')).toBe('studio')
  })

  it('builds locale-aware application paths', () => {
    expect(pathForApp('book', 'zh')).toBe('/zh/book')
    expect(pathForApp('settings', 'en')).toBe('/en/settings')
  })

  it('defines valid window constraints for every app', () => {
    for (const app of Object.values(appRegistry)) {
      expect(app.defaultSize.width).toBeGreaterThanOrEqual(app.minSize.width)
      expect(app.defaultSize.height).toBeGreaterThanOrEqual(app.minSize.height)
    }
  })
})
```

- [ ] **Step 2: Verify failure**

Run: `corepack pnpm@10.33.0 test lib/desktop/app-registry.test.ts`

Expected: FAIL because the desktop modules do not exist.

- [ ] **Step 3: Define the types and registry**

Create `lib/desktop/types.ts` with these exported contracts:

```ts
import type { Locale } from '@/i18n/routing'

export type AppId =
  | 'studio' | 'agent' | 'jd-match' | 'resume-3d' | 'book'
  | 'classic' | 'projects' | 'timeline' | 'terminal' | 'settings'

export type Point = { x: number; y: number }
export type Size = { width: number; height: number }
export type WindowStatus = 'open' | 'minimized' | 'maximized'

export type DesktopAppDefinition = {
  id: AppId
  route: string
  messageKey: string
  icon: string
  iconTone: 'teal' | 'coral' | 'gold' | 'blue' | 'neutral'
  defaultSize: Size
  minSize: Size
  defaultPosition: Point
  pinned: boolean
  desktop: boolean
}

export type DesktopWindowState = {
  appId: AppId
  status: WindowStatus
  position: Point
  size: Size
  restoreGeometry?: { position: Point; size: Size }
  zIndex: number
}

export type DesktopState = {
  windows: Partial<Record<AppId, DesktopWindowState>>
  focusedAppId: AppId | null
  nextZIndex: number
  hasCompletedIntro: boolean
}

export type AppPath = { appId: AppId; locale: Locale }
```

Create `lib/desktop/app-registry.ts`. Define all ten applications with explicit route, default geometry, pinning, and icon token. Export `appRegistry`, `appIdFromPath(pathname)`, and `pathForApp(appId, locale)`. Root locale paths map to `studio`; unknown paths return `null`.

- [ ] **Step 4: Verify registry behavior**

Run: `corepack pnpm@10.33.0 test lib/desktop/app-registry.test.ts`

Expected: PASS with three tests.

- [ ] **Step 5: Commit**

```bash
git add lib/desktop/types.ts lib/desktop/app-registry.ts lib/desktop/app-registry.test.ts
git commit -m "feat: add desktop application registry"
```

---

### Task 3: Window Reducer And Geometry Rules

**Files:**
- Create: `lib/desktop/reducer.ts`
- Create: `lib/desktop/reducer.test.ts`

- [ ] **Step 1: Write reducer tests**

Create tests for these exact transitions:

```ts
import { describe, expect, it } from 'vitest'
import { createInitialDesktopState, desktopReducer } from './reducer'

describe('desktop reducer', () => {
  it('opens singleton apps and raises an existing window', () => {
    let state = desktopReducer(createInitialDesktopState(), { type: 'open', appId: 'agent' })
    const firstZ = state.windows.agent?.zIndex
    state = desktopReducer(state, { type: 'open', appId: 'agent' })
    expect(Object.keys(state.windows)).toEqual(['agent'])
    expect(state.windows.agent?.zIndex).toBeGreaterThan(firstZ ?? 0)
  })

  it('preserves geometry across maximize and restore', () => {
    let state = desktopReducer(createInitialDesktopState(), { type: 'open', appId: 'studio' })
    const original = state.windows.studio
    state = desktopReducer(state, { type: 'maximize', appId: 'studio' })
    state = desktopReducer(state, { type: 'restore', appId: 'studio' })
    expect(state.windows.studio?.position).toEqual(original?.position)
    expect(state.windows.studio?.size).toEqual(original?.size)
  })

  it('focuses the top visible window after close', () => {
    let state = desktopReducer(createInitialDesktopState(), { type: 'open', appId: 'studio' })
    state = desktopReducer(state, { type: 'open', appId: 'agent' })
    state = desktopReducer(state, { type: 'close', appId: 'agent' })
    expect(state.focusedAppId).toBe('studio')
  })

  it('keeps restored title bars inside the viewport', () => {
    let state = desktopReducer(createInitialDesktopState(), { type: 'open', appId: 'studio' })
    state = desktopReducer(state, { type: 'move', appId: 'studio', position: { x: 5000, y: -900 } })
    state = desktopReducer(state, { type: 'clamp', viewport: { width: 1280, height: 800 } })
    expect(state.windows.studio?.position.x).toBeLessThan(1280)
    expect(state.windows.studio?.position.y).toBeGreaterThanOrEqual(0)
  })
})
```

- [ ] **Step 2: Verify failure**

Run: `corepack pnpm@10.33.0 test lib/desktop/reducer.test.ts`

Expected: FAIL because `reducer.ts` does not exist.

- [ ] **Step 3: Implement pure state transitions**

In `lib/desktop/reducer.ts`, export `DesktopAction`, `createInitialDesktopState()`, `desktopReducer()`, and `clampWindowGeometry()`. Use `appRegistry` defaults when opening a closed application. Treat absent window entries as closed. Minimize must select the highest-z non-minimized window; maximize must save restore geometry; close must remove the entry.

Use these action names and payloads so later provider code remains consistent:

```ts
export type DesktopAction =
  | { type: 'open'; appId: AppId }
  | { type: 'focus'; appId: AppId }
  | { type: 'move'; appId: AppId; position: Point }
  | { type: 'resize'; appId: AppId; position: Point; size: Size }
  | { type: 'minimize'; appId: AppId }
  | { type: 'maximize'; appId: AppId }
  | { type: 'restore'; appId: AppId }
  | { type: 'close'; appId: AppId }
  | { type: 'clamp'; viewport: Size }
  | { type: 'hydrate'; state: DesktopState }
  | { type: 'completeIntro' }
  | { type: 'reset' }
```

- [ ] **Step 4: Run reducer and full unit tests**

Run:

```bash
corepack pnpm@10.33.0 test lib/desktop/reducer.test.ts
corepack pnpm@10.33.0 test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/desktop/reducer.ts lib/desktop/reducer.test.ts
git commit -m "feat: add desktop window reducer"
```

---

### Task 4: Versioned Desktop Persistence

**Files:**
- Create: `lib/desktop/persistence.ts`
- Create: `lib/desktop/persistence.test.ts`

- [ ] **Step 1: Write persistence tests**

Test valid round trips, invalid JSON, unknown versions, missing registry apps, and out-of-bounds geometry. Use an in-memory `Storage` test double and assert invalid data returns `null` rather than throwing.

```ts
expect(readDesktopState(storage)).toBeNull()
writeDesktopState(storage, state)
expect(readDesktopState(storage)).toEqual(state)
storage.setItem(DESKTOP_STORAGE_KEY, '{bad json')
expect(readDesktopState(storage)).toBeNull()
```

- [ ] **Step 2: Verify failure**

Run: `corepack pnpm@10.33.0 test lib/desktop/persistence.test.ts`

Expected: FAIL because persistence helpers do not exist.

- [ ] **Step 3: Implement persistence**

Export:

```ts
export const DESKTOP_STORAGE_KEY = 'resume-os-desktop-v1'
export function readDesktopState(storage: Pick<Storage, 'getItem'>): DesktopState | null
export function writeDesktopState(storage: Pick<Storage, 'setItem'>, state: DesktopState): void
export function clearDesktopState(storage: Pick<Storage, 'removeItem'>): void
```

Validate with Zod. Strip application IDs that are not present in `appRegistry`, recalculate `nextZIndex`, and return `null` for malformed versions.

- [ ] **Step 4: Verify**

Run: `corepack pnpm@10.33.0 test lib/desktop/persistence.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/desktop/persistence.ts lib/desktop/persistence.test.ts
git commit -m "feat: persist desktop window sessions"
```

---

### Task 5: Desktop Provider And Route Descriptors

**Files:**
- Create: `components/desktop/desktop-provider.tsx`
- Create: `components/desktop/desktop-provider.test.tsx`
- Create: `components/desktop/desktop-route.tsx`
- Modify: `app/[locale]/page.tsx`
- Modify: `app/[locale]/agent/page.tsx`
- Modify: all other locale route pages
- Create: `app/[locale]/3d/page.tsx`
- Create: `app/[locale]/book/page.tsx`
- Create: `app/[locale]/studio/page.tsx`
- Create: `app/[locale]/settings/page.tsx`

- [ ] **Step 1: Write provider behavior tests**

Render the provider with a memory router adapter and verify:

- Hydration occurs once.
- `/zh/agent` opens Agent.
- Launching Book calls `push('/zh/book')`.
- Focusing an already open app calls `replace`.
- Closing the focused app routes to the next visible app or `/zh`.

Define the provider public API in the test:

```ts
type DesktopContextValue = {
  state: DesktopState
  openApp(appId: AppId): void
  focusApp(appId: AppId): void
  dispatch(action: DesktopAction): void
  resetDesktop(): void
}
```

- [ ] **Step 2: Verify failure**

Run: `corepack pnpm@10.33.0 test components/desktop/desktop-provider.test.tsx`

Expected: FAIL because provider modules do not exist.

- [ ] **Step 3: Implement provider and route descriptor**

`DesktopProvider` uses `useReducer`, reads persistence after mount, clamps on resize, writes state changes, and exposes `useDesktop()`. Accept a small router adapter prop in tests; default to the next-intl navigation hooks in production.

`DesktopRoute` has this exact interface:

```tsx
'use client'

import { useEffect, useSyncExternalStore } from 'react'
import type { AppId } from '@/lib/desktop/types'
import { useDesktop } from './desktop-provider'

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false
  )
}

export function DesktopRoute({
  appId,
  desktopOnly = false
}: {
  appId: AppId
  desktopOnly?: boolean
}) {
  const { openApp } = useDesktop()
  const isMobile = useMediaQuery('(max-width: 767px)')
  useEffect(() => {
    if (!desktopOnly || !isMobile) openApp(appId)
  }, [appId, desktopOnly, isMobile, openApp])
  return null
}
```

Guard `openApp` with stable callbacks so the effect does not loop.

- [ ] **Step 4: Convert route pages to descriptors**

Each locale route keeps `setRequestLocale` and returns one descriptor, for example:

```tsx
export default async function AgentPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <DesktopRoute appId="agent" />
}
```

Create matching pages for `resume-3d`, `book`, `studio`, and `settings`. The root returns `<DesktopRoute appId="studio" desktopOnly />`, so desktop startup opens Studio while the mobile root remains the iOS-style home screen. The `/studio` route returns a normal Studio descriptor on both responsive shells.

- [ ] **Step 5: Verify route and provider tests**

Run:

```bash
corepack pnpm@10.33.0 test components/desktop/desktop-provider.test.tsx
corepack pnpm@10.33.0 typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/desktop 'app/[locale]'
git commit -m "feat: route applications through desktop state"
```

---

### Task 6: Desktop Shell, Window Frame, Menu Bar, And Dock

**Files:**
- Create: `components/desktop/desktop-shell.tsx`
- Create: `components/desktop/desktop-surface.tsx`
- Create: `components/desktop/menu-bar.tsx`
- Create: `components/desktop/dock.tsx`
- Create: `components/desktop/window-manager.tsx`
- Create: `components/desktop/app-window.tsx`
- Create: `components/desktop/app-loader.tsx`
- Create: `components/desktop/app-error-boundary.tsx`
- Create: `components/apps/placeholder-app.tsx`
- Create: `components/desktop/desktop-shell.test.tsx`
- Modify: `app/[locale]/layout.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Write shell interaction tests**

Mock `react-rnd` as a positioned wrapper. Assert that Studio appears after first launch, three apps can coexist, traffic lights dispatch close/minimize/maximize, Dock restores a minimized app, and clicking a window focuses it.

Use accessible selectors:

```ts
expect(screen.getByRole('application', { name: /Resume Studio/i })).toBeVisible()
await user.click(screen.getByRole('button', { name: /minimize Resume Studio/i }))
expect(screen.queryByRole('application', { name: /Resume Studio/i })).not.toBeInTheDocument()
await user.click(screen.getByRole('button', { name: /Resume Studio/i }))
expect(screen.getByRole('application', { name: /Resume Studio/i })).toBeVisible()
```

- [ ] **Step 2: Verify failure**

Run: `corepack pnpm@10.33.0 test components/desktop/desktop-shell.test.tsx`

Expected: FAIL because the shell components do not exist.

- [ ] **Step 3: Implement the shell structure**

`DesktopShell` must render `MenuBar`, `DesktopSurface`, `WindowManager`, and `Dock` inside `DesktopProvider`. It accepts route descriptors through `children`. During this task, `app-loader.tsx` renders a typed `PlaceholderApp` for every application ID so this commit remains buildable before application migration. The placeholder displays the localized application name and a stable loading region. Later tasks replace one registry mapping at a time with `next/dynamic`; the 3D module must eventually use `{ ssr: false }`.

`AppErrorBoundary` catches child errors and renders localized Retry and Close controls. Retry remounts the application with an incremented key.

- [ ] **Step 4: Implement window geometry and controls**

`AppWindow` wraps content in `Rnd` with:

```tsx
<Rnd
  bounds="parent"
  dragHandleClassName="desktop-window-titlebar"
  cancel="button,input,textarea,select,a,[data-no-drag],canvas"
  minWidth={definition.minSize.width}
  minHeight={definition.minSize.height}
  position={windowState.position}
  size={windowState.size}
  disableDragging={windowState.status === 'maximized'}
  enableResizing={windowState.status !== 'maximized'}
  onDragStop={(_, data) => dispatch({ type: 'move', appId, position: { x: data.x, y: data.y } })}
  onResizeStop={(_, __, ref, ___, position) => dispatch({
    type: 'resize', appId, position,
    size: { width: ref.offsetWidth, height: ref.offsetHeight }
  })}
>
```

Wrap open/close presentation in Motion. Do not animate pointer-following move or resize operations.

- [ ] **Step 5: Add system layout CSS**

Define stable variables for menu height, Dock height, blur, window radius, z-index bands, focus ring, and light/dark wallpaper overlays. Ensure Dock magnification uses transforms inside fixed-size slots so it does not reflow.

- [ ] **Step 6: Wrap the locale layout**

Keep `NextIntlClientProvider` and `ThemeScript`, then render:

```tsx
<NextIntlClientProvider>
  <ResumeDraftProvider locale={locale}>
    <DesktopShell>{children}</DesktopShell>
  </ResumeDraftProvider>
</NextIntlClientProvider>
```

If `ResumeDraftProvider` is not created until Task 9, first add a pass-through provider with the final prop shape and replace its internals in Task 9.

- [ ] **Step 7: Verify**

Run:

```bash
corepack pnpm@10.33.0 test components/desktop/desktop-shell.test.tsx
corepack pnpm@10.33.0 lint
corepack pnpm@10.33.0 typecheck
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add components/desktop components/apps/placeholder-app.tsx components/resume-draft-provider.tsx 'app/[locale]/layout.tsx' app/globals.css
git commit -m "feat: add Resume OS desktop shell"
```

---

### Task 7: Original Wallpaper And System Motion

**Files:**
- Create: `public/wallpapers/resume-os-dark.webp`
- Create: `public/wallpapers/resume-os-light.webp`
- Create: `components/desktop/motion-preference.tsx`
- Create: `components/desktop/motion-preference.test.tsx`
- Modify: `components/desktop/desktop-surface.tsx`
- Modify: `components/desktop/dock.tsx`
- Modify: `components/desktop/app-window.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Generate original wallpaper assets**

Use the image generation skill with this prompt for dark and light variants:

```text
Abstract premium operating-system wallpaper for a product named Resume OS, layered folded glass and soft architectural light, graphite neutral foundation, teal highlights, restrained warm coral and muted gold accents, clean depth, no text, no logos, no circles, no bokeh, no gradient orbs, 16:10 desktop composition, detailed but quiet enough behind translucent application windows.
```

Export both variants as WebP at a minimum of 2560 x 1600.

- [ ] **Step 2: Write motion preference tests**

Assert precedence: explicit local setting, then `prefers-reduced-motion`, then full motion. Assert changing the setting updates `document.documentElement.dataset.motion`.

- [ ] **Step 3: Implement motion preference**

Use storage key `resume-os-motion` with values `system`, `full`, and `reduced`. Export `MotionPreferenceProvider`, `useMotionPreference`, and a setting control for the Settings application.

- [ ] **Step 4: Add P1 product motion**

Add 180–320ms window open/restore, Dock magnification, icon press, focus border, menu, and minimize-to-Dock motion. Reduced mode replaces transforms with opacity transitions no longer than 120ms.

- [ ] **Step 5: Verify screenshots manually at both themes**

Run: `corepack pnpm@10.33.0 dev`

Inspect `/zh` at 1440 x 900 in light and dark themes. Expected: readable window content, original wallpaper visible, no orb/bokeh decoration, Dock slots remain stable during magnification.

- [ ] **Step 6: Commit**

```bash
git add public/wallpapers components/desktop app/globals.css
git commit -m "feat: add Resume OS visual and motion system"
```

---

### Task 8: iOS-Style Mobile Shell

**Files:**
- Create: `components/desktop/mobile-home.tsx`
- Create: `components/desktop/mobile-app-frame.tsx`
- Create: `components/desktop/mobile-shell.test.tsx`
- Modify: `components/desktop/desktop-shell.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Write mobile shell tests**

Mock `matchMedia('(max-width: 767px)')` to match. Verify the app grid renders, a single tap opens a full-screen application, Home returns to the grid, and no traffic-light or resize controls exist.

- [ ] **Step 2: Verify failure**

Run: `corepack pnpm@10.33.0 test components/desktop/mobile-shell.test.tsx`

Expected: FAIL because mobile shell modules do not exist.

- [ ] **Step 3: Implement the responsive shell**

At 767px and below, render `MobileHome` for the exact locale root path. Render `MobileAppFrame` for `/studio` and every other application route. Use `env(safe-area-inset-*)`, 44px minimum touch targets, a fixed status region, app grid, and compact Dock. The Studio icon pushes `/[locale]/studio`; Home returns to `/[locale]`.

Mobile app controls must expose localized Back and Home labels. Do not render `Rnd`, traffic lights, desktop double-click handlers, or floating window geometry.

- [ ] **Step 4: Verify component and browser behavior**

Run:

```bash
corepack pnpm@10.33.0 test components/desktop/mobile-shell.test.tsx
corepack pnpm@10.33.0 test:e2e --project=mobile tests/e2e/smoke.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/desktop/mobile-home.tsx components/desktop/mobile-app-frame.tsx components/desktop/mobile-shell.test.tsx components/desktop/desktop-shell.tsx app/globals.css
git commit -m "feat: add Resume OS mobile shell"
```

---

### Task 9: Resume Draft Store, Versions, And Provider

**Files:**
- Modify: `lib/resume-model.ts`
- Modify: `lib/resume-model.test.ts`
- Create: `lib/resume-store.ts`
- Create: `lib/resume-store.test.ts`
- Replace: `components/resume-draft-provider.tsx`
- Create: `components/resume-draft-provider.test.tsx`

- [ ] **Step 1: Extend draft types with snapshots**

Add:

```ts
export type ResumeSnapshot = {
  id: string
  createdAt: string
  reason: 'manual' | 'agent-change'
  data: ResumeData
}

export type ResumeDraft = {
  id: string
  name: string
  source: ResumeSource
  createdAt: string
  updatedAt: string
  data: ResumeData
  snapshots: ResumeSnapshot[]
}
```

Update `createResumeDraft` to initialize `snapshots: []` and adjust existing tests.

- [ ] **Step 2: Write failing store tests**

Cover create, rename, delete, set active, update with snapshot, fallback sample, malformed storage, and maximum snapshot retention of 20 per draft.

- [ ] **Step 3: Implement store operations**

Use storage key `resume-os-drafts-v1`. Export pure functions `readDraftState`, `writeDraftState`, `addDraft`, `renameDraft`, `deleteDraft`, `setActiveDraft`, and `updateDraftData`. `updateDraftData` accepts `{ snapshotReason?: ResumeSnapshot['reason'] }`.

- [ ] **Step 4: Implement the provider**

Expose:

```ts
type ResumeDraftContextValue = {
  state: ResumeDraftState
  activeResume: ResumeData
  activeDraft: ResumeDraft | null
  createDraft(data: ResumeData, options?: { name?: string; source?: ResumeSource }): string
  updateActiveResume(data: ResumeData, options?: { snapshotReason?: ResumeSnapshot['reason'] }): void
  renameDraft(id: string, name: string): void
  deleteDraft(id: string): void
  setActiveDraft(id: string): void
}
```

Use `getSampleResumeData(locale)` when there is no active draft.

- [ ] **Step 5: Verify**

Run: `corepack pnpm@10.33.0 test lib/resume-model.test.ts lib/resume-store.test.ts components/resume-draft-provider.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/resume-model.ts lib/resume-model.test.ts lib/resume-store.ts lib/resume-store.test.ts components/resume-draft-provider.tsx components/resume-draft-provider.test.tsx
git commit -m "feat: add versioned local resume drafts"
```

---

### Task 10: Resume Studio And Resume Generation APIs

**Files:**
- Create: `lib/agent/json.ts`
- Create: `lib/agent/resume-prompts.ts`
- Create: `app/api/resume/extract-text/route.ts`
- Create: `app/api/resume/parse/route.ts`
- Create: `app/api/resume/generate/route.ts`
- Create: `components/apps/resume-studio-app.tsx`
- Create: `components/apps/resume-studio-app.test.tsx`
- Modify: `components/desktop/app-loader.tsx`

- [ ] **Step 1: Write API helper tests**

Test fenced JSON extraction, plain JSON extraction, invalid JSON rejection, and schema normalization. Test TXT extraction directly; mock PDF and DOCX parsers in route tests.

- [ ] **Step 2: Implement extraction and AI routes**

`extract-text` accepts multipart field `file`, rejects files over 8 MiB, and supports PDF, DOCX, and TXT. It returns `{ text, fileName, mimeType }`.

`parse` accepts `{ text, locale }`, calls `generateAgentText` with a strict JSON prompt, validates with `resumeDataSchema`, and returns `{ data, model }`.

`generate` accepts:

```ts
type GenerateResumeRequest = {
  locale: 'zh' | 'en'
  targetRole: string
  seniority: 'junior' | 'mid' | 'senior' | 'lead'
  background?: string
}
```

It returns normalized data with source `ai-generated`. Neither route exposes API keys or raw provider errors.

- [ ] **Step 3: Write failing Studio component tests**

Verify paste creation, generated-resume creation, draft switching/rename/delete, loading state, failed request preserving source text, and structured preview.

- [ ] **Step 4: Implement Resume Studio**

Use a dense desktop application layout with a source sidebar, main input/generation workspace, draft list, and structured preview. Provide upload, paste, target role, seniority, generate, rename, delete, and active-draft controls. The existing `AIServiceTest` becomes a compact diagnostics section inside Studio or Settings.

- [ ] **Step 5: Verify**

Run:

```bash
corepack pnpm@10.33.0 test components/apps/resume-studio-app.test.tsx
corepack pnpm@10.33.0 lint
corepack pnpm@10.33.0 typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/agent app/api/resume components/apps/resume-studio-app.tsx components/apps/resume-studio-app.test.tsx components/desktop/app-loader.tsx
git commit -m "feat: add Resume Studio creation workflow"
```

---

### Task 11: Agent Change Sets And JD Match Applications

**Files:**
- Create: `lib/agent/resume-change-set.ts`
- Create: `lib/agent/resume-change-set.test.ts`
- Create: `app/api/resume/optimize/route.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `app/api/jd-match/route.ts`
- Create: `components/apps/resume-agent-app.tsx`
- Create: `components/apps/resume-agent-app.test.tsx`
- Create: `components/apps/jd-match-app.tsx`
- Modify: `components/desktop/app-loader.tsx`

- [ ] **Step 1: Define and test the change-set schema**

Use this contract:

```ts
export const resumeChangeSchema = z.object({
  id: z.string(),
  path: z.string(),
  original: z.unknown(),
  proposed: z.unknown(),
  reason: z.string(),
  needsConfirmation: z.boolean().default(false)
})

export const resumeChangeSetSchema = z.object({
  summary: z.string(),
  changes: z.array(resumeChangeSchema),
  questions: z.array(z.string()).default([])
})
```

Test valid paths, rejection of prototype-pollution paths, selective application, original-value mismatch, and normalized output.

- [ ] **Step 2: Implement safe change application**

Only allow explicit path families for profile, skills, experiences, projects, education, and top-level string arrays. Apply to a cloned resume, verify `original` still matches, then call `normalizeResumeData`. Export `applyResumeChanges(resume, changeSet, acceptedIds)`.

- [ ] **Step 3: Implement optimize and contextual chat routes**

`optimize` accepts `{ resume, locale, instruction, jd? }` and returns a validated `ResumeChangeSet`. Prompts prohibit fabricated metrics and require `needsConfirmation: true` when evidence is missing.

Update chat and JD Match to accept an optional normalized `resume`; use built-in sample only when it is absent.

- [ ] **Step 4: Write Agent UI tests**

Verify request context, before/after display, accept one, accept all, discard, question display, snapshot creation, and failure preserving the active resume.

- [ ] **Step 5: Implement Agent and JD Match applications**

Agent uses three regions: conversation, suggested actions, and change preview. Applying changes calls `updateActiveResume(next, { snapshotReason: 'agent-change' })`. JD Match uses a textarea and structured report sections rather than a raw `<pre>` block.

- [ ] **Step 6: Verify and commit**

Run: `corepack pnpm@10.33.0 test lib/agent/resume-change-set.test.ts components/apps/resume-agent-app.test.tsx`

Expected: PASS.

```bash
git add lib/agent app/api components/apps components/desktop/app-loader.tsx
git commit -m "feat: add safe Resume Agent optimization"
```

---

### Task 12: Structured Presentation Applications

**Files:**
- Create: `components/apps/classic-resume-app.tsx`
- Create: `components/apps/projects-app.tsx`
- Create: `components/apps/timeline-app.tsx`
- Create: `components/apps/terminal-app.tsx`
- Create: `components/apps/presentation-apps.test.tsx`
- Modify: `components/desktop/app-loader.tsx`

- [ ] **Step 1: Write shared-data tests**

Render every application with a custom active draft and assert the custom name, project, and experience appear instead of built-in sample values. Test Projects internal detail navigation and Terminal command buttons.

- [ ] **Step 2: Verify failure**

Run: `corepack pnpm@10.33.0 test components/apps/presentation-apps.test.tsx`

Expected: FAIL because migrated applications do not exist.

- [ ] **Step 3: Migrate Classic and Projects**

Move existing route markup into client application components using `useResumeDraft()`. Classic keeps a printable white document surface inside the app window. Projects owns list/detail state internally so a detail does not open a second Projects window. When the pathname matches `/projects/[id]`, initialize or update the internal selected project from that route segment.

- [ ] **Step 4: Migrate Timeline and Terminal**

Timeline renders active experiences with progressive reveal classes. Terminal provides clickable commands for `whoami`, `skills`, `projects`, and `help`; command output comes from the active resume.

- [ ] **Step 5: Verify and commit**

Run:

```bash
corepack pnpm@10.33.0 test components/apps/presentation-apps.test.tsx
corepack pnpm@10.33.0 typecheck
```

Expected: PASS.

```bash
git add components/apps components/desktop/app-loader.tsx
git commit -m "feat: migrate resume presentation apps"
```

---

### Task 13: Three.js And Resume Book Applications

**Files:**
- Create: `components/apps/resume-3d-app.tsx`
- Create: `components/apps/resume-book-app.tsx`
- Create: `components/apps/resume-book-app.test.tsx`
- Create: `components/resume-3d/resume-scene.tsx`
- Create: `components/resume-3d/resume-node.tsx`
- Modify: `components/desktop/app-loader.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Write Book state tests**

Verify page order is profile, summary, skills, experience, projects, and closing page. Test Next, Previous, keyboard arrows, first/last disabled states, and reduced-motion fallback.

- [ ] **Step 2: Implement Resume Book**

Use CSS perspective and paired front/back page faces. Page turns use `rotateY` around the spine, stable aspect ratio, and z-index based on page index. At 767px and below, use a single-page reader while retaining Next/Previous controls.

- [ ] **Step 3: Implement the Three.js scene**

Use `Canvas`, `PerspectiveCamera`, `OrbitControls`, environment lighting, and text/panel nodes derived from experiences, projects, and skills. Selecting a node updates a DOM detail inspector outside the Canvas. Pause the frame loop when minimized or document visibility is hidden. Respect reduced motion by disabling automatic camera movement.

Provide a DOM fallback containing the same sections when WebGL initialization throws or `webglcontextlost` fires.

- [ ] **Step 4: Keep 3D lazy**

In `app-loader.tsx`, load `resume-3d-app.tsx` through `next/dynamic` with `ssr: false` and a fixed-size loading shell. Verify the root page source does not eagerly instantiate a Canvas.

- [ ] **Step 5: Verify unit and browser behavior**

Run:

```bash
corepack pnpm@10.33.0 test components/apps/resume-book-app.test.tsx
corepack pnpm@10.33.0 typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/apps/resume-3d-app.tsx components/apps/resume-book-app.tsx components/apps/resume-book-app.test.tsx components/resume-3d components/desktop/app-loader.tsx app/globals.css
git commit -m "feat: add 3d and book resume apps"
```

---

### Task 14: Settings, Localization, Accessibility, E2E, And Final Acceptance

**Files:**
- Create: `components/apps/settings-app.tsx`
- Modify: `components/app-controls.tsx`
- Modify: `messages/zh.json`
- Modify: `messages/en.json`
- Modify: `components/desktop/*`
- Create: `tests/e2e/desktop.spec.ts`
- Create: `tests/e2e/mobile.spec.ts`
- Create: `tests/e2e/resume-flow.spec.ts`
- Create: `tests/e2e/showcase.spec.ts`
- Remove: `tests/e2e/smoke.spec.ts` after its coverage is absorbed

- [ ] **Step 1: Complete translation namespaces**

Add matching `desktop`, `mobile`, `studio`, `agentChanges`, `book`, `resume3d`, `settings`, and `errors` keys in Chinese and English. Use a test that recursively compares both message-key trees and fails on any mismatch.

- [ ] **Step 2: Implement Settings**

Expose theme (`system`, `light`, `dark`), language, motion (`system`, `full`, `reduced`), desktop layout reset, and AI service diagnostics. Reset requires confirmation and clears only desktop state, not resume drafts.

- [ ] **Step 3: Audit keyboard and accessible names**

Verify desktop icons, Dock, traffic lights, menus, Agent changes, Book controls, and mobile Home/Back are keyboard reachable and named. Ensure focus rings are visible in both themes and color is not the only running/focus indicator.

- [ ] **Step 4: Write desktop E2E tests**

Cover first Studio launch, opening Agent/Timeline/Classic simultaneously, drag, resize, z-order, minimize/restore, maximize/restore, reload persistence, deep links, Back/Forward, locale, theme, and reduced motion.

- [ ] **Step 5: Write mobile E2E tests**

At 390 x 844 and 375 x 667, cover home grid, single-tap application launch, Back, Home, safe-area layout, and absence of desktop window controls.

- [ ] **Step 6: Write resume-flow E2E tests**

Mock AI API responses for deterministic CI. Cover pasted resume creation, active-draft switching, Agent proposal display, selective acceptance, snapshot creation, and immediate updates in Classic and Timeline.

- [ ] **Step 7: Write showcase verification**

Open 3D, wait for Canvas, read pixels with `page.evaluate`, and assert at least one sampled RGB value is nonzero. Capture screenshots at 1440 x 900 and 390 x 844. Flip Book twice and capture the initial and turned states. Also test the WebGL fallback by blocking WebGL context creation.

- [ ] **Step 8: Run the full automated gate**

Run:

```bash
corepack pnpm@10.33.0 test
corepack pnpm@10.33.0 lint
corepack pnpm@10.33.0 typecheck
corepack pnpm@10.33.0 build
corepack pnpm@10.33.0 test:e2e
```

Expected: every command exits 0.

- [ ] **Step 9: Run the real AI smoke test**

With the existing local environment, run the app at port 3001 and verify:

1. AI diagnostics returns the configured model.
2. Simulated resume generation returns normalized data.
3. Agent optimization returns a valid change set.
4. JD Match returns a report using the active resume.
5. An intentionally invalid model name produces a recoverable error while preserving source text and active draft.

Restore the original model environment value immediately after the negative test. Do not commit environment files or print secret values.

- [ ] **Step 10: Inspect target screenshots**

Inspect desktop at 1440 x 900 and 1280 x 800, plus mobile at 390 x 844 and 375 x 667. Confirm no text overflow, incoherent overlap, missing wallpaper, blank Canvas, window outside viewport, or Dock reflow.

- [ ] **Step 11: Commit final hardening**

```bash
git add components app messages tests playwright.config.ts
git commit -m "test: verify Resume OS desktop experience"
```

---

## Completion Checklist

- [ ] Root route starts the desktop and opens or restores Resume Studio.
- [ ] Three or more desktop applications operate concurrently.
- [ ] Deep links and browser history focus the correct application.
- [ ] Desktop layout and resume drafts persist independently.
- [ ] Mobile uses an iOS-style grid and full-screen applications.
- [ ] Upload, paste, generation, and Agent optimization produce normalized resume data.
- [ ] Agent changes require explicit preview and acceptance.
- [ ] All presentation applications consume the active draft.
- [ ] 3D Canvas is nonblank and Book page turns are functional.
- [ ] Light/dark/system theme, Chinese/English, keyboard, and reduced motion work.
- [ ] API and application errors remain local and non-destructive.
- [ ] pnpm 10.33.0 test, lint, typecheck, build, and E2E commands pass.
