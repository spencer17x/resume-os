import { expect, test, type Locator, type Page } from '@playwright/test'
import { getSampleResumeData } from '../../lib/resume-sample'
import { expectNoDevelopmentOverlay, expectReadableScreenshot } from './support/screenshot-evidence'
import { waitForAppSurfaceToSettle, waitForFiniteMotionToSettle } from './support/stable-motion'

async function seedSampleResume(page: Page) {
  const data = getSampleResumeData('en')
  const updatedAt = data.metadata.updatedAt
  const draft = {
    id: 'showcase-sample',
    name: 'Demo Candidate',
    source: 'sample',
    createdAt: updatedAt,
    updatedAt,
    data,
    snapshots: []
  }
  await page.addInitScript(({ draft }) => {
    localStorage.setItem('resume-os-drafts-v1', JSON.stringify({
      version: 1,
      state: { activeDraftId: draft.id, drafts: [draft] }
    }))
  }, { draft })
}

async function canvasPixelMetrics(page: Page, canvas: Locator) {
  const bounds = await page.evaluate(() => {
    const source = document.querySelector<HTMLCanvasElement>('.resume-3d__viewport canvas')
    if (!source) return null
    const rect = source.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })
  if (!bounds) return { width: 0, height: 0, visible: 0, variedColors: 0 }
  let image: Buffer
  try {
    image = await page.screenshot({ clip: bounds, animations: 'disabled' })
  } catch {
    return { width: 0, height: 0, visible: 0, variedColors: 0 }
  }
  return page.evaluate(async (base64) => {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob()
    const bitmap = await createImageBitmap(blob)
    const width = bitmap.width
    const height = bitmap.height
    const probe = document.createElement('canvas')
    probe.width = width
    probe.height = height
    const context = probe.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('2D canvas unavailable for pixel probe')
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const pixels = context.getImageData(0, 0, width, height).data
    const colors = new Set<string>()
    let visible = 0
    for (let y = 0; y < height; y += 12) {
      for (let x = 0; x < width; x += 12) {
        const offset = (y * width + x) * 4
        const alpha = pixels[offset + 3]
        const light = pixels[offset] + pixels[offset + 1] + pixels[offset + 2]
        if (alpha > 0 && light > 8) visible += 1
        colors.add(`${pixels[offset] >> 4}:${pixels[offset + 1] >> 4}:${pixels[offset + 2] >> 4}`)
      }
    }
    return { width, height, visible, variedColors: colors.size }
  }, image.toString('base64'))
}

async function waitForRenderedCanvas(page: Page) {
  const canvas = page.locator('.resume-3d__viewport canvas')
  await expect(canvas).toBeVisible({ timeout: 15_000 })
  await expect.poll(
    async () => Number(await canvas.getAttribute('data-frame-count') ?? '0'),
    { timeout: 15_000 }
  ).toBeGreaterThan(0)
  await expect.poll(
    async () => Number(await canvas.getAttribute('data-draw-calls') ?? '0'),
    { timeout: 15_000 }
  ).toBeGreaterThan(0)
  return canvas
}

async function frameCount(canvas: Locator) {
  return Number(await canvas.getAttribute('data-frame-count') ?? '0')
}

async function frameDelta(page: Page, canvas: Locator, duration = 400) {
  const before = await frameCount(canvas)
  await page.waitForTimeout(duration)
  return (await frameCount(canvas)) - before
}

async function expectFrameAdvance(canvas: Locator, minimumFrames: number, timeout = 2_000) {
  const before = await frameCount(canvas)
  await expect.poll(
    async () => (await frameCount(canvas)) - before,
    { timeout }
  ).toBeGreaterThanOrEqual(minimumFrames)
}

async function expectFramePause(page: Page, canvas: Locator, observationWindow = 300) {
  await expect.poll(
    () => frameDelta(page, canvas, observationWindow),
    { timeout: 2_000 }
  ).toBe(0)
}

