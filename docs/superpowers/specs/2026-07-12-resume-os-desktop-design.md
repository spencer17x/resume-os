# Resume OS Desktop Experience Design

## Goal

Transform Resume OS into a browser-based desktop operating environment for resume creation, optimization, and presentation.

The desktop experience must preserve the existing product direction:

- Users create structured resume drafts by uploading files, pasting text, generating simulated data, or talking with AI.
- The Resume Agent diagnoses and improves a resume without silently overwriting user content.
- Multiple applications render the same active resume through different frontend experiences, including Agent, Three.js 3D, Book, Classic, Projects, Timeline, and Terminal.
- Desktop users interact with a complete multi-window environment inspired by macOS interaction patterns.
- Mobile users receive an iOS-inspired home screen and full-screen applications.

This design extends the existing Resume Studio design rather than replacing its resume model, local draft storage, AI provider configuration, or route set.

## Confirmed Direction

- Desktop model: a complete in-browser window manager with multiple simultaneous windows.
- Window capability: drag, eight-direction resize, minimize, maximize, restore, close, focus, and z-index ordering.
- Mobile model: iOS-inspired home screen with full-screen applications; no floating windows on narrow screens.
- Visual identity: an original Resume OS system language that borrows familiar desktop interaction grammar without copying Apple assets or branding.
- Startup: animate into the desktop and automatically open Resume Studio on the first visit or when no restorable application window exists.
- Motion: product-level motion for daily interactions plus stronger showcase motion for first launch, 3D, Book, and Timeline.
- Implementation route: `react-rnd` for window geometry, Motion for animation, and a React reducer/context for desktop state.
- Persistence: resume drafts and desktop layout remain separate browser-local stores.

## Non-Goals

- Reproducing macOS or iOS pixel-for-pixel.
- Using Apple logos, proprietary icons, system wallpapers, or copyrighted interface assets.
- Running arbitrary third-party applications inside the desktop.
- Supporting multiple independent windows for the same application in the first version.
- Providing floating, draggable windows on mobile.
- Adding user accounts, cloud synchronization, or database persistence in this slice.
- Replacing the existing OpenAI-compatible server API abstraction.

## Product Architecture

Resume OS has three product layers:

1. A responsive system shell.
2. A registry of resume applications.
3. Shared resume, desktop, and AI services.

### System Shell

`DesktopShell` is the client boundary inside the locale layout. It owns the desktop presentation and renders these units:

- `MenuBar`: current application name, application commands, locale, theme, motion preference, and clock.
- `DesktopSurface`: wallpaper, desktop icons, selection state, and desktop-level pointer behavior.
- `WindowManager`: application windows, geometry, focus order, minimization, maximization, and close behavior.
- `Dock`: pinned applications, running state, launch, focus, and restore actions.
- `MobileHome`: iOS-inspired application grid and dock for narrow screens.
- `MobileAppFrame`: full-screen mobile application container with Back and Home navigation.

The desktop and mobile shells consume the same application registry and application components. Viewports at or below 767 pixels use the mobile shell; wider viewports use the desktop shell. Resume and application state do not fork when the presentation changes.

### Application Registry

An `AppRegistry` is the single source of truth for application metadata. Each entry contains:

- Stable application ID.
- Localized name and accessible description.
- Route path.
- Icon component and color token.
- Default desktop window size and minimum size.
- Dock pinning and desktop icon placement.
- Dynamically imported application component.
- Supported menu commands.

The first registry includes:

- Resume Studio
- Resume Agent
- JD Match
- Resume 3D
- Resume Book
- Classic Resume
- Projects
- Timeline
- Terminal
- Settings

Each application has one main window. Application-specific subviews, such as project details or resume versions, use tabs, sidebars, or internal navigation within that window.

Three.js and other heavy application code must be loaded only when its application is opened. The initial desktop bundle must not eagerly include the 3D scene.

## Route Semantics

All existing locale routes remain addressable and share the same desktop runtime.

