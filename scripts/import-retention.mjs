import { pathToFileURL } from 'node:url'

/** Narrow operational client. Only the retention RPCs and imports bucket can receive the key. */
export async function retainImports({ url, key, fetcher = fetch }) {
  const base = new URL(url)
  if (
    base.protocol !== 'https:' &&
    !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))
  ) {
    throw new Error('Retention requires HTTPS or a local Supabase URL')
  }
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/')
    throw new Error('Invalid Supabase origin')
  if (!key) throw new Error('Missing Supabase secret key')
  const headers = { apikey: key, 'Content-Type': 'application/json' }
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`
  async function request(path, body, method = 'POST') {
    const response = await fetcher(new URL(path, base), {
      method,
      headers,
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw new Error(`Retention request failed (${response.status})`)
    return response.json()
  }
  const candidates = await request('/rest/v1/rpc/import_retention_candidates', {})
  if (!Array.isArray(candidates) || candidates.length > 100)
    throw new Error('Invalid retention candidates')
  let removed = 0
  for (const row of candidates) {
    // Validate server-generated paths again; never accept an arbitrary bucket or prefix.
    if (
      !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[1-9]\d*\.[a-z0-9]+$/.test(row.storage_path) ||
      row.storage_path.split('/')[1] !== row.batch_id ||
      !Number.isInteger(row.file_no) ||
      !row.storage_path.split('/')[2].startsWith(`${row.file_no}.`)
    )
      throw new Error('Invalid retention path')
    await request('/storage/v1/object/imports', { prefixes: [row.storage_path] }, 'DELETE')
    if (
      (await request('/rest/v1/rpc/import_retention_complete', {
        p_batch_id: row.batch_id,
        p_file_no: row.file_no,
      })) !== true
    ) {
      throw new Error('Storage deletion was not confirmed; retry the retention job')
    }
    removed++
  }
  return removed
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const count = await retainImports({
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SECRET_KEY,
    })
    console.log(`Retained import summaries; removed ${count} expired originals.`)
  } catch (error) {
    // Error messages here are fixed diagnostics; never print response bodies, headers or secrets.
    console.error(
      error instanceof Error && error.message.startsWith('Retention')
        ? error.message
        : 'Import retention failed; inspect configuration and retry.',
    )
    process.exitCode = 1
  }
}
