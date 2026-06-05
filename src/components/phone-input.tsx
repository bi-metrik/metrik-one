'use client'

import { useState } from 'react'

// Indicativos telefónicos. Colombia primero (default). Lista acotada a los
// países más frecuentes para el negocio; ampliar aquí si hace falta.
export const COUNTRY_CODES: Array<{ code: string; label: string; flag: string }> = [
  { code: '+57', label: 'Colombia', flag: '🇨🇴' },
  { code: '+1', label: 'EE.UU. / Canadá', flag: '🇺🇸' },
  { code: '+52', label: 'México', flag: '🇲🇽' },
  { code: '+34', label: 'España', flag: '🇪🇸' },
  { code: '+58', label: 'Venezuela', flag: '🇻🇪' },
  { code: '+593', label: 'Ecuador', flag: '🇪🇨' },
  { code: '+51', label: 'Perú', flag: '🇵🇪' },
  { code: '+56', label: 'Chile', flag: '🇨🇱' },
  { code: '+54', label: 'Argentina', flag: '🇦🇷' },
  { code: '+507', label: 'Panamá', flag: '🇵🇦' },
  { code: '+55', label: 'Brasil', flag: '🇧🇷' },
]

export const DEFAULT_DIAL_CODE = '+57'

/** Separa un teléfono guardado ("+57 300 123 4567") en indicativo + número. */
export function splitPhone(value: string | null | undefined): { dial: string; number: string } {
  const v = (value ?? '').trim()
  // El más largo primero, para que +57 no gane sobre +571 etc.
  const found = [...COUNTRY_CODES]
    .sort((a, b) => b.code.length - a.code.length)
    .find((c) => v.startsWith(c.code))
  if (found) return { dial: found.code, number: v.slice(found.code.length).trim() }
  return { dial: DEFAULT_DIAL_CODE, number: v }
}

interface PhoneInputProps {
  /** Número completo con indicativo, p.ej. "+57 300 123 4567" (o vacío). */
  value: string
  onChange: (fullNumber: string) => void
  placeholder?: string
  disabled?: boolean
  /** Clases para el contenedor (el parent controla ancho/espaciado). */
  className?: string
  /** Clases para el input de número (para igualar el estilo del form host). */
  inputClassName?: string
}

/**
 * Input de teléfono con selector de indicativo por país (default +57 Colombia).
 * Emite el valor combinado "{indicativo} {numero}" o "" si el número está vacío.
 */
export function PhoneInput({
  value,
  onChange,
  placeholder = '300 123 4567',
  disabled,
  className = '',
  inputClassName = '',
}: PhoneInputProps) {
  const init = splitPhone(value)
  const [dial, setDial] = useState(init.dial)
  const [number, setNumber] = useState(init.number)

  function emit(d: string, n: string) {
    const clean = n.trim()
    onChange(clean ? `${d} ${clean}` : '')
  }

  return (
    <div className={`flex gap-2 ${className}`}>
      <select
        value={dial}
        disabled={disabled}
        onChange={(e) => { setDial(e.target.value); emit(e.target.value, number) }}
        aria-label="Indicativo de país"
        className="shrink-0 rounded-md border bg-background px-2 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60"
      >
        {COUNTRY_CODES.map((c) => (
          <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
        ))}
      </select>
      <input
        type="tel"
        value={number}
        disabled={disabled}
        onChange={(e) => { setNumber(e.target.value); emit(dial, e.target.value) }}
        placeholder={placeholder}
        className={inputClassName || 'w-full rounded-md border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60'}
      />
    </div>
  )
}
