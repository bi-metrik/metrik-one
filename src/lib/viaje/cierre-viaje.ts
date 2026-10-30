/**
 * En viaje, Cierre económico y Postventa (F6, post-cotización; Noor §2 etapas 7-9, Vera §6 F6,
 * C8, C13, N2). Puro: lo usan el panel, las acciones, los gates, el cron y el tablero de la
 * dirección, con la misma cuenta en todos.
 *
 *   · Margen real (C8) = (cobrado confirmado − IVA del ingreso propio − recargo de pasarela
 *     cobrado al cliente) − costo real. El margen cotizado, con la MISMA definición:
 *     (precio aprobado − IVA cotizado) − costo cotizado. Nadie teclea ninguna cifra (F6-4).
 *   · Costo real = todos los gastos del negocio (pagos a proveedor, cortesías e incidencias que
 *     asumió la agencia), cada uno una vez (§7.2.2).
 *   · Saldo a favor bloquea el cierre hasta que la dirección elige (N2). Una comisión pendiente
 *     NO bloquea y no entra al margen: se muestra aparte (C13).
 *   · La confirmación de la dirección lleva una huella de (ingreso, costo): si después cambia un
 *     gasto o un pago, la confirmación deja de valer y el gate la vuelve a pedir (F6-5).
 *
 * Interruptor: `lineas_negocio.config_extra.cierre_viaje.activo === true`. Ausente = apagado.
 */

import { diferenciaDeCambioDelServicio, type MonedaDelServicio } from './moneda-servicio'

// ── Configuración ────────────────────────────────────────────────────────────

export const GATE_MARGEN_CONFIRMADO = 'margen_confirmado'
export const GATE_POSTVENTA = 'postventa_completa'

export interface ConfigCierreViaje {
  activo: boolean
}

export function configCierreViaje(configLinea: unknown): ConfigCierreViaje {
  const raw = (configLinea as { cierre_viaje?: Record<string, unknown> } | null | undefined)?.cierre_viaje
  return { activo: !!raw && typeof raw === 'object' && raw.activo === true }
}

/** Entrar y salir de «En viaje» por fechas (diseño técnico §6). Ausente = el cron no toca la línea. */
export interface ConfigEtapasPorFecha {
  entrar: { etapa_numero: number }
  salir: { etapa_numero: number; offset: number }
}

export function configEtapasPorFecha(configLinea: unknown): ConfigEtapasPorFecha | null {
  const raw = (configLinea as { etapas_por_fecha?: Record<string, unknown> } | null | undefined)?.etapas_por_fecha
  if (!raw || typeof raw !== 'object') return null
  const e = raw.entrar as { etapa_numero?: unknown } | undefined
  const s = raw.salir as { etapa_numero?: unknown; offset?: unknown } | undefined
  const en = Number(e?.etapa_numero)
  const sn = Number(s?.etapa_numero)
  if (!Number.isInteger(en) || !Number.isInteger(sn) || sn <= en) return null
  const off = Number(s?.offset ?? 1)
  return { entrar: { etapa_numero: en }, salir: { etapa_numero: sn, offset: Number.isInteger(off) ? off : 1 } }
}

// ── Fechas ───────────────────────────────────────────────────────────────────

const DIA_MS = 86_400_000
const ms = (f: string) => Date.parse(`${f.slice(0, 10)}T00:00:00Z`)
export const sumarDias = (f: string, n: number) => new Date(ms(f) + n * DIA_MS).toISOString().slice(0, 10)
export const diasEntre = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DIA_MS)

/** Qué movimiento le toca hoy a un negocio de la línea (el cron). `null` = ninguno. */
export function movimientoPorFecha(p: {
  config: ConfigEtapasPorFecha
  etapaNumero: number | null
  salida: string | null
  regreso: string | null
  hoy: string
}): 'entrar' | 'salir' | null {
  if (p.etapaNumero === null) return null
  // Entra a «En viaje» desde la etapa anterior el día de salida (o después, si el cron no corrió).
  if (p.salida && p.etapaNumero === p.config.entrar.etapa_numero - 1 && p.hoy >= p.salida) return 'entrar'
  // Sale el día después del regreso (o el día del offset).
  if (p.regreso && p.etapaNumero === p.config.entrar.etapa_numero && p.hoy >= sumarDias(p.regreso, p.config.salir.offset)) return 'salir'
  return null
}

