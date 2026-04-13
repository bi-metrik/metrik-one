import { getRiesgos } from '@/lib/actions/riesgos'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { Grid3X3 } from 'lucide-react'
import { redirect } from 'next/navigation'
import MatrizClient from './matriz-client'

interface Props {
  searchParams: Promise<{
    categoria?: string
    celda?: string // "prob-imp" format e.g. "3-4"
  }>
}

export default async function MatrizPage({ searchParams }: Props) {
  const params = await searchParams
  const categoria = params.categoria ?? 'todos'
  const celda = params.celda ?? null

  const { role } = await getWorkspace()
  if (!getRolePermissions(role ?? 'read_only').canViewRiesgos) redirect('/')

  const riesgos = await getRiesgos({
    categoria: categoria,
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Grid3X3 className="h-6 w-6 text-[#10B981]" />
        <div>
          <h1 className="text-xl font-bold text-[#1A1A1A]">Matriz de riesgos</h1>
          <p className="text-sm text-[#6B7280]">Visualizacion probabilidad vs impacto</p>
        </div>
      </div>

      <MatrizClient riesgos={riesgos} categoriaFiltro={categoria} celdaFiltro={celda} />
    </div>
  )
}