async function seedDenseResume(page: Page, count = 12) {
  const now = '2026-07-13T00:00:00.000Z'
  const data = {
    profile: { name: 'Dense Candidate', title: 'Systems Engineer', summary: ['Dense resume layout test.'], tags: ['Dense'], links: [] },
    targetRole: 'AI Platform Engineer',
    skills: Array.from({ length: count }, (_, index) => ({ group: `Skill group ${index + 1}`, items: [`Skill ${index + 1}`, `Tool ${index + 1}`] })),
    experiences: Array.from({ length: count }, (_, index) => ({
      company: `Company ${index + 1}`, role: `Role ${index + 1}`, period: `20${10 + index} - 20${11 + index}`,
      location: 'Remote', tags: [`Experience ${index + 1}`], bullets: [`Delivered system ${index + 1}.`]
    })),
    projects: Array.from({ length: count }, (_, index) => ({
      id: `project-${index + 1}`, name: `Project ${index + 1}`, type: 'Platform', tags: [`Stack ${index + 1}`],
      summary: `Project summary ${index + 1}.`, highlights: [`Project result ${index + 1}.`]
    })),
    education: [], certifications: [], awards: [], languages: ['English'], openSource: [],
    metadata: { source: 'paste', locale: 'en', updatedAt: now }
  }
  const draft = { id: 'dense-draft', name: 'Dense Resume', source: 'paste', createdAt: now, updatedAt: now, data, snapshots: [] }
  await page.addInitScript(({ draft }) => {
    localStorage.setItem('resume-os-motion', 'reduced')
    localStorage.setItem('resume-os-drafts-v1', JSON.stringify({
      version: 1,
      state: { activeDraftId: draft.id, drafts: [draft] }
    }))
  }, { draft })
}

async function seedLongResume(page: Page) {
  const token = `TOKEN_${'x'.repeat(314)}`
  const now = '2026-07-13T00:00:00.000Z'
  const data = {
    profile: {
      name: token,
      title: token,
      summary: [token],
      email: `${token}@example.com`,
      phone: token,
      location: token,
      tags: [token],
      links: []
    },
    targetRole: token,
    skills: Array.from({ length: 5 }, () => ({ group: token, items: [token] })),
    experiences: Array.from({ length: 5 }, () => ({
      company: token, role: token, period: token, location: token, tags: [token], bullets: [token]
    })),
    projects: Array.from({ length: 5 }, () => ({
      id: 'duplicate-project', name: token, type: token, tags: [token], summary: token, highlights: [token]
    })),
    education: [], certifications: [], awards: [], languages: [token], openSource: [],
    metadata: { source: 'paste', locale: 'en', updatedAt: now }
  }
  const draft = { id: 'long-draft', name: token, source: 'paste', createdAt: now, updatedAt: now, data, snapshots: [] }
  await page.addInitScript(({ draft }) => {
    localStorage.setItem('resume-os-motion', 'reduced')
    localStorage.setItem('resume-os-drafts-v1', JSON.stringify({
      version: 1,
      state: { activeDraftId: draft.id, drafts: [draft] }
    }))
  }, { draft })
  return token
}

async function inspectSceneLabels(page: Page) {
  return page.locator('.resume-3d__viewport').evaluate((viewport) => {
    const frame = viewport.getBoundingClientRect()
    const rects = [...viewport.querySelectorAll<HTMLElement>('.resume-3d-node-label')].map((label) => label.getBoundingClientRect())
    const overlaps = rects.some((left, leftIndex) => rects.some((right, rightIndex) => (
      rightIndex > leftIndex
      && left.left < right.right && left.right > right.left
      && left.top < right.bottom && left.bottom > right.top
    )))
    return {
      count: rects.length,
      inFrame: rects.every((rect) => rect.left >= frame.left && rect.right <= frame.right && rect.top >= frame.top && rect.bottom <= frame.bottom),
      overlaps
    }
  })
}

async function inspectDesktopSceneRegions(app: Locator) {
  return app.evaluate((element) => {
    const nav = element.querySelector<HTMLElement>('.resume-3d__node-nav')
    const viewport = element.querySelector<HTMLElement>('.resume-3d__viewport')
    const inspector = element.querySelector<HTMLElement>('.resume-3d__inspector')
    if (!nav || !viewport || !inspector) throw new Error('Missing dense scene regions')
    const navRect = nav.getBoundingClientRect()
    const viewportRect = viewport.getBoundingClientRect()
    const inspectorRect = inspector.getBoundingClientRect()
    const overlaps = (left: DOMRect, right: DOMRect) => (
      left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top
    )
    return {
      canvasOverlapsInspector: overlaps(viewportRect, inspectorRect),
      navOverlapsCanvas: overlaps(navRect, viewportRect),
      navOverlapsInspector: overlaps(navRect, inspectorRect),
      viewportRect: { x: viewportRect.x, y: viewportRect.y, width: viewportRect.width, height: viewportRect.height },
      inspectorRect: { x: inspectorRect.x, y: inspectorRect.y, width: inspectorRect.width, height: inspectorRect.height },
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      navOverflowX: getComputedStyle(nav).overflowX
    }
  })
}

