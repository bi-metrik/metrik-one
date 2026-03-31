// ============================================================
// Tableros — Types
// ============================================================

// ── Shared ─────────────────────────────────────────────────
export type Periodo = 'mes' | 'trimestre' | '6meses' | 'anio'

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

export interface OportunidadUrgente {
  id: string
  nombre: string
  empresa: string
  valor: number
  etapa: string
  razones: ('estancada' | 'cierre_proximo' | 'alto_valor')[]
  diasSinMovimiento?: number
}

export interface RitmoPipeline {
  etapaMasLenta: string
  diasPromedioEtapaMasLenta: number
  transicionesEstaSemana: number
  cierresMesAnterior: number
  diasPromedioCierre: number
}

export interface CanalAdquisicion {
  canal: string
  total: number
  ganadas: number
  conversionRate: number
}

export interface ComercialData {
  // C1 - Recaudo vs Meta
  recaudoMes: number
  metaRecaudo: number | null
  recaudoDelta: number
  diasRestantesMes: number
  // C2 - Pipeline
  pipeline: PipelineStage[]
  // C3 - Oportunidades urgentes
  oportunidadesUrgentes: OportunidadUrgente[]
  // C4 - Conversion
  conversionRate: number
  ganados: number
  perdidos: number
  razonesPerdida: RazonPerdida[]
  // C5 - Ritmo del embudo (puede ser null si no hay datos suficientes)
  ritmoPipeline: RitmoPipeline | null
  // C6 - ROI por canal (solo si >= 10 oportunidades cerradas)
  canalesAdquisicion: CanalAdquisicion[] | null
  totalOportunidadesCerradas: number
}

// ── Operativo ──────────────────────────────────────────────
export interface ProyectoEstado {
  estado: string
  count: number
}

export interface AlertaProyecto {
  id: string
  nombre: string
  tipo: ('presupuesto' | 'horas' | 'entrega_proxima' | 'avance_bajo')[]
  presupuestoPct: number
  horasPct?: number
  diasParaEntrega?: number
  avancePct?: number
}

export interface StaffProductividad {
  nombre: string
  horasRegistradas: number
  horasDisponibles: number
  utilizacion: number
}

export interface CostoProyecto {
  id: string
  nombre: string
  presupuesto: number
  gastoReal: number
  pct: number
}

export interface RentabilidadProyecto {
  nombre: string
  margenPct: number
  fechaCierre: string
}

export interface OperativoData {
  // O1 - Salud operativa
  saludPct: number
  proyectosActivos: number
  proyectosSaludables: number
  // O2 - Alertas unificadas
  alertas: AlertaProyecto[]
  // O3 - Resumen estados
  proyectosPorEstado: ProyectoEstado[]
  completadosMes: number
  // O4 - Consumo promedio
  promedioPresupuestoConsumido: number
  promedioHorasConsumidas: number
  proyectosEnRiesgoPresupuesto: number
  proyectosEnRiesgoHoras: number
  totalProyectosActivos: number
  // O5 - Rentabilidad cerrados
  rentabilidadCerrados: RentabilidadProyecto[]
  // O6 - Costo por proyecto
  costoPorProyecto: CostoProyecto[]
  // O7 - Productividad equipo (condicional)
  productividadEquipo: StaffProductividad[]
}

// ── Financiero ─────────────────────────────────────────────
export interface MesIngresosEgresos {
  mes: string
  label: string
  ingresos: number
  egresos: number
  margen: number
}

export interface GastoAnomalo {
  categoria: string
  monto: number
  montoAnterior: number
  deltaPct: number
}

export interface ProyectoCartera {
  nombre: string
  facturado: number
  cobrado: number
  cartera: number
  diasAtraso: number
}

export interface ImpuestosEstimados {
  reteFuente: number
  ica: number
  iva: number
}

export interface FinancieroData {
  // F1 - Flujo neto del mes
  flujoNeto: number
  flujoNetoDelta: number
  // F2 - Saldo + Runway
  saldoActual: number
  diferenciaTeoricoReal: number
  runwayMeses: number
  costosFijos: number
  componenteNomina: number
  componenteOperativo: number
  // F3 - Tendencia I vs E
  ingresosVsEgresos: MesIngresosEgresos[]
  margenPromedio: number
  // F4 - Cartera pendiente
  carteraPendiente: ProyectoCartera[]
  // F5 - Posicion neta de caja
  totalCarteraCobrar: number
  totalGastosPorPagar: number
  posicionNetaCaja: number
  // F6 - Gastos anomalos (null si no hay anomalias >20%)
  gastosAnomalos: GastoAnomalo[]
  // F7 - Impuestos
  impuestos: ImpuestosEstimados | null
}
