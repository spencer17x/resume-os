import { expect, test, type Page, type Route } from '@playwright/test'
import { createStableJobDomainId } from '../../lib/jobs/job-domain'
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

function sourceResult(source: 'greenhouse' | 'lever', sourceKey: string, title: string) {
  const checkedAt = new Date(Date.now() + 60_000).toISOString()
  const sourceId = createStableJobDomainId('job-source', [source, sourceKey])
  const externalId = `${sourceKey}-1`
  const lever = source === 'lever'
  return {
    sourceId, completeness: 'complete' as const, checkedAt, warnings: [],
    postings: [{
      id: createStableJobDomainId('job-posting', [source, sourceKey, externalId]),
      sourceId, externalId,
      canonicalUrl: lever
        ? `https://jobs.lever.co/${sourceKey}/${externalId}`
        : `https://boards.greenhouse.io/${sourceKey}/jobs/${externalId}`,
      applyUrl: lever
        ? `https://jobs.lever.co/${sourceKey}/${externalId}/apply`
        : `https://boards.greenhouse.io/${sourceKey}/jobs/${externalId}`,
      title, company: sourceKey, description: `${title} using TypeScript.`, locale: 'en' as const,
      firstSeenAt: checkedAt, lastCheckedAt: checkedAt, status: 'open' as const,
      contentHash: `hash:${source}:${sourceKey}`
    }]
  }
}

test('refreshes Lever, rejects arbitrary source URLs, and cancels a late source without committing it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop source-boundary workflow')
  await createTrustedDraft(page)
  const discoveryBodies: unknown[] = []
  await page.route('**/api/jobs/discover', async (route) => {
    const body = route.request().postDataJSON() as { source: 'greenhouse' | 'lever'; sourceKey: string }
    discoveryBodies.push(body)
    expect(Object.keys(body).sort()).toEqual(['source', 'sourceKey'])
    if (body.sourceKey === 'slow-board') {
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      try { await json(route, sourceResult(body.source, body.sourceKey, 'Slow Role')) } catch { /* request was canceled */ }
      return
    }
    await json(route, sourceResult(body.source, body.sourceKey, 'Lever Platform Engineer'))
  })

  await page.goto('/en/jobs')
  const radar = page.getByRole('application', { name: 'Job Radar' })
  await radar.getByRole('textbox', { name: 'Profile name' }).fill('Platform roles')
  await radar.getByRole('textbox', { name: 'Target titles' }).fill('Platform Engineer')
  await radar.getByRole('button', { name: 'Save profile' }).click()

  await radar.getByText('Advanced: add a company board').click()
  await radar.getByRole('textbox', { name: 'Public board identifier' }).fill('https://evil.example/jobs')
  await radar.getByRole('button', { name: 'Add source' }).click()
  await expect(radar.getByRole('alert')).toContainText('valid public board identifier')
  expect(discoveryBodies).toEqual([])

  await radar.getByRole('combobox', { name: 'Provider' }).selectOption('lever')
  await radar.getByRole('textbox', { name: 'Public board identifier' }).fill('example')
  await radar.getByRole('button', { name: 'Add source' }).click()
  await radar.getByRole('button', { name: 'Refresh example' }).click()
  await expect(radar.getByRole('heading', { name: 'Lever Platform Engineer' })).toBeVisible()
  expect(discoveryBodies).toEqual([{ source: 'lever', sourceKey: 'example' }])

  await radar.getByRole('combobox', { name: 'Provider' }).selectOption('greenhouse')
  await radar.getByRole('textbox', { name: 'Public board identifier' }).fill('slow-board')
  await radar.getByRole('button', { name: 'Add source' }).click()
  await radar.getByRole('button', { name: 'Refresh slow-board' }).click()
  await radar.getByRole('button', { name: 'Cancel refresh' }).click()
  await expect(radar.getByRole('status')).toContainText('Refresh canceled')
  await page.waitForTimeout(2_100)
  await expect(radar.getByRole('heading', { name: 'Slow Role' })).toHaveCount(0)
})

test('derives a resume search and scans selected public marketplaces without a company input', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop market-search workflow')
  await createTrustedDraft(page)
  const discoveryBodies: Array<{ source: 'greenhouse' | 'lever'; sourceKey: string }> = []
  await page.route('**/api/jobs/discover', async (route) => {
    const body = route.request().postDataJSON() as { source: 'greenhouse' | 'lever'; sourceKey: string }
    discoveryBodies.push(body)
    await json(route, sourceResult(body.source, body.sourceKey, `${body.sourceKey} Platform Engineer`))
  })

  await page.goto('/en/jobs')
  const radar = page.getByRole('application', { name: 'Job Radar' })
  await expect(radar.getByRole('textbox', { name: 'Target titles' })).toHaveValue('Platform Engineer')
  await expect(radar.getByRole('checkbox', { name: /Greenhouse/ })).toBeChecked()
  await expect(radar.getByRole('checkbox', { name: /Lever/ })).toBeChecked()
  await expect(radar.getByRole('link', { name: 'Search BOSS Zhipin' })).toHaveAttribute('href', /query=Platform\+Engineer/)

  await radar.getByRole('checkbox', { name: /Lever/ }).uncheck()
  await radar.getByRole('button', { name: 'Search selected platforms' }).click()
  await expect(radar.getByRole('status')).toContainText('3 automatic sources')
  await expect(radar.getByRole('heading', { name: /Platform Engineer/ })).toHaveCount(3)
  expect(discoveryBodies).toEqual([
    { source: 'greenhouse', sourceKey: 'discord' },
    { source: 'greenhouse', sourceKey: 'webflow' },
    { source: 'greenhouse', sourceKey: 'cockroachlabs' }
  ])
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
  const radar = page.getByRole('application', { name: 'Job Radar' })
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

test('keeps the bilingual Job Radar route usable without horizontal overflow on mobile', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile Job Radar coverage')
  await page.goto('/zh/jobs')
  await expect(page.getByRole('heading', { name: '岗位雷达', level: 1 })).toBeVisible()
  await expect(page.getByText('请先导入或粘贴可信简历，再进行岗位匹配。')).toBeVisible()
  await expect(page.getByRole('group', { name: '筛选岗位' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0)
})
