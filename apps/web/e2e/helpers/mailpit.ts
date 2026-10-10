import type { APIRequestContext } from '@playwright/test'

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'

type SearchResponse = { messages: { ID: string }[] }
type MessageResponse = { HTML?: string; Text?: string }

/**
 * Polls the local Mailpit API for mail addressed to `email` and returns the first href matching
 * `pattern` (for example /\/auth\/invite\?/). HTML-escaped ampersands in the body are unescaped
 * first so the query string survives.
 */
export async function waitForEmailLink(
  request: APIRequestContext,
  email: string,
  pattern: RegExp,
  { timeoutMs = 30_000 }: { timeoutMs?: number } = {},
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const search = await request.get(`${MAILPIT_URL}/api/v1/search`, {
      params: { query: `to:${email}`, limit: 10 },
    })
    if (search.ok()) {
      const { messages } = (await search.json()) as SearchResponse
      for (const message of messages) {
        const detail = await request.get(`${MAILPIT_URL}/api/v1/message/${message.ID}`)
        if (!detail.ok()) continue
        const body = (await detail.json()) as MessageResponse
        const link = firstLink(`${body.HTML ?? ''}\n${body.Text ?? ''}`, pattern)
        if (link) return link
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(
    `No email for ${email} with a link matching ${pattern} arrived in Mailpit at ${MAILPIT_URL}`,
  )
}

/** Returns the first http(s) URL in `body` whose text matches `pattern`, or null. */
export function firstLink(body: string, pattern: RegExp): string | null {
  const haystack = body.replace(/&amp;/g, '&')
  for (const match of haystack.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
    if (pattern.test(match[0])) return match[0]
  }
  return null
}