/** «Viajando · día 3 de 6 · regresan el miércoles 9 dic» (Noor etapa 7). */
export function textoEnViaje(salida: string | null, regreso: string | null, hoy: string): string | null {
  if (!salida) return null
  const total = regreso ? diasEntre(salida, regreso) + 1 : null
  const dia = diasEntre(salida, hoy) + 1
  if (dia < 1) return null
  const de = total ? ` de ${total}` : ''
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const r = regreso ? new Date(`${regreso}T00:00:00Z`) : null
  const vuelta = r ? ` · regresan el ${DIAS[r.getUTCDay()]} ${r.getUTCDate()} ${MESES[r.getUTCMonth()]}` : ''
  return `Viajando · día ${Math.min(dia, total ?? dia)}${de}${vuelta}`
}

// ── Cortesías (F6-3) ─────────────────────────────────────────────────────────

export const TIPOS_CORTESIA = ['Acompañamiento en aeropuerto', 'Upgrade', 'Conductor', 'Sobrecosto absorbido', 'Otra'] as const
export const SIN_VALOR_CORTESIA = 'Ponle un valor aproximado. Sin valor no suma al costo real.'

/** Valor de una cortesía: entero > 0, o el mensaje literal. */
export function validarValorCortesia(v: unknown): { ok: true; valor: number } | { ok: false; error: string } {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: SIN_VALOR_CORTESIA }
  return { ok: true, valor: Math.round(n) }
}

// ── Cierre económico (F6-4, C8) ──────────────────────────────────────────────

export interface ServicioCierre {
  id: string
  nombre: string
  proveedor_nombre: string | null
  estado: string
  costo_cotizado: number
  valor_por_pagar: number | null
  comision_esperada: number | null
  comision_estado: string | null
  /** H6-3 · la moneda en que se cotizó (`moneda-servicio.ts`). Ausente = en pesos. */
  moneda?: MonedaDelServicio | null
}

export interface GastoCierre {
  monto: number
  servicio_id: string | null
  categoria: string | null
  descripcion: string | null
  titular_medio?: string | null
  /** QA G9 · moneda y TRM del pago a proveedor (`gastos`). Null = en pesos o pago de antes. */
  moneda?: string | null
  tasa_cambio?: number | string | null
}

export interface EntradaCierre {
  /** `precio_aprobado`: lo que el cliente compró (incluye el IVA). */
  precioAprobado: number
  /** Cobrado confirmado (`cobradoConfirmado`: con fecha, más la retención). */
  cobrado: number
  /** IVA sobre el ingreso propio de la tarifa aceptada (0 si la línea no lo cobra). */
  iva: number
  /** Recargo de pasarela cobrado al cliente (no es ingreso de la agencia). */
  recargo: number
  servicios: readonly ServicioCierre[]
  gastos: readonly GastoCierre[]
}

export interface FilaCierre {
  id: string
  nombre: string
  cotizado: number
  real: number
  diferencia: number
  /**
   * H-25 (QA G12) · de `diferencia`, lo que movió la TRM de los pagos (`tasa_cambio` frente a
   * `tasa_cotizada`). No es sobrecosto del proveedor. 0 si el servicio va en pesos.
   */
  cambio: number
  /** H-25 · `diferencia` sin la diferencia de cambio: lo que de verdad cobró de más (o de menos) el proveedor. */
  sobrecosto: number
  /** El servicio va y no tiene ningún pago: su costo real no se conoce. */
  sinCosto: boolean
  /**
   * Se sacó del viaje (`cancelado`) después de que el cliente aceptó el precio que lo incluía (QA
   * 2026-10-29, H9-3). Su costo cotizado sigue en el margen cotizado y su diferencia se explica:
   * sin esto, la plata del servicio pasaba a margen sin verse como desviación.
   */
  sacado: boolean
}

