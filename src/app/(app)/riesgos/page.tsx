import Link from 'next/link'
import { getRiesgos } from '@/lib/actions/riesgos'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { ShieldAlert, Plus } from 'lucide-react'
import { redirect } from 'next/navigation'
import type { Riesgo } from '@/lib/actions/riesgos'
import RiesgosExcelActions from './riesgos-excel-actions'

const NIVEL_COLORS: Record<string, string> = {
  BAJO: 'bg-green-100 text-green-800',
  MEDIO: 'bg-yellow-100 text-yellow-800',
  ALTO: 'bg-orange-100 text-orange-800',
  CRITICO: 'bg-red-100 text-red-800',
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

  // Role-based permissions (compliance module)
  const { role } = await getWorkspace()
  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canViewRiesgos) redirect('/')

  const riesgos = await getRiesgos({
    categoria: categoria,
    nivel_riesgo: nivel,
    estado: estado,
    factor_riesgo: factor,
  })

  // Counts by category
  const countByCategoria = riesgos.reduce((acc, r) => {
    acc[r.categoria] = (acc[r.categoria] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Counts by nivel
  const countByNivel = riesgos.reduce((acc, r) => {
    acc[r.nivel_riesgo] = (acc[r.nivel_riesgo] || 0) + 1
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
            <h1 className="text-xl font-bold text-[#1A1A1A]">Riesgos</h1>
            <p className="text-sm text-[#6B7280]">{riesgos.length} riesgo{riesgos.length !== 1 ? 's' : ''} registrado{riesgos.length !== 1 ? 's' : ''}</p>
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
        {(['CRITICO', 'ALTO', 'MEDIO', 'BAJO'] as const).map(n => (
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
            { value: 'CRITICO', label: 'Critico' },
            { value: 'ALTO', label: 'Alto' },
            { value: 'MEDIO', label: 'Medio' },
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

      {/* Table */}
      {riesgos.length === 0 ? (
        <div className="rounded-lg border border-[#E5E7EB] bg-white p-12 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-[#6B7280] mb-3" />
          <p className="text-sm font-medium text-[#1A1A1A]">Sin riesgos registrados</p>
          <p className="mt-1 text-xs text-[#6B7280]">Agrega el primer riesgo para comenzar la matriz de riesgos.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#E5E7EB]">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-[#6B7280]">
              <tr>
                <th className="px-4 py-3">Codigo</th>
                <th className="px-4 py-3">Categoria</th>
                <th className="px-4 py-3 min-w-[200px]">Descripcion</th>
                <th className="px-4 py-3">Factor</th>
                <th className="px-4 py-3 text-center">Prob</th>
                <th className="px-4 py-3 text-center">Imp</th>
                <th className="px-4 py-3">Nivel</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Responsable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB] bg-white">
              {riesgos.map((r: Riesgo) => (
                <tr key={r.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/riesgos/${r.id}`} className="font-mono text-xs font-medium text-[#10B981] hover:underline">
                      {r.codigo ?? '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${CATEGORIA_COLORS[r.categoria] ?? ''}`}>
                      {r.categoria}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#1A1A1A]">
                    <Link href={`/riesgos/${r.id}`} className="hover:underline line-clamp-2">
                      {r.descripcion}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#6B7280]">{FACTOR_LABELS[r.factor_riesgo] ?? r.factor_riesgo}</td>
                  <td className="px-4 py-3 text-center font-mono text-xs">{r.probabilidad}</td>
                  <td className="px-4 py-3 text-center font-mono text-xs">{r.impacto}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${NIVEL_COLORS[r.nivel_riesgo] ?? ''}`}>
                      {r.nivel_riesgo}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#6B7280]">{ESTADO_LABELS[r.estado] ?? r.estado}</td>
                  <td className="px-4 py-3 text-xs text-[#6B7280]">{r.responsable_nombre ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
