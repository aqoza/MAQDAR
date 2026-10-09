import { describe, expect, it } from 'vitest'
import { findViolations, splitVariants } from '../../scripts/check-logical-utilities.mjs'

const tokens = (text: string, css = false) => findViolations(text, { css }).map((v) => v.token)

describe('check-logical-utilities', () => {
  it('flags physical inline utilities', () => {
    expect(
      tokens('<div className="pl-4 mr-2 left-0 text-right border-l rounded-tl-lg -right-2" />'),
    ).toEqual(['pl-4', 'mr-2', 'left-0', 'text-right', 'border-l', 'rounded-tl-lg', '-right-2'])
  })

  it('accepts logical utilities and look-alikes', () => {
    expect(
      tokens(
        '<div className="ps-4 me-2 inset-s-0 text-start border-s rounded-ss-lg rounded-lg place-items-center print:hidden leading-6 border-lime-500 px-2 inset-x-0" />',
      ),
    ).toEqual([])
  })

  it('allows intentionally physical classes under rtl/ltr and side variants', () => {
    expect(
      tokens('"ltr:-translate-x-1 rtl:text-left data-[side=left]:left-0 md:rtl:pl-2"'),
    ).toEqual([])
    expect(tokens('"md:pl-2"')).toEqual(['md:pl-2'])
  })

  it('ignores comments and import lines', () => {
    expect(tokens("import { left } from 'left-pad'\n// ml-2 in a comment\n/* pr-4 */")).toEqual([])
  })

  it('checks only @apply lines in CSS', () => {
    expect(tokens('.x { padding-left: 1rem; }\n.y { @apply pl-4 ps-2; }', true)).toEqual(['pl-4'])
  })

  it('splits variants without breaking arbitrary values', () => {
    expect(splitVariants('md:data-[state=open]:ps-[calc(1rem+2px)]')).toEqual({
      variants: ['md', 'data-[state=open]'],
      base: 'ps-[calc(1rem+2px)]',
    })
  })
})
