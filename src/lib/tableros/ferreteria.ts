/**
 * Indicadores generales del piloto Marketplace (Ferretería de Dimpro) para Tableros.
 *
 * Totales del piloto, no el detalle por publicación (ese vive en `/ferreteria`). Dos preguntas:
 * alcance e interés (publicaciones, clics, conversaciones) y resultado (ventas, ganancia,
 * liquidación). Y una tercera, la dirección: cada indicador se compara con el periodo anterior de
 * igual duración.
 *
 * Puro: `tab-ferreteria.tsx` le pasa las filas crudas y el día de hoy en Bogotá. Todas las fechas
 * son días de calendario `YYYY-MM-DD` en hora de Bogotá; lo que llega como instante
 * (`created_at` de los eventos) lo convierte quien lee (`app/(app)/tableros/ferreteria-actions.ts`).
 *
 * ── Los clics ────────────────────────────────────────────────────────────────────────────
 * `ferreteria_mediciones` guarda el ACUMULADO de cada aviso en cada corrida del cron. Los clics de
 * un día son la diferencia contra la medición anterior de ESE aviso, con tres reglas:
 *   1. La primera medición de un aviso es su línea base: lo que trae acumulado no se le atribuye
 *      a ningún día (el corte inicial traía semanas de clics).
 *   2. Si el cron no corrió unos días, la diferencia NO se reparte: cae entera el día en que se
 *      midió, y los días sin ninguna medición se marcan aparte.
 *   3. Un salto hacia abajo es un reinicio del contador (aviso republicado que vuelve a cero): no
 *      resta, y lo que marca la medición nueva se cuenta como clics desde el reinicio.
 */
import { liquidacionMensual, porCobrar, type MesLiquidacion } from '@/lib/ferreteria/liquidacion'
import {
  META_TOTAL_PILOTO,
  METAS_MENSUALES,
  PISO_ALARMA_OCTUBRE,
  alarmaPisoOctubre,
  diasDelMes,
  metaDelMes,
  metaProrrateada,
  semaforoRitmo,
  type MetaMes,
  type Semaforo,
} from '@/lib/ferreteria/metas'

// ── Fechas ────────────────────────────────────────────────────────────────────────────

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Días de `desde` a `hasta`, los dos incluidos. Vacío si `desde > hasta`. */
export function diasDelRango(desde: string, hasta: string): string[] {
  const out: string[] = []
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) out.push(d)
  return out
}

export type ClavePeriodo = '7d' | '30d' | 'piloto'

export const PERIODOS: { clave: ClavePeriodo; etiqueta: string }[] = [
  { clave: '7d', etiqueta: 'Últimos 7 días' },
  { clave: '30d', etiqueta: 'Últimos 30 días' },
  { clave: 'piloto', etiqueta: 'Todo el piloto' },
]

export interface Rango {
  desde: string
  hasta: string
}

/** El periodo elegido, siempre terminando hoy. "Todo el piloto" arranca el día del inicio. */
export function rangoDe(clave: ClavePeriodo, inicioPiloto: string, hoy: string): Rango {
  if (clave === 'piloto') return { desde: inicioPiloto <= hoy ? inicioPiloto : hoy, hasta: hoy }
  return { desde: sumarDias(hoy, clave === '7d' ? -6 : -29), hasta: hoy }
}

/** El periodo inmediatamente anterior, de igual duración. */
export function periodoAnterior(r: Rango): Rango {
  const n = diasDelRango(r.desde, r.hasta).length
  return { desde: sumarDias(r.desde, -n), hasta: sumarDias(r.desde, -1) }
}

/**
 * Variación porcentual contra el periodo anterior. `null` cuando no hay contra qué comparar:
 * el periodo anterior es previo al piloto, o valía cero (un "+∞ %" no dice nada).
 */
export function variacion(actual: number | null, anterior: number | null): number | null {
  if (actual == null || anterior == null || anterior === 0) return null
  return ((actual - anterior) / Math.abs(anterior)) * 100
}

// ── Clics ─────────────────────────────────────────────────────────────────────────────

export interface Medicion {
  publicacion_id: string
  fecha: string
  clics_acumulados: number
}

