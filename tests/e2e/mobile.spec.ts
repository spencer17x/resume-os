import { expect, test, type Page } from '@playwright/test'
import { expectNoDevelopmentOverlay } from './support/screenshot-evidence'
import { waitForFiniteMotionToSettle } from './support/stable-motion'

function isMobileProject(projectName: string) {
  return projectName === 'mobile' || projectName === 'mobile-compact'
}

async function waitForMobileHomeReady(page: Page) {
  await expect(page.locator('.mobile-status-area__time')).not.toHaveText('--:--')
}

async function loadAnonymousSample(page: Page) {
  await page.goto('/en/studio')
  await page.getByRole('tab', { name: 'Demo / Sandbox' }).click()
  await page.getByRole('button', { name: 'Load anonymous sample' }).click()
  await expect(page.getByRole('heading', { name: 'Demo Candidate' })).toBeVisible()
}

test('loads the localized product', async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo.project.name), 'Mobile-only localized shell coverage')
  const mobile = isMobileProject(testInfo.project.name)
  const response = await page.goto('/zh')

  expect(response?.ok()).toBe(true)
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh')
  await expect(page).toHaveTitle(/Resume/i)
  await expect(page.getByRole('main', {
    name: mobile ? 'Resume OS' : 'Resume OS 桌面'
  })).toBeVisible()
  if (mobile) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0)
    await expect(page.locator('.desktop-window__controls')).toHaveCount(0)
  }
})

test('mobile shell has no horizontal overflow or desktop traffic controls', async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo.project.name), 'Mobile-only viewport coverage')

  await page.goto('/zh')
  await expect(page.getByRole('main', { name: 'Resume OS' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0)
  await expect(page.locator('.desktop-window__controls')).toHaveCount(0)
})

test('mobile cinematic shell preserves the 390x844 story contract without overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Exact 390x844 cinematic acceptance coverage')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/en')

  const home = page.getByTestId('mobile-home')
  const ambient = page.getByTestId('desktop-ambient')
  const hud = page.getByTestId('workflow-overview-mobile')
  const phases = ambient.locator('[data-agent-phase]')

  await expect(home).toBeVisible()
  await expect(hud).toBeVisible()
  await expect(ambient).toHaveAttribute('data-cinematic-cycle', '14000')
  await expect(ambient).toHaveAttribute('data-story-duration', '14000')
  await expect(ambient).toHaveAttribute('data-story-mode', 'sequence')
  await expect(ambient.locator('[data-agent-core]')).toHaveCount(1)
  await expect(ambient.locator('[data-agent-node]')).toHaveCount(6)
  await expect(ambient.locator('[data-story-output="resume-variant"]')).toHaveCount(1)
  await expect(ambient.locator('[data-story-status]')).toHaveCount(7)
  await expect(ambient.locator('video, canvas, img')).toHaveCount(0)
  await expect(page.locator('video, canvas, img')).toHaveCount(0)
  await expect(phases).toHaveCount(4)
  expect(await phases.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-agent-phase'))
  )).toEqual(['retrieve', 'rank', 'synthesize', 'verify'])

  await expect.poll(() => page.evaluate(() => {
    const home = document.querySelector<HTMLElement>('[data-testid="mobile-home"]')
    const ambient = document.querySelector<HTMLElement>('[data-testid="desktop-ambient"]')
    const core = ambient?.querySelector<HTMLElement>('[data-agent-core]')
    const rail = ambient?.querySelector<HTMLElement>('[data-agent-phase-rail]')
    const hud = document.querySelector<HTMLElement>('[data-testid="workflow-overview-mobile"]')
    const dock = document.querySelector<HTMLElement>('.mobile-home__dock')
    const hudAction = hud?.querySelector<HTMLElement>('button')
    if (!home || !ambient || !core || !rail || !hud || !dock || !hudAction) {
      throw new Error('Missing mobile cinematic layout target')
    }
    const ambientRect = ambient.getBoundingClientRect()
    const coreRect = core.getBoundingClientRect()
    const railRect = rail.getBoundingClientRect()
    const hudRect = hud.getBoundingClientRect()
    const hudActionRect = hudAction.getBoundingClientRect()
    const dockRect = dock.getBoundingClientRect()
    const overlaps = (first: DOMRect, second: DOMRect) => !(
      first.right <= second.left
      || first.left >= second.right
      || first.bottom <= second.top
      || first.top >= second.bottom
    )
    const horizontallyContained = (rect: DOMRect) => rect.left >= -1 && rect.right <= window.innerWidth + 1

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      homeMeasurable: home.getBoundingClientRect().height > 0,
      ambientContained: horizontallyContained(ambientRect),
      coreContained: horizontallyContained(coreRect),
      railContained: horizontallyContained(railRect),
      hudContained: horizontallyContained(hudRect),
      hudActionTouchTarget: hudActionRect.width >= 44 && hudActionRect.height >= 44,
      dockContained: horizontallyContained(dockRect),
      coreOverlapsHud: overlaps(coreRect, hudRect)
    }
  })).toEqual({
    viewport: { width: 390, height: 844 },
    noHorizontalOverflow: true,
    homeMeasurable: true,
    ambientContained: true,
    coreContained: true,
    railContained: true,
    hudContained: true,
    hudActionTouchTarget: true,
    dockContained: true,
    coreOverlapsHud: false
  })
})

