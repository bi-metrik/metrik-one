/**
 * El RC-3 (recibo de la tarifa UPME) es UNO POR NEGOCIO y sale del COMPROBANTE de pago a
 * la UPME, no del reparto de cada pago.
 *
 * ── Por qué (SOE-029, Mauricio 2026-10-26: «que salga del comprobante UPME») ──
 *
 * Lo pactado con SOENA el 2026-08-07 (`proyectos/soena/ve/decisions.md`): «Valor desde
 * `comprobante_pago_upme.valor_pagado`». Hasta hoy el RC-3 salía por `a_tarifa` de
 * `v_cobro_valor`, que es la franja de CADA pago entre el techo del honorario y el de la
 * tarifa confirmada. Eso daba dos defectos:
 *
 *   - el comprobante difiere de la tarifa confirmada por unos pesos (V0572: $978.707 contra
 *     $978.870) y el recibo acusaba la cifra confirmada, no la que se pagó a la UPME;
 *   - un cliente que pagó en dos partes partía la tarifa en pedazos absurdos (V0633: un RC-3
 *     de $45 y otro de $701.767).
 *
 * ── La regla ────────────────────────────────────────────────────────────────
 *
 * 1. **Valor** = `valor_pagado` del comprobante − lo que ya está resuelto de la tarifa en
 *    ese negocio. Resuelto es: los RC-3 ya emitidos (marcas `componente = 'pasante'`), la
 *    porción UPME de los pagos que tienen un recibo por el TOTAL (la marca vieja acusa el
 *    pago entero, tarifa incluida) y la de los pagos marcados `recibo_no_aplica` (el corte
 *    histórico: no llevan recibo retroactivo). Nunca por encima del comprobante; si lo
 *    resuelto ya lo cubre, no se ofrece otro.
 * 2. **Dónde queda colgado**: en el pago que COMPLETA la tarifa del negocio. Se recorren los
 *    pagos en el orden del reparto (`fecha`, `id`, el mismo de `v_cobro_valor`) sumando su
 *    porción UPME; el que lleva la suma hasta la meta es el titular. La meta es
 *    `min(comprobante, techo_tarifa)` con el piso de materialidad del sistema
 *    (`TOLERANCIA_SALDO_COP`): la franja UPME del reparto nunca pasa de `techo_tarifa`, así
 *    que un comprobante unos pesos mayor que la tarifa confirmada también se completa.
 *    Si ese pago ya tiene recibo propio (un RC-3 por pedazo, de antes), el titular es el
 *    siguiente pago con porción UPME y sin recibo; si no hay siguiente, el último anterior
 *    sin recibo (la tarifa ya entró completa).
 * 3. **Los demás pagos con porción UPME** quedan «sin recibo propio: va en el del negocio».
 *    Mientras ningún pago complete la tarifa, el RC-3 todavía no se ofrece: acusar el
 *    comprobante entero con $45 recibidos sería acusar plata que no entró.
 * 4. **Sin comprobante no hay RC-3.** Si el negocio no tiene `valor_pagado` (falta el bloque
 *    o falló la extracción), NO se cae a la tarifa confirmada: se bloquea con un mensaje.
 *    Casi siempre es que SOENA todavía no le ha pagado a la UPME (SOE-035): el mensaje lo
 *    dice así, no como un dato roto.
 * 5. **Unos pesos en la franja de la tarifa no son tarifa** (SOE-035). Si todo lo que
 *    entró a `a_tarifa` en el negocio no pasa del piso de materialidad
 *    (`TOLERANCIA_SALDO_COP`), es un sobrepago del honorario que el reparto dejó caer ahí
 *    (V0660: $45). No genera RC-3 ni frena pidiendo comprobante: se trata como sin tarifa.
 *
 * ── Idempotencia ────────────────────────────────────────────────────────────
 *
 * La clave del RC-3 sigue siendo la de siempre (cobro titular + `rcpas`). El titular solo
 * cambia si cambian los datos (se anula el pago, llega otro antes en la fecha), y para ese
 * caso sigue en pie el aviso de duplicado en Siigo por valor, que mira lo que ya existe.
 *
 * Módulo PURO: sin DB ni red. Lo usan la emisión (servidor) y el panel de Tesorería, para
 * que la cifra de la pantalla y la del recibo salgan de la misma cuenta.
 */

