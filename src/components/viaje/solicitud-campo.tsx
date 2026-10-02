'use client'

/**
 * La respuesta de un toque a un campo de la solicitud (Noor, §2.2 pieza 2): chips para un select,
 * «No / Sí → ¿Cuántos?» para niños e infantes, chips 1-4 + «Otro» para un número, un campo de
 * fecha, uno por menor para las edades y una línea para el texto. La usan «lo que falta» y la
 * edición en su sitio de la revisión. Cada respuesta se guarda sola al tocar: no hay «Guardar».
 */

import { useState } from 'react'
import { BTN, BTN_ELEGIDO, INPUT } from './estilo'

export interface CampoSolicitud {
  slug: string
  label?: string
  tipo: string
  pregunta?: string
  nivel?: 'minimo' | 'deseable' | string
  pedir_si?: unknown
  required?: boolean
  default?: unknown
  options?: string[]
  opciones?: Array<{ value: string; label?: string }>
  suma_de?: string[]
  lo_llena?: string
  showIf?: { field: string; equals: unknown }
}

/** Chips de al menos 44 px de alto en el celular (§2.5). */
const CHIP = 'min-h-11 sm:min-h-0'

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export function opcionesDe(f: CampoSolicitud): Array<{ value: string; label: string }> {
  if (Array.isArray(f.opciones) && f.opciones.length > 0) return f.opciones.map(o => ({ value: String(o.value), label: o.label ?? String(o.value) }))
  return (f.options ?? []).map(o => ({ value: o, label: o }))
}

export const vacio = (v: unknown) => v === '' || v === null || v === undefined

/** El valor como se le dice a una persona: «14 mar», la etiqueta de la opción, el número. */
export function legibleCampo(f: CampoSolicitud, v: unknown): string {
  if (vacio(v)) return '—'
  if (f.tipo === 'fecha') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v))
    if (m) return `${Number(m[3])} ${MESES[Number(m[2]) - 1]}`
  }
  const op = opcionesDe(f).find(o => o.value === String(v))
  return op?.label ?? String(v)
}

/** Niños e infantes se preguntan «¿Viajan…? No · Sí»: un cero es una respuesta, no un vacío. */
const SLUGS_MENORES = new Set(['ninos', 'infantes'])
const SLUG_EDADES = 'edades_menores'

function hoyISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
}

function Otro({ onGuardar }: { onGuardar: (n: number) => void }) {
  const [abierto, setAbierto] = useState(false)
  const [txt, setTxt] = useState('')
  if (!abierto) return <button type="button" className={`${BTN} ${CHIP}`} onClick={() => setAbierto(true)}>Otro</button>
  const listo = () => {
    const n = Number(txt.replace(/\D/g, ''))
    if (txt.trim() && Number.isFinite(n)) onGuardar(n)
  }
  return (
    <input
      autoFocus
      type="text"
      inputMode="numeric"
      aria-label="Otro número"
      className={`${INPUT} w-20`}
      value={txt}
      onChange={e => setTxt(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') listo(); if (e.key === 'Escape') setAbierto(false) }}
      onBlur={listo}
    />
  )
}

function Numero({ valor, onGuardar, hasta }: { valor: unknown; onGuardar: (v: number) => void; hasta: number }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: hasta }, (_, i) => i + 1).map(n => (
        <button key={n} type="button" className={`${String(valor) === String(n) ? BTN_ELEGIDO : BTN} ${CHIP}`} onClick={() => onGuardar(n)}>{n}</button>
      ))}
      <Otro onGuardar={onGuardar} />
    </div>
  )
}

function Menores({ valor, onGuardar }: { valor: unknown; onGuardar: (v: number) => void }) {
  const [si, setSi] = useState(!vacio(valor) && Number(valor) > 0)
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={`${String(valor) === '0' ? BTN_ELEGIDO : BTN} ${CHIP}`} onClick={() => { setSi(false); onGuardar(0) }}>No</button>
        <button type="button" className={`${si ? BTN_ELEGIDO : BTN} ${CHIP}`} onClick={() => setSi(true)}>Sí</button>
      </div>
      {si && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] text-[#6E6A62]">¿Cuántos?</span>
          <Numero valor={valor} onGuardar={onGuardar} hasta={3} />
        </div>
      )}
    </div>
  )
}

