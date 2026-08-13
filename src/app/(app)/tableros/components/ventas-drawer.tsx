'use client'

/**
 * Panel lateral con los casos detrás de una cifra del tablero comercial.
 *
 * El tablero decía "30 ventas en agosto" y para saber cuáles eran había que ir a
 * buscarlas a mano. Al hacer clic en cualquier cifra mayor que cero se abre esta lista,
 * ya filtrada por el mismo mes, el mismo vendedor y el mismo criterio de la celda.
 *
 * Hermano de `CasosDrawer` (que abre los casos de una ETAPA del proceso): misma forma en
 * pantalla, otra pregunta. Este responde "qué se vendió", aquel "qué está atascado".
 *
 * Trae las cuatro fechas que el equipo comercial viene pidiendo desde julio: cuándo se
 * vendió, cuándo quedó cubierto el honorario, cuándo entró el lead y cuándo fue su
 * última conversión.
 */

import { useEffect, useState } from 'react'
import { X, ExternalLink, AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react'
import Link from 'next/link'
import { getComercialVentasMes } from '../../equipo/comercial-actions'
import type { ComercialVentaCaso } from '../../equipo/comercial-types'

const CARBON = '#1A1A1A'
const GRIS = '#6B7280'
const BORDE = '#E5E7EB'
const VERDE = '#059669'
const OCRE = '#92400E'

export interface CifraSeleccionada {
  anio: number
  mes: number
  /** Qué cifra se abrió, para titular el panel con las palabras de la pantalla. */
  titulo: string
  responsableId?: string | null
  sinResponsable?: boolean
  soloCompletos?: boolean | null
  /** Nombre del vendedor, cuando la cifra es de una fila y no del total. */
  alcance?: string | null
}

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

/** '2026-08-05' → '05/08'. Se arma desde las partes: `new Date('YYYY-MM-DD')` se
 *  interpreta como UTC y en Colombia cae un día antes. */
function fmtDia(iso: string | null): string | null {
  if (!iso) return null
  const [, m, d] = iso.split('-')
  return d && m ? `${d}/${m}` : null
}

export function VentasDrawer({
  cifra,
  onClose,
}: {
  cifra: CifraSeleccionada
  onClose: () => void
}) {
  const [casos, setCasos] = useState<ComercialVentaCaso[] | null>(null)

  // El padre monta el panel con `key` por cifra, así que al cambiar de celda el
  // componente se remonta y el estado arranca vacío solo.
  useEffect(() => {
    let vivo = true
    void getComercialVentasMes({
      anio: cifra.anio,
      mes: cifra.mes,
      responsableId: cifra.responsableId ?? null,
      soloCompletos: cifra.soloCompletos ?? null,
      sinResponsable: cifra.sinResponsable ?? false,
    }).then(r => {
      if (vivo) setCasos(r)
    })
    return () => {
      vivo = false
    }
  }, [cifra.anio, cifra.mes, cifra.responsableId, cifra.soloCompletos, cifra.sinResponsable])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
                {cifra.titulo}
              </h2>
              {cifra.alcance && (
                <p className="mt-0.5 truncate text-[11px]" style={{ color: GRIS }}>
                  {cifra.alcance}
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
                  <li key={c.negocio_id}>
                    <Link
                      href={`/negocios/${c.negocio_id}`}
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
                            {c.responsable ?? 'Sin comercial'}
                          </p>
                        </div>
                        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: BORDE }} />
                      </div>

                      {/* Las cuatro fechas del caso. La de completado solo aparece cuando
                          el honorario quedó cubierto: una fecha ahí sobre un caso que
                          sigue debiendo diría que se cerró algo que está abierto. */}
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                        <Fecha label="Venta" valor={fmtDia(c.fecha_venta)} />
                        <Fecha label="Completado" valor={fmtDia(c.fecha_completado)} />
                        <Fecha label="Creado" valor={fmtDia(c.fecha_creacion)} />
                        <Fecha
                          label="Últ. conversión"
                          valor={fmtDia(c.ultima_conversion)}
                          extra={c.n_conversiones > 1 ? `${c.n_conversiones} veces` : null}
                        />
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
                          style={{ backgroundColor: '#F5F4F2', color: GRIS }}
                          title="Valor del honorario sin IVA"
                        >
                          {fmtCOP(c.valor_sin_iva)}
                        </span>
                        {c.caso_completo ? (
                          <span
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                            style={{ backgroundColor: '#ECFDF5', color: VERDE }}
                          >
                            <CheckCircle2 className="h-2.5 w-2.5" /> Honorario cubierto
                          </span>
                        ) : (
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
                            style={{ backgroundColor: '#F5F4F2', color: GRIS }}
                            title="Recaudado del honorario"
                          >
                            {fmtCOP(c.recaudado)} recaudado
                          </span>
                        )}
                        {c.sin_honorario_aprobado && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                            style={{ backgroundColor: '#FEF3C7', color: OCRE }}
                            title="Este caso no tiene honorario aprobado, así que el sistema compara su recaudo contra cero y lo cuenta como completo"
                          >
                            <AlertTriangle className="h-2.5 w-2.5" /> Sin honorario aprobado
                          </span>
                        )}
                        {c.n_conversiones > 1 && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium"
                            style={{ backgroundColor: '#F5F4F2', color: GRIS }}
                            title="El contacto volvió a dejar sus datos después de la primera vez"
                          >
                            <RotateCcw className="h-2.5 w-2.5" /> Reconvertido
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
              {casos.length} caso{casos.length === 1 ? '' : 's'} · más reciente primero
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/** Una fecha del caso. Sin dato se dice "—": dejarlo en blanco parece un error de carga. */
function Fecha({ label, valor, extra }: { label: string; valor: string | null; extra?: string | null }) {
  return (
    <span className="flex items-baseline gap-1">
      <span style={{ color: BORDE === '#E5E7EB' ? '#9CA3AF' : GRIS }}>{label}</span>
      <span className="font-medium tabular-nums" style={{ color: valor ? CARBON : '#9CA3AF' }}>
        {valor ?? '—'}
      </span>
      {extra && <span style={{ color: '#9CA3AF' }}>· {extra}</span>}
    </span>
  )
}