import { saldoCuadrado, TOLERANCIA_SALDO_COP } from '@/lib/negocios/tolerancia-saldo'
import { parseMontoCop } from '@/lib/negocios/monto-cop'
import { hayReciboPorElTotal, recibosDelCobro } from './recibo-componentes'

/** El bloque del comprobante de pago a la UPME y su campo con el valor pagado. */
export const SLUG_COMPROBANTE_UPME = 'comprobante_pago_upme'
export const CAMPO_VALOR_COMPROBANTE_UPME = 'valor_pagado'

/**
 * Sin comprobante. Casi siempre es que SOENA todavía no le pagó a la UPME (SOE-035: V0602,
 * V0658): el aviso viejo («Falta el valor del comprobante…») se leía como un dato roto.
 */
export const MENSAJE_SIN_COMPROBANTE_UPME =
  'Aún no se ha pagado a la UPME: el recibo sale cuando se cargue el comprobante de pago UPME en el negocio.'

/** Lo que dice el comprobante del negocio. */
export type ComprobanteUpme =
  | { estado: 'ok'; valor: number }
  | { estado: 'falta' }
  /** Más de una instancia del bloque con valores distintos: no se elige a ojo. */
  | { estado: 'ambiguo'; valores: number[] }

/**
 * El valor del comprobante a partir de las instancias del bloque (`data` de cada
 * `negocio_bloques`). Un documento guarda sus campos en `data.campos[slug].value`.
 */
export function leerComprobanteUpme(datas: Array<unknown>): ComprobanteUpme {
  const valores = new Set<number>()
  for (const d of datas) {
    const campos = (d as { campos?: Record<string, { value?: unknown }> } | null)?.campos
    // Extraído del comprobante: «350.906» son 350.906 pesos, no 350,906.
    const v = parseMontoCop(campos?.[CAMPO_VALOR_COMPROBANTE_UPME]?.value)
    if (v != null && v > 0) valores.add(redondear(v))
  }
  if (valores.size === 0) return { estado: 'falta' }
  if (valores.size > 1) return { estado: 'ambiguo', valores: [...valores].sort((a, b) => a - b) }
  return { estado: 'ok', valor: [...valores][0] }
}

/** Un pago del negocio, visto desde el RC-3. Los anulados no entran. */
export interface PagoParaRc3 {
  id: string
  fecha: string | null
  /** Porción UPME del pago según el reparto (`a_tarifa`). 0 sin reparto. */
  aTarifa: number
  /** `cobros.siigo_recibo` tal cual: objeto o lista. */
  marca: unknown
  /** `cobros.recibo_no_aplica` presente. */
  noAplica: boolean
}

export type EstadoRc3 =
  /** Hay que emitir `valor` en el pago `titularId`. */
  | 'emitir'
  /** Lo resuelto ya cubre el comprobante: no se ofrece otro. */
  | 'cubierto'
  /** Los pagos todavía no completan la tarifa: el RC-3 se ofrece cuando la completen. */
  | 'esperando_pagos'
  /** Sin `valor_pagado` en el comprobante. Bloquea. */
  | 'sin_comprobante'
  /** Varias instancias del comprobante con valores distintos. Bloquea. */
  | 'comprobante_ambiguo'
  /** Ningún pago del negocio trae porción UPME: no hay RC-3 que hablar. */
  | 'sin_tarifa'

export type RolDelPago =
  /** Lleva el RC-3 del negocio. */
  | 'titular'
  /** Trae porción UPME pero su recibo va en el del negocio. */
  | 'en_el_del_negocio'
  /** Ya tiene recibo de caja propio (RC-3 por pedazo, o recibo por el total). */
  | 'con_recibo_propio'
  /** Sin porción UPME, o marcado `recibo_no_aplica`. Este cálculo no le asigna nada. */
  | 'fuera'

export interface PlanRc3 {
  estado: EstadoRc3
  /** `valor_pagado` del comprobante. Null si falta o es ambiguo. */
  comprobante: number | null
  /** Lo que ya está resuelto de la tarifa en el negocio (ver el encabezado). */
  resuelto: number
  /** Lo que acusa el RC-3 que falta. Solo con `estado = 'emitir'`. */
  valor: number | null
  /** Suma de la porción UPME de los pagos vivos, en el orden del reparto. */
  tarifaRecibida: number
  /**
   * Porción UPME que ningún recibo acusa todavía: la de los pagos que van en el RC-3 del
   * negocio. Es la cifra que se muestra en la fila frenada (SOE-035), en vez del pago entero.
   */
  tarifaSinAcusar: number
  /** Hasta dónde tienen que llegar los pagos para completar la tarifa. */
  meta: number | null
  /**
   * El pago que lleva (o llevaría) el RC-3. Con `sin_comprobante` y `comprobante_ambiguo`
   * es el pago donde se muestra el bloqueo, para que el pendiente no desaparezca.
   */
  titularId: string | null
  roles: Map<string, RolDelPago>
}

