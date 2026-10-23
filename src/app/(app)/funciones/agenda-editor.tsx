'use client'

import { useEffect, useMemo, useState } from 'react'
import { leerAgenda } from '@/lib/funciones/agenda-texto'
import { preventaPasaLaFuncion } from '@/lib/funciones/reglas'
import type { LineaAgenda } from './actions'

type ModoPreventa = 'ninguna' | 'todas' | 'elegir'

/**
 * La agenda de una campaña, una función por línea (P3). ONE lee cada línea al escribirla y muestra su lectura completa
 * (día, fecha, a. m. o p. m.): las horas de 1 a 11 sin «a. m.» se leen como p. m., siempre a la vista. Una línea con
 * error queda en rojo y `onCambio` recibe `null`: no deja seguir. La preventa (P4) es un interruptor por función, con
 * una fecha de fin para las que la llevan; esa fecha no puede pasar el día de ninguna de ellas.
 */
export function AgendaEditor({ onCambio, ahoraMs }: { onCambio: (lineas: LineaAgenda[] | null) => void; ahoraMs: number }) {
  const [texto, setTexto] = useState('')
  const [modo, setModo] = useState<ModoPreventa>('ninguna')
  const [preventa, setPreventa] = useState<Set<string>>(new Set())
  const [hasta, setHasta] = useState('')
  const lecturas = useMemo(() => leerAgenda(texto, ahoraMs), [texto, ahoraMs])
  const errores = lecturas.filter((l) => !l.ok).length
  const lineas = useMemo(
    () =>
      lecturas.flatMap((l) => {
        if (!l.ok) return []
        const es = modo === 'todas' || (modo === 'elegir' && preventa.has(`${l.fecha} ${l.hora}`))
        return [{ fecha: l.fecha, hora: l.hora, es_preventa: es, preventa_hasta: es && hasta ? hasta : null }]
      }),
    [lecturas, modo, preventa, hasta],
  )
  const preventaPasa = lineas.find((l) => preventaPasaLaFuncion(l.preventa_hasta, l.fecha))

  useEffect(() => {
    if (lecturas.length === 0 || errores > 0 || preventaPasa) return onCambio(null)
    onCambio(lineas)
  }, [lecturas.length, errores, preventaPasa, lineas, onCambio])

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-sm font-medium text-[#1A1A1A]">Funciones (una por línea)</span>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={6}
          placeholder={'sábado 24 a la 1\nsábado 24 a las 5\ndomingo 25 a las 7'}
          className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-base"
          autoCapitalize="none"
        />
      </label>

      {lecturas.length > 0 && (
        <ul className="space-y-1 rounded-md border border-[#E5E7EB] bg-white p-2 text-sm" aria-label="Vista previa de la agenda">
          {lecturas.map((l, i) =>
            l.ok ? (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="text-[#059669]">✓ {l.lectura}</span>
                {modo === 'elegir' && (
                  <button
                    type="button"
                    onClick={() => {
                      const k = `${l.fecha} ${l.hora}`
                      const nuevo = new Set(preventa)
                      if (nuevo.has(k)) nuevo.delete(k)
                      else nuevo.add(k)
                      setPreventa(nuevo)
                    }}
                    className={`rounded-full border px-2 py-0.5 text-xs ${preventa.has(`${l.fecha} ${l.hora}`) ? 'border-[#10B981] bg-emerald-50 text-[#059669]' : 'border-[#E5E7EB] text-[#6B7280]'}`}
                  >
                    Preventa
                  </button>
                )}
              </li>
            ) : (
              <li key={i} className="text-red-600">
                ✗ «{l.linea}»: {l.error}
              </li>
            ),
          )}
        </ul>
      )}
      {errores > 0 && <p className="text-xs text-red-600">Corrige las líneas en rojo para seguir.</p>}
      <p className="text-xs text-[#6B7280]">Las horas de 1 a 11 sin «a. m.» se leen como p. m.</p>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-[#6B7280]">Preventa:</span>
        {(['ninguna', 'todas', 'elegir'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setModo(m)}
            className={`h-9 rounded-full border px-3 ${modo === m ? 'border-[#10B981] bg-emerald-50 text-[#059669]' : 'border-[#E5E7EB]'}`}
          >
            {m === 'ninguna' ? 'Ninguna' : m === 'todas' ? 'Todas' : 'Elegir'}
          </button>
        ))}
      </div>
      {modo !== 'ninguna' && (
        <label className="block text-sm">
          Preventa hasta (inclusive)
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="mt-1 h-11 w-full rounded-md border border-[#E5E7EB] px-3 text-base" />
          <span className="text-xs text-[#6B7280]">Vacía: sin fecha de fin. Después de esa fecha rige el precio regular.</span>
        </label>
      )}
      {preventaPasa && <p className="text-xs text-red-600">La preventa no puede terminar después de una de sus funciones ({preventaPasa.fecha}).</p>}
    </div>
  )
}
