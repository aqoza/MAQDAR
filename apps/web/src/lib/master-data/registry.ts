/**
 * Registry of master-data entities: the allow-list the save and delete actions pick from (by the
 * hidden `entity` field) and the lookup ListScreen / EditScreen use. See types.ts for the
 * definition contract.
 *
 * Adding an entity (copy entities/items.ts and the /items routes):
 *  1. Write `entities/<entity>.ts` exporting `defineEntity({...})`; its zod schema goes there or in
 *     schemas.ts, with tests next to it (`entities/<entity>.test.ts` or schemas.test.ts).
 *  2. Add its namespace to messages/en.json (title, description, newTitle, columns, fields,
 *     filters, options, hints, deleteWarning) and the area tab label under MasterData.tabs if new.
 *  3. Register it below: one import line and one entry line, keeping both lists alphabetical.
 *  4. Add the routes: `<basePath>/page.tsx` → `<ListScreen entity="<key>" searchParams={…} />`,
 *     `<basePath>/new/page.tsx` → `<EditScreen entity="<key>" />`,
 *     `<basePath>/[id]/page.tsx` → `<EditScreen entity="<key>" id={id} searchParams={…} />`.
 */
import { brands } from './entities/brands'
import { fxRates } from './entities/fx-rates'
import { holidayOverrides } from './entities/holiday-overrides'
import { interchanges } from './entities/interchanges'
import { items } from './entities/items'
import { locations } from './entities/locations'
import { networkLinks } from './entities/network-links'
import { supersessions } from './entities/supersessions'
import { supplierItems } from './entities/supplier-items'
import { suppliers } from './entities/suppliers'
import { workCalendars } from './entities/work-calendars'
import type { EntityDefinition } from './types'

const ENTITIES = {
  brands,
  fxRates,
  holidayOverrides,
  interchanges,
  items,
  locations,
  networkLinks,
  supersessions,
  supplierItems,
  suppliers,
  workCalendars,
} satisfies Record<string, EntityDefinition<unknown>>

export type EntityKey = keyof typeof ENTITIES

export function isEntityKey(value: unknown): value is EntityKey {
  return typeof value === 'string' && Object.hasOwn(ENTITIES, value)
}

/** The definition with its input type erased (the actions only pass it the schema's own output). */
export function getEntity(key: EntityKey): EntityDefinition<unknown> {
  return ENTITIES[key] as unknown as EntityDefinition<unknown>
}

export function entityKeys(): EntityKey[] {
  return Object.keys(ENTITIES) as EntityKey[]
}
