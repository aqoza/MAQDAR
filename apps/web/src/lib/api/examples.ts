import type { EntityName } from '../imports/contract'

/**
 * Example upsert records per resource, in load order: each example only references codes of
 * earlier examples (or of its own request), so sending them in load order into an empty
 * organization succeeds. The OpenAPI document shows them as request examples and the e2e suite
 * upserts every one. Decimals are canonical strings, as lists return them. The demand date must
 * stay inside the demand history window (partitions 2023-01 to 2027-12, at most tomorrow).
 * Pure module.
 */
export type ExampleRecord = Readonly<Record<string, string | number | boolean | null | number[]>>

export const EXAMPLES: { readonly [E in EntityName]: readonly ExampleRecord[] } = {
  work_calendars: [
    {
      work_calendar_code: 'SA-STD',
      name_en: 'Saudi standard week',
      name_ar: 'أسبوع العمل السعودي',
      country_code: 'SA',
      weekend_days: [5, 6],
      observe_public_holidays: true,
      is_active: true,
    },
  ],
  holiday_overrides: [
    {
      country_code: null,
      work_calendar_code: 'SA-STD',
      starts_on: '2026-12-31',
      ends_on: '2026-12-31',
      kind: 'closure',
      name_en: 'Year-end stocktake',
      name_ar: 'جرد نهاية السنة',
      note: null,
    },
  ],
  locations: [
    {
      location_code: 'RUH-DC',
      name_en: 'Riyadh Central Distribution Centre',
      name_ar: 'مركز التوزيع الرئيسي بالرياض',
      location_type: 'central',
      country_code: 'SA',
      city: 'Riyadh',
      latitude: '24.9247',
      longitude: '46.7764',
      timezone: 'Asia/Riyadh',
      parent_location_code: null,
      is_active: true,
      work_calendar_code: 'SA-STD',
    },
    {
      location_code: 'JED-BR1',
      name_en: 'Jeddah Branch 1',
      name_ar: 'فرع جدة 1',
      location_type: 'branch',
      country_code: 'SA',
      city: 'Jeddah',
      latitude: '21.5433',
      longitude: '39.1728',
      timezone: 'Asia/Riyadh',
      parent_location_code: 'RUH-DC',
      is_active: true,
      work_calendar_code: 'SA-STD',
    },
  ],
  network_links: [
    {
      from_location_code: 'RUH-DC',
      to_location_code: 'JED-BR1',
      lead_time_days_p50: 2,
      lead_time_days_p90: 4,
      freight_basis: 'per_shipment',
      freight_cost: '350',
      currency: 'SAR',
      is_active: true,
    },
  ],
  brands: [
    {
      brand_code: 'FALCON',
      name_en: 'Falcon Genuine Parts',
      name_ar: 'قطع فالكون الأصلية',
      brand_type: 'oem',
      country_of_origin: 'JP',
      is_active: true,
    },
  ],
  items: [
    {
      item_code: 'FAL-BRK-1001',
      name_en: 'Front brake pad set',
      name_ar: 'طقم فحمات فرامل أمامية',
      brand_code: 'FALCON',
      product_group: 'brakes',
      unit_of_measure: 'SET',
      unit_cost: '185.5',
      currency: 'SAR',
      status: 'active',
      introduced_on: '2024-01-15',
      discontinued_on: null,
    },
    {
      item_code: 'FAL-BRK-1002',
      name_en: 'Front brake pad set, low dust',
      name_ar: 'طقم فحمات فرامل أمامية قليلة الغبار',
      brand_code: 'FALCON',
      product_group: 'brakes',
      unit_of_measure: 'SET',
      unit_cost: '199',
      currency: 'SAR',
      status: 'new',
      introduced_on: '2026-06-01',
      discontinued_on: null,
    },
  ],
  item_supersessions: [
    {
      predecessor_item_code: 'FAL-BRK-1001',
      successor_item_code: 'FAL-BRK-1002',
      effective_on: '2026-06-01',
      quantity_factor: '1',
      note: 'New pad compound',
    },
  ],
  item_interchanges: [
    {
      item_code: 'FAL-BRK-1001',
      alternate_item_code: 'FAL-BRK-1002',
      direction: 'one_way',
      priority: 1,
      note: null,
    },
  ],
  suppliers: [
    {
      supplier_code: 'GULF-AUTO',
      name_en: 'Gulf Auto Parts Trading',
      name_ar: 'الخليج لتجارة قطع غيار السيارات',
      country_code: 'AE',
      currency: 'AED',
      lead_time_days_p50: 7,
      lead_time_days_p90: 12,
      is_active: true,
      work_calendar_code: null,
    },
  ],
  supplier_items: [
    {
      supplier_code: 'GULF-AUTO',
      item_code: 'FAL-BRK-1001',
      supplier_part_number: 'GA-04465',
      lead_time_days: 7,
      lead_time_days_p90: 12,
      min_order_quantity: '10',
      pack_size: '1',
      unit_price: '172.25',
      currency: 'AED',
      is_preferred: true,
      valid_from: '2026-01-01',
    },
  ],
  fx_rates: [
    {
      from_currency: 'USD',
      to_currency: 'SAR',
      valid_from: '2026-01-01',
      rate: '3.75',
      note: null,
    },
  ],
  demand_history: [
    {
      item_code: 'FAL-BRK-1001',
      location_code: 'JED-BR1',
      demand_date: '2026-09-01',
      quantity: '3',
      lost_sales_quantity: '0',
      unit_of_measure: 'EA',
    },
  ],
  stock_snapshots: [
    {
      item_code: 'FAL-BRK-1001',
      location_code: 'JED-BR1',
      snapshot_date: '2026-09-30',
      quantity: '12',
      allocated_quantity: '2',
      unit_cost: '172.25',
      currency: 'AED',
      unit_of_measure: 'EA',
    },
  ],
  open_orders: [
    {
      order_code: 'PO-1001',
      line_code: '1',
      item_code: 'FAL-BRK-1001',
      location_code: 'JED-BR1',
      supplier_code: 'GULF-AUTO',
      expected_date: '2026-10-20',
      quantity: '20',
      unit_cost: '172.25',
      currency: 'AED',
      status: 'open',
      unit_of_measure: 'EA',
    },
  ],
  receipts: [
    {
      receipt_code: 'GR-1001',
      line_code: '1',
      item_code: 'FAL-BRK-1001',
      location_code: 'JED-BR1',
      supplier_code: 'GULF-AUTO',
      receipt_date: '2026-09-30',
      quantity: '12',
      unit_cost: '172.25',
      currency: 'AED',
    },
  ],
}
