/**
 * Por qué se eligió esta combinación y no otra (§3.3 del diseño).
 *
 * *«Un campo de texto libre no se agrega: veinte motivos escritos a mano son veinte
 * frases distintas para cinco razones. El motivo se elige de una lista corta y ADEMÁS
 * se puede escribir.»*
 *
 * ## Las dos reglas que sostienen esto, y que no son de forma
 *
 * **Es opcional y nunca bloquea (§3.2.1 R5).** Se pide donde se elige —en la tabla de
 * combinaciones— y no en un modal al emitir: *«un campo obligatorio en el instante de
 * más afán produce veinte motivos basura, que es peor que veinte vacíos: el vacío se
 * puede ignorar, la basura hay que creérsela.»*
 *
 * **Sin motivo el registro guarda NULL, no una cadena vacía ni «no especificado».** Es
 * lo mismo que ya obliga este repo con todo indicador que puede calcularse sobre cero
 * evidencias: un valor por defecto es indistinguible de una respuesta real, y el día
 * que se midan los motivos acumulados para escribir criterios (§3.4), veinte «no
 * especificado» pesarían como veinte razones.
 *
 * ## La lista arranca aquí y se ajusta con lo que aparezca en «otro»
 *
 * El propio diseño lo dice: *«La lista sale de las primeras cotizaciones, no de esta
 * hoja.»* Por eso vive en código y no en configuración: cambiarla es una decisión que
 * se revisa en un PR, no un dato que alguien edite sin que quede traza.
 */

export interface MotivoCombinacion {
  /** Lo que se guarda. Estable: renombrarlo rompería la serie ya acumulada. */
  codigo: string
  /** Lo que lee quien cotiza. Se puede reescribir sin tocar los datos. */
  etiqueta: string
}

/** El código de «otro», el único que espera texto al lado. */
export const MOTIVO_OTRO = 'otro'

/** La lista corta de §3.3, en el orden en que se ofrece. */
export const MOTIVOS_COMBINACION: readonly MotivoCombinacion[] = [
  { codigo: 'horario', etiqueta: 'El horario no sirve (muy temprano, muy tarde, conexión corta)' },
  { codigo: 'aerolinea', etiqueta: 'La aerolínea no sirve para este cliente' },
  { codigo: 'ubicacion_hotel', etiqueta: 'El hotel no está donde el cliente quiere' },
  { codigo: 'precio', etiqueta: 'La diferencia de precio no justifica el cambio' },
  { codigo: 'cliente', etiqueta: 'El cliente lo pidió explícitamente' },
  { codigo: MOTIVO_OTRO, etiqueta: 'Otro' },
] as const

/** ¿Este código es uno de los de la lista? */
export function esMotivoConocido(codigo: string | null | undefined): boolean {
  if (!codigo) return false
  return MOTIVOS_COMBINACION.some(m => m.codigo === codigo)
}

/** La etiqueta de un código, o el código crudo si ya no está en la lista. */
export function etiquetaDeMotivo(codigo: string | null | undefined): string | null {
  if (!codigo) return null
  return MOTIVOS_COMBINACION.find(m => m.codigo === codigo)?.etiqueta ?? codigo
}

export interface MotivoNormalizado {
  codigo: string | null
  texto: string | null
}

/**
 * El motivo, limpio, tal como se guarda.
 *
 * Tres decisiones, y las tres son la misma:
 *
 *  · **Vacío y espacios en blanco valen `null`.** `''` y `null` tienen que significar
 *    lo mismo, o «nadie escribió» y «alguien escribió y borró» se guardan distinto y
 *    cuentan distinto al medir. Es la misma trampa que costó el `??` que no atrapaba
 *    la cadena vacía en el nombre de la variante.
 *  · **Un código que no está en la lista se descarta.** El valor llega de un `select`
 *    del navegador, o sea de un endpoint alcanzable: guardarlo tal cual metería
 *    categorías inventadas en la serie que después se agrupa.
 *  · **El texto sobrevive aunque el código se descarte.** Lo que una persona escribió
 *    es el dato caro; el código es la etiqueta con la que se agrupa.
 *
 * ⚠️ `otro` SIN texto se conserva como código. Es una respuesta —«ninguna de estas»—
 * y borrarla dejaría el mismo hueco que no haber contestado, que es otra cosa.
 */
export function normalizarMotivo(
  codigo: string | null | undefined,
  texto: string | null | undefined,
): MotivoNormalizado {
  const limpio = (texto ?? '').trim()
  return {
    codigo: esMotivoConocido(codigo) ? (codigo as string) : null,
    texto: limpio === '' ? null : limpio,
  }
}

/** ¿Este motivo dice algo? `false` cuando los dos campos quedaron nulos. */
export function hayMotivo(motivo: MotivoNormalizado): boolean {
  return motivo.codigo !== null || motivo.texto !== null
}