- `/[locale]` represents the desktop and ensures Resume Studio is available on first launch or when no window can be restored.
- `/[locale]/studio` opens and focuses Resume Studio. On mobile, this route distinguishes the full-screen Studio application from the root home screen.
- `/[locale]/agent` opens and focuses the Agent window.
- `/[locale]/jd-match` opens and focuses JD Match.
- `/[locale]/3d` opens and focuses Resume 3D.
- `/[locale]/book` opens and focuses Resume Book.
- `/[locale]/settings` opens and focuses Settings.
- Existing Classic, Projects, Timeline, and Terminal paths open their corresponding applications.

Each route page becomes a thin desktop entry descriptor. The locale layout renders `DesktopShell`, while the route descriptor tells the desktop runtime which application must be open and focused. Window content is loaded from `AppRegistry`, not duplicated inside route pages.

Opening an application from a desktop icon or Dock pushes its route. Focusing an already open window updates the active route without adding noisy history entries. Loading a deep link directly restores any saved desktop session, then opens and focuses the requested application even if it was not part of the saved session. Closing the focused application updates the route to the next focused window or the desktop root.

Browser Back and Forward must update application focus and open a missing target application when required.

## Desktop State

The desktop reducer owns:

```ts
type DesktopWindowState = {
  appId: AppId
  status: 'open' | 'minimized' | 'maximized'
  position: { x: number; y: number }
  size: { width: number; height: number }
  restoreGeometry?: {
    position: { x: number; y: number }
    size: { width: number; height: number }
  }
  zIndex: number
}

type DesktopState = {
  windows: Record<AppId, DesktopWindowState>
  focusedAppId: AppId | null
  nextZIndex: number
  hasCompletedIntro: boolean
}
```

Reducer actions cover open, focus, move, resize, minimize, maximize, restore, close, viewport correction, session restore, and reset layout.

Desktop state persists separately from resume data. Persistence stores open applications, window geometry, minimized/maximized state, and intro completion. On viewport changes, restored geometry is clamped so that a usable portion of every title bar remains visible. Invalid or outdated persisted data resets to registry defaults.

## Window Interaction Rules

- Every application is a singleton in the first version.
- A desktop icon is selected with one click and opened with a double click. Keyboard focus plus Enter also opens it.
- A Dock icon opens a closed application, restores a minimized application, or focuses an open application.
- Clicking a window or its Dock icon brings it to the front.
- The red control closes the window without deleting resume drafts or stored application data.
- The yellow control minimizes the window into the Dock.
- The green control toggles maximized and restored geometry.
- The title bar is the drag handle. Interactive title-bar controls do not initiate dragging.
- Window edges and corners support eight-direction resizing.
- Minimum sizes come from the application registry.
- A title bar cannot be dragged fully outside the usable desktop area.
- Maximized windows occupy the area between the menu bar and Dock.
- Desktop layout can be reset from Settings or a menu command.

The implementation must avoid drag conflicts with text selection, form controls, editors, scrollable content, and the Three.js canvas.

## Startup And Session Restore

On a first visit:

1. The wallpaper and menu bar appear.
2. Desktop icons and Dock settle into place.
3. Resume Studio opens from its Dock or desktop origin with a spring transition.

On later visits, Resume OS restores the valid saved window session. If no application window is open, the root route opens Resume Studio. A direct application route always opens and focuses its target after restoration.

The introduction is brief and interruptible. It must not block keyboard interaction or delay access to Studio beyond the animation interval.

## Mobile Experience

Narrow screens use an iOS-inspired layout with Resume OS branding:

- A status area, application grid, and compact Dock replace the desktop window manager.
- The mobile root route shows the application grid. Tapping Resume Studio opens `/[locale]/studio`; the Home control returns to `/[locale]`.
- A single tap opens an application full-screen.
- Applications share the same registry, resume provider, translations, API calls, and internal content as desktop windows.
- Back returns to the previous internal view or application history.
- Home returns to the mobile application grid.
- Mobile layouts use touch-sized controls and account for safe-area insets.
- Window dragging, resizing, stacking, traffic lights, and desktop icon double-click behavior are disabled.

