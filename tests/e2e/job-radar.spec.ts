import { expect, test, type Page, type Route } from '@playwright/test'
import type { ResumeData } from '../../lib/resume-model'

const resumeText = 'Ada Candidate, Platform Engineer, built reliable TypeScript platforms.'
const resume: ResumeData = {
  profile: { name: 'Ada Candidate', title: 'Platform Engineer', summary: ['Builds reliable systems.'], tags: ['TypeScript'], links: [] },
  targetRole: 'Platform Engineer',
  skills: [{ group: 'Core', items: ['TypeScript'] }],
  experiences: [], projects: [], education: [], certifications: [], awards: [], languages: [], openSource: [],
  metadata: { source: 'paste', locale: 'en', updatedAt: '2026-08-01T08:00:00.000Z' }
}

async function json(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
}

async function createTrustedDraft(page: Page) {
  await page.route('**/api/resume/parse', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ text: resumeText, locale: 'en', source: 'paste' })
    await json(route, { data: resume, model: 'job-radar-e2e' })
  })
  await page.addInitScript(() => localStorage.setItem('resume-os-ai-provider-preference-v1', JSON.stringify({
    version: 1, mode: 'openai-compatible', allowCloudFallback: false
  })))
  await page.goto('/en/studio')
  const studio = page.getByRole('application', { name: 'Resume Studio' })
  await studio.getByRole('textbox', { name: 'Resume text' }).fill(resumeText)
  await studio.getByRole('button', { name: 'Create draft' }).click()
  await expect(studio.getByRole('heading', { name: 'Ada Candidate' })).toBeVisible()
}

test('exposes only BOSS Zhipin', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop platform-scope workflow')
  await createTrustedDraft(page)
  let discoveryRequests = 0
  await page.route('**/api/jobs/discover', async (route) => { discoveryRequests += 1; await route.abort() })

  await page.goto('/en/jobs')
  const radar = page.getByRole('application', { name: 'Job Agent' })
  const platforms = radar.getByRole('list', { name: 'Agent work platforms' })
  await expect(platforms.getByRole('listitem')).toHaveCount(1)
  await expect(platforms).toContainText('BOSS Zhipin')
  await expect(radar.getByText('Greenhouse')).toHaveCount(0)
  await expect(radar.getByText('Lever')).toHaveCount(0)
  expect(discoveryRequests).toBe(0)
})

test('derives a resume search for BOSS Zhipin', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop market-search workflow')
  await createTrustedDraft(page)
  let discoveryRequests = 0
  await page.route('**/api/jobs/discover', async (route) => { discoveryRequests += 1; await route.abort() })

  await page.goto('/en/jobs')
  const radar = page.getByRole('application', { name: 'Job Agent' })
  await expect(radar.getByRole('textbox', { name: 'Target titles' })).toHaveValue('Platform Engineer')
  await expect(radar.getByRole('list', { name: 'Agent work platforms' }).getByRole('listitem')).toHaveCount(1)
  await expect(radar.getByRole('link', { name: 'Search BOSS Zhipin' })).toHaveAttribute('href', /query=Platform\+Engineer/)

  await radar.getByRole('button', { name: 'Run Agent now' }).click()
  await expect(radar.getByText('The selected platforms require official search or partner access. Open their official searches below.')).toBeVisible()
  expect(discoveryRequests).toBe(0)
})

test('brings a user-selected platform job into Target Job without fetching the page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop Copilot handoff workflow')
  await createTrustedDraft(page)
  let discoveryRequests = 0
  await page.route('**/api/jobs/discover', async (route) => {
    discoveryRequests += 1
    await route.abort()
  })

  await page.goto('/en/jobs')
  const radar = page.getByRole('application', { name: 'Job Agent' })
  await expect(radar.getByRole('textbox', { name: 'Target titles' })).toHaveValue('Platform Engineer')
  await radar.getByRole('textbox', { name: 'Quick paste' }).fill(`
Job title: Senior Platform Engineer
Company: Example China
Location: Shanghai
URL: https://www.zhipin.com/job_detail/example.html
Job description: Build TypeScript developer platforms and improve delivery reliability.
  `)
  await radar.getByRole('button', { name: 'Parse and prefill' }).click()
  await expect(radar.getByRole('combobox', { name: 'Source platform' })).toHaveValue('boss')
  await expect(radar.getByRole('textbox', { name: 'Official job URL' })).toHaveValue(
    'https://www.zhipin.com/job_detail/example.html'
  )
  await expect(radar.getByRole('textbox', { name: 'Job title' })).toHaveValue('Senior Platform Engineer')
  await expect(radar.getByRole('textbox', { name: 'Company' })).toHaveValue('Example China')
  await radar.getByRole('button', { name: 'Import and analyze' }).click()

  const targetJob = page.getByRole('application', { name: 'Target Job' })
  await expect(targetJob.getByRole('textbox', { name: 'Job description' })).toHaveValue(
    'Build TypeScript developer platforms and improve delivery reliability.'
  )
  await expect(targetJob.getByText(/Example China · Senior Platform Engineer was loaded/)).toBeVisible()
  expect(discoveryRequests).toBe(0)
})

test('keeps the bilingual Job Agent route usable without horizontal overflow on mobile', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile Job Agent coverage')
  await page.goto('/zh/jobs')
  await expect(page.getByRole('heading', { name: '求职 Agent', level: 1 })).toBeVisible()
  await expect(page.getByText('请先导入或粘贴可信简历，再进行岗位匹配。')).toBeVisible()
  await expect(page.getByRole('group', { name: '筛选岗位' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0)
})
