import { redirect } from 'next/navigation'
import { getMovimientos, getFilterOptions } from './actions'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import MovimientosClient from './movimientos-client'

interface Props {
  searchParams: Promise<{ tipo?: string; mes?: string; cat?: string; proy?: string; tipoProy?: string; estadoPago?: string; revisado?: string; clasificacion?: string; createdBy?: string }>
}

export default async function MovimientosPage({ searchParams }: Props) {
  const params = await searchParams
  const tipo = (params.tipo as 'todos' | 'ingresos' | 'egresos') ?? 'todos'
  const mes = params.mes ?? new Date().toISOString().slice(0, 7)
  const cat = params.cat ?? 'todos'
  const proy = params.proy ?? 'todos'
  const tipoProy = params.tipoProy ?? 'todos'
  const estadoPago = params.estadoPago ?? 'todos'
  const revisado = (params.revisado as 'todos' | 'pendientes' | 'revisados') ?? 'todos'
  const clasificacion = (params.clasificacion as 'todos' | 'variable' | 'fijo' | 'no_operativo') ?? 'todos'
  const createdBy = params.createdBy ?? 'todos'

  const { role } = await getWorkspace()
  const perms = getRolePermissions(role || '')
  if (!perms.canViewNumbers) redirect('/negocios')

  const [{ movimientos, totales, regimenFiscal }, { proyectos, miembros }] = await Promise.all([
    getMovimientos({ tipo, mes, cat, proy, tipoProy, estadoPago, revisadoFiltro: revisado, clasificacionFiltro: clasificacion, createdBy }),
    getFilterOptions(),
  ])

  return (
    <MovimientosClient
      movimientos={movimientos}
      totales={totales}
      filtroTipo={tipo}
      filtroMes={mes}
      filtroCat={cat}
      filtroProy={proy}
      filtroTipoProy={tipoProy}
      filtroEstadoPago={estadoPago}
      filtroRevisado={revisado}
      filtroClasificacion={clasificacion}
      filtroCreatedBy={createdBy}
      regimenFiscal={regimenFiscal}
      proyectos={proyectos}
      miembros={miembros}
      role={role ?? 'read_only'}
    />
  )
}
