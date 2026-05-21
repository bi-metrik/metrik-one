'use client'

import { useState, useEffect } from 'react'
import { ChevronRight, FileText } from 'lucide-react'
import { getEtapasAnterioresResumen, type EtapaAnteriorResumen } from '@/lib/actions/etapas-anteriores'

interface Props {
  negocioId: string
  /** Si true, fetcha al montar. Default false — fetcha al primer expand. */
  eagerLoad?: boolean
}

/**
 * Historial de etapas anteriores — Superficie 4 spec UX 2026-05-20.
 *
 * Render colapsado por default. Al expandir lista las etapas previas
 * con conteo de bloques. Cada etapa expandible muestra los bloques en
 * modo read-only.
 *
 * Nota Max: el render de bloques en read-only requiere conexion con
 * BloqueRenderer (negocio-detail-client). Para no acoplarnos a ese
 * arbol gigante, mostramos un placeholder por etapa con CTA "Ver bloques
 * en pantalla principal". Integracion full queda para iteracion siguiente.
 */
export default function EtapasHistorialAccordion({
  negocioId,
  eagerLoad = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const [etapas, setEtapas] = useState<EtapaAnteriorResumen[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedEtapas, setExpandedEtapas] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (eagerLoad && etapas === null) {
      void load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eagerLoad])

  async function load() {
    setLoading(true)
    const res = await getEtapasAnterioresResumen(negocioId)
    setEtapas(res)
    setLoading(false)
  }

  function toggle() {
    if (!open && etapas === null && !loading) {
      void load()
    }
    setOpen((v) => !v)
  }

  function toggleEtapa(id: string) {
    setExpandedEtapas((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const count = etapas?.length ?? 0

  // Si despues de cargar no hay etapas previas, no renderizar la seccion
  if (etapas !== null && etapas.length === 0) return null

  return (
    <section className="rounded-xl border border-[#E5E7EB] bg-white">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-[#F5F4F2]"
        aria-expanded={open}
      >
        <span>
          <span className="block text-sm font-medium text-[#1A1A1A]">
            Historial de etapas anteriores{etapas !== null && count > 0 ? ` (${count})` : ''}
          </span>
          <span className="block text-xs text-[#6B7280]">
            Etapas completadas en este negocio
          </span>
        </span>
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-[#6B7280] transition-transform ${
            open ? 'rotate-90' : ''
          }`}
        />
      </button>

      {open && (
        <div className="border-t border-[#E5E7EB] p-3">
          {loading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-12 animate-pulse rounded-md bg-[#F5F4F2]"
                />
              ))}
            </div>
          ) : etapas === null ? (
            <p className="py-2 text-center text-xs text-[#6B7280]">
              Cargando...
            </p>
          ) : (
            <div className="space-y-2">
              {etapas.map((e) => {
                const expanded = expandedEtapas.has(e.etapa_id)
                return (
                  <div
                    key={e.etapa_id}
                    className="rounded-md border border-[#E5E7EB]"
                  >
                    <button
                      type="button"
                      onClick={() => toggleEtapa(e.etapa_id)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-[#F5F4F2]"
                    >
                      <span className="flex items-center gap-2">
                        <ChevronRight
                          className={`h-3 w-3 text-[#6B7280] transition-transform ${
                            expanded ? 'rotate-90' : ''
                          }`}
                        />
                        <span className="font-medium text-[#1A1A1A]">
                          Etapa {e.orden} · {e.etapa_nombre}
                        </span>
                        {e.stage && (
                          <span className="rounded-full bg-[#F5F4F2] px-1.5 py-0.5 text-[10px] text-[#6B7280]">
                            {e.stage}
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] text-[#6B7280]">
                        {e.bloquesCount} bloque{e.bloquesCount !== 1 ? 's' : ''}
                      </span>
                    </button>
                    {expanded && (
                      <div className="border-t border-[#E5E7EB] bg-[#F5F4F2]/50 p-3">
                        <p className="flex items-start gap-2 text-[11px] text-[#6B7280]">
                          <FileText className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>
                            Los bloques de esta etapa se conservan completos en
                            el activity log y en la vista principal del negocio.
                            La consulta detallada por bloque historico llega en
                            iteracion siguiente.
                          </span>
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
