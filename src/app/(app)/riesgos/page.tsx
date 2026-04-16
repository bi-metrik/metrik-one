import Link from 'next/link'
import { getRiesgos, getAllCausasGrouped } from '@/lib/actions/riesgos'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { ShieldAlert, Plus, ChevronRight, ShieldCheck } from 'lucide-react'
import { redirect } from 'next/navigation'
import type { Riesgo } from '@/lib/actions/riesgos'
import RiesgosExcelActions from './riesgos-excel-actions'

const NIVEL_COLORS: Record<string, string> = {
  BAJO: 'bg-green-100 text-green-800',
  MODERADO: 'bg-yellow-100 text-yellow-800',
  ALTO: 'bg-orange-100 text-orange-800',
  EXTREMO: 'bg-red-100 text-red-800',
}

const CATEGORIA_COLORS: Record<string, string> = {
  LA: 'bg-blue-100 text-blue-800',
  FT: 'bg-purple-100 text-purple-800',
  FPADM: 'bg-amber-100 text-amber-800',
  PTEE: 'bg-red-100 text-red-800',
}

const CATEGORIA_LABELS: Record<string, string> = {
  LA: 'Lavado de Activos',
  FT: 'Financiacion del Terrorismo',
  FPADM: 'Financiacion Proliferacion ADM',
  PTEE: 'Personas Exp. Politicamente',
}

const ESTADO_LABELS: Record<string, string> = {
  ABIERTO: 'Abierto',
  BAJO_CONTROL: 'Bajo control',
  MONITOREADO: 'Monitoreado',
  MITIGADO: 'Mitigado',
  REPORTADO: 'Reportado',
  CERRADO: 'Cerrado',
}

const FACTOR_LABELS: Record<string, string> = {
  clientes: 'Clientes',
  proveedores: 'Proveedores',
  empleados: 'Empleados',
  canales: 'Canales',
  jurisdicciones: 'Jurisdicciones',
  productos: 'Productos',
  operaciones: 'Operaciones',
}

function getImpactoBadgeColor(value: number): string {
  if (value <= 1.5) return 'bg-green-100 text-green-800'
  if (value <= 2.5) return 'bg-yellow-100 text-yellow-800'
  if (value <= 3.5) return 'bg-orange-100 text-orange-800'
  return 'bg-red-100 text-red-800'
}

const PROB_COLORS: Record<number, string> = {
  1: 'bg-green-100 text-green-800',
  2: 'bg-yellow-100 text-yellow-800',
  3: 'bg-orange-100 text-orange-800',
  4: 'bg-red-100 text-red-700',
  5: 'bg-red-200 text-red-900',
}

interface Props {
  searchParams: Promise<{
    categoria?: string
    nivel?: string
    estado?: string
    factor?: string
  }>
}