test('desktop Resume 3D renders real content, orbits, pauses, and falls back safely', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop 3D coverage')
  test.slow()
  await seedSampleResume(page)
  await page.goto('/en/3d')
  const app = page.getByRole('region', { name: 'Resume 3D' })
  await expect(app).toBeVisible({ timeout: 15_000 })
  const canvas = await waitForRenderedCanvas(page)
  await waitForAppSurfaceToSettle(app)
  await expectNoDevelopmentOverlay(page)
  await page.screenshot({ path: '/tmp/resume-os-task14-3d-desktop-1440x900.png', fullPage: true })

  const metrics = await canvasPixelMetrics(page, canvas)
  expect(metrics.width).toBeGreaterThan(700)
  expect(metrics.height).toBeGreaterThan(450)
  expect(metrics.visible).toBeGreaterThan(500)
  expect(metrics.variedColors).toBeGreaterThan(8)
  expect(Number(await canvas.getAttribute('data-draw-calls'))).toBeGreaterThan(0)

  const labels = app.locator('.resume-3d-node-label')
  await expect(labels.first()).toBeVisible()
  await expect(app.getByRole('navigation', { name: 'Resume scene nodes' })).toHaveCount(0)
  expect(await app.locator('button').count()).toBe(await labels.count())
  expect(await labels.evaluateAll((items) => items.every((item) => item.tagName === 'BUTTON' && (item as HTMLElement).tabIndex === 0))).toBe(true)
  const secondLabel = labels.nth(1)
  const secondName = await secondLabel.getAttribute('aria-label')
  await secondLabel.click({ force: true })
  await expect(app.locator('.resume-3d__inspector h2')).toHaveText(secondName ?? '')

  await expect(canvas).toHaveAttribute('data-frame-loop', 'always')
  await expectFrameAdvance(canvas, 3)
  const beforeOrbit = await frameCount(canvas)
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Canvas has no bounds')
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.52, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(180)
  await expect.poll(async () => frameCount(canvas)).toBeGreaterThan(beforeOrbit)

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(app).toHaveAttribute('data-render-active', 'false')
  await expect(canvas).toHaveAttribute('data-frame-loop', 'never')
  await expectFramePause(page, canvas)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(app).toHaveAttribute('data-render-active', 'true')

  await canvas.dispatchEvent('webglcontextlost')
  const fallback = app.locator('.resume-3d__fallback')
  await expect(fallback).toBeVisible()
  await expect(fallback.getByRole('heading', { name: 'Experience' })).toBeVisible()
  await expect(fallback.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(fallback.getByRole('heading', { name: 'Skills' })).toBeVisible()
  await fallback.getByRole('button', { name: 'Retry 3D' }).click()
  await waitForRenderedCanvas(page)
})

test('Resume 3D disables automatic movement in reduced motion', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop reduced-motion coverage')
  await seedSampleResume(page)
  await page.addInitScript(() => localStorage.setItem('resume-os-motion', 'reduced'))
  await page.goto('/en/3d')
  const canvas = await waitForRenderedCanvas(page)
  await expect(page.locator('.resume-3d__canvas')).toHaveAttribute('data-auto-rotate', 'false')
  await expect(canvas).toHaveAttribute('data-frame-loop', 'demand')
  expect(await frameDelta(page, canvas, 500)).toBeLessThanOrEqual(1)
  const labels = page.locator('.resume-3d-node-label')
  const beforeSelection = await frameCount(canvas)
  await labels.nth(1).click({ force: true })
  await expect.poll(async () => frameCount(canvas)).toBeGreaterThan(beforeSelection)
})

test('Resume 3D uses structured fallback when WebGL initialization is unavailable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop WebGL fallback coverage')
  await seedSampleResume(page)
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId, options) {
      if (contextId === 'webgl' || contextId === 'webgl2' || contextId === 'experimental-webgl') return null
      return original.call(this, contextId, options)
    } as typeof HTMLCanvasElement.prototype.getContext
  })
  await page.goto('/en/3d')
  const fallback = page.getByRole('group', { name: 'Structured resume view' })
  await expect(fallback).toBeVisible()
  await expect(fallback.getByRole('heading', { name: 'Experience' })).toBeVisible()
  await expect(fallback.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(fallback.getByRole('heading', { name: 'Skills' })).toBeVisible()
  await expect(page.locator('.resume-3d__viewport canvas')).toHaveCount(0)
})

