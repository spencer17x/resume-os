import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 2,
  outputDir: '.next/playwright-results',
  use: { baseURL: 'http://127.0.0.1:3101', trace: 'retain-on-failure' },
  webServer: {
    command: 'RESUME_OS_E2E=1 corepack pnpm@10.33.0 exec next dev -p 3101',
    url: 'http://127.0.0.1:3101',
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'], browserName: 'chromium', viewport: { width: 390, height: 844 } }
    },
    {
      name: 'mobile-compact',
      use: { ...devices['iPhone SE'], browserName: 'chromium', viewport: { width: 375, height: 667 } }
    }
  ]
})
