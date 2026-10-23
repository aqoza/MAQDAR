import { describe, expect, it } from 'vitest'
import { CONTRACT, ENTITY_NAMES } from '../imports/contract'
import {
  API_BASE_PATH,
  RESOURCES,
  allOperationIds,
  allowHeader,
  methodHint,
  operationId,
  parseResourceSegment,
  pascalCase,
  resourceByName,
  resourceForEntity,
  resourceName,
  resourcePath,
} from './resources'

describe('resources', () => {
  it('has one resource per contract entity, in load order', () => {
    expect(RESOURCES).toHaveLength(15)
    expect(RESOURCES.map((resource) => resource.entity).sort()).toEqual([...ENTITY_NAMES].sort())
    const orders = RESOURCES.map((resource) => resource.loadOrder)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
    expect(RESOURCES.map((resource) => resource.entity)).toEqual(
      [...CONTRACT.entities].sort((a, b) => a.load_order - b.load_order).map((e) => e.name),
    )
  })

  it('names resources like their entities with dashes', () => {
    expect(resourceName('demand_history')).toBe('demand-history')
    expect(resourceName('items')).toBe('items')
    for (const resource of RESOURCES) {
      expect(resource.name).toMatch(/^[a-z]+(-[a-z]+)*$/)
      expect(resourceByName(resource.name)).toBe(resource)
      expect(resourceForEntity(resource.entity)).toBe(resource)
      expect(resource.category).toBe(
        ['demand_history', 'stock_snapshots', 'open_orders', 'receipts'].includes(resource.entity)
          ? 'transactions'
          : 'master_data',
      )
    }
    expect(resourceByName('demand_history')).toBeNull()
  })
})

describe('parseResourceSegment', () => {
  it('reads lists and upserts', () => {
    expect(parseResourceSegment('items')).toEqual({
      resource: resourceByName('items'),
      action: 'list',
    })
    expect(parseResourceSegment('items:upsert')).toEqual({
      resource: resourceByName('items'),
      action: 'upsert',
    })
    expect(parseResourceSegment('demand-history:upsert')?.resource.entity).toBe('demand_history')
  })

  it('decodes a segment that still carries percent escapes', () => {
    expect(parseResourceSegment('items%3Aupsert')?.action).toBe('upsert')
    expect(parseResourceSegment('items%3aupsert')?.action).toBe('upsert')
    expect(parseResourceSegment('items%E0%A4%A')).toBeNull()
  })

  it('refuses unknown resources and suffixes', () => {
    for (const segment of [
      '',
      'Items',
      'demand_history',
      'items:Upsert',
      'items:delete',
      'items:upsert:upsert',
      ':upsert',
      'items/',
    ]) {
      expect(parseResourceSegment(segment), segment).toBeNull()
    }
  })
})

describe('paths, methods and operation ids', () => {
  it('builds paths and Allow headers', () => {
    const items = resourceForEntity('items')
    expect(resourcePath(items, 'list')).toBe('/items')
    expect(resourcePath(items, 'upsert')).toBe('/items:upsert')
    expect(allowHeader('list')).toBe('GET, HEAD')
    expect(allowHeader('upsert')).toBe('POST')
  })

  it('points a wrong method to the right path', () => {
    const items = resourceForEntity('items')
    expect(methodHint({ resource: items, action: 'list' }, 'POST')).toBe(
      `Upserts use POST ${API_BASE_PATH}/items:upsert.`,
    )
    expect(methodHint({ resource: items, action: 'upsert' }, 'GET')).toBe(
      `Lists use GET ${API_BASE_PATH}/items.`,
    )
    expect(methodHint({ resource: items, action: 'list' }, 'DELETE')).toBe(
      `${API_BASE_PATH}/items answers GET, HEAD only.`,
    )
  })

  it('derives unique operation ids', () => {
    expect(pascalCase('item_supersessions')).toBe('ItemSupersessions')
    expect(operationId('demand_history', 'upsert')).toBe('upsertDemandHistory')
    expect(operationId('items', 'list')).toBe('listItems')
    const ids = allOperationIds()
    expect(ids).toHaveLength(85)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe('getOrganization')
  })
})