function Edades({ valor, cuantos, onGuardar }: { valor: unknown; cuantos: number; onGuardar: (v: string) => void }) {
  const iniciales = String(valor ?? '').split(/[,;]\s*/).filter(Boolean)
  const n = Math.max(1, cuantos || iniciales.length || 1)
  const [edades, setEdades] = useState<string[]>(() => Array.from({ length: n }, (_, i) => iniciales[i] ?? ''))
  const guardar = (lista: string[]) => {
    if (lista.every(e => e.trim() !== '')) onGuardar(lista.map(e => e.trim()).join(', '))
  }
  return (
    <div className="flex flex-wrap gap-2">
      {edades.map((e, i) => (
        <label key={i} className="flex items-center gap-1 text-[13px] text-[#6E6A62]">
          {`Niño ${i + 1}`}
          <input
            type="text"
            inputMode="numeric"
            className={`${INPUT} w-14`}
            value={e}
            onChange={ev => setEdades(prev => prev.map((x, j) => (j === i ? ev.target.value.replace(/[^\d.,]/g, '') : x)))}
            onBlur={() => guardar(edades)}
            onKeyDown={ev => { if (ev.key === 'Enter') guardar(edades) }}
          />
        </label>
      ))}
    </div>
  )
}

function Texto({ valor, onGuardar, onCancelar, autoFocus }: { valor: unknown; onGuardar: (v: string) => void; onCancelar?: () => void; autoFocus?: boolean }) {
  const [txt, setTxt] = useState(String(valor ?? ''))
  const listo = () => { if (txt.trim() && txt.trim() !== String(valor ?? '').trim()) onGuardar(txt.trim()) }
  return (
    <input
      type="text"
      autoFocus={autoFocus}
      className={`${INPUT} max-w-sm`}
      value={txt}
      onChange={e => setTxt(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') listo(); if (e.key === 'Escape') onCancelar?.() }}
      onBlur={listo}
    />
  )
}

/**
 * El control de un campo. `valores` son los del bloque (para saber cuántos menores hay).
 * `onCancelar` (Esc) solo lo pasa la edición en su sitio.
 */
export function RespuestaCampo({
  campo,
  valor,
  valores,
  onGuardar,
  onCancelar,
  autoFocus,
}: {
  campo: CampoSolicitud
  valor: unknown
  valores: Record<string, unknown>
  onGuardar: (v: unknown) => void
  onCancelar?: () => void
  autoFocus?: boolean
}) {
  const ops = opcionesDe(campo)
  if (ops.length > 0) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {ops.map(o => (
          <button key={o.value} type="button" className={`${String(valor) === o.value ? BTN_ELEGIDO : BTN} ${CHIP}`} onClick={() => onGuardar(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    )
  }
  if (campo.tipo === 'numero') {
    if (SLUGS_MENORES.has(campo.slug)) return <Menores valor={valor} onGuardar={onGuardar} />
    return <Numero valor={valor} onGuardar={onGuardar} hasta={4} />
  }
  if (campo.tipo === 'fecha') {
    return (
      <input
        type="date"
        autoFocus={autoFocus}
        min={hoyISO()}
        className={`${INPUT} max-w-[11rem]`}
        defaultValue={typeof valor === 'string' ? valor.slice(0, 10) : ''}
        onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) onGuardar(e.target.value) }}
        onKeyDown={e => { if (e.key === 'Escape') onCancelar?.() }}
      />
    )
  }
  if (campo.slug === SLUG_EDADES) {
    const n = (Number(valores.ninos) || 0) + (Number(valores.infantes) || 0)
    return <Edades valor={valor} cuantos={n} onGuardar={onGuardar} />
  }
  return <Texto valor={valor} onGuardar={onGuardar} onCancelar={onCancelar} autoFocus={autoFocus} />
}
