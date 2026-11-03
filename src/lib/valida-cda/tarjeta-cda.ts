/**
 * El pago automático con tarjeta (ePayco) de los CDA de Valida. Puro: lo usan la pestaña Pagos de
 * `/suscripcion`, sus acciones, el paso 7b del cron (`cobro-token-servidor.ts`), el enlace del paso 6 y
 * el correo del cobro que no pasó. Diseño aprobado por Mauricio el 2026-10-30
 * (proyectos/metrik/valida/docs/legal/2026-10-30_diseno-tarjeta-cda-epayco.md).
 *
 * ## La base: los Términos v1.5 del Plan CDA
 *
 *   - 2.4: el débito automático lo autoriza el Cliente; se cobra en la fecha de renovación y, si no
 *     pasa, solo dentro de los 5 días de gracia.
 *   - 11.7: los períodos que empiezan antes de la vigencia por aviso se pagan aparte (transición).
 *
 * ## Las decisiones
 *
 *   - D1: solo la persona designada (quien ve `/suscripcion`) registra, cambia o quita la tarjeta.
 *   - D2: exige la v1.5 ACEPTADA por el espacio. Sin ella, el bloque lleva a aceptarla.
 *   - D3: lo atrasado NUNCA se cobra solo. El cobro automático alcanza solo los períodos que EMPIEZAN
 *     después del día en que se registró la tarjeta (`cobro_desde`); lo de antes se ofrece con su propio
 *     botón y confirmación («¿Pagarlo ahora con esta tarjeta?»).
 *   - D4: intentos automáticos solo el día 0 (la fecha de renovación: el primer día del período) y el
 *     día 3. Ninguno después. El calendario de autoservicio (`CALENDARIO_MORA`) no cambia.
 *
 * ## Por qué el día 0 es el inicio del período y no el vencimiento de la cuota
 *
 * Las cuotas de los CDA vencen el 27 de un período que arranca el 23 (cláusula SEXTA de la carga). La
 * 2.4 de la v1.5 cobra «en la fecha de renovación», que es el 23: el día 0 del calendario de la tarjeta
 * es el inicio del período (del concepto de la cuota; sin él, el vencimiento).
 */

import { leerPeriodoEnConcepto } from '@/lib/cobros/periodo-en-concepto'
import { RESTRICCION_VIGENTE_DESDE, REGLA_MORA_CDA, sumarDias, vencimientoConTransicion } from './plazos'
import type { DocumentoContractual } from '@/lib/valida-api/resultados'
import type { CuotaConEstado } from './pago-pendiente'
import { datosDelTextoV15, diaYMes, esTerminosV15, pesos } from './terminos-v1-5'

const FECHA = /^\d{4}-\d{2}-\d{2}$/

// ── La autorización (2.4) ────────────────────────────────────────────────────────────────

/** El texto de la casilla, con `{dia}` por llenar con el día de renovación del CDA (del dato, nunca fijo). */
export const PLANTILLA_AUTORIZACION_TARJETA =
  'Autorizo que el valor de cada período se cobre a esta tarjeta en la fecha de renovación (el {dia} de cada mes) y, si no pasa, dentro de los 5 días siguientes (Términos v1.5, 2.4).'

export function textoAutorizacionTarjeta(diaRenovacion: number): string {
  return PLANTILLA_AUTORIZACION_TARJETA.replace('{dia}', String(diaRenovacion))
}

// ── El calendario de la tarjeta (D4) ─────────────────────────────────────────────────────

/**
 * Los intentos automáticos de un CDA, en días desde la fecha de renovación: el índice es
 * `cobro_intentos_tarjeta.intento`. `ultimoDia`: el último día de la gracia de la 2.4 (5 días siguientes).
 */
export const CALENDARIO_TARJETA_CDA = { intentos: [0, 3] as const, ultimoDia: 5 } as const

/**
 * Qué intento toca hoy a un período que empezó hace `dias` días, o `null`. Un intento cuyo día pasó sin
 * correr (el cron estuvo caído) se hace al día siguiente, mientras no llegue el siguiente y siempre
 * dentro de la gracia: después del día 5 no se intenta nada.
 */
