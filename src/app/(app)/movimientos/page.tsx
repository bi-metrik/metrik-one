import { getMovimientos, getFilterOptions } from './actions'
import { getWorkspace } from '@/lib/actions/get-workspace'
import MovimientosClient from './movimientos-client'

interface Props {
  searchParams: Promise<{ tipo?: string; mes?: string; cat?: string; proy?: string; tipoProy?: string; estadoPago?: string; estadoCausacion?: string; createdBy?: string }>
}

export default async function MovimientosPage({ searchParams }: Props) {
  const params = await searchParams
  const tipo = (params.tipo as 'todos' | 'ingresos' | 'egresos') ?? 'todos'
  const mes = params.mes ?? new Date().toISOString().slice(0, 7)
  const cat = params.cat ?? 'todos'
  const proy = params.proy ?? 'todos'
  const tipoProy = params.tipoProy ?? 'todos'
  const estadoPago = params.estadoPago ?? 'todos'
  const estadoCausacion = params.estadoCausacion ?? 'todos'
  const createdBy = params.createdBy ?? 'todos'

  const [{ movimientos, totales, regimenFiscal }, { proyectos, miembros }, { role }] = await Promise.all([
    getMovimientos({ tipo, mes, cat, proy, tipoProy, estadoPago, estadoCausacion, createdBy }),
    getFilterOptions(),
    getWorkspace(),
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
      filtroEstadoCausacion={estadoCausacion}
      filtroCreatedBy={createdBy}
      regimenFiscal={regimenFiscal}
      proyectos={proyectos}
      miembros={miembros}
      role={role ?? 'read_only'}
    />
  )
}
