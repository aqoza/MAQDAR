/**
 * Organization slugs mirror the database check constraint on public.organizations.slug:
 * lower-case ASCII letters and digits separated by single hyphens, at most 64 characters.
 */
export const SLUG_MAX_LENGTH = 64

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Derives a slug from a display name: diacritics are folded to ASCII, everything else outside
 * [a-z0-9] collapses into a single hyphen, leading/trailing hyphens are trimmed and the result is
 * capped at SLUG_MAX_LENGTH. Names without ASCII letters or digits (Arabic, empty) yield ''.
 */
export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, '')
}
