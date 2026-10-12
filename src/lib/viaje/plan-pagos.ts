/**
 * Plan de pagos del viajero: regla 80/15, plan sugerido y validación en vivo (F2).
 *
 * Puro (servidor y navegador): la misma función arma el sugerido en la hoja «El cliente
 * confirmó», lo valida mientras la comercial lo ajusta y lo vuelve a validar el servidor al
 * acordar. Una sola regla en los dos lados (Vera C2).
 *
 * Forma del sugerido (Vera C2, la de Noor §4.1):
 *   · anticipo del 30 % al confirmar (hoy);
 *   · una cuota que completa el 80 % quince días antes de salir (T-15);
 *   · el 20 % restante el día del viaje.
 * Si T-15 ya pasó o es hoy: 80 % al confirmar y 20 % el día del viaje. Sin fecha de salida, o con la
 * salida ya pasada, no hay sugerido (la pantalla dice la regla en palabras).
 *
 * Redondeo a $1.000: el anticipo se redondea; el acumulado del 80 % se redondea HACIA ARRIBA (un
 * redondeo hacia abajo dejaría el sugerido fuera de su propia regla); la última cuota absorbe el
 * residuo para que la suma sea el total al peso.
 *
 * Las cuotas son compromisos, no plata: el estado de cada una sale del reparto contra los pagos
 * reales (`cobros` con fecha), nunca se guardan como cobros programados (Vera §7.2.3).
 */

export interface ReglaPlan {
  /** Porcentaje del total que debe estar pagado a `dias_antes` de la salida. */
  pct_minimo: number
  /** Días antes de la salida en que se mide el `pct_minimo`. */
  dias_antes: number
  /** Anticipo del sugerido (P1: 30 %). */
  anticipo_pct: number
}

export const REGLA_POR_DEFECTO: ReglaPlan = { pct_minimo: 80, dias_antes: 15, anticipo_pct: 30 }

export interface CuotaPlan {
  /** 0 = anticipo; 1..n en orden de vencimiento. */
  numero: number
  monto: number
  /** `YYYY-MM-DD`. */
  fecha: string
  concepto: string | null
}

export interface ConfigPlanPagos {
  activo: boolean
  regla: ReglaPlan
}

function numeroEnRango(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}

/** `lineas_negocio.config_extra.plan_pagos`. Ausente o `activo !== true` = apagado (como hoy). */
export function configPlanPagos(configLinea: unknown): ConfigPlanPagos {
  const raw = (configLinea as { plan_pagos?: Record<string, unknown> } | null | undefined)?.plan_pagos
  const activo = !!raw && typeof raw === 'object' && raw.activo === true
  const r = (raw?.regla ?? {}) as Record<string, unknown>
  return {
    activo,
    regla: {
      pct_minimo: numeroEnRango(r.pct_minimo, 1, 100) ?? REGLA_POR_DEFECTO.pct_minimo,
      dias_antes: numeroEnRango(r.dias_antes, 0, 365) ?? REGLA_POR_DEFECTO.dias_antes,
      anticipo_pct: numeroEnRango(r.anticipo_pct, 1, 100) ?? REGLA_POR_DEFECTO.anticipo_pct,
    },
  }
}

// ── Fechas (civiles, sin zona: `YYYY-MM-DD`) ─────────────────────────────────

const DIA_MS = 86_400_000
const ms = (f: string) => Date.parse(`${f.slice(0, 10)}T00:00:00Z`)
const iso = (n: number) => new Date(n).toISOString().slice(0, 10)

export function sumarDiasCivil(fecha: string, dias: number): string {
  return iso(ms(fecha) + dias * DIA_MS)
}

export function esFechaCivil(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(ms(v))
}

/**
 * Hasta qué fecha se mide el mínimo: T-`dias_antes`, o hoy si eso ya pasó (un viaje a menos de 15
 * días se mide contra lo que paga al confirmar).
 */
export function fechaDelMinimo(fechaSalida: string, hoy: string, regla: ReglaPlan): string {
  const t = sumarDiasCivil(fechaSalida, -regla.dias_antes)
  return t > hoy ? t : hoy
}

const redondear = (v: number) => Math.round(v / 1000) * 1000
const redondearArriba = (v: number) => Math.ceil(v / 1000) * 1000