test('dense Resume 3D frames twelve nodes per category without DOM label collisions', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-compact', 'Desktop and 390x844 dense coverage')
  await seedDenseResume(page, 12)
  await page.goto('/en/3d')
  const app = page.getByRole('region', { name: 'Resume 3D' })
  const canvas = await waitForRenderedCanvas(page)
  await expect(app.getByRole('heading', { name: 'Dense Candidate' })).toBeVisible()
  await expect(app.locator('.resume-3d-node-label')).toHaveCount(36)

  const layout = await inspectSceneLabels(page)
  expect(layout).toEqual({ count: 36, inFrame: true, overlaps: false })
  const metrics = await canvasPixelMetrics(page, canvas)
  expect(metrics.visible).toBeGreaterThan(500)
  expect(metrics.variedColors).toBeGreaterThan(8)

  const navigator = app.getByRole('navigation', { name: 'Resume scene nodes' })
  await expect(navigator).toBeVisible()
  const controls = navigator.getByRole('button')
  await expect(controls).toHaveCount(36)
  await expect(app.locator('button')).toHaveCount(36)
  const canvasLabels = app.locator('.resume-3d-node-label')
  await expect(canvasLabels).toHaveCount(36)
  expect(await canvasLabels.evaluateAll((labels) => labels.every((label) => (
    label.tagName === 'DIV' && label.getAttribute('aria-hidden') === 'true' && (label as HTMLElement).tabIndex === -1
  )))).toBe(true)
  const readability = await controls.evaluateAll((buttons) => buttons.map((button) => {
    const category = button.querySelector<HTMLElement>('span')
    const label = button.querySelector<HTMLElement>('strong')
    return {
      category: category?.textContent?.trim() ?? '',
      label: label?.textContent?.trim() ?? '',
      categoryFontSize: category ? Number.parseFloat(getComputedStyle(category).fontSize) : 0,
      labelFontSize: label ? Number.parseFloat(getComputedStyle(label).fontSize) : 0,
      tabIndex: (button as HTMLButtonElement).tabIndex
    }
  }))
  expect(readability.every((item) => item.category.length > 0 && item.label.length > 0)).toBe(true)
  expect(readability.every((item) => item.categoryFontSize >= 12 && item.labelFontSize >= 12)).toBe(true)
  expect(readability.every((item) => item.tabIndex === 0)).toBe(true)

  const regions = await inspectDesktopSceneRegions(app)
  expect(regions).toMatchObject({
    canvasOverlapsInspector: false,
    navOverlapsCanvas: false,
    navOverlapsInspector: false
  })
  expect(regions.pageWidth).toBeLessThanOrEqual(regions.viewportWidth)
  expect(regions.navOverflowX).toBe('auto')

  if (testInfo.project.name === 'desktop') {
    const beforeResize = await frameCount(canvas)
    await page.setViewportSize({ width: 1100, height: 760 })
    await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(500)
    await expect.poll(async () => frameCount(canvas)).toBeGreaterThan(beforeResize)
    const resizedRegions = await inspectDesktopSceneRegions(app)
    expect(resizedRegions.canvasOverlapsInspector).toBe(false)
    expect(resizedRegions.navOverlapsCanvas).toBe(false)
    expect(resizedRegions.navOverlapsInspector).toBe(false)
    expect(resizedRegions.pageWidth).toBeLessThanOrEqual(resizedRegions.viewportWidth)
  }

  for (const index of [0, 17, 35]) {
    const control = controls.nth(index)
    const name = await control.locator('strong').textContent()
    if (index === 0) {
      await control.focus()
      await expect(control).toBeFocused()
      await page.keyboard.press('Enter')
    } else {
      await control.click()
    }
    await expect(control).toHaveAttribute('aria-pressed', 'true')
    await expect(app.locator('.resume-3d__inspector h2')).toHaveText(name ?? '')
  }
  await page.screenshot({ path: `/tmp/resume-os-task13-dense-${testInfo.project.name}.png`, fullPage: true })
})

