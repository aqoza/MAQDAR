'use client'

import { cloneElement, useState, type MouseEventHandler, type ReactElement } from 'react'

type FilterFormElement = ReactElement<{
  onClickCapture?: MouseEventHandler<HTMLFormElement>
}>

/** Reset this form's unsaved controls even when its reset URL is already the current URL. */
export function ForecastFilterForm({
  children,
  onReset,
}: {
  children: FilterFormElement
  onReset?: () => void
}) {
  const [revision, setRevision] = useState(0)
  const onClickCapture: MouseEventHandler<HTMLFormElement> = (event) => {
    children.props.onClickCapture?.(event)
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    const link =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>('a[data-forecast-filter-reset]')
        : null
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return
    // Same-URL Next navigation refreshes page data and can discard sibling drafts.
    if (link.href === window.location.href) event.preventDefault()
    onReset?.()
    setRevision((current) => current + 1)
  }

  // Preserve native/Next Form behavior and layout, plus the server's applied-parameter key.
  return cloneElement(children, {
    key: `${children.key ?? 'filters'}:${revision}`,
    onClickCapture,
  })
}
