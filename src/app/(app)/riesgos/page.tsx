import Link from 'next/link'
import { getAllCausasGrouped } from '@/lib/actions/riesgos'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { ShieldAlert, Plus } from 'lucide-react'
import { redirect } from 'next/navigation'
import RiesgosExcelActions from './riesgos-excel-actions'
import RiesgosFilters from './riesgos-filters'
import RiesgosList from './riesgos-list'

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

  // Group causas by riesgo_id for the client component
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const causasByRiesgo: Record<string, any[]> = {}
  for (const c of causas) {
    if (!causasByRiesgo[c.riesgo_id]) causasByRiesgo[c.riesgo_id] = []
    causasByRiesgo[c.riesgo_id].push(c)
  }

  // Counts based on causas
  const totalCausas = causas.length
  const countByCategoria: Record<string, number> = {}
  const countByNivel: Record<string, number> = {}
  for (const r of riesgos) {
    const n = causasByRiesgo[r.id]?.length ?? 0
    countByCategoria[r.categoria] = (countByCategoria[r.categoria] || 0) + n
    countByNivel[r.nivel_riesgo] = (countByNivel[r.nivel_riesgo] || 0) + n
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-6 w-6 text-[#10B981]" />
          <div>
            <h1 className="text-xl font-bold text-[#1A1A1A]">Riesgos</h1>
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
              Nueva causa
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
      <RiesgosFilters
        categoria={categoria}
        nivel={nivel}
        estado={estado}
        factor={factor}
      />

      {/* Collapsible causas list */}
      <RiesgosList
        riesgos={riesgos.map(r => ({
          id: r.id,
          codigo: r.codigo,
          categoria: r.categoria,
          descripcion: r.descripcion,
          nivel_riesgo: r.nivel_riesgo,
        }))}
        causasByRiesgo={causasByRiesgo}
        controlesByCausaId={controlesByCausaId}
      />
    </div>
  )
}