test('mobile Resume 3D remains framed, interactive, and nonblank at 390x844', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', '390x844 mobile coverage')
  await seedSampleResume(page)
  await page.goto('/en/3d')
  const frame = page.getByRole('main', { name: 'Resume 3D' })
  await expect(frame).toBeVisible()
  const canvas = await waitForRenderedCanvas(page)
  await waitForAppSurfaceToSettle(frame)
  await expectNoDevelopmentOverlay(page)
  await page.screenshot({ path: '/tmp/resume-os-task14-3d-mobile-390x844.png', fullPage: true })
  const metrics = await canvasPixelMetrics(page, canvas)
  expect(metrics.width).toBeGreaterThan(300)
  expect(metrics.height).toBeGreaterThan(400)
  expect(metrics.variedColors).toBeGreaterThan(8)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await expect(canvas).toHaveAttribute('data-frame-loop', 'demand')
  expect(await frameDelta(page, canvas, 500)).toBeLessThanOrEqual(1)

  const labelLayout = await frame.locator('.resume-3d-node-label').evaluateAll((labels) => {
    const rects = labels.map((label) => label.getBoundingClientRect())
    const overlaps = rects.some((left, leftIndex) => rects.some((right, rightIndex) => (
      rightIndex > leftIndex
      && left.left < right.right && left.right > right.left
      && left.top < right.bottom && left.bottom > right.top
    )))
    return {
      inViewport: rects.every((rect) => rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight),
      overlaps
    }
  })
  expect(labelLayout.inViewport).toBe(true)
  expect(labelLayout.overlaps).toBe(false)

  const label = frame.locator('.resume-3d__node-nav button').nth(1)
  const name = await label.locator('strong').textContent()
  await label.click()
  await expect(frame.locator('.resume-3d__inspector h2')).toHaveText(name ?? '')
  const beforeInteraction = await frameCount(canvas)
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Mobile Canvas has no bounds')
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.45)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.52, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => frameCount(canvas)).toBeGreaterThan(beforeInteraction)
})

test('long unbroken resume text remains contained and reachable in 3D and Book', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Desktop and 375x667 long-content coverage')
  const token = await seedLongResume(page)
  await page.goto('/en/3d')
  const app = page.getByRole('region', { name: 'Resume 3D' })
  const canvas = await waitForRenderedCanvas(page)
  await expect(app.locator('.resume-3d__header h1')).toHaveText(token)
  await expect(app.locator('.resume-3d__inspector')).toContainText(token)
  const navigator = app.getByRole('navigation', { name: 'Resume scene nodes' })
  await expect(navigator.getByRole('button')).toHaveCount(15)
  await expect(navigator).toContainText(token)
  const visualLabels = app.locator('.resume-3d-node-label[aria-hidden="true"]')
  await expect(visualLabels).toHaveCount(15)
  const visualLayout = await visualLabels.evaluateAll((labels) => {
    const viewport = document.querySelector<HTMLElement>('.resume-3d__viewport')?.getBoundingClientRect()
    const header = document.querySelector<HTMLElement>('.resume-3d__header')?.getBoundingClientRect()
    if (!viewport) throw new Error('Missing 3D viewport')
    const rects = labels.map((label) => label.getBoundingClientRect())
    const intersects = (left: DOMRect, right: DOMRect) => (
      left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top
    )
    const overlaps = rects.some((left, leftIndex) => rects.some((right, rightIndex) => (
      rightIndex > leftIndex && intersects(left, right)
    )))
    return {
      inFrame: rects.every((rect) => rect.left >= viewport.left && rect.right <= viewport.right && rect.top >= viewport.top && rect.bottom <= viewport.bottom),
      overlaps,
      overlapsHeader: header ? rects.some((rect) => intersects(rect, header)) : false,
      bounded: rects.every((rect) => rect.width <= 164 && rect.height <= 54),
      short: labels.every((label) => (label.querySelector('strong')?.textContent?.length ?? 0) <= 28)
    }
  })
  expect(visualLayout).toEqual({ inFrame: true, overlaps: false, overlapsHeader: false, bounded: true, short: true })
  const threeDimensions = await app.evaluate((element) => ({
      appOverflow: element.scrollWidth - element.clientWidth,
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      textRegionsFit: [...element.querySelectorAll<HTMLElement>('.resume-3d__header, .resume-3d__node-nav button, .resume-3d__inspector')]
        .filter((region) => getComputedStyle(region).display !== 'none')
        .every((region) => region.scrollWidth <= region.clientWidth + 1)
  }))
  expect(threeDimensions).toEqual({ appOverflow: 0, documentOverflow: 0, textRegionsFit: true })
  await page.screenshot({ path: `/tmp/resume-os-task13-long-3d-${testInfo.project.name}.png`, fullPage: true })

  await canvas.dispatchEvent('webglcontextlost')
  const fallback = app.locator('.resume-3d__fallback')
  await expect(fallback).toContainText(token)
  expect(await fallback.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)

  await page.goto('/en/book')
  const book = page.getByRole('region', { name: 'Resume Book' })
  await expect(book).toBeVisible()
  for (let pageIndex = 0; pageIndex < 6; pageIndex += 1) {
    const current = book.locator('.resume-book__sheet--active')
    await expect(current).toContainText(token)
    const dimensions = await current.evaluate((element) => ({
      sheetOverflow: element.scrollWidth - element.clientWidth,
      faceFits: [...element.querySelectorAll<HTMLElement>('.resume-book__face, .resume-book__page-content')]
        .every((region) => region.scrollWidth <= region.clientWidth + 1),
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth
    }))
    expect(dimensions.sheetOverflow).toBeLessThanOrEqual(1)
    expect(dimensions.faceFits).toBe(true)
    expect(dimensions.documentOverflow).toBeLessThanOrEqual(1)
    if (pageIndex < 5) await book.getByRole('button', { name: 'Next page' }).click()
  }
  await page.screenshot({ path: `/tmp/resume-os-task13-long-${testInfo.project.name}.png`, fullPage: true })
})