const redondear = (n: number) => Math.round(n * 100) / 100

/** Orden del reparto: el mismo `ORDER BY c.fecha, c.id` de `v_cobro_valor`. */
function enOrden(pagos: readonly PagoParaRc3[]): PagoParaRc3[] {
  return [...pagos].sort((a, b) => {
    const fa = a.fecha ?? ''
    const fb = b.fecha ?? ''
    if (fa !== fb) return fa < fb ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** Los RC-3 ya emitidos en este pago (marcas del componente `pasante`). */
function rc3Emitido(marca: unknown): number {
  return recibosDelCobro(marca)
    .filter(m => m.componente === 'pasante' && m.tipo !== 'abono')
    .reduce((s, m) => s + (Number(m.valor) || 0), 0)
}

function tieneRc3(marca: unknown): boolean {
  return recibosDelCobro(marca).some(m => m.componente === 'pasante' && m.tipo !== 'abono')
}

/** El RC-3 del negocio: cuánto, en qué pago, y qué es cada pago. */
export function planRc3DelNegocio(entrada: {
  comprobante: ComprobanteUpme
  /** `v_negocio_valor.techo_tarifa`. Null = no se conoce. */
  techoTarifa: number | null
  pagos: readonly PagoParaRc3[]
}): PlanRc3 {
  const pagos = enOrden(entrada.pagos)
  const roles = new Map<string, RolDelPago>()

  let resuelto = 0
  let tarifaRecibida = 0
  for (const p of pagos) {
    const aTarifa = Math.max(0, Number(p.aTarifa) || 0)
    tarifaRecibida += aTarifa
    if (tieneRc3(p.marca)) {
      resuelto += rc3Emitido(p.marca)
      roles.set(p.id, 'con_recibo_propio')
    } else if (hayReciboPorElTotal(p.marca)) {
      resuelto += aTarifa
      roles.set(p.id, aTarifa > 0 ? 'con_recibo_propio' : 'fuera')
    } else if (p.noAplica) {
      resuelto += aTarifa
      roles.set(p.id, 'fuera')
    } else {
      roles.set(p.id, aTarifa > 0 ? 'en_el_del_negocio' : 'fuera')
    }
  }
  resuelto = redondear(resuelto)
  tarifaRecibida = redondear(tarifaRecibida)

  const comprobante = entrada.comprobante.estado === 'ok' ? entrada.comprobante.valor : null
  const techo = entrada.techoTarifa != null && entrada.techoTarifa > 0 ? entrada.techoTarifa : null

  // La meta: sin comprobante se usa la tarifa confirmada SOLO para saber en qué pago se
  // muestra el bloqueo, nunca para emitir.
  const base = comprobante ?? techo
  const meta = base == null ? null : redondear(techo != null ? Math.min(base, techo) : base)

  // El pago que completa la tarifa, y desde ahí el primero sin recibo propio.
  // Si ese pago y los siguientes ya tienen recibo propio, va en el último pago anterior
  // sin recibo: la tarifa ya entró completa, así que cualquiera la puede acusar.
  let titularId: string | null = null
  let completo = false
  if (meta != null && meta > 0) {
    let acumulado = 0
    let ultimoSinReciboAntes: string | null = null
    for (const p of pagos) {
      const aTarifa = Math.max(0, Number(p.aTarifa) || 0)
      acumulado += aTarifa
      if (!completo && aTarifa > 0 && acumulado >= meta - TOLERANCIA_SALDO_COP) completo = true
      const libre = aTarifa > 0 && roles.get(p.id) === 'en_el_del_negocio'
      if (completo && libre) {
        titularId = p.id
        break
      }
      if (libre) ultimoSinReciboAntes = p.id
    }
    if (!titularId && completo) titularId = ultimoSinReciboAntes
  }

  const pendientes = pagos.filter(p => roles.get(p.id) === 'en_el_del_negocio')
  const tarifaSinAcusar = redondear(pendientes.reduce((s, p) => s + Math.max(0, Number(p.aTarifa) || 0), 0))
  const base0 = { comprobante, resuelto, tarifaRecibida, tarifaSinAcusar, meta, roles }

  // Regla 5: unos pesos en la franja de la tarifa son un sobrepago del honorario, no tarifa.
  // Solo cuando ningún pago tiene ya un RC-3: si lo tiene, la tarifa sí entró.
  const algunRc3 = pagos.some(p => tieneRc3(p.marca))
  const hayTarifa = tarifaRecibida > 0 && (algunRc3 || !saldoCuadrado(tarifaRecibida))
  if (!hayTarifa) {
    for (const p of pendientes) roles.set(p.id, 'fuera')
    return { ...base0, tarifaSinAcusar: 0, estado: 'sin_tarifa', valor: null, titularId: null }
  }

  if (entrada.comprobante.estado !== 'ok') {
    // El bloqueo se muestra en un pago, aunque los pagos no hayan completado la tarifa:
    // sin comprobante no se sabe la meta, y esconder el pendiente es lo que no puede pasar.
    const dondeBloquea = titularId ?? pendientes[pendientes.length - 1]?.id ?? null
    if (dondeBloquea) roles.set(dondeBloquea, 'titular')
    return {
      ...base0,
      estado: entrada.comprobante.estado === 'falta' ? 'sin_comprobante' : 'comprobante_ambiguo',
      valor: null,
      titularId: dondeBloquea,
    }
  }

  const porEmitir = redondear(Math.max(0, comprobante! - resuelto))
  // Menos de un peso no es un recibo: es el redondeo. Y con la tarifa completa sin un
  // solo pago libre donde colgarlo, todo lo que entró ya tiene su recibo.
  if (porEmitir < 1 || (completo && !titularId)) return { ...base0, estado: 'cubierto', valor: null, titularId: null }
  if (!titularId) return { ...base0, estado: 'esperando_pagos', valor: null, titularId: null }

  roles.set(titularId, 'titular')
  return { ...base0, estado: 'emitir', valor: porEmitir, titularId }
}

const fmtCOP = (v: number): string =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

/**
 * Por qué ESTE pago no emite el RC-3, en una frase para la persona. Null si sí lo emite.
 *
 * Una sola redacción para el servidor y para la pantalla: si dijeran cosas distintas, quien
 * oprime el botón no sabría a cuál creerle.
 */
export function motivoSinRc3(plan: PlanRc3, cobroId: string): { mensaje: string; bloqueo: boolean } | null {
  if (plan.estado === 'emitir' && plan.titularId === cobroId) return null
  const rol = cobroId ? plan.roles.get(cobroId) : undefined
  if (rol === 'con_recibo_propio') {
    return { mensaje: 'Este pago ya tiene su recibo de caja: no se emite otro.', bloqueo: false }
  }
  if (cobroId && (rol === 'fuera' || rol === undefined)) {
    return {
      mensaje: 'Este pago no lleva recibo de caja: no trae tarifa UPME sin acusar. '
        + 'Su honorario se abona solo a la factura del negocio.',
      bloqueo: false,
    }
  }
  switch (plan.estado) {
    case 'sin_comprobante':
      return { mensaje: MENSAJE_SIN_COMPROBANTE_UPME, bloqueo: true }
    case 'comprobante_ambiguo':
      return {
        mensaje: 'El negocio tiene más de un comprobante de pago UPME con valores distintos: '
          + 'revisa el bloque del comprobante en el negocio.',
        bloqueo: true,
      }
    case 'sin_tarifa':
      return {
        mensaje: 'Este pago no trae tarifa UPME: no lleva recibo de caja. Su honorario se abona solo a la factura del negocio.',
        bloqueo: false,
      }
    case 'cubierto':
      return {
        mensaje: `La tarifa UPME de este negocio ya tiene su recibo (${fmtCOP(plan.resuelto)} acusados; `
          + `comprobante ${fmtCOP(plan.comprobante ?? 0)}): no se emite otro.`,
        bloqueo: false,
      }
    case 'esperando_pagos':
      return {
        mensaje: `El recibo de la tarifa UPME es uno por negocio y sale cuando los pagos completen la tarifa: `
          + `van ${fmtCOP(plan.tarifaRecibida)} de ${fmtCOP(plan.meta ?? 0)}.`,
        bloqueo: false,
      }
    case 'emitir':
      return {
        mensaje: 'Este pago no lleva recibo propio: su porción UPME va en el recibo del negocio, '
          + 'que se emite desde el pago que completó la tarifa.',
        bloqueo: false,
      }
  }
}