/**
 * Clics de una medición contra la anterior del mismo aviso. Un acumulado que baja es un
 * reinicio: cuenta lo que marca ahora (clics desde el reinicio), nunca un negativo.
 */
export function clicsEntre(anterior: number, actual: number): { clics: number; reinicio: boolean } {
  if (actual >= anterior) return { clics: actual - anterior, reinicio: false }
  return { clics: Math.max(0, actual), reinicio: true }
}

/**
 * Clics por día (día de la medición) y por publicación. La primera medición de cada aviso es
 * línea base y no suma.
 */
export function clicsPorDia(mediciones: Medicion[]): {
  porDia: Map<string, number>
  porPublicacionDia: Map<string, Map<string, number>>
  reinicios: number
} {
  const porPub = new Map<string, Medicion[]>()
  for (const m of mediciones) {
    const l = porPub.get(m.publicacion_id) ?? []
    l.push(m)
    porPub.set(m.publicacion_id, l)
  }
  const porDia = new Map<string, number>()
  const porPublicacionDia = new Map<string, Map<string, number>>()
  let reinicios = 0
  for (const [pub, serie] of porPub) {
    serie.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0))
    const propio = new Map<string, number>()
    for (let i = 1; i < serie.length; i++) {
      const r = clicsEntre(Number(serie[i - 1].clics_acumulados), Number(serie[i].clics_acumulados))
      if (r.reinicio) reinicios++
      porDia.set(serie[i].fecha, (porDia.get(serie[i].fecha) ?? 0) + r.clics)
      propio.set(serie[i].fecha, (propio.get(serie[i].fecha) ?? 0) + r.clics)
    }
    porPublicacionDia.set(pub, propio)
  }
  return { porDia, porPublicacionDia, reinicios }
}

/** Días del rango en los que no hubo NINGUNA medición (el cron no corrió o no llegó). */
export function diasSinMedicion(mediciones: Medicion[], r: Rango): string[] {
  const medidos = new Set(mediciones.map((m) => m.fecha))
  return diasDelRango(r.desde, r.hasta).filter((d) => !medidos.has(d))
}

// ── Estado de las publicaciones por día ───────────────────────────────────────────────

export interface Publicacion {
  id: string
  estado: string
  /** Primer día en que existe: el menor entre publicación, alta y primer evento. */
  desde: string
}

export interface CambioEstado {
  publicacion_id: string
  /** Día (Bogotá) del cambio. */
  fecha: string
  /** Para ordenar cambios del mismo día. */
  instante: string
  anterior: string | null
  nuevo: string
}

/**
 * Estado de una publicación al cierre de un día: el del último cambio hasta ese día; si todos
 * los cambios son posteriores, el `anterior` del primero; sin cambios, el estado actual.
 */
export function estadoEnDia(pub: Publicacion, cambios: CambioEstado[], dia: string): string | null {
  if (dia < pub.desde) return null
  let ultimo: CambioEstado | null = null
  let primero: CambioEstado | null = null
  for (const c of cambios) {
    if (!primero || c.instante < primero.instante) primero = c
    if (c.fecha <= dia && (!ultimo || c.instante > ultimo.instante)) ultimo = c
  }
  if (ultimo) return ultimo.nuevo
  if (primero) return primero.anterior ?? pub.estado
  return pub.estado
}

export interface EstadosDia {
  fecha: string
  activa: number
  en_revision: number
  agotada: number
}

export function estadosPorDia(pubs: Publicacion[], cambios: CambioEstado[], dias: string[]): EstadosDia[] {
  const porPub = new Map<string, CambioEstado[]>()
  for (const c of cambios) {
    const l = porPub.get(c.publicacion_id) ?? []
    l.push(c)
    porPub.set(c.publicacion_id, l)
  }
  return dias.map((fecha) => {
    const fila: EstadosDia = { fecha, activa: 0, en_revision: 0, agotada: 0 }
    for (const p of pubs) {
      const e = estadoEnDia(p, porPub.get(p.id) ?? [], fecha)
      if (e === 'activa' || e === 'en_revision' || e === 'agotada') fila[e]++
    }
    return fila
  })
}

// ── Series ────────────────────────────────────────────────────────────────────────────

