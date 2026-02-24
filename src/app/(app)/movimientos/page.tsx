import { getMovimientos } from './actions'
import MovimientosClient from './movimientos-client'

interface Props {
  searchParams: Promise<{ tipo?: string; mes?: string }>
}

export default async function MovimientosPage({ searchParams }: Props) {
  const params = await searchParams
  const tipo = (params.tipo as 'todos' | 'ingresos' | 'egresos') ?? 'todos'
  const mes = params.mes ?? new Date().toISOString().slice(0, 7)

  const { movimientos, totales, regimenFiscal } = await getMovimientos({ tipo, mes })

  return (
    <MovimientosClient
      movimientos={movimientos}
      totales={totales}
      filtroTipo={tipo}
      filtroMes={mes}
      regimenFiscal={regimenFiscal}
    />
  )
}