The mobile visual language is original Resume OS styling. It must not include Apple logos, copyrighted wallpapers, or copied application icons.

## Visual System

Resume OS uses a neutral system foundation with multiple accent families instead of a one-color interface.

- Structural colors: graphite, mist, white, and deep neutral surfaces.
- Primary accent: teal for active system state and successful AI connectivity.
- Secondary accent: warm coral for creative and showcase actions.
- Supporting accent: muted gold for timeline and evidence highlights.
- Error colors remain distinct and accessible.

Desktop materials use restrained translucency and blur. Content-heavy applications remain opaque enough for sustained reading. Window corners remain compact, and controls use familiar icons with tooltips and accessible labels.

A custom raster wallpaper provides the first-viewport visual asset. It should feel like layered glass or folded light, use the Resume OS palette, work in light and dark variants, and avoid decorative orb or bokeh motifs. Application icons use a consistent custom tile system with Lucide symbols where available.

Theme and locale controls remain global. The menu bar exposes light, dark, and system theme modes plus Chinese/English switching. Application content continues to use translation namespaces.

## Motion System

Motion has two layers.

### Product Motion

Used across daily desktop operations:

- Window open and restore: spring scale and opacity from the launching icon origin.
- Window focus: restrained elevation and border transition without disruptive scaling.
- Window minimize: directional transform toward the Dock.
- Dock hover: bounded magnification that does not reflow surrounding layout.
- Icon launch: short press and rebound feedback.
- Menu and popover transitions: brief opacity and vertical movement.

Most product transitions complete in approximately 180 to 320 milliseconds. Dragging and resizing follow the pointer directly rather than using delayed animation.

### Showcase Motion

Used only where motion communicates the resume story:

- First desktop launch uses layered depth and a short Studio reveal.
- Resume 3D uses camera movement, depth, and interactive orbit controls.
- Resume Book uses physically coherent CSS 3D page turns.
- Timeline uses progressive section reveals tied to scrolling.
- Project navigation may use shared-element transitions inside the Projects application.

Showcase effects must pause or reduce when their window is minimized, hidden, or outside the active mobile view.

### Reduced Motion

The system respects `prefers-reduced-motion` and exposes a matching Resume OS setting. Reduced mode removes parallax, large transforms, Dock magnification, and cinematic camera transitions. Short opacity changes may remain. All content and controls remain available.

## Resume Data Flow

All applications consume normalized `ResumeData` from the active resume draft.

```text
Upload / paste / AI generation / Agent chat
                    ↓
            Server parsing or AI API
                    ↓
        Zod validation and normalization
                    ↓
       Resume draft and version snapshot store
                    ↓
       Shared active-resume provider
                    ↓
 Studio / Agent / JD Match / 3D / Book / other views
```

The resume store remains independent from desktop layout state. Closing a window never deletes a draft. Changing the active draft updates all open presentation applications through the shared provider.

## Agent Modification Contract

The Resume Agent must not write free-form model output directly into the active resume.

Optimization requests return a structured change set containing:

- Target field or stable item identifier.
- Original value.
- Proposed value.
- Reason for the change.
- Optional evidence or missing-information warning.

The Agent application displays a before/after comparison. Users can accept all changes, accept individual changes, or discard the proposal. Applying any change first creates a version snapshot, then updates and normalizes the draft.

When the model lacks evidence for a quantified achievement, it must ask for information or mark a placeholder as requiring confirmation. It must not invent metrics and silently place them into the resume.

AI credentials stay server-side. The existing `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL` variables remain the provider contract for OpenAI-compatible custom endpoints.

## Error Handling

- File extraction errors preserve the selected file metadata and any pasted text so the user can retry.
- AI errors show provider, model, request status, and an actionable message without exposing secrets.
- A failed AI response never replaces the active draft.
- Invalid structured AI output is rejected by the schema and can be retried from the original request.
- Each application window has an error boundary. A failed application displays a local recovery action without crashing the desktop.
- Resume 3D provides a structured two-dimensional fallback when WebGL is unavailable or the scene fails.
- Invalid persisted desktop layout resets safely to registry defaults.
- Route failures leave the system shell and Dock usable.