export interface PuntoSerie {
  fecha: string
  valor: number
  acumulado: number
}

/** Serie diaria con su curva acumulada dentro del rango. */
export function serieConAcumulado(dias: string[], valor: (dia: string) => number): PuntoSerie[] {
  let acc = 0
  return dias.map((fecha) => {
    const v = valor(fecha)
    acc += v
    return { fecha, valor: v, acumulado: acc }
  })
}

// ── El resumen del periodo ────────────────────────────────────────────────────────────

export interface Conversacion {
  fecha: string
}

export interface Venta {
  fecha_primer_pago: string | null
  precio_final: number
  costo_dia: number
  ganancia: number
}

export interface DatosPiloto {
  publicaciones: Publicacion[]
  cambios: CambioEstado[]
  mediciones: Medicion[]
  conversaciones: Conversacion[]
  ventas: Venta[]
}

/** Primer día del piloto: la primera publicación, medición, conversación o pago. */
export function inicioDelPiloto(d: DatosPiloto, hoy: string): string {
  const fechas = [
    ...d.publicaciones.map((p) => p.desde),
    ...d.mediciones.map((m) => m.fecha),
    ...d.conversaciones.map((c) => c.fecha),
    ...d.ventas.map((v) => v.fecha_primer_pago).filter((f): f is string => !!f),
  ].filter((f) => f <= hoy)
  return fechas.length ? fechas.reduce((a, b) => (b < a ? b : a)) : hoy
}

const enRango = (f: string, r: Rango) => f >= r.desde && f <= r.hasta

export interface Totales {
  /** Activas al cierre del último día del rango. */
  activas: number
  clics: number
  conversaciones: number
  ventas: number
  ingreso: number
  ganancia: number
  /** Conversaciones / clics. */
  tasaConversacion: number | null
  /** Ventas / conversaciones. */
  tasaVenta: number | null
  ticketPromedio: number | null
  gananciaPromedio: number | null
  /** Clics del periodo / publicaciones activas en promedio por día. */
  clicsPorActiva: number | null
}

export function totalesDelRango(d: DatosPiloto, r: Rango): Totales {
  const dias = diasDelRango(r.desde, r.hasta)
  const { porDia } = clicsPorDia(d.mediciones)
  const clics = dias.reduce((s, f) => s + (porDia.get(f) ?? 0), 0)
  const conversaciones = d.conversaciones.filter((c) => enRango(c.fecha, r)).length
  const pagadas = d.ventas.filter((v) => v.fecha_primer_pago && enRango(v.fecha_primer_pago, r))
  const ingreso = pagadas.reduce((s, v) => s + Number(v.precio_final), 0)
  const ganancia = pagadas.reduce((s, v) => s + Number(v.ganancia), 0)
  const estados = estadosPorDia(d.publicaciones, d.cambios, dias)
  const promedioActivas = estados.length ? estados.reduce((s, e) => s + e.activa, 0) / estados.length : 0
  return {
    activas: estados.at(-1)?.activa ?? 0,
    clics,
    conversaciones,
    ventas: pagadas.length,
    ingreso,
    ganancia,
    tasaConversacion: clics > 0 ? conversaciones / clics : null,
    tasaVenta: conversaciones > 0 ? pagadas.length / conversaciones : null,
    ticketPromedio: pagadas.length > 0 ? ingreso / pagadas.length : null,
    gananciaPromedio: pagadas.length > 0 ? ganancia / pagadas.length : null,
    clicsPorActiva: promedioActivas > 0 ? clics / promedioActivas : null,
  }
}

/**
 * Publicaciones activas hoy, ya medidas (tienen al menos una medición después de su línea base),
 * que no sumaron un solo clic en los últimos 7 días.
 */
export function sinClicsUltimos7(d: DatosPiloto, hoy: string): number {
  const { porPublicacionDia } = clicsPorDia(d.mediciones)
  const desde = sumarDias(hoy, -6)
  const porPub = new Map<string, CambioEstado[]>()
  for (const c of d.cambios) porPub.set(c.publicacion_id, [...(porPub.get(c.publicacion_id) ?? []), c])
  let n = 0
  for (const p of d.publicaciones) {
    if (estadoEnDia(p, porPub.get(p.id) ?? [], hoy) !== 'activa') continue
    const propio = porPublicacionDia.get(p.id)
    if (!propio || propio.size === 0) continue
    let clics = 0
    for (const [f, c] of propio) if (f >= desde && f <= hoy) clics += c
    if (clics === 0) n++
  }
  return n
}

