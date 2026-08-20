import { expect, test } from '@playwright/test'

function isMobileProject(projectName: string) {
  return projectName === 'mobile' || projectName === 'mobile-compact'
}

test('localized root opens the Job Agent backend without the desktop launcher', async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo.project.name), 'Mobile-only backend coverage')
  await page.goto('/zh')

  await expect(page).toHaveURL(/\/zh\/jobs$/u)
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh')
  await expect(page.getByRole('application', { name: '求职 Agent' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '求职概览', level: 1 })).toBeVisible()
  await expect(page.locator('.desktop-shell, .mobile-home, .desktop-window__controls, .desktop-dock')).toHaveCount(0)
})

test('Job Agent backend has no horizontal overflow on supported mobile viewports', async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo.project.name), 'Mobile-only viewport coverage')
  await page.goto('/en')

  await expect(page).toHaveURL(/\/en\/jobs$/u)
  await expect(page.getByRole('application', { name: 'Job Agent' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 0
  )
})

test('mobile backend navigation exposes the complete job workflow', async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo.project.name), 'Mobile-only navigation coverage')
  await page.goto('/en/jobs')
  const workspace = page.getByRole('application', { name: 'Job Agent' })
  const navigation = workspace.getByRole('navigation', { name: 'Job workspace navigation' })

  await expect(navigation.getByRole('link')).toHaveCount(7)
  await navigation.getByRole('link', { name: 'Opportunities', exact: true }).click()
  await expect(page).toHaveURL(/\/en\/jobs\/opportunities$/u)
  await expect(workspace.getByRole('heading', { name: 'Opportunity inbox', level: 1 })).toBeVisible()

  await navigation.getByRole('link', { name: 'Interviews', exact: true }).click()
  await expect(page).toHaveURL(/\/en\/jobs\/interviews$/u)
  await expect(workspace.getByRole('heading', { name: 'Interviews and review', level: 1 })).toBeVisible()

  await workspace.getByRole('link', { name: 'Open settings' }).click()
  await expect(page).toHaveURL(/\/en\/jobs\/settings$/u)
  await expect(workspace.getByRole('heading', { name: 'Model and system settings', level: 1 })).toBeVisible()
  await expect(page.locator('.desktop-shell, .mobile-home, .desktop-dock')).toHaveCount(0)

  await workspace.getByRole('link', { name: 'Candidate' }).click()
  await expect(page).toHaveURL(/\/en\/jobs\/profile$/u)
  await expect(workspace.getByRole('heading', { name: 'Career profile', level: 1 })).toBeVisible()
})

test('legacy resume tools remain reachable directly without restoring the removed home UI', async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo.project.name), 'Mobile-only compatibility coverage')
  await page.goto('/en/studio')

  await expect(page.getByRole('main', { name: 'Resume Studio' })).toBeVisible()
  await expect(page.locator('.mobile-home, .desktop-dock')).toHaveCount(0)
})