export function intentoDelDiaCda(dias: number): number | null {
  if (!Number.isInteger(dias) || dias < 0 || dias > CALENDARIO_TARJETA_CDA.ultimoDia) return null
  let actual: number | null = null
  CALENDARIO_TARJETA_CDA.intentos.forEach((d, i) => {
    if (dias >= d) actual = i
  })
  return actual
}

/** El primer día del período que paga la cuota (su fecha de renovación); sin período legible, el vencimiento. */
export function inicioDelPeriodo(c: { concepto: string | null; fechaVencimiento: string }): string {
  const p = leerPeriodoEnConcepto(c.concepto, c.fechaVencimiento)
  return p?.desde && FECHA.test(p.desde) ? p.desde : c.fechaVencimiento
}

/** D3: ¿la cuota entra al cobro automático? Solo un período que empieza DESPUÉS del registro de la tarjeta. */
export function entraAlCobroAutomatico(c: { concepto: string | null; fechaVencimiento: string }, cobroDesde: string): boolean {
  return inicioDelPeriodo(c) > cobroDesde
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)
}

export interface CuotaDelPlanCda {
  id: string
  numero: number
  monto: number
  fechaVencimiento: string
  concepto: string | null
}

export type SeleccionCobroCda = {
  /** Las cuotas que se cobran hoy, en orden, con su intento. */
  cobrar: { cuotaId: string; numero: number; intento: number }[]
  /** Una cuota de la tarjeta pasó la gracia sin pagarse: no se intenta ni se cobran las siguientes. */
  frenado: boolean
}

/**
 * El paso 7b para el plan de un CDA: qué cuotas se cobran hoy con la tarjeta. Las atrasadas (período que
 * empieza el día del registro o antes) se saltan sin frenar nada: nunca se cobran solas (D3). Un período
 * que todavía no empieza, tampoco. Una cuota de la tarjeta sin pagar después del día 5 frena el plan.
 */
export function cuotasACobrarCda(p: {
  cuotas: readonly CuotaDelPlanCda[]
  pagadas: ReadonlySet<number>
  cobroDesde: string
  hoy: string
}): SeleccionCobroCda {
  const out: SeleccionCobroCda = { cobrar: [], frenado: false }
  for (const c of [...p.cuotas].sort((a, b) => a.numero - b.numero)) {
    if (p.pagadas.has(c.numero) || !(Number(c.monto) > 0)) continue
    if (!entraAlCobroAutomatico(c, p.cobroDesde)) continue
    const inicio = inicioDelPeriodo(c)
    if (inicio > p.hoy) break
    const intento = intentoDelDiaCda(diasEntre(inicio, p.hoy))
    if (intento === null) {
      out.frenado = true
      break
    }
    out.cobrar.push({ cuotaId: c.id, numero: c.numero, intento })
  }
  return out
}

// ── Quién puede (D1, D2) ─────────────────────────────────────────────────────────────────

/** La v1.5 del Plan CDA para este espacio: aceptada, publicada sin aceptar, o todavía no publicada. */
export type EstadoV15 = 'aceptada' | 'pendiente' | 'sin_publicar'

/**
 * La v1.5 (o posterior) del espacio, de los documentos que ve el cliente (`documentosDelCliente`, que ya
 * saca los avisos todavía no publicados). Aceptada = alguna fila de esa versión con `aceptadoAt`. Con
 * varias versiones ≥ v1.5, manda la más reciente.
 */
export function v15DelEspacio(documentos: readonly DocumentoContractual[]): { estado: EstadoV15; doc: DocumentoContractual | null } {
  const v15 = documentos.filter(esTerminosV15)
  if (v15.length === 0) return { estado: 'sin_publicar', doc: null }
  const masReciente = [...v15].sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde))[0]
  const deEsa = v15.filter((d) => d.documentoId === masReciente.documentoId)
  const aceptada = deEsa.find((d) => d.aceptadoAt !== null)
  return aceptada ? { estado: 'aceptada', doc: aceptada } : { estado: 'pendiente', doc: masReciente }
}

