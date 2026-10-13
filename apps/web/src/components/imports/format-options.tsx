'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { ENCODINGS, isEncodingChoice } from '@/lib/imports/encoding'
import { DATE_ORDERS, displayRawCell, type DateOrder } from '@/lib/imports/normalize'
import { PreviewTable } from './preview-table'
import {
  DELIMITER_NAMES,
  delimiterName,
  type DelimiterName,
  type FileOptions,
  type WizardFile,
} from './wizard-state'

export type FormatOptionsProps = {
  file: WizardFile
  disabled?: boolean
  onChange: (patch: Partial<FileOptions>) => void
  /** Copies this file's decimal separator and date order to every file. */
  onApplyToAll?: () => void
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-48 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  )
}

/**
 * How one file is read: encoding and delimiter (CSV, TSV, TXT) or sheet (XLSX), then the decimal
 * separator and date order, which are declared and never guessed. Shows the first rows as read.
 */
export function FormatOptions({ file, disabled, onChange, onApplyToAll }: FormatOptionsProps) {
  const t = useTranslations('ImportsClient')
  const inspect = file.inspect
  const id = (name: string) => `format-${file.id}-${name}`
  const isCsv = inspect?.format === 'csv'

  const delimiterValue: DelimiterName | 'auto' =
    file.options.delimiter === 'auto' ? 'auto' : delimiterName(file.options.delimiter)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4">
        {isCsv ? (
          <>
            <Field id={id('encoding')} label={t('format.encoding')}>
              <NativeSelect
                id={id('encoding')}
                value={file.options.encoding}
                disabled={disabled}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  if (isEncodingChoice(value)) onChange({ encoding: value })
                }}
              >
                <NativeSelectOption value="auto">{t('format.encodingAuto')}</NativeSelectOption>
                {ENCODINGS.map((encoding) => (
                  <NativeSelectOption key={encoding} value={encoding}>
                    {t(`format.encodings.${encoding}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {inspect?.encoding ? (
                <p className="text-muted-foreground text-xs">
                  {t('format.encodingDetected', {
                    encoding: t(`format.encodings.${inspect.encoding.encoding}`),
                  })}
                </p>
              ) : null}
            </Field>
            <Field id={id('delimiter')} label={t('format.delimiter')}>
              <NativeSelect
                id={id('delimiter')}
                value={delimiterValue}
                disabled={disabled}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  onChange({
                    delimiter: value === 'auto' ? 'auto' : DELIMITER_NAMES[value as DelimiterName],
                  })
                }}
              >
                <NativeSelectOption value="auto">{t('format.delimiterAuto')}</NativeSelectOption>
                {(Object.keys(DELIMITER_NAMES) as DelimiterName[]).map((name) => (
                  <NativeSelectOption key={name} value={name}>
                    {t(`format.delimiters.${name}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {inspect?.dialect ? (
                <p className="text-muted-foreground text-xs">
                  {inspect.dialect.detected
                    ? t('format.delimiterDetected', {
                        delimiter: t(
                          `format.delimiters.${delimiterName(inspect.dialect.delimiter)}`,
                        ),
                      })
                    : t('format.delimiterFallback')}
                </p>
              ) : null}
            </Field>
          </>
        ) : inspect ? (
          <Field id={id('sheet')} label={t('format.sheet')}>
            <NativeSelect
              id={id('sheet')}
              value={inspect.sheet ?? ''}
              disabled={disabled}
              onChange={(event) => onChange({ sheet: event.currentTarget.value || null })}
            >
              {inspect.sheets.map((sheet) => (
                <NativeSelectOption key={sheet.name} value={sheet.name}>
                  {sheet.hidden ? t('format.hiddenSheet', { name: sheet.name }) : sheet.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {inspect.date1904 ? (
              <p className="text-muted-foreground text-xs">{t('format.date1904')}</p>
            ) : null}
          </Field>
        ) : null}
        <Field id={id('decimal')} label={t('format.decimalSeparator')}>
          <NativeSelect
            id={id('decimal')}
            value={file.options.decimalSeparator === ',' ? 'comma' : 'dot'}
            disabled={disabled}
            onChange={(event) =>
              onChange({ decimalSeparator: event.currentTarget.value === 'comma' ? ',' : '.' })
            }
          >
            <NativeSelectOption value="dot">{t('format.decimalSeparators.dot')}</NativeSelectOption>
            <NativeSelectOption value="comma">
              {t('format.decimalSeparators.comma')}
            </NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field id={id('dates')} label={t('format.dateOrder')}>
          <NativeSelect
            id={id('dates')}
            value={file.options.dateOrder}
            disabled={disabled}
            onChange={(event) => {
              const value = event.currentTarget.value
              if ((DATE_ORDERS as readonly string[]).includes(value)) {
                onChange({ dateOrder: value as DateOrder })
              }
            }}
          >
            {DATE_ORDERS.map((order) => (
              <NativeSelectOption key={order} value={order}>
                {t(`format.dateOrders.${order}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {onApplyToAll ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onApplyToAll}
          >
            {t('format.applyToAll')}
          </Button>
        </div>
      ) : null}
      {inspect ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('format.preview')}</h3>
          {inspect.preview.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('format.noRows')}</p>
          ) : (
            <PreviewTable
              columns={inspect.header.map((label, index) => ({
                key: String(index),
                label: label === '' ? t('map.blankHeader', { index: index + 1 }) : label,
              }))}
              rows={inspect.preview.map((row) =>
                inspect.header.map((_, index) => displayRawCell(row[index])),
              )}
              emptyLabel={t('summary.empty')}
            />
          )}
        </div>
      ) : null}
    </div>
  )
}
