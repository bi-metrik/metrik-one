/**
 * La 16.4 al vender un período (revisión de Emilio del 5-nov-2026, en
 * proyectos/metrik/valida/docs/legal/2026-11-04_diseno-suspendido-cancelado.md). Puro.
 *
 * ## La regla
 *
 * «Vencido el plazo de la cláusula 12.1, la suscripción continúa solo si el Cliente aceptó esta versión»
 * (16.4) y «la suscripción se renueva cada mes con el pago del período» (12.2): renovar es vender un
 * período. Por eso, sin la v1.5 aceptada, METRIK NO ofrece ningún período cuyo INICIO sea igual o
 * posterior a la fecha base de la 16.4 del CDA: ni la cuota nueva (`renovar-ciclo`), ni el enlace
 * automático, ni el botón de pago, ni el correo de cobro (`generarEnlacePagoCuota`, el único camino de
 * los tres). Los períodos que empiezan antes de la base se venden normal.
 *
 *   - La base sale del TEXTO registrado de la v1.5 de cada CDA (`datosDelTextoV15().exigeDesde`), nunca de
 *     `terminos_plazo_hasta` (que es el plazo de la v1.4): Maxitec 22-dic-2026; Caquetá, El Carmen y
 *     Puerto Test 16-ene-2027.
 *   - Un período se vende si se aceptó la v1.5 a más tardar el día en que empieza
 *     (`periodoSeVende`). Aceptarla después del inicio no vende ese período: la suscripción no había
 *     continuado, y aceptar y pagar es volver a empezar, con un período desde el día del pago (el flujo de
 *     la reactivación, `suscripcionNoContinua`).
 *   - La tarjeta del pago automático no necesita guarda propia: no se registra sin la v1.5 aceptada
 *     (`TEXTO_ACEPTA_V15`), y solo cobra períodos que empiezan después de su registro.
 *
 * ## El período no vendido (no es la cláusula 11)
 *
 * Una cuota cuyo período no se vende (y no tiene ningún abono) sale de la mora, del enlace, de la tarjeta
 * de pago, de la pestaña Pagos y de la cartera (`separarNoVendidas`): no hay Suspendida ni Cancelada por
 * ella, porque la 11.3 dice que la Cancelada «se debe a la falta de pago del Cliente» y aquí METRIK no
 * ofreció el período. El contrato sigue `activo`, sin `cancelada_desde`, y nunca pasa solo a `terminado`.
 * Cuando su período termina sin pago, el cron la anula con `MOTIVO_ANULACION_16_4` y apaga la renovación
 * del plan (`venta-16-4-servidor.ts`).
 *
 * Lo que se pague de todos modos (por transferencia) se presta: la 16.4 corre la fecha exigible al fin
 * del último período pagado. Con un abono la cuota ya no es «no vendida», y el cron avisa por correo que
 * el período siguiente no se vende sin la v1.5 (`correoPeriodoPrestado`).
 *
 * ## La reactivación
 *
 * Reactivar (11.4) exige la v1.5 aceptada solo si hoy es igual o posterior a la base
 * (`reactivacionExigeV15`): el período que se vende empieza el día del pago. Antes de la base, exigirla
 * le agregaría a la 11.4 una condición que no tiene.
 */

import type { DocumentoContractual } from '@/lib/valida-api/resultados'
import { escaparHtml } from '@/lib/usuarios-espacio/correo'
import type { CuotaConEstado } from './pago-pendiente'
import { fechaDiaMesLargo, periodoDeCuota } from './plazos'
import { datosDelTextoV15, esTerminosV15, pesos } from './terminos-v1-5'

/** El motivo con que se anula la cuota de un período que METRIK no vendió (16.4). */
export const MOTIVO_ANULACION_16_4 = '16.4: período no vendido sin aceptación de la v1.5'

const FECHA = /^\d{4}-\d{2}-\d{2}$/

/** Lo que decide si un período se vende: la base de la 16.4 del CDA y el día en que aceptó la v1.5. */
export interface VentaV15 {
  /** 'YYYY-MM-DD' del texto registrado (16.4); `null` = el contrato no tiene v1.5: todo se vende. */
  base: string | null
  /** El día (Bogotá) en que la persona designada aceptó la v1.5, o `null` si no la ha aceptado. */
  aceptadaEl: string | null
}

/** Sin v1.5 registrada (o un espacio que no es CDA): nada cambia. */
export const VENTA_SIN_V15: VentaV15 = { base: null, aceptadaEl: null }

/** El día en Bogotá (UTC−5, sin horario de verano) de un instante ISO; `null` si no se puede leer. */
export function diaBogota(iso: string | null | undefined): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : new Date(t - 5 * 3_600_000).toISOString().slice(0, 10)
}