/**
 * El día de renovación del CDA: el que dice el texto registrado de SU v1.5 (2.4); si el texto no lo trae,
 * el día en que empieza el período de su última cuota. `null` si no hay de dónde sacarlo.
 */
export function diaDeRenovacion(
  doc: Pick<DocumentoContractual, 'textoMd'> | null,
  cuotas: readonly { concepto: string | null; fechaVencimiento: string }[],
): number | null {
  const delTexto = doc ? datosDelTextoV15(doc.textoMd).diaRenovacion : null
  if (delTexto) return delTexto
  const ultima = [...cuotas].sort((a, b) => b.fechaVencimiento.localeCompare(a.fechaVencimiento))[0]
  const p = ultima ? leerPeriodoEnConcepto(ultima.concepto, ultima.fechaVencimiento) : null
  return p?.desde && FECHA.test(p.desde) ? Number(p.desde.slice(8, 10)) : null
}

export type ElegibilidadTarjeta =
  | { estado: 'puede' }
  /** D2: sin la v1.5 aceptada, el bloque lleva a aceptarla en vez de mostrar el formulario. */
  | { estado: 'acepta_v15' }
  | { estado: 'oculto'; motivo: 'no_cda' | 'no_designado' | 'sin_v15' | 'epayco_apagado' }

export function elegibilidadTarjeta(p: {
  producto: string
  negocioId: string | null
  /** La persona efectiva es la designada del contrato (`puedeVerSuscripcion`). */
  designado: boolean
  v15: EstadoV15
  epaycoHabilitado: boolean
}): ElegibilidadTarjeta {
  if (p.producto !== 'valida_cda' || !p.negocioId) return { estado: 'oculto', motivo: 'no_cda' }
  if (!p.designado) return { estado: 'oculto', motivo: 'no_designado' }
  if (!p.epaycoHabilitado) return { estado: 'oculto', motivo: 'epayco_apagado' }
  if (p.v15 === 'sin_publicar') return { estado: 'oculto', motivo: 'sin_v15' }
  if (p.v15 === 'pendiente') return { estado: 'acepta_v15' }
  return { estado: 'puede' }
}

// ── Lo atrasado (D3) ─────────────────────────────────────────────────────────────────────

export interface PendienteTarjeta {
  cuotaId: string | null
  numero: number
  /** «23-oct al 22-nov de 2026» o, sin período legible, «cuota que vence el …». */
  periodo: string
  saldo: number
  /** Lo pagado ya cubrió una parte: no se cobra con la tarjeta (el cargo es por la cuota entera). */
  abonada: boolean
}

/**
 * Lo que debe el CDA fuera del cobro automático: cuotas con saldo cuyo período empieza el día del
 * registro de la tarjeta o antes. `cuotas` es la salida de `cuotasConEstado` (el reparto de la pestaña).
 */
export function pendientesFueraDeLaTarjeta(cuotas: readonly CuotaConEstado[], cobroDesde: string): PendienteTarjeta[] {
  return cuotas
    .filter((c) => c.estado !== 'pagada' && c.saldo > 0 && !entraAlCobroAutomatico(c, cobroDesde))
    .map((c) => {
      const p = leerPeriodoEnConcepto(c.concepto, c.fechaVencimiento)
      return {
        cuotaId: c.cuotaId,
        numero: c.numero,
        periodo: p ? (p.hasta ? `${p.corto} de ${p.hasta.slice(0, 4)}` : p.corto) : `cuota que vence el ${diaYMes(c.fechaVencimiento)}`,
        saldo: c.saldo,
        abonada: c.abonado > 0,
      }
    })
}

/** ¿Se puede ofrecer cobrarlo con la tarjeta? Todas con id y ninguna con abono parcial. */
export function pendienteCobrableConTarjeta(pendientes: readonly PendienteTarjeta[]): boolean {
  return pendientes.length > 0 && pendientes.every((p) => p.cuotaId && !p.abonada)
}

