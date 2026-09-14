'use client'

import { useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AtSign, X } from 'lucide-react'
import {
  consultaMencion,
  filtrarEquipo,
  MAX_RESPONSABLE_TEXTO,
  type MiembroEquipo,
  type Responsable,
} from '@/lib/cronograma/responsable'

interface ResponsableInputProps {
  /** Solo los activos: a alguien que salió del equipo no se le asigna trabajo nuevo. */
  equipo: MiembroEquipo[]
  valor: Responsable
  /** El nombre de la persona elegida, aunque ya no esté activa. */
  nombreElegido: string | null
  onChange: (valor: Responsable) => void
}

/**
 * Responsable de un paso: «@» abre el equipo; cualquier otra cosa se guarda como texto.
 *
 * La lista va en un portal con posición fija porque la tabla del cronograma vive dentro
 * de un contenedor con scroll horizontal, y ese contenedor recorta todo lo que sobresale:
 * en la última fila la lista quedaba invisible debajo del borde.
 */
export default function ResponsableInput({ equipo, valor, nombreElegido, onChange }: ResponsableInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const listaId = useId()
  const [texto, setTexto] = useState(valor.responsable_texto ?? '')
  const [activo, setActivo] = useState(0)
  const [cerrada, setCerrada] = useState(false)
  const [posicion, setPosicion] = useState<{ top: number; left: number; width: number } | null>(null)

  const consulta = valor.responsable_id ? null : consultaMencion(texto)
  const abierta = consulta !== null && !cerrada
  const opciones = abierta ? filtrarEquipo(equipo, consulta) : []

  useLayoutEffect(() => {
    if (!abierta || !inputRef.current) return
    const medir = () => {
      const r = inputRef.current!.getBoundingClientRect()
      setPosicion({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 200) })
    }
    medir()
    window.addEventListener('scroll', medir, true)
    window.addEventListener('resize', medir)
    return () => {
      window.removeEventListener('scroll', medir, true)
      window.removeEventListener('resize', medir)
    }
  }, [abierta])

  function elegir(m: MiembroEquipo) {
    setTexto('')
    setCerrada(false)
    onChange({ responsable_id: m.id, responsable_texto: null })
  }

  function quitarPersona() {
    onChange({ responsable_id: null, responsable_texto: null })
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  if (valor.responsable_id) {
    return (
      <span className="inline-flex max-w-[180px] items-center gap-1 rounded-full bg-acento/10 py-0.5 pl-2 pr-1 text-xs text-acento">
        <AtSign className="h-3 w-3 shrink-0" />
        <span className="truncate">{nombreElegido ?? 'Persona del equipo'}</span>
        <button
          type="button"
          onClick={quitarPersona}
          className="rounded-full p-0.5 hover:bg-acento/15"
          aria-label="Quitar responsable"
        >
          <X className="h-3 w-3" />
        </button>
      </span>
    )
  }

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={texto}
        maxLength={MAX_RESPONSABLE_TEXTO}
        placeholder="@persona o texto"
        onChange={e => {
          setTexto(e.target.value)
          setActivo(0)
          setCerrada(false)
          onChange({ responsable_id: null, responsable_texto: e.target.value })
        }}
        onKeyDown={e => {
          if (!abierta) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActivo(i => Math.min(i + 1, Math.max(opciones.length - 1, 0)))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActivo(i => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && opciones[activo]) {
            e.preventDefault()
            elegir(opciones[activo])
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setCerrada(true)
          }
        }}
        onBlur={() => setCerrada(true)}
        onFocus={() => setCerrada(false)}
        role="combobox"
        aria-label="Responsable"
        aria-expanded={abierta}
        aria-controls={listaId}
        aria-autocomplete="list"
        className="w-full min-w-[130px] rounded border border-[#E5E7EB] px-1.5 py-1 text-xs focus:border-acento focus:outline-none"
      />
      {abierta && posicion && createPortal(
        <ul
          id={listaId}
          role="listbox"
          style={{ position: 'fixed', top: posicion.top, left: posicion.left, width: posicion.width }}
          className="z-[100] max-h-56 overflow-y-auto rounded-lg border border-[#E5E7EB] bg-white py-1 text-xs shadow-lg"
        >
          {opciones.length === 0 ? (
            <li className="px-3 py-2 text-tinta-suave">
              {equipo.length === 0 ? 'No hay personas en el equipo' : 'Nadie coincide. Se guarda como texto.'}
            </li>
          ) : (
            opciones.map((m, i) => (
              <li key={m.id} role="option" aria-selected={i === activo}>
                <button
                  type="button"
                  // mousedown y no click: el blur del input cierra la lista antes del click.
                  onMouseDown={e => { e.preventDefault(); elegir(m) }}
                  onMouseEnter={() => setActivo(i)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${i === activo ? 'bg-acento/10 text-acento' : 'text-tinta'}`}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-medium text-tinta-suave">
                    {(m.full_name ?? '?').trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="truncate">{m.full_name}</span>
                </button>
              </li>
            ))
          )}
        </ul>,
        document.body,
      )}
    </>
  )
}
