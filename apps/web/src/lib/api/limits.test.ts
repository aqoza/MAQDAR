import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ENTITY_NAMES, getEntity } from '../imports/contract'
import {
  API_LIMITS,
  isTransactionEntity,
  listLimits,
  organizationLimits,
  recordCap,
} from './limits'

const ROOT = new URL('../../../../../', import.meta.url)

/** supabase/tests/fixtures/api_limits.json: the object pgTAP compares with app.api_limits(). */
function sharedFixture(): string {
  return readFileSync(
    fileURLToPath(new URL('supabase/tests/fixtures/api_limits.json', ROOT)),
    'utf8',
  )
}

/** The JSON literal returned by app.api_limits() in the latest migration that defines it. */
function migrationLimits(): string {
  const directory = fileURLToPath(new URL('supabase/migrations/', ROOT))
  const definitions = readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(`${directory}/${name}`, 'utf8'))
    .flatMap((sql) => [
      ...sql.matchAll(/function app\.api_limits\(\)[\s\S]*?\bselect '([^']*)'::json;/g),
    ])
  const literal = definitions.at(-1)?.[1]
  if (literal === undefined) throw new Error('No migration defines app.api_limits()')
  return literal
}

describe('API limits', () => {
  it('caps records per upsert by kind of resource', () => {
    for (const entity of ENTITY_NAMES) {
      expect(recordCap(entity)).toBe(entity === 'demand_history' ? 2_500 : 1_000)
    }
  })

  it('keeps record caps within the staged chunk size of the contract', () => {
    for (const entity of ENTITY_NAMES) {
      expect(recordCap(entity)).toBeLessThanOrEqual(getEntity(entity).stage_rows)
    }
  })

  it('gives list limits with the default inside the range', () => {
    for (const entity of ENTITY_NAMES) {
      const limits = listLimits(entity)
      expect(limits.min).toBe(1)
      expect(limits.default).toBeGreaterThanOrEqual(limits.min)
      expect(limits.default).toBeLessThanOrEqual(limits.max)
    }
    expect(listLimits('items')).toEqual({ min: 1, max: 1_000, default: 100 })
    expect(listLimits('demand_history')).toEqual({ min: 1, max: 5_000, default: 1_000 })
  })

  it('classifies all four transaction resources', () => {
    expect(ENTITY_NAMES.filter(isTransactionEntity)).toEqual([
      'demand_history',
      'stock_snapshots',
      'open_orders',
      'receipts',
    ])
  })

  it('states the approved plan values', () => {
    expect(API_LIMITS.bodyBytes).toBe(1_048_576)
    expect(API_LIMITS.keyRequestsPerWindow).toBe(120)
    expect(API_LIMITS.ipRequestsPerWindow).toBe(300)
    expect(API_LIMITS.rateLimitWindowSeconds).toBe(60)
    expect(API_LIMITS.recordedWritesPerDay).toBe(5_000)
    expect(API_LIMITS.activeKeysPerOrganization).toBe(20)
    expect(API_LIMITS.demandRangeDays).toBe(366)
    expect(API_LIMITS.validationErrors).toBe(1_000)
    expect(API_LIMITS.requestErrors).toBe(100)
    expect(API_LIMITS.keyExpiryDays).toContain(API_LIMITS.defaultKeyExpiryDays)
    expect(Math.max(...API_LIMITS.keyExpiryDays)).toBeLessThanOrEqual(API_LIMITS.maxKeyExpiryDays)
  })
})

describe('organizationLimits', () => {
  it('reports the caps the requests are checked against', () => {
    const limits = organizationLimits()
    expect(limits.upsert_records).toEqual({
      master_data: recordCap('items'),
      demand_history: recordCap('demand_history'),
    })
    expect(limits.list_limit).toEqual({
      master_data: listLimits('items').max,
      demand_history: listLimits('demand_history').max,
    })
    expect(limits.list_default_limit).toEqual({
      master_data: listLimits('items').default,
      demand_history: listLimits('demand_history').default,
    })
  })

  it('equals the shared fixture, key order included', () => {
    expect(JSON.stringify(organizationLimits())).toBe(JSON.stringify(JSON.parse(sharedFixture())))
  })

  it('equals app.api_limits() of the migrations, key order included', () => {
    expect(JSON.stringify(organizationLimits())).toBe(JSON.stringify(JSON.parse(migrationLimits())))
  })
})