test('mobile Back from a direct app entry stays in the locale shell', async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo.project.name), 'Mobile-only navigation coverage')

  await page.goto('/en/agent')
  await expect(page.getByRole('main', { name: 'Resume Agent' })).toBeVisible()
  await page.getByRole('button', { name: 'Back' }).click()

  await expect(page).toHaveURL(/\/en$/)
  await expect(page.getByRole('main', { name: 'Resume OS' })).toBeVisible()
})

test('mobile Back returns from an internally opened app to Home', async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo.project.name), 'Mobile-only navigation coverage')

  await page.goto('/en')
  await waitForMobileHomeReady(page)
  await page.locator('.mobile-home__app').filter({ hasText: 'Resume Agent' }).click()
  await expect(page).toHaveURL(/\/en\/agent$/)
  await page.getByRole('button', { name: 'Back' }).click()

  await expect(page).toHaveURL(/\/en$/)
  await expect(page.getByRole('main', { name: 'Resume OS' })).toBeVisible()
})

test('mobile Home exits a nested app and restores only the iOS app grid', async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo.project.name), 'Mobile-only Home coverage')

  await loadAnonymousSample(page)
  await page.goto('/en/projects')
  const frame = page.getByRole('main', { name: 'Projects' })
  await frame.getByRole('button', { name: 'Open Evidence RAG Lab' }).click()
  await expect(page).toHaveURL(/\/en\/projects\/evidence-rag-lab$/)
  await expect(frame.getByRole('heading', { name: 'Evidence RAG Lab' })).toBeVisible()

  await page.getByRole('button', { name: 'Home' }).click()

  await expect(page).toHaveURL(/\/en$/)
  await expect(page.getByRole('main', { name: 'Resume OS' })).toBeVisible()
  await expect(page.locator('.mobile-home__app')).toHaveCount(10)
  await expect(page.locator('.mobile-app-frame')).toHaveCount(0)
  await expect(page.locator('.mobile-app-frame__bar')).toHaveCount(0)
  await expect(page.locator('.desktop-app-content')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Evidence RAG Lab' })).toHaveCount(0)
  await waitForFiniteMotionToSettle(page.getByTestId('mobile-home'), { subtree: true })
  const screenshotPath = testInfo.project.name === 'mobile'
    ? '/tmp/resume-os-task14-acceptance-mobile-390x844.png'
    : '/tmp/resume-os-task14-acceptance-mobile-375x667.png'
  await expectNoDevelopmentOverlay(page)
  await page.screenshot({ path: screenshotPath, fullPage: true })
})

