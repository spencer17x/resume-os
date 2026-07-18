# Resume Studio Design

## Goal

Upgrade Resume OS from a mostly static interactive resume into a Resume Studio product:

- The home route becomes the data production and draft management entry.
- Users can upload or paste resume content, generate simulated resume data with AI, or chat with AI to create and improve a resume.
- Display routes render the same active structured resume data through different frontend experiences instead of showing PDF or image snapshots.
- The first stable display set includes Agent, Three.js 3D, Book, Classic, and Timeline routes.

## Confirmed Scope

- First implementation slice: stable product foundation.
- Persistence: browser-local multi-draft storage.
- Upload inputs: PDF, DOCX, TXT, and pasted text.
- Draft model: multiple saved resume drafts with rename, switch, delete, and active draft selection.
- AI generation: one-click simulated resume generation plus conversational resume generation/completion.
- Resume model: a generalized resume data model that remains compatible with the current fields.
- 3D route: real Three.js scene, not CSS-only 3D.
- AI credentials: reuse the existing `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL` environment variables.
- Provider compatibility: keep OpenAI-compatible provider support without coupling the UI to one vendor.

## Non-Goals For This Slice

- User accounts or cloud synchronization.
- Database-backed draft storage.
- PDF/image rendering as the primary resume presentation.
- Full ATS scoring, version diffs, job application history, or JD match history.
- Streaming chat as a hard requirement. Non-streaming responses are acceptable in the first slice.
- Full production upload storage. Uploaded files are parsed for text and not persisted as files.

## Architecture

The product has two layers:

1. Resume Studio on the home route.
2. Display routes that read the active resume draft.

The home route owns resume data creation and management:

- Upload PDF, DOCX, or TXT.
- Paste raw resume text.
- Generate a simulated resume with AI.
- Chat with AI to create or improve a resume draft.
- Preview the structured resume data.
- Manage local drafts.

Display routes read resume data in this order:

1. Browser-local active draft.
2. Built-in sample resume data when there is no local draft.

All routes should consume structured `ResumeData`, not raw uploaded files.

The first implementation should keep the data access boundary narrow so local storage can later be replaced by a remote draft service without rewriting every display route.

## Data Model

Use a generalized model that extends the current `ResumeData` shape while preserving compatibility with existing pages.

```ts
type ResumeData = {
  profile: {
    name: string
    title: string
    location?: string
    email?: string
    phone?: string
    links: Array<{ label: string; url: string }>
    summary: string[]
    tags: string[]
  }
  targetRole?: string
  skills: Array<{ group: string; items: string[] }>
  experiences: Array<{
    company: string
    role: string
    period: string
    location?: string
    tags: string[]
    bullets: string[]
  }>
  projects: Array<{
    id: string
    name: string
    type: string
    tags: string[]
    summary: string
    highlights: string[]
  }>
  education: Array<{
    school: string
    degree?: string
    major?: string
    period?: string
    details: string[]
  }>
  certifications: string[]
  awards: string[]
  languages: string[]
  openSource: string[]
  metadata: {
    source: 'sample' | 'upload' | 'paste' | 'ai-generated' | 'ai-chat'
    locale: 'zh' | 'en'
    updatedAt: string
  }
}
```

Draft storage should wrap this model:

```ts
type ResumeDraft = {
  id: string
  name: string
  source: ResumeData['metadata']['source']
  createdAt: string
  updatedAt: string
  data: ResumeData
}

type ResumeDraftState = {
  activeDraftId: string | null
  drafts: ResumeDraft[]
}
```

Missing fields from AI responses should be normalized into empty strings or empty arrays so UI routes do not crash.

## Resume Store

The MVP store is browser local:

- Use `localStorage` or IndexedDB behind a small client-side store module.
- Store multiple drafts and the active draft ID.
- Expose helpers for create, update, rename, delete, set active, and reset.
- Provide a hook for client routes and components to resolve the active resume.
- Return the built-in sample resume when no active draft exists.

The store API should hide the persistence mechanism from UI components. Future database migration should replace the store implementation, not the display components.

## Home Route: Resume Studio

The home route should become the primary Studio experience while still feeling like the product entry.

Primary areas:

- Header with language, theme, and display route shortcuts.
- Current draft status.
- Upload and paste input.
- AI generation controls.
- AI chat/completion panel.
- Draft list.
- Structured resume preview.
- Route cards for Agent, 3D, Book, Classic, and Timeline.

Studio entry points:

- Upload PDF, DOCX, or TXT.
- Paste raw resume text.
- One-click AI simulated resume generation using fields such as target role, seniority, language, and style.
- AI conversation for creating or improving the active draft.

Draft behavior:

- New parsed or generated data creates a draft.
- Users can rename, switch, delete, and set drafts active.
- The active draft powers all display routes.
- When no local draft exists, the app displays the built-in sample resume.

## AI API Routes

Add resume-specific API routes:

### `POST /api/resume/parse`

Input:

- Extracted plain text.
- Locale.
- Optional target role.

Output:

- Normalized `ResumeData`.

Purpose:

- Convert uploaded or pasted resume text into structured resume data.

### `POST /api/resume/generate`