/** El plan sugerido (C2). `null` sin fecha de salida, con la salida ya pasada o con total inválido. */
export function planSugerido(args: {
  total: number
  fechaSalida: string | null
  hoy: string
  regla?: ReglaPlan
}): CuotaPlan[] | null {
  const regla = args.regla ?? REGLA_POR_DEFECTO
  const total = Math.round(args.total)
  if (!(total > 0) || !esFechaCivil(args.fechaSalida) || args.fechaSalida < args.hoy) return null
  const salida = args.fechaSalida
  const tMin = sumarDiasCivil(salida, -regla.dias_antes)
  const minimo = Math.min(total, redondearArriba((total * regla.pct_minimo) / 100))

  // Viaje a 15 días o menos: el mínimo al confirmar y el resto el día del viaje.
  if (tMin <= args.hoy) {
    const cuotas: CuotaPlan[] = [{ numero: 0, monto: minimo, fecha: args.hoy, concepto: 'Anticipo' }]
    if (total - minimo > 0) cuotas.push({ numero: 1, monto: total - minimo, fecha: salida, concepto: 'Saldo' })
    return cuotas
  }

  const anticipo = Math.min(minimo, Math.max(1000, redondear((total * regla.anticipo_pct) / 100)))
  const cuotas: CuotaPlan[] = [{ numero: 0, monto: anticipo, fecha: args.hoy, concepto: 'Anticipo' }]
  if (minimo - anticipo > 0) {
    cuotas.push({ numero: cuotas.length, monto: minimo - anticipo, fecha: tMin, concepto: null })
  }
  if (total - minimo > 0) {
    cuotas.push({ numero: cuotas.length, monto: total - minimo, fecha: salida, concepto: 'Saldo' })
  }
  return cuotas
}

/** Ordena por fecha y renumera (0 = la primera, el anticipo). No muta la entrada. */
export function normalizarCuotas(cuotas: readonly CuotaPlan[]): CuotaPlan[] {
  return [...cuotas]
    .map((c) => ({ ...c, monto: Math.round(Number(c.monto) || 0) }))
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.numero - b.numero))
    .map((c, i) => ({ ...c, numero: i }))
}

export interface ValidacionPlan {
  suma: number
  /** total − suma: positivo = faltan, negativo = sobran. */
  diferencia: number
  /** Hasta qué fecha se mide el mínimo (null sin fecha de salida). */
  fechaMinimo: string | null
  /** Lo acumulado a `fechaMinimo`. */
  acumuladoAlMinimo: number
  pctAlMinimo: number
  cumpleMinimo: boolean
  /** Alguna cuota cae después del día del viaje. */
  despuesDelViaje: boolean
  /** Alguna cuota con monto ≤ 0 o fecha inválida. */
  cuotaInvalida: boolean
  /** Suma = total y todas las cuotas válidas: se puede guardar. */
  cuadra: boolean
  /** Cuadra, ninguna después del viaje, y cumple el mínimo: no pide aprobación. */
  dentroDeRegla: boolean
}

export function validarPlan(
  cuotas: readonly CuotaPlan[],
  ctx: { total: number; fechaSalida: string | null; hoy: string; regla?: ReglaPlan },
): ValidacionPlan {
  const regla = ctx.regla ?? REGLA_POR_DEFECTO
  const total = Math.round(ctx.total)
  const cuotaInvalida = cuotas.length === 0 || cuotas.some((c) => !(Number(c.monto) > 0) || !esFechaCivil(c.fecha))
  const suma = cuotas.reduce((s, c) => s + Math.round(Number(c.monto) || 0), 0)
  const diferencia = total - suma
  const conFecha = esFechaCivil(ctx.fechaSalida)
  const fechaMinimo = conFecha ? fechaDelMinimo(ctx.fechaSalida as string, ctx.hoy, regla) : null
  const acumuladoAlMinimo = fechaMinimo
    ? cuotas.filter((c) => esFechaCivil(c.fecha) && c.fecha <= fechaMinimo).reduce((s, c) => s + Math.round(Number(c.monto) || 0), 0)
    : 0
  const pctAlMinimo = total > 0 ? (acumuladoAlMinimo / total) * 100 : 0
  // Sin fecha de salida no hay contra qué medir: el plan no puede quedar «dentro de la regla».
  const cumpleMinimo = !!fechaMinimo && acumuladoAlMinimo * 100 >= total * regla.pct_minimo
  const despuesDelViaje = conFecha && cuotas.some((c) => esFechaCivil(c.fecha) && c.fecha > (ctx.fechaSalida as string))
  const cuadra = !cuotaInvalida && diferencia === 0 && total > 0
  return {
    suma,
    diferencia,
    fechaMinimo,
    acumuladoAlMinimo,
    pctAlMinimo,
    cumpleMinimo,
    despuesDelViaje,
    cuotaInvalida,
    cuadra,
    dentroDeRegla: cuadra && !despuesDelViaje && cumpleMinimo,
  }
}

