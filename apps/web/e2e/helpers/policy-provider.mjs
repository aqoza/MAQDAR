// Test-only Node preload. Never imported by application code or a production command.
const loopback = (value) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)
if (
  process.env.ZEESPARE_POLICY_TEST !== 'true' ||
  !loopback(process.env.NEXT_PUBLIC_SITE_URL) ||
  !loopback(process.env.NEXT_PUBLIC_SUPABASE_URL)
)
  throw new Error('Policy provider fixture requires an isolated local test server')
const original = globalThis.fetch
globalThis.fetch = async (resource, init) => {
  const url = resource instanceof Request ? resource.url : String(resource)
  if (url !== 'https://api.anthropic.com/v1/messages') return original(resource, init)
  if (
    new Headers(init?.headers ?? (resource instanceof Request ? resource.headers : undefined)).get(
      'x-api-key',
    ) !== 'test-only-claude-key-no-external-access'
  )
    throw new Error('Unexpected provider credential')
  const request = JSON.parse(
    init?.body ?? (resource instanceof Request ? await resource.clone().text() : ''),
  )
  const input = JSON.parse(request.messages[0].content)
  if (request.tools || JSON.stringify(input.evidence).includes('DO-NOT-SEND'))
    throw new Error('Unsafe provider projection')
  const text =
    input.language === 'ar'
      ? 'المهلة المحفوظة ثلاثة أيام تقويمية.'
      : 'The recorded lead time is three calendar days.'
  const answer = {
    paragraphs: [
      {
        text: text + ' <script>window.injected=true</script>',
        references: input.question.includes('force-invalid-reference')
          ? ['unknown']
          : ['policy_inputs'],
      },
    ],
  }
  return new Response(
    JSON.stringify({
      model: 'claude-sonnet-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(answer) }],
    }),
    { headers: { 'content-type': 'application/json' } },
  )
}
