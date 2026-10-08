import path from 'node:path'
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The pnpm workspace root, so output tracing and Turbopack agree on the monorepo root.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  transpilePackages: ['@maqdar/shared'],
  // CLAUDE.md is the rules file for agents; do not let `next dev` generate AGENTS.md.
  agentRules: false,
}

export default withNextIntl(nextConfig)
