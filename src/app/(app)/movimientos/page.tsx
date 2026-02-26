import { getMovimientos, getFilterOptions } from './actions'
import MovimientosClient from './movimientos-client'

interface Props {
  searchParams: Promise<{ tipo?: string; mes?: string; cat?: string; proy?: string; tipoProy?: string; estadoPago?: string }>
}

export default async function MovimientosPage({ searchParams }: Props) {
  const params = await searchParams
  const tipo = (params.tipo as 'todos' | 'ingresos' | 'egresos') ?? 'todos'
  const mes = params.mes ?? new Date().toISOString().slice(0, 7)
  const cat = params.cat ?? 'todos'
  const proy = params.proy ?? 'todos'
  const tipoProy = params.tipoProy ?? 'todos'
  const estadoPago = params.estadoPago ?? 'todos'

  const [{ movimientos, totales, regimenFiscal }, { proyectos }] = await Promise.all([
    getMovimientos({ tipo, mes, cat, proy, tipoProy, estadoPago }),
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
      regimenFiscal={regimenFiscal}
      proyectos={proyectos}
    />
  )
}
