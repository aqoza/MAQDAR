import { test } from 'node:test'
import assert from 'node:assert/strict'
import { retainImports } from './import-retention.mjs'

const batch = '10000000-0000-0000-0000-000000000001'
const row = {
  batch_id: batch,
  file_no: 1,
  storage_path: `20000000-0000-0000-0000-000000000001/${batch}/1.csv`,
}
test('removes the object before marking it purged, with no credential redirects', async () => {
  const calls = []
  const count = await retainImports({
    url: 'https://example.supabase.co',
    key: 'sb_secret_test',
    fetcher: async (url, init) => {
      calls.push({ path: url.pathname, ...init })
      return Response.json(calls.length === 1 ? [row] : calls.length === 2 ? [] : true)
    },
  })
  assert.equal(count, 1)
  assert.deepEqual(
    calls.map((c) => c.path),
    [
      '/rest/v1/rpc/import_retention_candidates',
      '/storage/v1/object/imports',
      '/rest/v1/rpc/import_retention_complete',
    ],
  )
  assert.equal(calls[1].method, 'DELETE')
  assert.equal(calls[1].redirect, 'error')
  assert.deepEqual(JSON.parse(calls[1].body), { prefixes: [row.storage_path] })
})
test('storage failures never acknowledge deletion', async () => {
  let calls = 0
  await assert.rejects(
    retainImports({
      url: 'https://example.supabase.co',
      key: 'sb_secret_test',
      fetcher: async () =>
        ++calls === 1 ? Response.json([row]) : new Response('private failure', { status: 500 }),
    }),
    /Retention request failed \(500\)/,
  )
  assert.equal(calls, 2)
})
test('refuses arbitrary paths and insecure remote origins', async () => {
  await assert.rejects(retainImports({ url: 'http://remote.example', key: 'secret' }), /HTTPS/)
  await assert.rejects(
    retainImports({
      url: 'https://example.supabase.co',
      key: 'secret',
      fetcher: async () => Response.json([{ ...row, storage_path: '../another-bucket' }]),
    }),
    /Invalid retention path/,
  )
})
