'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, History, Loader2 } from 'lucide-react'
import { getRastroDeMargen, type RastroMargenEntrada } from '@/app/(app)/negocios/cotizacion-actions'
import { formatBogotaFechaHora } from '@/lib/dates/bogota'

/**
 * Quién movió el margen, cuándo, de cuánto a cuánto y en qué línea.
 *
 * El rastro se ESCRIBE desde que existe `registrarCambioDeMargen`; hasta ahora no lo
 * leía ninguna pantalla, así que "por qué este viaje salió al 3%" tenía respuesta en
 * la base y ninguna en el producto.
 *
 * Se carga bajo demanda, al abrirlo: en la mayoría de las cotizaciones está vacío y
 * una consulta más en cada render del editor no se paga sola.
 */
export default function RastroMargen({ cotizacionId }: { cotizacionId: string }) {
  const [abierto, setAbierto] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [entradas, setEntradas] = useState<RastroMargenEntrada[] | null>(null)
  const [alcance, setAlcance] = useState<'negocio' | 'oportunidad'>('negocio')
  const [error, setError] = useState<string | null>(null)

  const abrir = () => {
    const siguiente = !abierto
    setAbierto(siguiente)
    if (!siguiente || entradas !== null || cargando) return
    setCargando(true)
    getRastroDeMargen(cotizacionId).then((res) => {
      setCargando(false)
      // Un fallo se DICE. Pintar "todavía nadie ha tocado el margen" cuando lo que
      // pasó es que la consulta falló afirma lo contrario de lo que se sabe.
      if (!res.ok) { setError(res.error); return }
      setEntradas(res.entradas)
      setAlcance(res.alcance)
    })
  }

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={abrir}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-accent"
      >
        {abierto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <History className="h-3.5 w-3.5" />
        Historial de cambios de margen
      </button>

      {abierto && (
        <div className="border-t px-3 py-2">
          {cargando && (
            <p className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Cargando…
            </p>
          )}

          {error && (
            <p className="py-2 text-xs text-red-600">No se pudo leer el historial: {error}</p>
          )}

          {!cargando && !error && entradas?.length === 0 && (
            <p className="py-2 text-xs text-muted-foreground">
              Nadie ha cambiado el margen de una línea todavía. Lo que se anote a partir
              de ahora aparece aquí.
            </p>
          )}

          {!cargando && !error && entradas && entradas.length > 0 && (
            <>
              {/* El rastro cuelga del negocio, no de la cotización: `activity_log` no
                  guarda de cuál salió el cambio. Decirlo evita que un cambio hecho en
                  otra variante del mismo viaje se lea como hecho en esta. */}
              <p className="mb-2 text-[10px] text-muted-foreground">
                Cubre {alcance === 'negocio' ? 'todas las cotizaciones de este negocio' : 'toda la oportunidad'}.
              </p>
              <ul className="space-y-2">
                {entradas.map((e) => (
                  <li key={e.id} className="text-xs">
                    <p className="text-foreground">{e.contenido}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {e.autor ?? 'Sin autor registrado'} · {formatBogotaFechaHora(e.creadoEn) ?? '—'}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