export interface Cierre {
  ingresoReal: number
  iva: number
  recargo: number
  ingresoNeto: number
  costoReal: number
  margenReal: number
  margenRealPct: number | null
  costoCotizado: number
  margenCotizado: number
  margenCotizadoPct: number | null
  filas: FilaCierre[]
  cortesias: Array<{ descripcion: string; monto: number }>
  /** Lo que cobró de más el cliente (bloquea hasta decidir, N2). 0 si no hay. */
  saldoAFavor: number
  /** Lo que falta por cobrar (gate `saldo_cero`, aparte). */
  porCobrar: number
  comisiones: Array<{ servicioId: string; proveedor: string; esperada: number; estado: string }>
  /** «Dejó $317.000 menos de lo cotizado: Hotel (+$90.000), una cortesía ($50.000).» */
  explicacion: string | null
}

const r0 = (n: number) => Math.round(Number(n) || 0)
const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null)

export function pesosCierre(v: number): string {
  return `${v < 0 ? '-' : ''}$${Math.abs(Math.round(v)).toLocaleString('es-CO', { useGrouping: true }).replace(/,/g, '.')}`
}

function esCortesia(g: GastoCierre): boolean {
  return g.categoria === 'cortesia_viaje'
}

export function calcularCierre(e: EntradaCierre): Cierre {
  const iva = r0(e.iva)
  const recargo = r0(e.recargo)
  const cobrado = r0(e.cobrado)
  const precio = r0(e.precioAprobado)
  // El ingreso real no pasa del precio: lo que sobra es saldo a favor, no margen.
  const ingresoReal = Math.min(cobrado, precio + recargo)
  const ingresoNeto = ingresoReal - iva - recargo
  const costoReal = e.gastos.reduce((a, g) => a + r0(g.monto), 0)
  const margenReal = ingresoNeto - costoReal
  // Todos los servicios, también los sacados: el precio aprobado se armó con ellos (H9-3).
  const van = e.servicios
  const costoCotizado = van.reduce((a, s) => a + r0(s.costo_cotizado), 0)
  const margenCotizado = precio - iva - costoCotizado
  const pagadoDe = new Map<string, number>()
  for (const g of e.gastos) if (g.servicio_id) pagadoDe.set(g.servicio_id, (pagadoDe.get(g.servicio_id) ?? 0) + r0(g.monto))
  const filas: FilaCierre[] = van.map(s => {
    const real = pagadoDe.get(s.id) ?? 0
    const aPagar = typeof s.valor_por_pagar === 'number' && Number.isFinite(s.valor_por_pagar) ? s.valor_por_pagar : s.costo_cotizado
    const diferencia = real - r0(s.costo_cotizado)
    const cambio = s.estado === 'cancelado' ? 0 : diferenciaDeCambioDelServicio(s.moneda, e.gastos.filter(g => g.servicio_id === s.id)).pesos
    return {
      id: s.id,
      nombre: s.nombre,
      cotizado: r0(s.costo_cotizado),
      real,
      diferencia,
      cambio,
      // ±1 peso es redondeo de la conversión, no sobrecosto.
      sobrecosto: Math.abs(diferencia - cambio) <= 1 ? 0 : diferencia - cambio,
      sinCosto: s.estado !== 'cancelado' && real === 0 && r0(aPagar) > 0,
      sacado: s.estado === 'cancelado',
    }
  })
  const cortesias = e.gastos.filter(esCortesia).map(g => ({ descripcion: (g.descripcion ?? 'Cortesía').trim() || 'Cortesía', monto: r0(g.monto) }))
  const otrosSinServicio = e.gastos.filter(g => !g.servicio_id && !esCortesia(g)).reduce((a, g) => a + r0(g.monto), 0)

  const razones: string[] = []
  for (const f of filas) {
    if (f.diferencia === 0 || f.sinCosto) continue
    const cifra = `${f.diferencia > 0 ? '+' : '-'}${pesosCierre(Math.abs(f.diferencia))}`
    if (f.sacado) { razones.push(`${f.nombre} sacado del viaje (${cifra})`); continue }
    // H6-3 · lo que movió la TRM se nombra como tal: no es que el proveedor cobrara más.
    const cambio = f.cambio
    if (cambio !== 0 && Math.abs(cambio - f.diferencia) <= 1) razones.push(`${f.nombre} (${cifra}, diferencia de cambio)`)
    else if (cambio !== 0) razones.push(`${f.nombre} (${cifra}, de ellos ${pesosCierre(cambio)} de diferencia de cambio)`)
    else razones.push(`${f.nombre} (${cifra})`)
  }
  if (cortesias.length === 1) razones.push(`una cortesía (${pesosCierre(cortesias[0].monto)})`)
  else if (cortesias.length > 1) razones.push(`${cortesias.length} cortesías (${pesosCierre(cortesias.reduce((a, c) => a + c.monto, 0))})`)
  if (otrosSinServicio > 0) razones.push(`otros gastos (${pesosCierre(otrosSinServicio)})`)
  const delta = margenReal - margenCotizado
  const explicacion = delta === 0
    ? null
    : `Dejó ${pesosCierre(Math.abs(delta))} ${delta < 0 ? 'menos' : 'más'} de lo cotizado${razones.length ? `: ${razones.join(', ')}` : ''}.`

  return {
    ingresoReal,
    iva,
    recargo,
    ingresoNeto,
    costoReal,
    margenReal,
    margenRealPct: pct(margenReal, ingresoNeto),
    costoCotizado,
    margenCotizado,
    margenCotizadoPct: pct(margenCotizado, precio - iva),
    filas,
    cortesias,
    saldoAFavor: Math.max(0, cobrado - precio - recargo),
    porCobrar: Math.max(0, precio + recargo - cobrado),
    comisiones: e.servicios
      .filter(s => s.comision_esperada !== null && Number(s.comision_esperada) > 0)
      .map(s => ({ servicioId: s.id, proveedor: s.proveedor_nombre?.trim() || s.nombre, esperada: r0(s.comision_esperada ?? 0), estado: s.comision_estado ?? 'por_cobrar' })),
    explicacion,
  }
}

