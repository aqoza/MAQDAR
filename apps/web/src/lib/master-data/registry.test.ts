import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import { RESERVED_PARAMS } from './list-params'
import { entityKeys, getEntity, isEntityKey } from './registry'

/** Every registered entity's definition is consistent with itself and with en.json. */
const messages = en as unknown as Record<string, unknown>

function message(namespace: string, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      messages[namespace],
    )
}

describe('registry', () => {
  it('allow-lists only registered keys', () => {
    expect(isEntityKey('items')).toBe(true)
    expect(isEntityKey('brands')).toBe(true)
    expect(isEntityKey('organizations')).toBe(false)
    expect(isEntityKey('toString')).toBe(false)
    expect(isEntityKey(null)).toBe(false)
  })

  describe.each(entityKeys())('%s', (key) => {
    const definition = getEntity(key)
    const { list, namespace } = definition

    it('is registered under its own key', () => {
      expect(definition.key).toBe(key)
    })

    it('has the page messages', () => {
      for (const name of ['title', 'description', 'newTitle']) {
        expect(typeof message(namespace, name), `${namespace}.${name}`).toBe('string')
      }
    })

    it('labels every column, field and filter', () => {
      for (const column of definition.columns) {
        expect(typeof message(namespace, `columns.${column.key}`), column.key).toBe('string')
      }
      for (const field of definition.fields) {
        expect(typeof message(namespace, `fields.${field.name}`), field.name).toBe('string')
        if (field.hint) {
          expect(typeof message(namespace, `hints.${field.name}`), field.name).toBe('string')
        }
        if (field.options?.source === 'enum') {
          for (const value of field.options.values) {
            const label = `options.${field.name}.${value}`
            expect(typeof message(namespace, label), label).toBe('string')
          }
        }
      }
      for (const filter of list.filters) {
        expect(typeof message(namespace, `filters.${filter.param}`), filter.param).toBe('string')
      }
    })

    it('sorts and filters only by allow-listed columns', () => {
      expect(list.sorts).toContain(list.defaultSort)
      for (const column of definition.columns) {
        if (column.sortable) expect(list.sorts).toContain(column.sortBy ?? column.key)
      }
      const params = list.filters.map((filter) => filter.param)
      expect(new Set(params).size).toBe(params.length)
      for (const param of params) {
        expect(RESERVED_PARAMS as readonly string[]).not.toContain(param)
      }
      for (const [param] of Object.entries(definition.filterOptions ?? {})) {
        expect(params).toContain(param)
      }
    })

    it('lives under its area and links its first code column', () => {
      expect(definition.basePath.startsWith(`/${definition.area}`)).toBe(true)
      expect(definition.columns.filter((column) => column.link)).toHaveLength(1)
      expect(definition.editSelect).toMatch(/\bupdated_at\b/)
      expect(definition.listSelect).toMatch(/\bid\b/)
    })
  })
})