test('375x667 reflows the 3D inspector into reachable page flow without overlap', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-compact', '375x667 compact coverage')
  await seedDenseResume(page, 5)
  await page.goto('/en/3d')
  const frame = page.getByRole('main', { name: 'Resume 3D' })
  const app = frame.getByRole('region', { name: 'Resume 3D' })
  const canvas = await waitForRenderedCanvas(page)
  const before = await canvas.boundingBox()
  if (!before) throw new Error('Compact Canvas has no bounds')
  expect(before.width).toBeGreaterThan(340)
  expect(before.height).toBeGreaterThanOrEqual(280)

  const nav = app.getByRole('navigation', { name: 'Resume scene nodes' })
  const lastNode = nav.getByRole('button').last()
  await lastNode.click()
  const inspector = app.locator('.resume-3d__inspector')
  await expect(inspector).toBeAttached()

  const flow = await app.evaluate((element) => {
    const header = element.querySelector<HTMLElement>('.resume-3d__header')
    const nav = element.querySelector<HTMLElement>('.resume-3d__node-nav')
    const viewport = element.querySelector<HTMLElement>('.resume-3d__viewport')
    const inspector = element.querySelector<HTMLElement>('.resume-3d__inspector')
    if (!header || !nav || !viewport || !inspector) throw new Error('Missing compact scene regions')
    const headerRect = header.getBoundingClientRect()
    const navRect = nav.getBoundingClientRect()
    const viewportRect = viewport.getBoundingClientRect()
    const inspectorStyle = getComputedStyle(inspector)
    return {
      minHeight: getComputedStyle(element).minHeight,
      headerBeforeNav: headerRect.bottom <= navRect.top,
      navBeforeCanvas: navRect.bottom <= viewportRect.top,
      inspectorPosition: inspectorStyle.position,
      inspectorOverflowY: inspectorStyle.overflowY,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth
    }
  })
  expect(flow.minHeight).not.toBe('620px')
  expect(flow.headerBeforeNav).toBe(true)
  expect(flow.navBeforeCanvas).toBe(true)
  expect(flow.inspectorPosition).not.toBe('absolute')
  expect(flow.inspectorOverflowY).toBe('visible')
  expect(flow.documentWidth).toBeLessThanOrEqual(flow.viewportWidth)

  await inspector.scrollIntoViewIfNeeded()
  await expect(inspector).toBeVisible()
  const reachability = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('.mobile-app-frame__content')
    const inspector = document.querySelector<HTMLElement>('.resume-3d__inspector')
    if (!content || !inspector) throw new Error('Missing compact scroll regions')
    const contentRect = content.getBoundingClientRect()
    const inspectorRect = inspector.getBoundingClientRect()
    return {
      outerScrollTop: content.scrollTop,
      inspectorFullyVisible: inspectorRect.top >= contentRect.top - 1 && inspectorRect.bottom <= contentRect.bottom + 1,
      inspectorHasNestedScroll: inspector.scrollHeight > inspector.clientHeight,
      bodyScrollTop: document.body.scrollTop,
      documentScrollTop: document.documentElement.scrollTop
    }
  })
  expect(reachability.outerScrollTop).toBeGreaterThan(0)
  expect(reachability.inspectorFullyVisible).toBe(true)
  expect(reachability.inspectorHasNestedScroll).toBe(false)
  expect(reachability.bodyScrollTop).toBe(0)
  expect(reachability.documentScrollTop).toBe(0)

  const after = await canvas.boundingBox()
  expect(after?.width).toBeCloseTo(before.width, 0)
  expect(after?.height).toBeCloseTo(before.height, 0)
  await page.screenshot({ path: '/tmp/resume-os-task13-compact-375x667.png', fullPage: true })
})