/**
 * Lo que el diálogo de «Cerrar negocio» necesita del cierre del viaje (barrido ámbar, 2026-10-22):
 * el margen es el MISMO del panel de Cierre económico (cobrado − IVA sobre el ingreso propio −
 * gastos), no `totalCobrado − costosEjecutados`, que no resta el IVA y suma las horas. Y lo que
 * falta de postventa, para decirlo en el primer paso y no después de las dos pantallas.
 */
export interface CierreParaCerrar {
  margenReal: number
  margenRealPct: number | null
  costoReal: number
  iva: number
  /** Solo en la etapa de Postventa (`postventa_completa`); `null` si no falta nada o no aplica. */
  faltaPostventa: string | null
}

export function cierreParaCerrar(c: Pick<Cierre, 'margenReal' | 'margenRealPct' | 'costoReal' | 'iva'>, faltaPostventa: string | null): CierreParaCerrar {
  return { margenReal: c.margenReal, margenRealPct: c.margenRealPct, costoReal: c.costoReal, iva: c.iva, faltaPostventa }
}

/** La huella de lo que la dirección confirma: si cambia un gasto o un pago, deja de valer. */
export function huellaCierre(c: Pick<Cierre, 'ingresoReal' | 'costoReal' | 'iva' | 'recargo'>): string {
  return `${c.ingresoReal}|${c.costoReal}|${c.iva}|${c.recargo}`
}

export interface CierreGuardado {
  confirmado: { huella: string; por: string | null; at: string; margen_real: number; margen_real_pct: number | null; margen_cotizado: number; margen_cotizado_pct: number | null; ingreso_neto: number; costo_real: number } | null
  saldo_a_favor: { decision: 'devolver' | 'proximo_viaje'; por: string | null; at: string; nota: string | null } | null
  reaperturas: Array<{ por: string | null; at: string; motivo: string }>
}

export function leerCierreGuardado(metadata: unknown): CierreGuardado {
  const c = ((metadata as { cierre_viaje?: Record<string, unknown> } | null)?.cierre_viaje ?? {}) as Record<string, unknown>
  const conf = c.confirmado as CierreGuardado['confirmado'] | undefined
  const saf = c.saldo_a_favor as CierreGuardado['saldo_a_favor'] | undefined
  return {
    confirmado: conf && typeof conf.huella === 'string' ? conf : null,
    saldo_a_favor: saf && (saf.decision === 'devolver' || saf.decision === 'proximo_viaje') ? saf : null,
    reaperturas: Array.isArray(c.reaperturas) ? (c.reaperturas as CierreGuardado['reaperturas']) : [],
  }
}

