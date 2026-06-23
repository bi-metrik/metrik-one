'use client'
import { useState, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import NegocioCard from './negocio-card'
import EmptyState from '@/components/empty-state'
import type { NegocioResumen } from './negocio-v2-actions'

type StageFilter = 'todos' | 'venta' | 'inclusion' | 'ejecucion' | 'cobro' | 'cerrados'
type MotivoCierre = 'todos' | 'exitoso' | 'perdido' | 'cancelado'

interface FiltroSpec {
  key: StageFilter
  label: string
  /** Tokens MeTRIK por stage. */
  active: { bg: string; text: string; border: string }
}

// Tokens MeTRIK (no Tailwind generico)
const ALL_FILTROS: FiltroSpec[] = [
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
    key: 'inclusion',
    label: 'Inclusión',
    active: { bg: 'bg-[#FEF3C7]', text: 'text-[#B45309]', border: 'border-[#FCD34D]' },
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
  defaultStage = 'todos',
}: {
  negocios: NegocioResumen[]
  cerrados: NegocioResumen[]
  stagesActivos: string[]
  defaultStage?: StageFilter
}) {
  const [filtro, setFiltro] = useState<StageFilter>(defaultStage)
  const [motivoCierre, setMotivoCierre] = useState<MotivoCierre>('todos')
  const [q, setQ] = useState('')
  const [seccional, setSeccional] = useState<string>('todas')
  const [ciudad, setCiudad] = useState<string>('todas')
  const [responsable, setResponsable] = useState<string>('todos')

  // Seccionales DIAN presentes en los negocios (para el filtro). Solo las que existen.
  const seccionalesDisponibles = useMemo(() => {
    const set = new Set<string>()
    for (const n of negocios) if (n.seccional_label) set.add(n.seccional_label)
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'))
  }, [negocios])

  // Ciudades/seccionales de venta presentes en los negocios (para el filtro). Solo las que existen.
  const ciudadesDisponibles = useMemo(() => {
    const set = new Set<string>()
    for (const n of negocios) if (n.ciudad_label) set.add(n.ciudad_label)
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

  // Inclusión es una etapa dentro del stage 'venta'; se separa en su propio filtro.
  // En 'venta' NO se muestran los de Inclusión.
  const current =
    filtro === 'cerrados'
      ? cerradosFiltrados
      : filtro === 'todos'
        ? negocios
        : filtro === 'inclusion'
          ? negocios.filter((n) => n.etapa_nombre === 'Inclusión')
          : filtro === 'venta'
            ? negocios.filter((n) => n.stage_actual === 'venta' && n.etapa_nombre !== 'Inclusión')
            : negocios.filter((n) => n.stage_actual === filtro)

  // Búsqueda libre (código, nombre/contacto, empresa, vehículo) + filtro de seccional DIAN
  const term = q.trim().toLowerCase()
  const currentFiltrado = useMemo(() => {
    let res = current
    if (seccional !== 'todas') {
      res = res.filter((n) => n.seccional_label === seccional)
    }
    if (ciudad !== 'todas') {
      res = res.filter((n) => n.ciudad_label === ciudad)
    }
    if (responsable !== 'todos') {
      res = res.filter((n) => n.responsables.some((r) => r.id === responsable))
    }
    if (term) {
      res = res.filter((n) => {
        const hay = [n.codigo, n.nombre, n.empresa_nombre, n.contacto_nombre, n.vehiculo_label,
          ...n.responsables.map((r) => r.full_name)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return hay.includes(term)
      })
    }
    return res
  }, [current, term, seccional, ciudad, responsable])

  // Filtros visibles. El pill "Inclusión" solo si hay negocios en esa etapa.
  const hayInclusion = useMemo(() => negocios.some((n) => n.etapa_nombre === 'Inclusión'), [negocios])
  const filtros = ALL_FILTROS.filter((f) =>
    f.key === 'inclusion'
      ? hayInclusion
      : f.key === 'todos' || f.key === 'cerrados'
        ? f.key === 'todos' || cerrados.length > 0
        : stagesActivos.includes(f.key),
  )

  const showEmpty = currentFiltrado.length === 0
  const isFilteringMotivo = filtro === 'cerrados' && motivoCierre !== 'todos'
  const sinResultadosBusqueda = term.length > 0 && currentFiltrado.length === 0 && current.length > 0

  return (
    <div className="space-y-4">
      {/* Pills de filtro */}
      <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1">
        {filtros.map((f) => {
          const count =
            f.key === 'todos'
              ? negocios.length
              : f.key === 'cerrados'
                ? cerrados.length
                : f.key === 'inclusion'
                  ? negocios.filter((n) => n.etapa_nombre === 'Inclusión').length
                  : f.key === 'venta'
                    ? negocios.filter((n) => n.stage_actual === 'venta' && n.etapa_nombre !== 'Inclusión').length
                    : negocios.filter((n) => n.stage_actual === f.key).length
          const active = filtro === f.key
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFiltro(f.key)}
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

      {/* Barra de búsqueda */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por código, cliente o vehículo…"
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

      {/* Filtro por ciudad de venta (solo si hay ciudades en los negocios) */}
      {ciudadesDisponibles.length > 0 && (
        <select
          value={ciudad}
          onChange={(e) => setCiudad(e.target.value)}
          aria-label="Filtrar por ciudad"
          className="w-full rounded-lg border border-[#E5E7EB] bg-white py-2 px-3 text-sm text-[#1A1A1A] focus:border-[#1A1A1A]/30 focus:outline-none"
        >
          <option value="todas">Todas las ciudades</option>
          {ciudadesDisponibles.map((c) => (
            <option key={c} value={c}>{c}</option>
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
      {filtro === 'cerrados' && cerrados.length > 0 && (
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
            description="Prueba con otro código, cliente o vehículo."
            primaryCta={{ label: 'Limpiar búsqueda', onClick: () => setQ('') }}
          />
        ) : filtro === 'cerrados' && !isFilteringMotivo ? (
          <EmptyState
            illustration="/empty-states/empty-cerrados.svg"
            illustrationAlt="Sin negocios cerrados todavia"
            title="Sin negocios cerrados todavia"
            description="Aqui veras el historial de negocios exitosos, perdidos y cancelados cuando los tengas."
          />
        ) : filtro === 'cerrados' && isFilteringMotivo ? (
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
              {filtro === 'todos'
                ? 'Sin negocios abiertos'
                : `Sin negocios en ${ALL_FILTROS.find((f) => f.key === filtro)?.label}`}
            </p>
            {filtro === 'todos' && (
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