Input:

- Target role.
- Seniority or career direction.
- Locale.
- Optional style.

Output:

- Simulated `ResumeData`.

Purpose:

- Quickly generate demo data for testing the Studio and display routes.

### `POST /api/resume/chat`

Input:

- Current resume draft.
- User message.
- Locale.

Output:

- Updated `ResumeData`.
- Short explanation of the changes.

Purpose:

- Let users conversationally create, complete, or improve a resume.

### Existing `POST /api/chat`

Keep the current agent Q&A route and extend it to accept optional current draft context. If no draft is passed, use the built-in sample resume.

AI responses that are meant to become resume data should be strict JSON and validated/normalized server-side before returning to the client.

## File Parsing

Uploaded files are text sources only. The product should not persist original files in the first slice.

Parsing strategy:

- PDF: extract text before calling AI. Browser-side parsing is acceptable if reliable; otherwise use an API route and a package such as `pdf-parse`.
- DOCX: use a package such as `mammoth` to extract text.
- TXT: read directly as text.
- Paste: use the textarea contents directly.

Errors should be visible and specific:

- Unsupported file type.
- Empty extracted text.
- Parser failure.
- AI parse failure.
- Invalid structured output.

## Display Routes

### `/agent`

Make this a real resume agent page:

- Left side: current resume summary and suggested questions.
- Right side: chat window.
- Context: active draft first, sample data fallback.
- First slice can use non-streaming responses.
- Show clear loading and error states.

### `/3d`

Build a real Three.js scene:

- Use `three`, preferably through `@react-three/fiber` and `@react-three/drei`.
- Full or near-full viewport canvas.
- Center node: candidate profile.
- Skill ring, project nodes, and experience orbit.
- Click or hover nodes to reveal a detail panel.
- Drag to rotate, wheel or pinch to zoom, and subtle idle motion.
- Mobile layout should keep the canvas visible and provide a readable detail panel.
- Verify that the canvas is nonblank, framed correctly, and interactive on desktop and mobile.

### `/book`

Build a book-style resume view:

- CSS 3D transform page turns.
- Chapters: Profile, Skills, Experience, Projects, Education, Open Source.
- Button and keyboard navigation.
- Page shadow and edge treatment should make the flip feel physical without sacrificing readability.

### `/classic`

Keep this as the stable traditional resume view:

- Read active draft first.
- Fall back to sample data.
- Preserve clean text hierarchy.
- This route can later become the basis for export.

### `/timeline`

Read active draft first:

- Experiences and projects become chronological milestones.
- Empty sections should degrade gracefully.

### `/projects` and `/terminal`

Keep as secondary views:

- Read active draft where practical.
- Preserve current product personality.
- Do not block the first slice on deep redesign here.

## Visual And Motion Direction

The UI should feel like a polished product tool, not a generic resume template.

Style direction:

- Preserve dark/light theme support.
- Keep teal, fog white, gold, and a small amount of warm red or purple for state accents.
- Avoid returning to a monotonous dark blue palette.
- Use restrained borders, subtle translucent surfaces, and clear section rhythm.
- Keep cards at moderate radius and avoid nested card-heavy layouts.
- Use icons for core controls.

Motion:

- Home: upload scanning, parse progress, draft switching, route card hover effects.
- Agent: message entrance, status pulse, suggested-question transitions.
- 3D: orbit motion, node float, click focus, detail panel slide.
- Book: page flip, page edge shadow, chapter index motion.
- Respect `prefers-reduced-motion`.

## I18n And Theme

All new visible strings must be available in Chinese and English.

Theme controls should keep working across the new pages.

Route labels should include:

- Studio
- Agent
- 3D
- Book
- Classic
- Timeline

## Model And Provider Notes

The app should continue using:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`

Real-AI acceptance requires a provider and model enabled for the tester's account. Keep provider selection configurable through `OPENAI_BASE_URL` and `OPENAI_MODEL`, and do not record credential or account-entitlement details in repository documentation.

The first implementation should not hard-code behavior that prevents other OpenAI-compatible providers from being used.

## Testing And Verification

Required checks:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- Browser verification of the home Studio core flow.
- Browser verification of Agent, 3D, Book, Classic, and Timeline routes.
- Desktop and mobile viewport checks for the 3D canvas and Book route.
- AI success path when credentials/model are valid.
- AI error path when the provider request fails.
- Local draft persistence after refresh and route changes.

3D-specific checks:

- Canvas is nonblank.
- Nodes are visible and framed.
- Drag/zoom interactions work.
- Detail panel does not overlap unreadably.
- Mobile layout remains usable.

## First Slice Completion Criteria

The first slice is complete when:

- Users can upload PDF, DOCX, or TXT, or paste text, and create a structured draft.
- Users can generate a simulated draft with AI.
- Users can use AI chat to update the active draft.
- Users can save, rename, switch, and delete multiple local drafts.
- Agent, 3D, Book, Classic, and Timeline routes all read the active draft.
- The sample resume remains as fallback when no draft exists.
- AI errors are visible and understandable.
- i18n and theme controls cover new UI.
- Verification commands pass.
- Browser QA confirms the core pages work on desktop and mobile.
