'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react'
import type { NegocioDelMismoContacto } from '@/app/(app)/negocios/negocio-v2-actions'

const CARBON = '#1A1A1A'
const GRIS = '#6B7280'
const BORDE = '#E5E7EB'
const AMBAR = '#B45309'

/** Un negocio cerrado no compite con el nuevo; uno abierto sí. */
function estaAbierto(estado: string): boolean {
  return estado === 'abierto'
}

function etiquetaEstado(estado: string): string {
  if (estado === 'abierto') return 'Abierto'
  if (estado === 'completado') return 'Completado'
  if (estado === 'perdido') return 'Perdido'
  return estado
}

function fechaCorta(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * Fricción deliberada al crear un segundo negocio para el mismo contacto.
 *
 * No prohíbe: un cliente puede comprar un segundo vehículo, y en producción hay
 * negocios así. Lo que hace es poner a la vista lo que ya existe —con su etapa y
 * su estado— para que el comercial no cree por tercera vez el mismo lead sin
 * enterarse. La salida barata es abrir el que ya existe; crear otro cuesta un
 * clic más y queda registrado.
 */
export function DialogoNegocioDuplicado({
  duplicados,
  nombreContacto,
  creando,
  onCancelar,
  onCrearIgual,
}: {
  duplicados: NegocioDelMismoContacto[]
  nombreContacto?: string
  creando?: boolean
  onCancelar: () => void
  onCrearIgual: () => void
}) {
  // Escape cancela; el scroll del fondo se congela mientras está abierto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancelar() }
    document.addEventListener('keydown', onKey)
    const overflowPrevio = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflowPrevio
    }
  }, [onCancelar])

  const abiertos = duplicados.filter(d => estaAbierto(d.estado)).length

  const contenido = (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onCancelar}
    >
      <div
        className="flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-negocio-duplicado"
      >
        <div className="shrink-0 border-b px-5 py-4" style={{ borderColor: BORDE }}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" style={{ color: AMBAR }} />
            <div>
              <h2 id="titulo-negocio-duplicado" className="text-base font-bold" style={{ color: CARBON }}>
                Este cliente ya tiene {duplicados.length === 1 ? 'un negocio' : `${duplicados.length} negocios`}
              </h2>
              <p className="mt-1 text-xs" style={{ color: GRIS }}>
                {nombreContacto ? <><strong style={{ color: CARBON }}>{nombreContacto}</strong>{' '}</> : null}
                {abiertos > 0
                  ? `tiene ${abiertos === 1 ? 'uno en curso' : `${abiertos} en curso`}. Revisa si el que buscas ya está creado.`
                  : 'no tiene ninguno en curso. Si vuelve, crear otro es lo correcto.'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          <ul className="space-y-2">
            {duplicados.map(d => (
              <li
                key={d.id}
                className="rounded-lg border px-3 py-2.5"
                style={{ borderColor: BORDE }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {d.codigo && (
                        <span className="rounded bg-[#1A1A1A] px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white">
                          {d.codigo}
                        </span>
                      )}
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider"
                        style={{ color: estaAbierto(d.estado) ? '#10B981' : GRIS }}
                      >
                        {etiquetaEstado(d.estado)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm font-medium" style={{ color: CARBON }}>
                      {d.nombre}
                    </p>
                    <p className="mt-0.5 text-[11px]" style={{ color: GRIS }}>
                      {d.etapa_nombre ? `${d.etapa_nombre} · ` : ''}creado el {fechaCorta(d.created_at)}
                    </p>
                  </div>
                  <a
                    href={`/negocios/${d.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-[#F5F4F2]"
                    style={{ borderColor: BORDE, color: CARBON }}
                  >
                    Abrir <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="shrink-0 border-t px-5 py-4" style={{ borderColor: BORDE }}>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancelar}
              disabled={creando}
              className="rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-[#F5F4F2] disabled:opacity-50"
              style={{ borderColor: BORDE, color: CARBON }}
            >
              No crear
            </button>
            <button
              type="button"
              onClick={onCrearIgual}
              disabled={creando}
              className="flex items-center justify-center gap-2 rounded-lg bg-[#10B981] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#059669] disabled:opacity-50"
            >
              {creando && <Loader2 className="h-4 w-4 animate-spin" />}
              Crear otro de todos modos
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] sm:text-right" style={{ color: GRIS }}>
            Si creas otro, queda registrado en el negocio.
          </p>
        </div>
      </div>
    </div>
  )

  // Portal a body: un overlay montado dentro del header (que usa backdrop-blur)
  // queda atrapado por su containing block. Ya pasó tres veces en este repo.
  if (typeof document === 'undefined') return null

  return createPortal(contenido, document.body)
}
