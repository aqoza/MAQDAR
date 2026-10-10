import { defineCloudflareConfig } from '@opennextjs/cloudflare'

// Every route is dynamic (sessions, organization context), so no incremental cache is configured.
export default defineCloudflareConfig({})