## Accessibility

- Desktop icons, Dock items, traffic-light controls, menu commands, and mobile navigation have accessible names.
- Keyboard users can focus and open icons, move through Dock applications, operate window controls, and reach application content.
- Visible focus indicators work in light and dark themes.
- Color is not the only indication of running, focused, selected, success, or error state.
- Touch targets meet a minimum usable size on mobile.
- Text remains selectable inside application windows.
- Motion reduction is respected across CSS, Motion, Three.js, and Book transitions.

## Testing Strategy

### Unit Tests

Vitest covers:

- Window reducer transitions and z-index ordering.
- Geometry clamping and viewport correction.
- Minimize, maximize, restore, close, and reset behavior.
- Desktop persistence validation and migration fallback.
- Application registry and route mapping.
- Resume normalization and draft operations.
- Agent change-set validation and application.

### Component Tests

Component tests cover:

- Traffic-light controls.
- Dock running, focused, and minimized states.
- Keyboard operation for desktop icons and window controls.
- Resume Studio default startup.
- Agent before/after preview and selective acceptance.
- Application-local error recovery.
- Reduced-motion rendering branches.

### Browser Tests

Playwright covers:

- First desktop launch and automatic Studio opening.
- Opening at least three applications simultaneously.
- Drag, resize, focus, minimize, maximize, restore, and close workflows.
- Layout persistence after reload.
- Deep-link loading and browser Back/Forward synchronization.
- Chinese/English and light/dark/system theme switching.
- Mobile home, full-screen application launch, Back, and Home behavior.
- Upload/paste, simulated generation, Agent proposal, and cross-application draft updates.

Target viewports:

- 1440 x 900 desktop.
- 1280 x 800 desktop.
- 390 x 844 mobile.
- 375 x 667 compact mobile.

### Visual And 3D Verification

Capture screenshots for the desktop, Studio, Agent, Resume 3D, Resume Book, and mobile home. Inspect them for overlap, clipping, unreadable text, broken blur, and incorrect stacking.

Resume 3D verification must include a Canvas pixel check that proves the scene is nonblank, correctly framed, and rendered after interaction. Book verification must capture at least two page states.

### AI Service Smoke Test

With the configured local environment, verify upload parsing, simulated resume generation, Agent requests, JD Match, and the existing connectivity test. The smoke test must also exercise an invalid model or endpoint response and confirm that user input and active draft data remain intact.

## Acceptance Criteria

The design is implemented when all of the following are true:

- The root route presents the Resume OS desktop and opens Resume Studio under the startup rules.
- At least three application windows can be opened and manipulated concurrently on desktop.
- Window layout and resume drafts survive reload independently.
- All existing application routes deep-link into the correct focused window.
- Mobile uses an iOS-inspired home screen and full-screen applications without desktop window controls.
- Upload, paste, and AI generation create normalized resume drafts.
- Agent optimization changes are previewed and explicitly accepted before writing.
- Open presentation applications update when the active resume changes.
- Resume 3D and Resume Book render structured resume data through frontend technology rather than PDF or image snapshots.
- Theme, locale, keyboard navigation, and reduced-motion behavior work across the shell and applications.
- Application and AI failures remain local, recoverable, and non-destructive.
- No severe text overflow, incoherent overlap, blank 3D Canvas, or console error appears in target viewports.
- The project uses pnpm 10.33.0 and passes `test`, `lint`, `typecheck`, and `build`.

## Implementation Boundaries

Implementation should proceed in focused slices:

1. Desktop state, application registry, and tested window reducer.
2. Desktop shell, window interactions, Dock, menu bar, persistence, and route synchronization.
3. Mobile home and full-screen application frame.
4. Resume Studio and shared resume provider integration.
5. Agent change-set workflow and application migration.
6. Resume 3D, Book, and showcase motion.
7. Accessibility, error recovery, browser testing, visual verification, and AI smoke testing.

Existing unrelated changes must remain untouched. Each slice should preserve working routes and keep dynamically loaded application code outside the initial desktop bundle where practical.
