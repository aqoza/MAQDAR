/**
 * Whether a click on a link would leave the page inside the app (a client-side navigation that
 * `beforeunload` never sees) and so should be confirmed while an import is being checked or
 * committed. New tabs, downloads, modified clicks, other origins and same-page anchors leave the
 * import running and are not guarded. Pure, so Vitest covers it.
 */

export type GuardClick = {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  defaultPrevented: boolean
}

export type GuardLink = {
  href: string
  target: string
  download: boolean
}

export function leavesPage(click: GuardClick, link: GuardLink, current: string): boolean {
  if (click.defaultPrevented || click.button !== 0) return false
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false
  if (link.download || (link.target !== '' && link.target !== '_self')) return false
  let next: URL
  let here: URL
  try {
    here = new URL(current)
    next = new URL(link.href, current)
  } catch {
    return false
  }
  if (next.origin !== here.origin) return false
  return next.pathname !== here.pathname || next.search !== here.search
}