test('Resume Book turns pages on desktop and becomes a single-page reader on mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-compact', 'Primary desktop/mobile showcase coverage')
  await page.goto('/en/book')
  const scope = testInfo.project.name === 'desktop'
    ? page.getByRole('application', { name: 'Resume Book' })
    : page.getByRole('main', { name: 'Resume Book' })
  const book = scope.getByRole('region', { name: 'Resume Book' })
  await expect(book).toBeVisible()
  await waitForAppSurfaceToSettle(book)
  await expect(book.getByText('1 / 6')).toBeVisible()
  await expect(book.getByText('Chapter 1 of 6')).toBeVisible()
  await expect(book.locator('[data-page-kind="profile"]')).toHaveAttribute('data-page-state', 'current')
  await expectBookControlsUnobscured(book)
  await expectNoDevelopmentOverlay(page)
  const initialImage = await page.screenshot({ path: `/tmp/resume-os-task14-book-initial-${testInfo.project.name}.png`, fullPage: true })
  await expectReadableScreenshot(page, initialImage)
  await book.getByRole('button', { name: 'Next page' }).click()
  await expect(book.getByText('2 / 6')).toBeVisible()
  await waitForFiniteMotionToSettle(book, { subtree: true })
  await book.getByRole('button', { name: 'Next page' }).click()
  await expect(book.getByText('3 / 6')).toBeVisible()
  await waitForFiniteMotionToSettle(book, { subtree: true })
  await expect(book.getByText('Chapter 3 of 6')).toBeVisible()
  await expect(book.locator('[data-page-kind="profile"]')).toHaveAttribute('data-page-state', 'past')
  await expect(book.locator('[data-page-kind="summary"]')).toHaveAttribute('data-page-state', 'past')
  await expect(book.locator('[data-page-kind="skills"]')).toHaveAttribute('data-page-state', 'current')
  await expectBookControlsUnobscured(book)
  await expectNoDevelopmentOverlay(page)
  const turnedImage = await page.screenshot({ path: `/tmp/resume-os-task14-book-turned-${testInfo.project.name}.png`, fullPage: true })
  await expectReadableScreenshot(page, turnedImage)

  const state = await book.evaluate((element) => {
    const first = element.querySelector<HTMLElement>('[data-page-kind="profile"]')
    const current = element.querySelector<HTMLElement>('[data-page-kind="skills"]')
    if (!first || !current) throw new Error('Missing book pages')
    return {
      width: element.getBoundingClientRect().width,
      firstTransform: getComputedStyle(first).transform,
      currentWidth: current.getBoundingClientRect().width,
      pageCount: element.querySelectorAll('[data-testid="book-page"]').length,
      overflow: element.scrollWidth - element.clientWidth
    }
  })
  expect(state.pageCount).toBe(6)
  expect(state.overflow).toBeLessThanOrEqual(1)
  if (testInfo.project.name === 'desktop') {
    expect(state.firstTransform).not.toBe('none')
    expect(state.currentWidth).toBeLessThan(state.width * 0.6)
  } else {
    expect(state.firstTransform).toBe('none')
    expect(state.currentWidth).toBeGreaterThan(state.width * 0.9)
  }
})

async function expectBookControlsUnobscured(book: Locator) {
  const controls = book.locator('.resume-book__controls')
  await controls.scrollIntoViewIfNeeded()
  await expect(controls).toBeInViewport()
  const buttons = controls.getByRole('button')
  await expect(buttons).toHaveCount(2)
  expect(await buttons.evaluateAll((items) => items.every((item) => {
    const rect = item.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return hit === item || item.contains(hit)
  }))).toBe(true)
}
