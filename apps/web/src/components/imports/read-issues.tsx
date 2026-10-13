import { useFormatter, useTranslations } from 'next-intl'
import type { IssueSummary, ParseIssueCode } from '@/lib/imports/parse'

const ISSUE_CODES = [
  'ambiguous_decimal',
  'cell_truncated',
  'invalid_characters',
  'numeric_code_cell',
  'error_cell',
  'parse_error',
  'extra_cells',
  'replacement_characters',
] as const satisfies readonly ParseIssueCode[]

/** Whether a summary holds anything worth showing. */
export function hasReadIssues(issues: IssueSummary | null | undefined): boolean {
  return Object.values(issues ?? {}).some((entry) => (entry?.count ?? 0) > 0)
}

/**
 * Things the browser noticed while reading a file (an ambiguous decimal, a cut cell, a wrong
 * delimiter…): they do not stop the import, so they are shown before anything is committed, with
 * up to five examples each. Works in any tree.
 */
export function ReadIssues({
  issues,
  labels,
}: {
  issues: IssueSummary
  /** Display label per contract column. */
  labels?: Readonly<Record<string, string>>
}) {
  const t = useTranslations('ImportsClient')
  const format = useFormatter()
  const codes = ISSUE_CODES.filter((code) => (issues[code]?.count ?? 0) > 0)
  if (codes.length === 0) return null

  return (
    <ul className="flex flex-col gap-2 text-sm">
      {codes.map((code) => {
        const entry = issues[code]
        if (!entry) return null
        return (
          <li key={code} className="flex flex-col gap-0.5">
            <p>
              <span className="text-amber-700 dark:text-amber-400">{t(`issues.${code}`)}</span>{' '}
              <span className="text-muted-foreground tabular-nums">
                ({format.number(entry.count)})
              </span>
            </p>
            {entry.examples.length > 0 ? (
              <ul className="text-muted-foreground flex flex-col gap-0.5 ps-4 text-xs">
                {entry.examples
                  .filter((example) => example.row > 0 || example.value || example.column)
                  .map((example, index) => (
                    <li key={index}>
                      {example.row > 0 ? t('issueExample', { row: example.row }) : null}
                      {example.column ? ` · ${labels?.[example.column] ?? example.column}` : null}
                      {example.value ? (
                        <>
                          {': '}
                          <bdi className="font-mono break-all">{example.value}</bdi>
                        </>
                      ) : null}
                    </li>
                  ))}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
