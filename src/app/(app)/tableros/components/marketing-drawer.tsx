'use client'

/**
 * Panel lateral con los negocios detras de una fila del tablero de marketing.
 *
 * Mismo patron visual que `casos-drawer.tsx` (overlay, Escape, lista de enlaces),
 * pero con su propia consulta: los casos de aquel salen de `getCasosDeEtapa`, que
 * responde otra pregunta (donde esta atascado un caso). Reusarlo obligaria a que el
 * drill del marketing pasara por un criterio distinto del que produjo la cifra, que
 * es exactamente lo que la pestana existe para no hacer.
 *
 * Se carga bajo demanda: la tabla no arrastra el detalle de 300 negocios por si acaso.
 */

import { useEffect, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import Link from 'next/link'
import { getNegociosDeCampana, type NegocioDeCampana } from '../marketing-actions'

const CARBON = '#1A1A1A'
const GRIS = '#6B7280'
const BORDE = '#E5E7EB'
const VERDE = '#10B981'

export interface CampanaSeleccionada {
  campaignId: string | null
  titulo: string
  /** 'YYYY-MM-01' en lente MES; `null` en lente COHORTE. */
  mes: string | null
  /** Como se llama el alcance en el encabezado, con las palabras de la pantalla. */
  alcance: string
}

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

export function MarketingDrawer({
  seleccion,
  onClose,
}: {
  seleccion: CampanaSeleccionada
  onClose: () => void
}) {
  const [negocios, setNegocios] = useState<NegocioDeCampana[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // El padre monta este panel con `key` por seleccion, asi que al cambiar de fila el
  // componente se remonta y el estado arranca vacio solo.
  useEffect(() => {
    let vivo = true
    getNegociosDeCampana({ campaignId: seleccion.campaignId, mes: seleccion.mes })
      .then(r => { if (vivo) setNegocios(r) })
      .catch(e => { if (vivo) setError(e instanceof Error ? e.message : 'No se pudo cargar la lista') })
    return () => { vivo = false }
  }, [seleccion.campaignId, seleccion.mes])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const ventas = negocios?.filter(n => n.fechaVenta !== null).length ?? 0

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />

      <div className="fixed inset-y-0 right-0 z-[60] w-full max-w-md animate-in slide-in-from-right duration-200">
        <div className="flex h-full flex-col bg-white shadow-2xl">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3" style={{ borderColor: BORDE }}>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold" style={{ color: CARBON }} title={seleccion.titulo}>
                {seleccion.titulo}
              </h2>
              <p className="mt-0.5 text-[11px]" style={{ color: GRIS }}>{seleccion.alcance}</p>
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
            {error !== null ? (
              <p className="py-8 text-center text-xs text-red-700">{error}</p>
            ) : negocios === null ? (
              <p className="py-8 text-center text-xs" style={{ color: GRIS }}>Cargando…</p>
            ) : negocios.length === 0 ? (
              <p className="py-8 text-center text-xs" style={{ color: GRIS }}>No hay negocios aquí.</p>
            ) : (
              <ul className="space-y-2">
                {negocios.map(n => (
                  <li key={n.id}>
                    <Link
                      href={`/negocios/${n.id}`}
                      className="block rounded-lg border p-3 transition-colors hover:bg-[#F9FAFB]"
                      style={{ borderColor: BORDE }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold" style={{ color: CARBON }}>
                            {n.codigo && <span className="mr-1.5 font-mono" style={{ color: GRIS }}>{n.codigo}</span>}
                            {n.cliente ?? n.nombre}
                          </p>
                          <p className="mt-0.5 truncate text-[11px]" style={{ color: GRIS }}>
                            {[n.comercial ?? 'Sin comercial', n.etapa ?? 'Sin etapa'].join(' · ')}
                          </p>
                        </div>
                        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: BORDE }} />
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                        {n.fechaVenta ? (
                          <span
                            className="rounded px-1.5 py-0.5 font-medium tabular-nums"
                            style={{ backgroundColor: '#ECFDF5', color: VERDE }}
                            title="Fecha de venta"
                          >
                            Venta {n.fechaVenta}
                          </span>
                        ) : (
                          <span
                            className="rounded px-1.5 py-0.5 font-medium"
                            style={{ backgroundColor: '#F5F4F2', color: GRIS }}
                            title="Todavía no ha entrado dinero: no cuenta como venta"
                          >
                            Sin venta
                          </span>
                        )}
                        <span className="tabular-nums" style={{ color: GRIS }}>
                          Honorario {fmtCOP(n.honorario)} · Recaudado {fmtCOP(n.recaudado)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {negocios !== null && negocios.length > 0 && (
            <div className="shrink-0 border-t px-4 py-2 text-[11px]" style={{ borderColor: BORDE, color: GRIS }}>
              {negocios.length} negocio{negocios.length === 1 ? '' : 's'} · {ventas} venta{ventas === 1 ? '' : 's'}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