test('mobile app frame fits and scrolls within the safe-area layout', async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo.project.name), 'Mobile-only layout coverage')

  await page.goto('/en/agent')
  const frame = page.getByRole('main', { name: 'Resume Agent' })
  const back = page.getByRole('button', { name: 'Back' })
  const home = page.getByRole('button', { name: 'Home' })
  await expect(frame).toBeVisible()
  await expect(back).toBeVisible()
  await expect(home).toBeVisible()
  await expect.poll(() => frame.evaluate((element) => getComputedStyle(element).transform))
    .toBe('none')

  await page.locator('.mobile-app-frame__content').evaluate((content) => {
    const scrollProbe = document.createElement('div')
    scrollProbe.dataset.testid = 'mobile-scroll-probe'
    scrollProbe.style.height = `${content.clientHeight * 2}px`
    scrollProbe.style.width = '1px'
    scrollProbe.setAttribute('aria-hidden', 'true')
    content.append(scrollProbe)
    content.scrollTop = content.scrollHeight
  })
  await expect.poll(() => page.locator('.mobile-app-frame__content').evaluate((content) => content.scrollTop))
    .toBeGreaterThan(0)

  const metrics = await page.evaluate(() => {
    const appFrame = document.querySelector<HTMLElement>('.mobile-app-frame')
    const bar = document.querySelector<HTMLElement>('.mobile-app-frame__bar')
    const content = document.querySelector<HTMLElement>('.mobile-app-frame__content')
    const controls = [...document.querySelectorAll<HTMLElement>('.mobile-app-frame__control')]
    if (!appFrame || !bar || !content || controls.length !== 2) throw new Error('Missing mobile app frame elements')
    const frameRect = appFrame.getBoundingClientRect()
    const barRect = bar.getBoundingClientRect()
    const contentRect = content.getBoundingClientRect()

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      frameHeight: frameRect.height,
      barTop: barRect.top,
      contentBottom: contentRect.bottom,
      contentClientHeight: content.clientHeight,
      contentScrollHeight: content.scrollHeight,
      contentScrollTop: content.scrollTop,
      documentScrollTop: document.documentElement.scrollTop,
      bodyScrollTop: document.body.scrollTop,
      controlSizes: controls.map((control) => {
        const rect = control.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      }),
      supportsSafeArea: CSS.supports('padding-top: env(safe-area-inset-top)')
    }
  })

  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
  expect(metrics.frameHeight).toBeLessThanOrEqual(metrics.viewportHeight)
  expect(metrics.barTop).toBeGreaterThanOrEqual(0)
  expect(metrics.contentBottom).toBeLessThanOrEqual(metrics.viewportHeight)
  expect(metrics.contentClientHeight).toBeGreaterThan(0)
  expect(metrics.contentScrollHeight).toBeGreaterThan(metrics.contentClientHeight)
  expect(metrics.contentScrollTop).toBeGreaterThan(0)
  expect(metrics.documentScrollTop).toBe(0)
  expect(metrics.bodyScrollTop).toBe(0)
  expect(metrics.controlSizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true)
  expect(metrics.supportsSafeArea).toBe(true)
  await expect(back).toBeVisible()
  await expect(home).toBeVisible()
})

test('mobile settled browser navigation returns to the exact previous app', async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo.project.name), 'Mobile-only navigation coverage')

  await page.goto('/en')
  await waitForMobileHomeReady(page)
  await page.locator('.mobile-home__app').filter({ hasText: 'Resume Agent' }).click()
  await expect(page).toHaveURL(/\/en\/agent$/)
  const agentFrame = page.getByRole('main', { name: 'Resume Agent' })
  await expect(agentFrame).toBeVisible()
  await expect.poll(() => agentFrame.evaluate((element) => getComputedStyle(element).transform))
    .toBe('none')

  await page.goto('/en/book')
  await expect(page).toHaveURL(/\/en\/book$/)
  const bookFrame = page.getByRole('main', { name: 'Resume Book' })
  await expect(bookFrame).toBeVisible()
  await expect.poll(() => bookFrame.evaluate((element) => getComputedStyle(element).transform))
    .toBe('none')

  await page.goBack()
  await expect(page).toHaveURL(/\/en\/agent$/)
  await expect(page.getByRole('main', { name: 'Resume Agent' })).toBeVisible()
})

test('mobile rapid app launches render the latest selected app', async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo.project.name), 'Mobile-only navigation coverage')

  await page.goto('/en')
  await waitForMobileHomeReady(page)
  await expect(page.locator('.mobile-home__app').filter({ hasText: 'Resume Agent' })).toBeVisible()
  await expect(page.locator('.mobile-home__app').filter({ hasText: 'Resume Book' })).toBeVisible()
  await page.evaluate(() => {
    const apps = [...document.querySelectorAll<HTMLButtonElement>('.mobile-home__app')]
    const agent = apps.find((app) => app.textContent?.includes('Resume Agent'))
    const book = apps.find((app) => app.textContent?.includes('Resume Book'))
    if (!agent || !book) throw new Error('Missing launch targets')
    agent.click()
    book.click()
  })

  await expect(page).toHaveURL(/\/en\/book$/)
  await expect(page.getByRole('main', { name: 'Resume Book' })).toBeVisible()
})