/** Lo que falta para salir del Cierre económico, en palabras (Noor etapa 8). Vacío = pasa. */
export function faltaParaCerrar(c: Cierre, g: CierreGuardado, nombreCliente: string): string[] {
  const falta: string[] = []
  for (const f of c.filas) if (f.sinCosto) falta.push(`Falta el costo real de ${f.nombre}.`)
  if (c.saldoAFavor > 0 && !g.saldo_a_favor) {
    falta.push(`${nombreCliente || 'El cliente'} tiene un saldo a favor de ${pesosCierre(c.saldoAFavor)}. Decide antes de cerrar: devolver o dejar para su próximo viaje.`)
  }
  if (!g.confirmado) falta.push('Falta que Edgar confirme el cierre.')
  else if (g.confirmado.huella !== huellaCierre(c)) falta.push('Cambió un pago o un gasto después de confirmar: falta que Edgar confirme el cierre otra vez.')
  return falta
}

// ── Postventa (F6-7) ─────────────────────────────────────────────────────────

export type RespuestaReferido = 'si' | 'no_quiso' | 'no_se_lo_pedi'

export interface Postventa {
  calificacion: number | null
  comentario: string | null
  referido: RespuestaReferido | null
  referido_contacto_id: string | null
  proximo_viaje: { mes: string | null; destino: string | null } | null
}

export function leerPostventa(metadata: unknown): Postventa {
  const p = ((metadata as { postventa?: Record<string, unknown> } | null)?.postventa ?? {}) as Record<string, unknown>
  const cal = Number(p.calificacion)
  const ref = p.referido
  const prox = p.proximo_viaje as { mes?: unknown; destino?: unknown } | undefined
  return {
    calificacion: Number.isInteger(cal) && cal >= 1 && cal <= 5 ? cal : null,
    comentario: typeof p.comentario === 'string' ? p.comentario : null,
    referido: ref === 'si' || ref === 'no_quiso' || ref === 'no_se_lo_pedi' ? ref : null,
    referido_contacto_id: typeof p.referido_contacto_id === 'string' ? p.referido_contacto_id : null,
    proximo_viaje: prox ? { mes: typeof prox.mes === 'string' ? prox.mes : null, destino: typeof prox.destino === 'string' ? prox.destino : null } : null,
  }
}

/** «Para cerrar falta: la calificación del viaje y si pediste el referido.» (Noor etapa 9). */
export function faltaPostventa(p: Postventa): string | null {
  const falta: string[] = []
  if (p.calificacion === null) falta.push('la calificación del viaje')
  // «No se lo pedí» no cierra: la etapa insiste.
  if (p.referido === null || p.referido === 'no_se_lo_pedi') falta.push('si pediste el referido')
  if (falta.length === 0) return null
  return `Para cerrar falta: ${falta.join(' y ')}.`
}

/** El celular de un referido: 10 dígitos colombianos (o con 57 adelante). */
export function celularReferido(v: string | null | undefined): string | null {
  const d = String(v ?? '').replace(/\D/g, '')
  const local = d.length === 12 && d.startsWith('57') ? d.slice(2) : d
  return /^3\d{9}$/.test(local) ? local : null
}

/** La encuesta (Noor §7.5, canal C1: la respuesta llega a la comercial, no al bot). */
export function mensajeEncuesta(p: { nombreCliente: string; destino: string | null; comercial: string | null; agencia: string }): string {
  const nombre = p.nombreCliente.trim().split(/\s+/)[0] || 'Hola'
  const donde = p.destino?.trim() ? ` en ${p.destino.trim()}` : ''
  return [
    `${nombre}, ¿cómo les fue${donde}? Respóndeme con un número del 1 al 5.`,
    '',
    'Y si conoces a alguien que quiera viajar, mándame su nombre y número: le escribimos de tu parte.',
    '',
    [p.comercial?.trim(), p.agencia.trim()].filter(Boolean).join(' · '),
  ].join('\n')
}
