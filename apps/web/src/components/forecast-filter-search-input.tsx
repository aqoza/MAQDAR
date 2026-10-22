'use client'

import { useId, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import styles from './forecast-quality.module.css'

/** Shared search treatment for the server-filtered forecast histories and workbench. */
export function ForecastFilterSearchInput({
  id,
  name = 'q',
  defaultValue = '',
  label,
  placeholder,
  clearLabel,
  maxLength = 100,
  className,
}: {
  id?: string
  name?: string
  defaultValue?: string
  label: string
  placeholder?: string
  clearLabel: string
  maxLength?: number
  className?: string
}) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const [value, setValue] = useState(defaultValue)
  const input = useRef<HTMLInputElement>(null)

  return (
    <div className={`${styles.field}${className ? ` ${className}` : ''}`}>
      <label htmlFor={inputId}>{label}</label>
      <span className={styles.searchBox}>
        <Search aria-hidden="true" />
        <input
          id={inputId}
          ref={input}
          name={name}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={maxLength}
          placeholder={placeholder}
          autoComplete="off"
          dir="auto"
        />
        {value && (
          <button
            type="button"
            className={styles.clear}
            aria-label={clearLabel}
            onClick={() => {
              setValue('')
              input.current?.focus()
            }}
          >
            <X aria-hidden="true" />
          </button>
        )}
      </span>
    </div>
  )
}