/**
 * La venta de la v1.5 de un espacio, de sus documentos (`mis_documentos_de_servicio`): la v1.5 más
 * reciente publicada, su base (16.4) y si se aceptó. Una v1.5 sin la fecha en el texto no frena nada
 * (la puerta tampoco la exige: `exigenciaV15Cda`).
 */
export function ventaDeDocumentos(documentos: readonly DocumentoContractual[]): VentaV15 {
  const v15 = documentos.filter(esTerminosV15)
  if (v15.length === 0) return VENTA_SIN_V15
  const masReciente = [...v15].sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde))[0]
  const deEsa = v15.filter((d) => d.documentoId === masReciente.documentoId)
  const aceptadas = deEsa.map((d) => diaBogota(d.aceptadoAt)).filter((x): x is string => x !== null).sort()
  return { base: datosDelTextoV15(masReciente.textoMd).exigeDesde, aceptadaEl: aceptadas[0] ?? null }
}

/** ¿METRIK vende (ofrece) el período que empieza en `inicio`? */
export function periodoSeVende(v: VentaV15, inicio: string): boolean {
  if (!v.base || !FECHA.test(v.base) || inicio < v.base) return true
  return v.aceptadaEl !== null && v.aceptadaEl <= inicio
}

/** El día en que empieza el período de una cuota: el del concepto; sin él, su vencimiento. */
export function inicioDeCuota(c: { concepto: string | null; fechaVencimiento: string }): string {
  return periodoDeCuota(c)?.desde ?? c.fechaVencimiento
}

/**
 * Las cuotas no vendidas, con el mismo reparto de lo pagado que la pestaña Pagos (`cuotasConEstado`): sin
 * ningún abono, y de un período que no se vende o posterior a uno no vendido (la suscripción no continuó:
 * lo que sigue tampoco se vende hasta volver a empezar). Una cuota con plata no es «no vendida»: se presta.
 */
export function noVendidas<C extends Pick<CuotaConEstado, 'concepto' | 'fechaVencimiento' | 'abonado' | 'estado'>>(
  estados: readonly C[],
  v: VentaV15,
): C[] {
  if (!v.base) return []
  const orden = [...estados].sort((a, b) => inicioDeCuota(a).localeCompare(inicioDeCuota(b)))
  const out: C[] = []
  let corte = false
  for (const c of orden) {
    const conPlata = c.estado === 'pagada' || c.abonado > 0
    if (conPlata) continue
    if (corte || !periodoSeVende(v, inicioDeCuota(c))) {
      corte = true
      out.push(c)
    }
  }
  return out
}

/** La llave con que se reconoce una cuota entre la lectura y su estado (el número se repite entre planes). */
export function llaveDeCuota(c: { numero: number; fechaVencimiento: string }): string {
  return `${c.numero}|${c.fechaVencimiento}`
}

/**
 * Saca las cuotas no vendidas de una lista de cuotas (la de las RPC o la de las tablas). `estados` es el
 * reparto de ESAS cuotas con sus cobros. Devuelve las que quedan y las que salieron.
 */
export function separarNoVendidas<Q extends { numero: number; fechaVencimiento: string }>(
  cuotas: readonly Q[],
  estados: readonly CuotaConEstado[],
  v: VentaV15,
): { vendidas: Q[]; noVendidas: Q[] } {
  const fuera = new Set(noVendidas(estados, v).map(llaveDeCuota))
  if (fuera.size === 0) return { vendidas: [...cuotas], noVendidas: [] }
  return {
    vendidas: cuotas.filter((c) => !fuera.has(llaveDeCuota(c))),
    noVendidas: cuotas.filter((c) => fuera.has(llaveDeCuota(c))),
  }
}

/** ¿Reactivar (11.4) exige hoy aceptar la v1.5? Solo desde la base (el período nuevo empieza el día del pago). */
export function reactivacionExigeV15(v: VentaV15, hoy: string): boolean {
  return !!v.base && FECHA.test(v.base) && hoy >= v.base && v.aceptadaEl === null
}

/**
 * La suscripción no continuó (16.4) y el CDA ya aceptó la v1.5, tarde: hoy es igual o posterior a la base,
 * la aceptó después de la base, y ningún período vendido (pagado o por pagar) cubre hoy. No puede hacer
 * consultas nuevas hasta pagar un período desde el día del pago (flujo de la reactivación).
 *
 * Sin la v1.5 aceptada esto no aplica: manda la exigencia de la 16.4 (`exigenciaV15Cda`). Aceptada antes
 * de la base, todo período se vende y la mora es la de siempre. `vendidas` son las cuotas del plan vigente
 * sin las no vendidas ni las anuladas. Una cuota sin período legible en el concepto cuenta como que cubre
 * hoy: sin prueba de que no hay período, no se cierra nada.
 */