function lista(partes: readonly string[]): string {
  return partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`
}

/** «Tienes pendiente $300.000 (períodos 23-sep al 22-oct de 2026 y 23-oct al 22-nov de 2026).» */
export function textoPendiente(pendientes: readonly PendienteTarjeta[]): string {
  const total = pendientes.reduce((s, p) => s + p.saldo, 0)
  const palabra = pendientes.length === 1 ? 'período' : 'períodos'
  return `Tienes pendiente ${pesos(total)} (${palabra} ${lista(pendientes.map((p) => p.periodo))}).`
}

/** La pregunta, con su botón aparte: nada atrasado se cobra sin ese clic. */
export const PREGUNTA_PENDIENTE = '¿Pagarlo ahora con esta tarjeta?'

/** El texto de la confirmación: lo que se cobra, a qué tarjeta. Su huella viaja con el clic. */
export function textoConfirmacionPendiente(pendientes: readonly PendienteTarjeta[], ultimos4: string | null): string {
  const total = pendientes.reduce((s, p) => s + p.saldo, 0)
  const tarjeta = ultimos4 ? `tu tarjeta terminada en ${ultimos4}` : 'la tarjeta que registraste'
  const cargos = pendientes.length === 1 ? 'un cobro' : `${pendientes.length} cobros, uno por período`
  return `Se cobrarán ${pesos(total)} a ${tarjeta}, en ${cargos}. Solo esta vez: los próximos períodos se cobran en su fecha de renovación.`
}

// ── Lo que se ve con la tarjeta activa ───────────────────────────────────────────────────

export interface ProximoCobroTarjeta {
  /** 'YYYY-MM-DD': la fecha de renovación del próximo período que se cobra con la tarjeta. */
  fecha: string
  /** El saldo de esa cuota, si ya existe; `null` si la cuota de ese período todavía no se creó. */
  monto: number | null
}

/** La próxima fecha con el día `dia` estrictamente después de `desde` (el día 31 cae al último del mes). */
export function siguienteFechaDeRenovacion(desde: string, dia: number): string {
  const [y, m] = desde.split('-').map(Number)
  for (let k = 0; k < 3; k++) {
    const destino = new Date(Date.UTC(y, m - 1 + k, 1))
    const ultimo = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate()
    const f = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth(), Math.min(dia, ultimo))).toISOString().slice(0, 10)
    if (f > desde) return f
  }
  return sumarDias(desde, 30)
}

/**
 * El próximo cobro con la tarjeta: la primera cuota con saldo que entra al cobro automático; si ninguna
 * existe todavía, la siguiente fecha de renovación después del registro (y de hoy), sin monto.
 */
export function proximoCobroTarjeta(p: {
  cuotas: readonly CuotaConEstado[]
  cobroDesde: string
  hoy: string
  diaRenovacion: number
}): ProximoCobroTarjeta {
  const c = p.cuotas.find((x) => x.estado !== 'pagada' && x.saldo > 0 && entraAlCobroAutomatico(x, p.cobroDesde))
  if (c) return { fecha: inicioDelPeriodo(c), monto: c.saldo }
  const base = p.hoy > p.cobroDesde ? sumarDias(p.hoy, -1) : p.cobroDesde
  return { fecha: siguienteFechaDeRenovacion(base, p.diaRenovacion), monto: null }
}

/** «Pago automático activo · tarjeta terminada en 1234 · próximo cobro 23 de noviembre: $150.000». */
export function textoTarjetaActiva(ultimos4: string | null, proximo: ProximoCobroTarjeta): string {
  const tarjeta = ultimos4 ? `tarjeta terminada en ${ultimos4}` : 'tarjeta registrada'
  const cuando = `próximo cobro ${diaYMes(proximo.fecha)}`
  return `Pago automático activo · ${tarjeta} · ${proximo.monto !== null ? `${cuando}: ${pesos(proximo.monto)}` : cuando}`
}

/** Lo que pinta el bloque «Pago automático con tarjeta» de la pestaña Pagos. Serializable (va al navegador). */
export type VistaPagoAutomatico =
  /** D2: falta aceptar la v1.5; el bloque lleva a aceptarla. */
  | { tipo: 'acepta_v15' }
  | { tipo: 'sin_tarjeta' }
  | {
      tipo: 'activa'
      /** «Pago automático activo · tarjeta terminada en 1234 · próximo cobro …». */
      resumen: string
      /** El aviso del último cobro rechazado de un período de la tarjeta, o `null`. */
      fallo: string | null
      /** Lo atrasado (D3), si hay. */
      pendiente: VistaPendiente | null
    }

export type VistaPendiente =
  | { cobrable: true; texto: string; pregunta: string; confirmacion: string; huella: string }
  /** Con un abono parcial no se ofrece la tarjeta: se paga con el enlace. */
  | { cobrable: false; texto: string }

/** Lo que dice el bloque antes de registrar la tarjeta. */
export const TEXTO_SIN_TARJETA =
  'Registra una tarjeta y cada período se cobra solo en tu fecha de renovación. Lo que ya debes no se cobra solo: te preguntamos antes.'

/** D2: sin la v1.5 aceptada. */
export const TEXTO_ACEPTA_V15 =
  'Para cobrar cada período a tu tarjeta necesitas aceptar la versión 1.5 de los Términos, que autoriza el pago automático (cláusula 2.4).'

/** Lo que se le dice a quien tiene un pendiente con abono parcial. */
export const TEXTO_PENDIENTE_CON_ENLACE = 'Págalo con el enlace de pago de cada cuota, abajo.'

/** Lo que dice el botón «Quitar tarjeta» antes de confirmar. */
export const TEXTO_CONFIRMAR_QUITAR =
  'Si quitas la tarjeta, ya no se cobra sola: cada período lo pagas con el enlace de pago, como antes. Le pedimos a ePayco borrarla.'

// ── Un cobro que no pasó ─────────────────────────────────────────────────────────────────

export interface FechasDelFallo {
  /** El día 3 desde la renovación, si todavía no llegó; `null` si ya no queda reintento. */
  reintento: string | null
  /** Desde cuándo no se pueden hacer consultas nuevas si no se paga (la regla de `plazos.ts`). */
  pausaDesde: string
}

/**
 * Las fechas que dice el aviso de un cobro rechazado. La pausa es la MISMA que aplica la puerta de Valida
 * (`estadoMora`): el vencimiento (o, para un período anterior a la vigencia de la v1.5, el día anterior a
 * ella: 11.7) más los días de la restricción, nunca antes de que rija la restricción.
 */
export function fechasDelFallo(p: {
  cuota: { concepto: string | null; fechaVencimiento: string }
  /** La vigencia de la v1.5 del contrato (`vigenciaTransicion`), o `null`. */
  transicion: string | null
  hoy: string
}): FechasDelFallo {
  const inicio = inicioDelPeriodo(p.cuota)
  const diaReintento = sumarDias(inicio, CALENDARIO_TARJETA_CDA.intentos[1])
  const vence = vencimientoConTransicion(p.cuota, p.transicion)
  const porDias = sumarDias(vence, REGLA_MORA_CDA.diaRestriccion)
  return {
    reintento: p.hoy < diaReintento ? diaReintento : null,
    pausaDesde: porDias < RESTRICCION_VIGENTE_DESDE ? RESTRICCION_VIGENTE_DESDE : porDias,
  }
}

/** El aviso en `/suscripcion`: «No pudimos cobrar a tu tarjeta terminada en 1234…» (el correo arma el suyo). */
export function textoFalloTarjeta(p: { ultimos4: string | null; fechas: FechasDelFallo }): string {
  const tarjeta = p.ultimos4 ? `tu tarjeta terminada en ${p.ultimos4}` : 'la tarjeta que registraste'
  const partes = [`No pudimos cobrar a ${tarjeta}. Puedes pagar con el enlace de pago.`]
  if (p.fechas.reintento) partes.push(`Reintentamos el ${diaYMes(p.fechas.reintento)}.`)
  partes.push(`Si no se paga, las consultas nuevas se pausan desde el ${diaYMes(p.fechas.pausaDesde)}.`)
  return partes.join(' ')
}