export default async function RiesgosPage({ searchParams }: Props) {
  const params = await searchParams
  const categoria = params.categoria ?? 'todos'
  const nivel = params.nivel ?? 'todos'
  const estado = params.estado ?? 'todos'
  const factor = params.factor ?? 'todos'

  const { role } = await getWorkspace()
  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canViewRiesgos) redirect('/')

  const { riesgos, causas, controlesByCausaId } = await getAllCausasGrouped({
    categoria,
    nivel_riesgo: nivel,
    estado,
    factor_riesgo: factor,
  })

  // Group causas by riesgo_id
  const causasByRiesgo = new Map<string, typeof causas>()
  for (const c of causas) {
    const list = causasByRiesgo.get(c.riesgo_id) ?? []
    list.push(c)
    causasByRiesgo.set(c.riesgo_id, list)
  }

  // Counts
  const totalCausas = causas.length
  const countByCategoria = riesgos.reduce((acc, r) => {
    acc[r.categoria] = (acc[r.categoria] || 0) + (causasByRiesgo.get(r.id)?.length ?? 0)
    return acc
  }, {} as Record<string, number>)

  const countByNivel = riesgos.reduce((acc, r) => {
    acc[r.nivel_riesgo] = (acc[r.nivel_riesgo] || 0) + (causasByRiesgo.get(r.id)?.length ?? 0)
    return acc
  }, {} as Record<string, number>)

  function buildFilterUrl(key: string, value: string) {
    const p = new URLSearchParams()
    const current = { categoria, nivel, estado, factor }
    const updated = { ...current, [key]: value }
    Object.entries(updated).forEach(([k, v]) => {
      if (v !== 'todos') p.set(k, v)
    })
    const qs = p.toString()
    return `/riesgos${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-6 w-6 text-[#10B981]" />
          <div>
            <h1 className="text-xl font-bold text-[#1A1A1A]">Matriz de Riesgos</h1>
            <p className="text-sm text-[#6B7280]">
              {totalCausas} causa{totalCausas !== 1 ? 's' : ''} en {riesgos.length} evento{riesgos.length !== 1 ? 's' : ''} de riesgo
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RiesgosExcelActions
            canImport={perms.canImportRiesgos}
            canExport={perms.canExportRiesgos}
          />
          {perms.canEditRiesgos && (
            <Link
              href="/riesgos/nuevo"
              className="inline-flex items-center gap-2 rounded-lg bg-[#10B981] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#059669]"
            >
              <Plus className="h-4 w-4" />
              Nuevo riesgo
            </Link>
          )}
        </div>
      </div>

      {/* Summary badges */}
      <div className="flex flex-wrap gap-3">
        {(['EXTREMO', 'ALTO', 'MODERADO', 'BAJO'] as const).map(n => (
          <div key={n} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${NIVEL_COLORS[n]}`}>
            {n}: {countByNivel[n] ?? 0}
          </div>
        ))}
        <div className="border-l border-[#E5E7EB] mx-1" />
        {(['LA', 'FT', 'FPADM', 'PTEE'] as const).map(c => (
          <div key={c} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${CATEGORIA_COLORS[c]}`}>
            {c}: {countByCategoria[c] ?? 0}
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <FilterSelect
          label="Categoria"
          value={categoria}
          paramKey="categoria"
          options={[
            { value: 'todos', label: 'Todas' },
            { value: 'LA', label: 'LA' },
            { value: 'FT', label: 'FT' },
            { value: 'FPADM', label: 'FPADM' },
            { value: 'PTEE', label: 'PTEE' },
          ]}
          buildUrl={buildFilterUrl}
        />
        <FilterSelect
          label="Nivel"
          value={nivel}
          paramKey="nivel"
          options={[
            { value: 'todos', label: 'Todos' },
            { value: 'EXTREMO', label: 'Extremo' },
            { value: 'ALTO', label: 'Alto' },
            { value: 'MODERADO', label: 'Moderado' },
            { value: 'BAJO', label: 'Bajo' },
          ]}
          buildUrl={buildFilterUrl}
        />
        <FilterSelect
          label="Estado"
          value={estado}
          paramKey="estado"
          options={[
            { value: 'todos', label: 'Todos' },
            { value: 'ABIERTO', label: 'Abierto' },
            { value: 'BAJO_CONTROL', label: 'Bajo control' },
            { value: 'MONITOREADO', label: 'Monitoreado' },
            { value: 'MITIGADO', label: 'Mitigado' },
            { value: 'REPORTADO', label: 'Reportado' },
            { value: 'CERRADO', label: 'Cerrado' },
          ]}
          buildUrl={buildFilterUrl}
        />
        <FilterSelect
          label="Factor"
          value={factor}
          paramKey="factor"
          options={[
            { value: 'todos', label: 'Todos' },
            { value: 'clientes', label: 'Clientes' },
            { value: 'proveedores', label: 'Proveedores' },
            { value: 'empleados', label: 'Empleados' },
            { value: 'canales', label: 'Canales' },
            { value: 'jurisdicciones', label: 'Jurisdicciones' },
            { value: 'productos', label: 'Productos' },
            { value: 'operaciones', label: 'Operaciones' },
          ]}
          buildUrl={buildFilterUrl}
        />
      </div>

      {/* Causas grouped by riesgo */}
      {riesgos.length === 0 ? (
        <div className="rounded-lg border border-[#E5E7EB] bg-white p-12 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-[#6B7280] mb-3" />
          <p className="text-sm font-medium text-[#1A1A1A]">Sin riesgos registrados</p>
          <p className="mt-1 text-xs text-[#6B7280]">Agrega el primer riesgo para comenzar la matriz.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {riesgos.map((r: Riesgo) => {
            const rCausas = causasByRiesgo.get(r.id) ?? []
            return (
              <div key={r.id} className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
                {/* Risk event header */}
                <Link
                  href={`/riesgos/${r.id}`}
                  className="flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors border-b border-[#E5E7EB]"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs font-bold text-[#10B981]">{r.codigo ?? '—'}</span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${CATEGORIA_COLORS[r.categoria] ?? ''}`}>
                      {r.categoria}
                    </span>
                    <span className="text-sm font-medium text-[#1A1A1A] line-clamp-1">{r.descripcion}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${NIVEL_COLORS[r.nivel_riesgo] ?? ''}`}>
                      {r.nivel_riesgo}
                    </span>
                    <span className="text-xs text-[#6B7280]">{rCausas.length} causa{rCausas.length !== 1 ? 's' : ''}</span>
                    <ChevronRight className="h-4 w-4 text-[#6B7280]" />
                  </div>
                </Link>

                {/* Causas table */}
                {rCausas.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-[10px] font-medium uppercase tracking-wider text-[#6B7280] bg-white">
                        <tr>
                          <th className="px-4 py-2">Ref</th>
                          <th className="px-4 py-2 min-w-[200px]">Causa</th>
                          <th className="px-4 py-2">Factor</th>
                          <th className="px-4 py-2 text-center">Imp. Pond.</th>
                          <th className="px-4 py-2 text-center">Prob</th>
                          <th className="px-4 py-2">Control</th>
                          <th className="px-4 py-2 text-center">Efect.</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E5E7EB]">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {rCausas.map((c: any) => {
                          const impPonderado = parseFloat(c.impacto_ponderado ?? 0)
                          const controles = controlesByCausaId[c.id] ?? []
                          const control = controles[0] // Primary control
                          const efectividad = control?.ponderacion_efectividad != null
                            ? Math.round(control.ponderacion_efectividad * 100)
                            : null

                          return (
                            <tr key={c.id} className="transition-colors hover:bg-gray-50">
                              <td className="px-4 py-2.5">
                                <span className="font-mono text-xs font-medium text-[#10B981]">{c.referencia}</span>
                              </td>
                              <td className="px-4 py-2.5">
                                <Link href={`/riesgos/${r.id}`} className="hover:underline">
                                  <p className="text-[#1A1A1A] line-clamp-2 text-sm">{c.descripcion}</p>
                                </Link>
                              </td>
                              <td className="px-4 py-2.5 text-xs text-[#6B7280] capitalize">{c.factor_riesgo ?? '—'}</td>
                              <td className="px-4 py-2.5 text-center">
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${getImpactoBadgeColor(impPonderado)}`}>
                                  {impPonderado.toFixed(1)}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${PROB_COLORS[c.probabilidad ?? 1] ?? 'bg-gray-100 text-gray-800'}`}>
                                  {c.probabilidad ?? 1}
                                </span>
                              </td>
                              <td className="px-4 py-2.5">
                                {control ? (
                                  <div className="flex items-center gap-1.5">
                                    <ShieldCheck className="h-3.5 w-3.5 text-[#10B981] shrink-0" />
                                    <span className="text-xs text-[#1A1A1A] line-clamp-1">{control.referencia ?? control.nombre_control}</span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-[#6B7280] italic">Sin control</span>
                                )}
                                {controles.length > 1 && (
                                  <span className="text-[10px] text-[#6B7280]">+{controles.length - 1} más</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                {efectividad != null ? (
                                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                    efectividad >= 80 ? 'bg-green-100 text-green-800' :
                                    efectividad >= 60 ? 'bg-yellow-100 text-yellow-800' :
                                    'bg-red-100 text-red-800'
                                  }`}>
                                    {efectividad}%
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-[#6B7280]">—</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {rCausas.length === 0 && (
                  <div className="px-4 py-4 text-center">
                    <p className="text-xs text-[#6B7280] italic">Sin causas identificadas para este evento de riesgo</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Filter select component (server component) ────────────

function FilterSelect({
  label,
  value,
  paramKey,
  options,
  buildUrl,
}: {
  label: string
  value: string
  paramKey: string
  options: { value: string; label: string }[]
  buildUrl: (key: string, value: string) => string
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs font-medium text-[#6B7280]">{label}:</label>
      <div className="flex gap-1">
        {options.map(opt => (
          <Link
            key={opt.value}
            href={buildUrl(paramKey, opt.value)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              value === opt.value
                ? 'bg-[#10B981] text-white'
                : 'bg-gray-100 text-[#6B7280] hover:bg-gray-200'
            }`}
          >
            {opt.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
