// ============================================================
// Tableros — Types
// ============================================================

// ── Comercial ──────────────────────────────────────────────

export interface PipelineStage {
  etapa: string
  count: number
  valor: number
}

export interface RazonPerdida {
  razon: string
  count: number
}

export interface TopOportunidad {
  id: string
  nombre: string
  empresa: string
  valor: number
  etapa: string
  diasAbierta: number
}

export interface CarteraRango {
  rango_0_30: number
  rango_31_60: number
  rango_61_90: number
  rango_90_plus: number
  total: number
}

export interface ComercialData {
  ventasMes: number
  metaVentas: number | null
  ventasDelta: number         // % change vs previous month
  recaudoMes: number
  metaRecaudo: number | null
  pipeline: PipelineStage[]
  conversionRate: number      // % ganadas / (ganadas + perdidas)
  avgCloseTimeDays: number
  ganados: number
  perdidos: number
  razonesPerdida: RazonPerdida[]
  topOportunidades: TopOportunidad[]
  cartera: CarteraRango
}

// ── Operativo ──────────────────────────────────────────────

export interface ProyectoEstado {
  estado: string
  count: number
}

export interface ProyectoRiesgo {
  id: string
  nombre: string
  presupuestoPct: number
  horasPct: number
}

export interface GastoCategoria {
  categoria: string
  monto: number
}

export interface StaffProductividad {
  nombre: string
  horasRegistradas: number
  horasDisponibles: number
  utilizacion: number         // %
}

export interface OperativoData {
  proyectosPorEstado: ProyectoEstado[]
  completadosMes: number
  promedioPresupuestoConsumido: number  // %
  promedioHorasConsumidas: number       // %
  proyectosEnRiesgo: ProyectoRiesgo[]
  gastosPorCategoria: GastoCategoria[]
  productividadEquipo: StaffProductividad[]
}

// ── Financiero ─────────────────────────────────────────────

export interface MesIngresosEgresos {
  mes: string                 // YYYY-MM
  label: string               // "Ene", "Feb", etc.
  ingresos: number
  egresos: number
  margen: number              // %
}

export interface CategoriaGasto {
  categoria: string
  monto: number
  montoAnterior: number
}

export interface ProyectoFacturacion {
  nombre: string
  facturado: number
  cobrado: number
  cartera: number
}

export interface ImpuestosEstimados {
  reteFuente: number
  ica: number
  iva: number
}

export interface FinancieroData {
  saldoActual: number
  diferenciaTeoricoReal: number
  runwayMeses: number
  ingresosVsEgresos: MesIngresosEgresos[]
  margenPromedio: number      // %
  costosFijos: number
  componenteNomina: number
  componenteOperativo: number
  topCategoriasGasto: CategoriaGasto[]
  facturadoVsCobrado: ProyectoFacturacion[]
  impuestos: ImpuestosEstimados | null  // null if fiscal profile incomplete
}

// ── Periodos ───────────────────────────────────────────────

export type Periodo = 'mes' | 'trimestre' | '6meses' | 'anio'
