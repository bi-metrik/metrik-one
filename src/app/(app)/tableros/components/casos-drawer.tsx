'use client'

/**
 * Panel lateral con los casos detrás de un número de la tabla de proceso.
 *
 * El tablero dice "17 en Precobro" y hasta ahora había que ir a buscarlos a mano. Al
 * hacer clic en cualquier número mayor que cero se abre esta lista, ya filtrada por la
 * misma etapa, seccional y métrica de la celda en la que se hizo clic.
 *
 * Se carga bajo demanda: la tabla no arrastra el detalle de los 77 casos por si acaso.
 */

import { useEffect, useState } from 'react'
import { X, ExternalLink, AlertTriangle, RotateCcw } from 'lucide-react'
import Link from 'next/link'
import { getCasosDeEtapa, type CasoEnEtapa } from '../actions'

const CARBON = '#1A1A1A'
const GRIS = '#6B7280'
const BORDE = '#E5E7EB'
const ROJO = '#B91C1C'
const OCRE = '#92400E'

export interface CeldaSeleccionada {
  etapaId: string
  etapaNombre: string
  etapaNumero: number
  /**
   * `undefined` = todas las seccionales. `null` = solo los que no la tienen.
   * Un arreglo abre una columna que agrupa varias (el caso de "Sin cita").
   */
  seccional?: string | string[] | null
  /** Cómo nombrar el alcance en el encabezado cuando `seccional` es un grupo. */
  seccionalLabel?: string
  soloVencidos: boolean
  soloReproceso?: boolean
}

export function CasosDrawer({
  celda,
  onClose,
}: {
  celda: CeldaSeleccionada
  onClose: () => void
}) {
  const [casos, setCasos] = useState<CasoEnEtapa[] | null>(null)

  // El padre monta este panel con `key` por celda, así que al cambiar de celda el
  // componente se remonta y el estado arranca vacío solo. No hace falta resetearlo
  // dentro del efecto, que además dispara renders en cascada.
  useEffect(() => {
    let vivo = true
    void getCasosDeEtapa({
      etapaId: celda.etapaId,
      seccional: celda.seccional,
      soloVencidos: celda.soloVencidos,
      soloReproceso: celda.soloReproceso,
    }).then(r => {
      if (vivo) setCasos(r)
    })
    return () => {
      vivo = false
    }
  }, [celda.etapaId, celda.seccional, celda.soloVencidos, celda.soloReproceso])

  // Escape cierra, como el resto de los paneles del producto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const alcanceSeccional =
    celda.seccional === undefined
      ? null
      : Array.isArray(celda.seccional)
        ? celda.seccionalLabel ?? celda.seccional.join(', ')
        : celda.seccional ?? 'sin seccional registrada'

  const alcance = [
    alcanceSeccional,
    celda.soloVencidos ? 'solo atrasados' : null,
    celda.soloReproceso ? 'en reproceso' : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />

      <div className="fixed inset-y-0 right-0 z-[60] w-full max-w-md animate-in slide-in-from-right duration-200">
        <div className="flex h-full flex-col bg-white shadow-2xl">
          <div
            className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3"
            style={{ borderColor: BORDE }}
          >
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold" style={{ color: CARBON }}>
                <span className="tabular-nums" style={{ color: GRIS }}>
                  {String(celda.etapaNumero).padStart(2, '0')}
                </span>{' '}
                {celda.etapaNombre}
              </h2>
              {alcance && (
                <p className="mt-0.5 text-[11px]" style={{ color: GRIS }}>
                  {alcance}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 hover:bg-[#F5F4F2]"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" style={{ color: GRIS }} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {casos === null ? (
              <p className="py-8 text-center text-xs" style={{ color: GRIS }}>
                Cargando…
              </p>
            ) : casos.length === 0 ? (
              <p className="py-8 text-center text-xs" style={{ color: GRIS }}>
                No hay casos aquí.
              </p>
            ) : (
              <ul className="space-y-2">
                {casos.map(c => (
                  <li key={c.id}>
                    <Link
                      href={`/negocios/${c.id}`}
                      className="block rounded-lg border p-3 transition-colors hover:bg-[#F9FAFB]"
                      style={{ borderColor: BORDE }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold" style={{ color: CARBON }}>
                            {c.codigo && (
                              <span className="mr-1.5 font-mono" style={{ color: GRIS }}>
                                {c.codigo}
                              </span>
                            )}
                            {c.nombre}
                          </p>
                          <p className="mt-0.5 truncate text-[11px]" style={{ color: GRIS }}>
                            {[c.seccional ?? 'Sin seccional', c.responsable ?? 'Sin responsable'].join(' · ')}
                          </p>
                        </div>
                        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: BORDE }} />
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {c.horasEnEtapa !== null && (
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                            style={{
                              backgroundColor: c.vencido ? '#FEE2E2' : '#F5F4F2',
                              color: c.vencido ? ROJO : GRIS,
                            }}
                            title="Horas hábiles en esta etapa"
                          >
                            {c.vencido && <AlertTriangle className="mr-0.5 inline h-2.5 w-2.5" />}
                            {Math.round(c.horasEnEtapa)}h
                          </span>
                        )}
                        {c.diasInactivo !== null && (
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                            style={{
                              backgroundColor: c.diasInactivo >= 14 ? '#FEF3C7' : '#F5F4F2',
                              color: c.diasInactivo >= 14 ? OCRE : GRIS,
                            }}
                            title="Días desde la última actividad registrada en el negocio"
                          >
                            {c.diasInactivo === 0
                              ? 'tocado hoy'
                              : `${c.diasInactivo}d sin tocar`}
                          </span>
                        )}
                        {c.reproceso && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                            style={{ backgroundColor: '#FEE2E2', color: ROJO }}
                            title="Este caso está en reproceso"
                          >
                            <RotateCcw className="h-2.5 w-2.5" />
                            {c.reproceso === 'certificacion_upme' ? 'Certificado UPME' : 'Devolución DIAN'}
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {casos !== null && casos.length > 0 && (
            <div className="shrink-0 border-t px-4 py-2 text-[11px]" style={{ borderColor: BORDE, color: GRIS }}>
              {casos.length} caso{casos.length === 1 ? '' : 's'} · ordenados por tiempo en la etapa
            </div>
          )}
        </div>
      </div>
    </>
  )
}