/**
 * Huella de un plan: cambia si cambia cualquier cuota (monto o fecha) o el total. Una aprobación
 * de «plan fuera de la regla» vale solo para la huella con que se pidió (F2-3).
 */
export function huellaPlan(cuotas: readonly CuotaPlan[], total: number): string {
  const partes = normalizarCuotas(cuotas).map((c) => `${c.fecha}:${c.monto}`)
  return `plan:v1|${Math.round(total)}|${partes.join(';')}`
}

/** Lee cuotas que llegan del navegador. `null` si algo no tiene forma de cuota. */
export function leerCuotas(raw: unknown): CuotaPlan[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 24) return null
  const out: CuotaPlan[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') return null
    const o = r as Record<string, unknown>
    const monto = typeof o.monto === 'number' ? o.monto : Number(o.monto)
    if (!Number.isFinite(monto) || !esFechaCivil(o.fecha)) return null
    const concepto = typeof o.concepto === 'string' && o.concepto.trim() !== '' ? o.concepto.trim().slice(0, 200) : null
    out.push({ numero: out.length, monto: Math.round(monto), fecha: o.fecha, concepto })
  }
  return normalizarCuotas(out)
}

// ── Textos (Noor §4.2 y §2 etapa 4; español llano, sin palabras técnicas) ─────

/** «$9.165.000», como el documento del cliente y `formatCOP`. */
export const pesos = (v: number) => `${v < 0 ? '-' : ''}$${Math.abs(Math.round(v)).toLocaleString('es-CO', { useGrouping: true })}`

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/** «19 nov» (el formato de Noor; no depende del ICU del servidor). */
export function fechaCorta(f: string): string {
  const d = new Date(`${f.slice(0, 10)}T00:00:00Z`)
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`
}

/** «viernes 4 dic» */
export function fechaConDia(f: string): string {
  const d = new Date(`${f.slice(0, 10)}T00:00:00Z`)
  return `${DIAS[d.getUTCDay()]} ${fechaCorta(f)}`
}

/** La línea de validación en vivo, arriba del editor (Noor §4.2). */
export function lineasDeValidacion(v: ValidacionPlan, ctx: { total: number; regla?: ReglaPlan; fechaSalida: string | null }): Array<{ ok: boolean; texto: string }> {
  const regla = ctx.regla ?? REGLA_POR_DEFECTO
  const out: Array<{ ok: boolean; texto: string }> = []
  if (v.diferencia === 0) out.push({ ok: true, texto: `Suma ${pesos(v.suma)}` })
  else if (v.diferencia > 0) out.push({ ok: false, texto: `Las cuotas suman ${pesos(v.suma)} y el viaje vale ${pesos(ctx.total)}. Faltan ${pesos(v.diferencia)}.` })
  else out.push({ ok: false, texto: `Las cuotas suman ${pesos(v.suma)} y el viaje vale ${pesos(ctx.total)}. Sobran ${pesos(-v.diferencia)}.` })
  if (v.fechaMinimo) {
    const pct = Math.floor(v.pctAlMinimo)
    out.push(v.cumpleMinimo
      ? { ok: true, texto: `Al ${fechaCorta(v.fechaMinimo)}: ${pesos(v.acumuladoAlMinimo)} (${pct} %)` }
      : { ok: false, texto: `Al ${fechaCorta(v.fechaMinimo)} el cliente llevaría el ${pct} %. La regla pide el ${regla.pct_minimo} % ${regla.dias_antes} días antes del viaje.` })
  } else {
    out.push({ ok: false, texto: `Sin fecha de salida no se puede medir el ${regla.pct_minimo} % ${regla.dias_antes} días antes del viaje.` })
  }
  if (ctx.fechaSalida) {
    out.push(v.despuesDelViaje
      ? { ok: false, texto: `La última cuota no puede ir después del ${fechaConDia(ctx.fechaSalida)}, el día del viaje.` }
      : { ok: true, texto: 'Última cuota antes del viaje' })
  }
  return out
}

/** La regla en palabras (fecha móvil o sin fecha). */
export function reglaEnPalabras(regla: ReglaPlan = REGLA_POR_DEFECTO): string {
  return `${regla.pct_minimo} % quince días antes de salir y el resto el día del viaje`.replace(
    'quince',
    regla.dias_antes === 15 ? 'quince' : String(regla.dias_antes),
  )
}
