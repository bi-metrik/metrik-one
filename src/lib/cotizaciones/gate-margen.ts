/**
 * El piso de margen, aplicado al AVANCE DE ETAPA.
 *
 * ## Por qué hacía falta
 *
 * El piso ya rechazaba en dos sitios: marcar un itinerario `va_en_propuesta` y
 * marcarlo principal (`motivoDeRechazo`, §2.6.4 del diseño). Eso protege lo que sale
 * al cliente **dentro de la cotización**, y no protege nada más: una cotización sin
 * itinerarios —que es toda cotización de hoy— no pasa por ese candado, y el negocio
 * avanzaba de etapa con el margen que fuera.
 *
 * Lo que Mauricio le anunció al equipo de Trappvel el 2026-09-14 fue más ancho: *«un
 * margen por debajo del piso BLOQUEA avanzar, y por debajo del aviso solo advierte»*.
 * Esta pieza es la mitad que faltaba.
 *
 * ## Opt-in por etapa, como todos los gates de este producto
 *
 * Se declara en `etapas_negocio.config_extra.gates` con el nombre `margen_sobre_piso`.
 * Sin esa declaración no corre en ningún workspace: SOENA, AFI, Termotech y WMC no
 * cambian de comportamiento, que es la condición de todo gate nuevo en este repo.
 *
 * ## Las dos decisiones que no son obvias
 *
 *  · **Cuál cotización manda.** Un negocio puede tener varias. Manda la que fija el
 *    precio: si hay aceptada, esa; si no, las enviadas; si no, los borradores. No se
 *    miran las rechazadas ni las vencidas — bloquear por una cotización que el cliente
 *    ya rechazó sería un bloqueo que nadie puede levantar sin borrar historia.
 *  · **Un margen que NO se puede medir NO bloquea.** Es lo contrario del criterio de
 *    `motivoDeRechazo`, y a propósito. Allá el objeto es un documento que va al
 *    cliente y el lado seguro es frenar. Aquí el objeto es el avance del caso, y
 *    frenar por «sin costo cargado» congelaría todo negocio cuya cotización apenas
 *    empieza — incluidos los que van a la etapa donde justamente se costea.
 */

import { nivelDeMargen, type UmbralesMargen } from './convencion-margen'

/** Lo mínimo que hace falta de una cotización para juzgarla. */
export interface CotizacionParaGate {
  id: string
  /** El código visible (COT-2026-0004). Es lo que el mensaje tiene que nombrar. */
  codigo: string | null
  estado: string | null
}

/** Estados que NO fijan el precio de un negocio: no se miran. */
const ESTADOS_MUERTOS = new Set(['rechazada', 'vencida'])

/** Precedencia: lo aceptado manda sobre lo enviado, y lo enviado sobre el borrador. */
const PRECEDENCIA = ['aceptada', 'enviada', 'borrador']

/**
 * Las cotizaciones que fijan el precio del negocio HOY.
 *
 * Devuelve las del escalón más alto que exista, no todas: con una aceptada al 18% y
 * un borrador viejo al 2%, el negocio vale lo que dice la aceptada y el borrador es
 * trabajo a medias. Bloquear por él sería pedirle a alguien que suba el margen de un
 * documento que nadie va a mandar.
 */
export function cotizacionesQueFijanElPrecio<T extends CotizacionParaGate>(cotizaciones: T[]): T[] {
  const vivas = cotizaciones.filter(c => !ESTADOS_MUERTOS.has((c.estado ?? '').toLowerCase()))
  for (const estado of PRECEDENCIA) {
    const enEsteEscalon = vivas.filter(c => (c.estado ?? '').toLowerCase() === estado)
    if (enEsteEscalon.length > 0) return enEsteEscalon
  }
  return []
}

/** Una cotización que no llega al piso. */
export interface BajoPiso {
  codigo: string | null
  margenRealPct: number
  pisoPct: number
}

/** Lo que hace falta saber de cada cotización ya medida. */
export interface CotizacionMedida extends CotizacionParaGate {
  /** `null` = no se pudo medir (sin precio o sin costo). NO bloquea. */
  margenRealPct: number | null
  umbrales: UmbralesMargen
}

/**
 * Las cotizaciones que frenan el avance. Vacío = puede avanzar.
 *
 * ⚠️ Cada cotización se juzga contra SU propio piso, el que congeló al nacer. Dos
 * cotizaciones del mismo negocio creadas con políticas distintas no comparten umbral,
 * y usar el vigente le cambiaría el desenlace a una que ya salió al cliente.
 */
export function cotizacionesBajoPiso(medidas: CotizacionMedida[]): BajoPiso[] {
  return cotizacionesQueFijanElPrecio(medidas)
    .filter(c => nivelDeMargen(c.margenRealPct, c.umbrales) === 'bajo_piso')
    .map(c => ({
      codigo: c.codigo,
      // El filtro de arriba ya descartó `sin_dato`, así que aquí siempre hay número.
      margenRealPct: c.margenRealPct as number,
      pisoPct: c.umbrales.pisoPct,
    }))
}

/**
 * El motivo, dicho como se le dice a una persona.
 *
 * Nombra la cotización, su margen y su piso: «no se puede avanzar» sin las tres cifras
 * deja a quien lo lee sin saber cuánto le falta ni a cuál documento mirar.
 */
export function mensajeGateMargen(bajoPiso: BajoPiso[]): string {
  if (bajoPiso.length === 0) return ''
  const detalle = bajoPiso
    .map(c => `${c.codigo ?? 'la cotización'} está al ${pct(c.margenRealPct)} (mínimo ${pct(c.pisoPct)})`)
    .join('; ')
  return bajoPiso.length === 1
    ? `Margen por debajo del mínimo para aprobar: ${detalle}. Sube el margen o el precio antes de avanzar.`
    : `${bajoPiso.length} cotizaciones por debajo del margen mínimo: ${detalle}. Sube el margen o el precio antes de avanzar.`
}

function pct(valor: number): string {
  return `${valor.toFixed(1).replace('.', ',')}%`
}
