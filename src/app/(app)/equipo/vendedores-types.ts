// Tipos del perfil de vendedor (derivado de ventas_hechos + metas_vendedor).
export interface VendedorResumen {
  vendedor: string
  ventaNeta: number
  utilidad: number
  margenPct: number | null
  documentos: number
}
export interface VendedorPerfilKpis {
  ventaNeta: number
  utilidad: number
  margenPct: number | null
  margenValido: boolean
  documentos: number
  unidades: number
  pesoVentaPct: number
}
export interface VendedorEquipo {
  vendedores: number
  margenPonderado: number | null
  percentilVenta: number | null
  percentilMargen: number | null
}
export interface VendedorMes { label: string; ventaNeta: number; margenPct: number | null }
export interface VendedorCumplimiento { metaVenta: number; ventaReal: number; cumplimientoPct: number | null }
export interface VendedorLinea { linea: string; ventaNeta: number; margenPct: number | null }
export interface VendedorProducto { producto: string; ventaNeta: number; margenPct: number | null }
export interface VendedorPerfil {
  vendedor: string
  existe: boolean
  kpis: VendedorPerfilKpis
  equipo: VendedorEquipo
  porMes: VendedorMes[]
  cumplimiento: VendedorCumplimiento
  porLinea: VendedorLinea[]
  topProductos: VendedorProducto[]
}

export function slugVendedor(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}
