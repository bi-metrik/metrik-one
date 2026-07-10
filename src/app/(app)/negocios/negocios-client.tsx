'use client'
import { useState, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import NegocioCard from './negocio-card'
import EmptyState from '@/components/empty-state'
import type { NegocioResumen } from './negocio-v2-actions'

type FaseFilter = 'todos' | 'venta' | 'ejecucion' | 'cobro' | 'cerrados'
type MotivoCierre = 'todos' | 'exitoso' | 'perdido' | 'cancelado'

/** Etapa del workflow de la línea, para el segmentador de nivel 2. */
export type EtapaSeg = { numero: number; nombre: string; stage: string; orden: number }

interface FaseSpec {
  key: FaseFilter
  label: string
  /** Tokens MeTRIK por stage. */
  active: { bg: string; text: string; border: string }
}

// Tokens MeTRIK (no Tailwind generico)
const ALL_FASES: FaseSpec[] = [
  {
    key: 'todos',
    label: 'Todos',
    active: { bg: 'bg-[#F5F4F2]', text: 'text-[#1A1A1A]', border: 'border-[#1A1A1A]/20' },
  },
  {
    key: 'venta',
    label: 'Venta',
    active: { bg: 'bg-[#10B981]/10', text: 'text-[#059669]', border: 'border-[#10B981]' },
  },
  {
    key: 'ejecucion',
    label: 'Ejecucion',
    active: { bg: 'bg-[#FFF7ED]', text: 'text-[#C2410C]', border: 'border-[#FED7AA]' },
  },
  {
    key: 'cobro',
    label: 'Cobro',
    active: { bg: 'bg-[#EFF6FF]', text: 'text-[#2563EB]', border: 'border-[#BFDBFE]' },
  },
  {
    key: 'cerrados',
    label: 'Cerrados',
    active: { bg: 'bg-[#F5F4F2]', text: 'text-[#6B7280]', border: 'border-[#E5E7EB]' },
  },
]

export default function NegociosClient({
  negocios,
  cerrados,
  stagesActivos,
  etapas,
  defaultStage = 'todos',
}: {
  negocios: NegocioResumen[]
  cerrados: NegocioResumen[]
  stagesActivos: string[]
  etapas: EtapaSeg[]
  defaultStage?: FaseFilter
}) {
  // Segmentador jerárquico: fase (stage) → etapa (numero dentro de la fase).
  const [fase, setFase] = useState<FaseFilter>(defaultStage)
  const [etapaNum, setEtapaNum] = useState<number | null>(null)
  const [motivoCierre, setMotivoCierre] = useState<MotivoCierre>('todos')
  const [q, setQ] = useState('')
  const [seccional, setSeccional] = useState<string>('todas')
  const [responsable, setResponsable] = useState<string>('todos')

  // Seccionales DIAN presentes en los negocios (para el filtro). Solo las que existen.
  const seccionalesDisponibles = useMemo(() => {
    const set = new Set<string>()
    for (const n of negocios) if (n.seccional_label) set.add(n.seccional_label)
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'))
  }, [negocios])

  // Responsables asignados presentes en los negocios (para el filtro). Únicos por id.
  const responsablesDisponibles = useMemo(() => {
    const map = new Map<string, string>()
    for (const n of negocios) for (const r of n.responsables) map.set(r.id, r.full_name)
    return Array.from(map, ([id, full_name]) => ({ id, full_name }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'))
  }, [negocios])

  // Cerrados filtrados por motivo
  const cerradosFiltrados = useMemo(() => {
    if (motivoCierre === 'todos') return cerrados
    return cerrados.filter((n) => n.cierre_motivo === motivoCierre)
  }, [cerrados, motivoCierre])

  // ── Contadores (sobre `negocios`, que ya viene scopeado por servidor: el
  //    operator solo recibe sus negocios, así que los conteos salen por rol). ──
  const faseCount = (key: FaseFilter) =>
    key === 'todos'
      ? negocios.length
      : key === 'cerrados'
        ? cerrados.length
        : negocios.filter((n) => n.stage_actual === key).length
  const etapaCount = (numero: number) => negocios.filter((n) => n.etapa_numero === numero).length

  // Etapas de la fase seleccionada (solo cuando la fase es un stage), en orden del workflow.
  const etapasDeFase = useMemo(
    () =>
      fase === 'venta' || fase === 'ejecucion' || fase === 'cobro'
        ? etapas.filter((e) => e.stage === fase).sort((a, b) => a.orden - b.orden)
        : [],
    [etapas, fase],
  )

  // Al cambiar de fase se limpia la etapa seleccionada.
  const seleccionarFase = (key: FaseFilter) => {
    setFase(key)
    setEtapaNum(null)
  }

  // Filtrado por fase / etapa.
  const current = useMemo(() => {
    if (fase === 'cerrados') return cerradosFiltrados
    if (fase === 'todos') return negocios
    if (etapaNum !== null) return negocios.filter((n) => n.etapa_numero === etapaNum)
    return negocios.filter((n) => n.stage_actual === fase)
  }, [fase, etapaNum, negocios, cerradosFiltrados])

  // Búsqueda libre (código, nombre/contacto, empresa, vehículo, cédula, radicado) + filtro de seccional DIAN
  const term = q.trim().toLowerCase()
  const currentFiltrado = useMemo(() => {
    let res = current
    if (seccional !== 'todas') {
      res = res.filter((n) => n.seccional_label === seccional)
    }
    if (responsable !== 'todos') {
      res = res.filter((n) => n.responsables.some((r) => r.id === responsable))
    }
    if (term) {
      res = res.filter((n) => {
        const hay = [n.codigo, n.nombre, n.empresa_nombre, n.contacto_nombre, n.vehiculo_label,
          n.cedula, n.radicado, n.seccional_label,
          ...n.responsables.map((r) => r.full_name)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return hay.includes(term)
      })
    }
    return res
  }, [current, term, seccional, responsable])

  // Fases visibles (según stages activos del workspace + si hay cerrados).
  const fases = ALL_FASES.filter((f) =>
    f.key === 'todos'
      ? true
      : f.key === 'cerrados'
        ? cerrados.length > 0
        : stagesActivos.includes(f.key),
  )

  const showEmpty = currentFiltrado.length === 0
  const isFilteringMotivo = fase === 'cerrados' && motivoCierre !== 'todos'
  const sinResultadosBusqueda = term.length > 0 && currentFiltrado.length === 0 && current.length > 0

  return (
    <div className="space-y-4">
      {/* Nivel 1: fases */}
      <div className="flex flex-wrap gap-2">
        {fases.map((f) => {
          const count = faseCount(f.key)
          const active = fase === f.key
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => seleccionarFase(f.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? `${f.active.bg} ${f.active.text} ${f.active.border}`
                  : 'border-[#E5E7EB] text-[#6B7280] hover:border-[#1A1A1A]/30 hover:text-[#1A1A1A]'
              }`}
            >
              {f.label}
              {count > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    active ? 'bg-black/10' : 'bg-[#F5F4F2]'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Nivel 2: etapas de la fase seleccionada (solo stages) */}
      {etapasDeFase.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setEtapaNum(null)}
            className={`shrink-0 rounded-full border px-2.5 py-1 transition-colors ${
              etapaNum === null
                ? 'border-[#1A1A1A]/30 bg-[#F5F4F2] text-[#1A1A1A]'
                : 'border-[#E5E7EB] text-[#6B7280] hover:text-[#1A1A1A]'
            }`}
          >
            Todas
          </button>
          {etapasDeFase.map((e) => {
            const count = etapaCount(e.numero)
            const active = etapaNum === e.numero
            const vacia = count === 0
            return (
              <button
                key={e.numero}
                type="button"
                onClick={() => setEtapaNum(e.numero)}
                className={`flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 transition-colors ${
                  active
                    ? 'border-[#1A1A1A]/30 bg-[#F5F4F2] text-[#1A1A1A]'
                    : vacia
                      ? 'border-[#E5E7EB] text-[#6B7280]/50 hover:text-[#6B7280]'
                      : 'border-[#E5E7EB] text-[#6B7280] hover:text-[#1A1A1A]'
                }`}
              >
                {e.nombre}
                <span
                  className={`rounded-full px-1 py-0.5 text-[10px] font-bold ${
                    active ? 'bg-black/10' : vacia ? 'bg-[#F5F4F2] text-[#6B7280]/50' : 'bg-[#F5F4F2]'
                  }`}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Barra de búsqueda */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por código, cliente, cédula, seccional o vehículo…"
          className="w-full rounded-lg border border-[#E5E7EB] bg-white py-2 pl-9 pr-9 text-sm text-[#1A1A1A] placeholder:text-[#6B7280] focus:border-[#1A1A1A]/30 focus:outline-none"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            aria-label="Limpiar búsqueda"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#6B7280] transition-colors hover:bg-[#F5F4F2] hover:text-[#1A1A1A]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filtro por seccional DIAN (solo si hay seccionales en los negocios) */}
      {seccionalesDisponibles.length > 0 && (
        <select
          value={seccional}
          onChange={(e) => setSeccional(e.target.value)}
          aria-label="Filtrar por seccional DIAN"
          className="w-full rounded-lg border border-[#E5E7EB] bg-white py-2 px-3 text-sm text-[#1A1A1A] focus:border-[#1A1A1A]/30 focus:outline-none"
        >
          <option value="todas">Todas las seccionales DIAN</option>
          {seccionalesDisponibles.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      )}

      {/* Filtro por responsable asignado (solo si hay responsables en los negocios) */}
      {responsablesDisponibles.length > 0 && (
        <select
          value={responsable}
          onChange={(e) => setResponsable(e.target.value)}
          aria-label="Filtrar por responsable asignado"
          className="w-full rounded-lg border border-[#E5E7EB] bg-white py-2 px-3 text-sm text-[#1A1A1A] focus:border-[#1A1A1A]/30 focus:outline-none"
        >
          <option value="todos">Todos los responsables</option>
          {responsablesDisponibles.map((r) => (
            <option key={r.id} value={r.id}>{r.full_name}</option>
          ))}
        </select>
      )}

      {/* Sub-filtros Cerrados (motivo) */}
      {fase === 'cerrados' && cerrados.length > 0 && (
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto pb-1 text-xs">
          {(['todos', 'exitoso', 'perdido', 'cancelado'] as MotivoCierre[]).map((m) => {
            const isActive = motivoCierre === m
            const cuenta =
              m === 'todos'
                ? cerrados.length
                : cerrados.filter((n) => n.cierre_motivo === m).length
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMotivoCierre(m)}
                className={`shrink-0 rounded-full border px-2.5 py-1 transition-colors ${
                  isActive
                    ? 'border-[#1A1A1A]/30 bg-[#F5F4F2] text-[#1A1A1A]'
                    : 'border-[#E5E7EB] text-[#6B7280] hover:text-[#1A1A1A]'
                }`}
              >
                {motivoLabel(m)} {cuenta > 0 && `(${cuenta})`}
              </button>
            )
          })}
        </div>
      )}

      {/* Lista o empty */}
      {showEmpty ? (
        sinResultadosBusqueda ? (
          <EmptyState
            title={`Sin resultados para "${q.trim()}"`}
            description="Prueba con otro código, cliente, cédula, seccional o vehículo."
            primaryCta={{ label: 'Limpiar búsqueda', onClick: () => setQ('') }}
          />
        ) : fase === 'cerrados' && !isFilteringMotivo ? (
          <EmptyState
            illustration="/empty-states/empty-cerrados.svg"
            illustrationAlt="Sin negocios cerrados todavia"
            title="Sin negocios cerrados todavia"
            description="Aqui veras el historial de negocios exitosos, perdidos y cancelados cuando los tengas."
          />
        ) : fase === 'cerrados' && isFilteringMotivo ? (
          <EmptyState
            title={`Sin cerrados como ${motivoLabel(motivoCierre).toLowerCase()}`}
            description="Prueba otro filtro o quita el filtro de motivo."
            primaryCta={{
              label: 'Quitar filtro',
              onClick: () => setMotivoCierre('todos'),
            }}
          />
        ) : (
          <div className="py-16 text-center">
            <p className="text-sm text-[#6B7280]">
              {fase === 'todos'
                ? 'Sin negocios abiertos'
                : etapaNum !== null
                  ? `Sin negocios en ${etapasDeFase.find((e) => e.numero === etapaNum)?.nombre ?? 'esta etapa'}`
                  : `Sin negocios en ${ALL_FASES.find((f) => f.key === fase)?.label}`}
            </p>
            {fase === 'todos' && (
              <p className="mt-1 text-xs text-[#6B7280]/70">Crea uno con el boton +</p>
            )}
          </div>
        )
      ) : (
        <div className="space-y-3">
          {currentFiltrado.map((n) => (
            <NegocioCard key={n.id} negocio={n} />
          ))}
        </div>
      )}
    </div>
  )
}

function motivoLabel(m: MotivoCierre): string {
  switch (m) {
    case 'todos':
      return 'Todos'
    case 'exitoso':
      return 'Exitosos'
    case 'perdido':
      return 'Perdidos'
    case 'cancelado':
      return 'Cancelados'
  }
}