export interface Tablero {
  rango: Rango
  anterior: Rango
  /** El periodo anterior empieza antes del piloto: no se compara. */
  sinComparacion: boolean
  actual: Totales
  previo: Totales
  diasSinMedicion: string[]
  reinicios: number
  estados: EstadosDia[]
  clics: PuntoSerie[]
  conversaciones: PuntoSerie[]
  ventas: PuntoSerie[]
  ingreso: PuntoSerie[]
  ganancia: PuntoSerie[]
  clicsPorActivaDia: { fecha: string; valor: number | null }[]
  sinClics7d: number
  porCobrar: { ventas: number; valor: number }
  /** El mes en curso de la liquidación (mes del pago). Null si aún no hay pagos este mes. */
  mesEnCurso: MesLiquidacion | null
}

export function armarTablero(d: DatosPiloto, clave: ClavePeriodo, hoy: string): Tablero {
  const inicio = inicioDelPiloto(d, hoy)
  const rango = rangoDe(clave, inicio, hoy)
  const anterior = periodoAnterior(rango)
  const sinComparacion = anterior.desde < inicio
  const dias = diasDelRango(rango.desde, rango.hasta)
  const clicsDia = clicsPorDia(d.mediciones)
  const estados = estadosPorDia(d.publicaciones, d.cambios, dias)

  const contar = <T,>(filas: T[], fecha: (x: T) => string | null, valor: (x: T) => number) => {
    const m = new Map<string, number>()
    for (const x of filas) {
      const f = fecha(x)
      if (f) m.set(f, (m.get(f) ?? 0) + valor(x))
    }
    return (dia: string) => m.get(dia) ?? 0
  }
  const convDia = contar(d.conversaciones, (c) => c.fecha, () => 1)
  const ventasDia = contar(d.ventas, (v) => v.fecha_primer_pago, () => 1)
  const ingresoDia = contar(d.ventas, (v) => v.fecha_primer_pago, (v) => Number(v.precio_final))
  const gananciaDia = contar(d.ventas, (v) => v.fecha_primer_pago, (v) => Number(v.ganancia))

  const mesActual = hoy.slice(0, 7)
  return {
    rango,
    anterior,
    sinComparacion,
    actual: totalesDelRango(d, rango),
    previo: totalesDelRango(d, anterior),
    diasSinMedicion: diasSinMedicion(d.mediciones, { desde: rango.desde < inicio ? inicio : rango.desde, hasta: rango.hasta }),
    reinicios: clicsDia.reinicios,
    estados,
    clics: serieConAcumulado(dias, (f) => clicsDia.porDia.get(f) ?? 0),
    conversaciones: serieConAcumulado(dias, convDia),
    ventas: serieConAcumulado(dias, ventasDia),
    ingreso: serieConAcumulado(dias, ingresoDia),
    ganancia: serieConAcumulado(dias, gananciaDia),
    clicsPorActivaDia: dias.map((fecha, i) => {
      const act = estados[i].activa
      return { fecha, valor: act > 0 ? (clicsDia.porDia.get(fecha) ?? 0) / act : null }
    }),
    sinClics7d: sinClicsUltimos7(d, hoy),
    porCobrar: porCobrar(d.ventas),
    mesEnCurso: liquidacionMensual(d.ventas, hoy).find((m) => m.mes === mesActual) ?? null,
  }
}

// ── El mes en curso contra la meta ────────────────────────────────────────────────────

export interface PuntoMeta {
  dia: number
  fecha: string
  /** Acumulado real hasta ese día. Null en los días que aún no llegan. */
  real: number | null
  /** Meta del mes prorrateada a ese día. */
  meta: number
}

export interface IndicadorMes {
  acumulado: number
  metaMes: number
  metaAHoy: number
  ritmo: { semaforo: Semaforo; ritmo: number } | null
  curva: PuntoMeta[]
}

