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
 * EL PRESUPUESTO DE 300 s NO SE PUEDE SUBIR. No es el default de la plataforma
 * sino el maximo del plan (hobby, verificado el 2026-07-29 contra la API de
 * Vercel). Los 800 s y los 1.800 s de duracion extendida son de Pro.
 *
 * DE DONDE SALEN LOS 45 MINUTOS. No de extrapolar: de medir la transcripcion
 * completa de una llamada real del sector recortada a cuatro duraciones, con
 * `maxOutputTokens` en 64.000.
 *
 *   min | reloj | margen | pensamiento+salida / 64.000 | margen | cobertura
 *    30 |  110s |  2,7x  |  25.898  (40%)              |  2,5x  |  100%
 *    40 |   99s |  3,0x  |  23.400  (37%)              |  2,7x  |   99%
 *    52 |  121s |  2,5x  |  30.670  (48%)              |  2,1x  |  100%
 *    65 |  242s |  1,2x  |  62.636  (98%)              |  1,0x  |   98%
 *
 * El reloj NO crece de forma lineal con la duracion, que era lo que este
 * archivo suponia antes: lo que manda es cuanto PIENSA el modelo, y eso pega un
 * salto entre los 52 y los 65 minutos (de 18k a 46k tokens de pensamiento). A
 * 65 minutos la cosa funciona, pero gastando el 98% del presupuesto de salida:
 * eso no es un tope, es una moneda al aire. 52 es el ultimo punto medido con
 * margen comodo en las dos dimensiones, y 45 deja un 15% por debajo de el.
 *
 * Para pasar de aqui hacen falta dos cosas, y solo una es codigo: plan Pro para
 * el reloj, y trocear para que el pensamiento no se coma el presupuesto.
 */

/** Tope real: 45 minutos. Lo fijan el reloj y el presupuesto de salida. */
export const MINUTOS_MAX_AUDIO = 45
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
