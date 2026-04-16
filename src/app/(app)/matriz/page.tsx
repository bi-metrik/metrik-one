import { getAllCausasGrouped } from '@/lib/actions/riesgos'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { Grid3X3 } from 'lucide-react'
import { redirect } from 'next/navigation'
import MatrizClient from './matriz-client'

interface Props {
  searchParams: Promise<{
    categoria?: string
    celda?: string
  }>
}

export default async function MatrizPage({ searchParams }: Props) {
  const params = await searchParams
  const categoria = params.categoria ?? 'todos'
  const celda = params.celda ?? null

  const { role } = await getWorkspace()
  if (!getRolePermissions(role ?? 'read_only').canViewRiesgos) redirect('/')

  const { causas } = await getAllCausasGrouped({
    categoria: categoria,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Grid3X3 className="h-6 w-6 text-[#10B981]" />
        <div>
          <h1 className="text-xl font-bold text-[#1A1A1A]">Matriz de riesgos</h1>
          <p className="text-sm text-[#6B7280]">
            {causas.length} causa{causas.length !== 1 ? 's' : ''} — Probabilidad vs Impacto ponderado
          </p>
        </div>
      </div>

      <MatrizClient causas={causas} categoriaFiltro={categoria} celdaFiltro={celda} />
    </div>
  )
}