export function suscripcionNoContinua(p: {
  venta: VentaV15
  hoy: string
  vendidas: readonly { concepto: string | null; fechaVencimiento: string }[]
}): boolean {
  const { base, aceptadaEl } = p.venta
  if (!base || !FECHA.test(base) || p.hoy < base) return false
  if (aceptadaEl === null || aceptadaEl <= base) return false
  return !p.vendidas.some((c) => {
    const per = periodoDeCuota(c)
    return per === null || (per.desde <= p.hoy && p.hoy <= per.hasta)
  })
}

// ── Textos ───────────────────────────────────────────────────────────────────────────────

/** Lo que se le suma a la persona designada en la pantalla de la 16.4 exigida (anexo A, final). */
export const TEXTO_DESIGNADA_ACEPTA_Y_PAGA = 'Cuando la aceptes, pagas un período y vuelven las consultas.'

/** Lo que responde «Pagar un período» / «Reactivar» sin la v1.5 aceptada, desde la base. */
export const TEXTO_REACTIVAR_EXIGE_V15 =
  'Para pagar un período primero hay que aceptar la versión 1.5 de los Términos (cláusula 16.4). La persona designada la acepta en Valida.'

/** Lo que responde una consulta nueva (y lo que ve la pantalla) con la v1.5 aceptada tarde y sin período. */
export function textoNoContinua(razonSocial: string | null): string {
  return (
    `${razonSocial ?? 'Tu empresa'} ya aceptó la versión 1.5 de los Términos. Para volver a consultar en Valida, la persona ` +
    'designada paga un período en la sección Suscripción: corre desde el día del pago, que pasa a ser tu nueva fecha de renovación.'
  )
}

/** El botón de `/valida` y `/suscripcion` para volver a empezar después de aceptar tarde. */
export const BOTON_PAGAR_PERIODO = 'Pagar un período desde hoy'

/** El bloque de `/suscripcion` para volver a empezar después de aceptar tarde (la forma de `textosBloqueReactivar`). */
export function textosBloquePagarPeriodo(p: { monto: number | null }): { titulo: string; detalle: string; cartera: null; boton: string } {
  return {
    titulo: 'Pagar un período',
    detalle:
      `${p.monto ? `Pagas un período de ${pesos(p.monto)}.` : 'Pagas un período.'} Corre desde el día del pago, que pasa a ser tu nueva ` +
      'fecha de renovación, y con el pago vuelven las consultas.',
    cartera: null,
    boton: BOTON_PAGAR_PERIODO,
  }
}

/** Lo que responde el enlace (cron o botón) de un período que no se vende. */
export function errorPeriodoNoVendido(periodo: string | null): string {
  return `El período ${periodo ?? 'de esta cuota'} no se vende sin la versión 1.5 de los Términos aceptada (cláusula 16.4).`
}

export interface DatosCorreoPrestado {
  razonSocial: string
  /** 'YYYY-MM-DD' del período pagado sin la v1.5 aceptada. */
  desde: string
  hasta: string
  /** https://<espacio>.metrikone.co/valida */
  urlValida: string
}

/** El correo al registrar el pago de un período posterior a la base sin la v1.5 aceptada (16.4, Emilio (c)). */
export function asuntoCorreoPrestado(d: DatosCorreoPrestado): string {
  return `Valida: recibimos el pago del período del ${fechaDiaMesLargo(d.desde)} al ${fechaDiaMesLargo(d.hasta)}; el siguiente necesita la versión 1.5 de los Términos`
}

function parrafosPrestado(d: DatosCorreoPrestado): string[] {
  return [
    `Hola, equipo de ${d.razonSocial}:`,
    `Registramos el pago del período del ${fechaDiaMesLargo(d.desde)} al ${fechaDiaMesLargo(d.hasta)}. Durante ese período ` +
      'puedes seguir haciendo consultas en Valida.',
    `${d.razonSocial} todavía no ha aceptado la versión 1.5 de los Términos. Por la cláusula 16.4, la suscripción continúa ` +
      `después de este período solo si se acepta: el período siguiente no se ofrece ni se cobra sin esa aceptación.`,
    `La persona designada por tu empresa la acepta en Valida: ${d.urlValida}.`,
    'METRIK IA S.A.S. · NIT 902.079.601-9 · mauricio.moreno@metrik.com.co',
  ]
}

export function textoCorreoPrestado(d: DatosCorreoPrestado): string {
  return parrafosPrestado(d).join('\n\n')
}

export function htmlCorreoPrestado(d: DatosCorreoPrestado): string {
  const p = parrafosPrestado(d)
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1A1A1A;max-width:640px">` +
    p
      .slice(0, 3)
      .map((x) => `<p>${escaparHtml(x)}</p>`)
      .join('') +
    `<p><a href="${escaparHtml(d.urlValida)}" style="display:inline-block;background:#10B981;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold">Leer y aceptar en Valida</a></p>` +
    `<p style="font-size:12px;color:#6B7280">${escaparHtml(p[4])}</p>` +
    `</div>`
  )
}
