import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const nextConfig: NextConfig = {
  typedRoutes: true,
  devIndicators: process.env.RESUME_OS_E2E === '1' ? false : undefined,
  allowedDevOrigins: ['127.0.0.1'],
  serverExternalPackages: ['@napi-rs/canvas', 'pdf-parse', 'mammoth'],
  outputFileTracingIncludes: {
    '/api/resume/extract-text': [
      './lib/server/document-parser-worker.mjs',
      './node_modules/pdf-parse/package.json',
      './node_modules/pdf-parse/dist/pdf-parse/cjs/index.cjs',
      './node_modules/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs'
    ]
  },
  turbopack: {
    root: process.cwd()
  }
}

const withNextIntl = createNextIntlPlugin()

export default withNextIntl(nextConfig)