export interface MesConMeta {
  mes: string
  /** Null antes de octubre y después de diciembre: el tablero muestra los datos sin meta. */
  meta: MetaMes | null
  ventas: IndicadorMes | null
  ganancia: IndicadorMes | null
  conversaciones: IndicadorMes | null
  activasHoy: number
  bajoPisoActivas: boolean
  alarmaPisoOctubre: boolean
  totalPiloto: { ventas: number; ganancia: number; metaVentas: number; metaGanancia: number }
}

function indicadorMes(mes: string, hoy: string, metaMes: number, valorDia: (fecha: string) => number): IndicadorMes {
  const n = diasDelMes(mes)
  const diaHoy = hoy.slice(0, 7) === mes ? Number(hoy.slice(8, 10)) : hoy.slice(0, 7) > mes ? n : 0
  let acc = 0
  const curva: PuntoMeta[] = []
  for (let dia = 1; dia <= n; dia++) {
    const fecha = `${mes}-${String(dia).padStart(2, '0')}`
    if (dia <= diaHoy) acc += valorDia(fecha)
    curva.push({ dia, fecha, real: dia <= diaHoy ? acc : null, meta: metaProrrateada(metaMes, mes, dia) })
  }
  const metaAHoy = diaHoy > 0 ? metaProrrateada(metaMes, mes, diaHoy) : 0
  return { acumulado: acc, metaMes, metaAHoy, ritmo: semaforoRitmo(acc, metaAHoy), curva }
}

export function mesConMeta(d: DatosPiloto, hoy: string): MesConMeta {
  const mes = hoy.slice(0, 7)
  const meta = metaDelMes(mes)
  const porDia = (filas: { fecha: string | null; v: number }[]) => {
    const m = new Map<string, number>()
    for (const x of filas) if (x.fecha) m.set(x.fecha, (m.get(x.fecha) ?? 0) + x.v)
    return (f: string) => m.get(f) ?? 0
  }
  const ventasDia = porDia(d.ventas.map((v) => ({ fecha: v.fecha_primer_pago, v: 1 })))
  const gananciaDia = porDia(d.ventas.map((v) => ({ fecha: v.fecha_primer_pago, v: Number(v.ganancia) })))
  const convDia = porDia(d.conversaciones.map((c) => ({ fecha: c.fecha, v: 1 })))

  const porPub = new Map<string, CambioEstado[]>()
  for (const c of d.cambios) porPub.set(c.publicacion_id, [...(porPub.get(c.publicacion_id) ?? []), c])
  const activasHoy = d.publicaciones.filter((p) => estadoEnDia(p, porPub.get(p.id) ?? [], hoy) === 'activa').length

  const primerMes = METAS_MENSUALES[0].mes
  const ultimoMes = METAS_MENSUALES[METAS_MENSUALES.length - 1].mes
  const delPiloto = d.ventas.filter(
    (v) => v.fecha_primer_pago && v.fecha_primer_pago.slice(0, 7) >= primerMes && v.fecha_primer_pago.slice(0, 7) <= ultimoMes,
  )
  const ventasOctubre = d.ventas.filter((v) => v.fecha_primer_pago?.slice(0, 7) === PISO_ALARMA_OCTUBRE.mes).length

  return {
    mes,
    meta,
    ventas: meta ? indicadorMes(mes, hoy, meta.ventas, ventasDia) : null,
    ganancia: meta ? indicadorMes(mes, hoy, meta.ganancia, gananciaDia) : null,
    conversaciones: meta ? indicadorMes(mes, hoy, meta.conversaciones, convDia) : null,
    activasHoy,
    bajoPisoActivas: meta ? activasHoy < meta.activasPiso : false,
    alarmaPisoOctubre: alarmaPisoOctubre(ventasOctubre, hoy),
    totalPiloto: {
      ventas: delPiloto.length,
      ganancia: delPiloto.reduce((s, v) => s + Number(v.ganancia), 0),
      metaVentas: META_TOTAL_PILOTO.ventas,
      metaGanancia: META_TOTAL_PILOTO.ganancia,
    },
  }
}
