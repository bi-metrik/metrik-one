/**
 * Tope del audio que se puede auditar. AHORA MANDA EL RELOJ, NO EL PESO.
 *
 * ESTE ARCHIVO DECIA LO CONTRARIO, Y ERA CIERTO HASTA QUE EL AUDIO DEJO DE
 * VIAJAR DENTRO DE LA PETICION.
 *
 * Antes el archivo iba como multipart en el cuerpo de POST /transcribir, y ahi
 * el techo era el cuerpo: 4.500.000 bytes medidos contra produccion, que a un
 * audio tipico de call center le daban unos 17 minutos. Ese techo mordia mucho
 * antes que ningun otro, asi que el criterio correcto era el peso.
 *
 * Hoy el archivo sube directo a Storage y a esta aplicacion solo le llega su
 * ruta. El cuerpo de la peticion pasa a no pesar nada y ese techo desaparece
 * del camino. El que queda es el reloj de la funcion, y el reloj NO depende del
 * peso: depende de los MINUTOS.
 *
 * Dos archivos de 18 MB, uno de 37 minutos bien comprimido y otro de 75 mal
 * comprimido, pesan igual y tardan la mitad y el doble. Un tope por peso ya no
 * protege de nada. Por eso el criterio se invirtio.
 *
 * LOS NUMEROS DEL RELOJ, MEDIDOS EN PRODUCCION SOBRE EL DOMINIO PROPIO:
 * 12 min de audio -> 200 en 48,9 s. 17 min -> 200 en 78,1 s. Eso da entre 4,1 y
 * 4,6 segundos de reloj por minuto de audio, ligeramente superlineal. A 30
 * minutos son unos 140 s contra un presupuesto de 300 s: margen 2x, que es el
 * que se necesita para que un reintento no reviente la peticion.
 *
 * Y EL PRESUPUESTO DE 300 s NO SE PUEDE SUBIR. No es el default de la
 * plataforma sino el maximo del plan (hobby, verificado el 2026-07-29 contra la
 * API de Vercel). Los 800 s y los 1.800 s de duracion extendida son de Pro. Si
 * algun dia se quiere pasar de 30 minutos, el primer paso no es tocar este
 * archivo: es decidir el plan.
 */

/** Tope real: media hora de llamada. Lo fija el reloj de la funcion. */
export const MINUTOS_MAX_AUDIO = 30
export const MAX_SEGUNDOS_AUDIO = MINUTOS_MAX_AUDIO * 60

/**
 * Red secundaria, y ya no es el criterio principal.
 *
 * Existe por dos razones, ninguna relacionada con el cuerpo de la peticion:
 *
 * 1. El audio se le manda a Gemini en linea, y ahi el tope son 20 MB de
 *    peticion TOTAL, prompt incluido. 18 MB deja margen para el prompt.
 * 2. Cuando el navegador no logra leer la duracion del archivo (pasa con
 *    contenedores raros o metadatos rotos), el peso es lo unico que queda para
 *    decidir. A 240 KB por minuto, 18 MB son unos 75 minutos: generoso a
 *    proposito, porque aqui el peso solo esta atajando el caso degenerado.
 */
export const MAX_BYTES_AUDIO = 18_000_000

/**
 * Bytes por minuto del audio TIPICO de un call center: mono, 8 kHz, 32 kbps.
 * 32.000 bits/s / 8 = 4.000 bytes/s x 60.
 *
 * Confirmado contra un archivo real del sector: la llamada de 1:05:10 de Regat
 * pesa 15.658.605 bytes, o sea 240,6 KB por minuto. La constante estaba bien.
 *
 * Sirve solo para traducir pesos a minutos en los mensajes. No es el criterio.
 */
const BYTES_POR_MINUTO_TIPICO = 240_000

/** MB con un decimal, para hablarle al usuario en la unidad que ve en su disco. */
export function mb(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1).replace('.', ',')
}

/** Minutos redondeados hacia arriba, para hablar de duracion sin decimales. */
export function minutos(segundos: number): number {
  return Math.ceil(segundos / 60)
}

/**
 * El rechazo por DURACION, que es el criterio principal.
 *
 * Dice los minutos del archivo y los del tope, porque de la duracion el usuario
 * si tiene una nocion antes de mirar nada. Y dice que hacer, no solo que no
 * cabe: sin eso nadie sabe que hacer con el archivo que ya tiene.
 */
export function mensajeAudioMuyLargo(segundos: number): string {
  return (
    `La llamada dura ${minutos(segundos)} minutos y el máximo son ${MINUTOS_MAX_AUDIO}. ` +
    `Sube un fragmento más corto: la parte donde se toman los datos de pago suele ser la más reveladora.`
  )
}

/**
 * El rechazo por PESO, que ahora es el caso raro.
 *
 * Se ve cuando el archivo dura poco pero pesa mucho (grabado sin comprimir), o
 * cuando no se pudo leer la duracion y el peso es lo unico que hay.
 */
export function mensajeAudioMuyPesado(bytes: number): string {
  const equivalencia = Math.floor(MAX_BYTES_AUDIO / BYTES_POR_MINUTO_TIPICO)
  return (
    `El archivo pesa ${mb(bytes)} MB y el máximo son ${mb(MAX_BYTES_AUDIO)} MB, ` +
    `que a calidad de llamada normal son unos ${equivalencia} minutos. ` +
    `Si la tuya dura menos de ${MINUTOS_MAX_AUDIO} minutos, vuelve a exportarla comprimida (MP3 mono) y súbela otra vez.`
  )
}
