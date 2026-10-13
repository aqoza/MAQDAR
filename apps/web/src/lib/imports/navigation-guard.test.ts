import { describe, expect, it } from 'vitest'
import { leavesPage, type GuardClick, type GuardLink } from './navigation-guard'

const HERE = 'https://maqdar.test/imports/new'
const click = (patch: Partial<GuardClick> = {}): GuardClick => ({
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
  ...patch,
})
const link = (href: string, patch: Partial<GuardLink> = {}): GuardLink => ({
  href,
  target: '',
  download: false,
  ...patch,
})

describe('leavesPage', () => {
  it('guards a plain click on an in-app link to another page (sidebar, header, history)', () => {
    expect(leavesPage(click(), link('/items'), HERE)).toBe(true)
    expect(leavesPage(click(), link('https://maqdar.test/imports'), HERE)).toBe(true)
    expect(leavesPage(click(), link('/imports/new?entity=items'), HERE)).toBe(true)
  })

  it('lets new tabs, downloads and modified or non-primary clicks through', () => {
    expect(leavesPage(click(), link('/imports/abc', { target: '_blank' }), HERE)).toBe(false)
    expect(
      leavesPage(click(), link('/api/imports/templates/items', { download: true }), HERE),
    ).toBe(false)
    expect(leavesPage(click({ ctrlKey: true }), link('/items'), HERE)).toBe(false)
    expect(leavesPage(click({ metaKey: true }), link('/items'), HERE)).toBe(false)
    expect(leavesPage(click({ shiftKey: true }), link('/items'), HERE)).toBe(false)
    expect(leavesPage(click({ button: 1 }), link('/items'), HERE)).toBe(false)
    expect(leavesPage(click({ defaultPrevented: true }), link('/items'), HERE)).toBe(false)
  })

  it('ignores other origins and anchors on the same page', () => {
    expect(leavesPage(click(), link('https://example.com/'), HERE)).toBe(false)
    expect(leavesPage(click(), link('#files'), HERE)).toBe(false)
    expect(leavesPage(click(), link('/imports/new'), HERE)).toBe(false)
  })
})
