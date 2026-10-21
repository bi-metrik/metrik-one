/**
 * Lo que ePayco.js entrega cuando no tokeniza, traducido a un texto para quien paga. Leído del propio
 * script (https://checkout.epayco.co/epayco.min.js), porque la documentación no lo describe:
 *
 * - Un campo que no pasa su validación local: `callback(texto, null)`, con el texto del error 103,
 *   «El formato es incorrecto o esta vacío en: <campo>» (`name`, `email`, `number`, `cvc`, `date_exp`).
 * - Un rechazo de la API (`token/encrypt` o `token/tokenize` responden 400): `callback(respuesta, null)`,
 *   con `{ status: false, message, data: { status: 'error', description } }`.
 * - Una respuesta 200 sin token: `callback(null, undefined)` (el script compara con `=` y no con `===`).
 *
 * Ninguno de los tres trae datos de la tarjeta: el 103 solo nombra el campo y la API solo describe.
 */

const CAMPOS: Record<string, string> = {
  name: 'el nombre en la tarjeta',
  email: 'el correo',
  number: 'el número de la tarjeta',
  cvc: 'el CVC',
  date_exp: 'la fecha de vencimiento (MM y AAAA)',
}

/** Lo que ePayco antepone a toda descripción de la API y no le dice nada a quien paga. */
const PREFIJO_GENERAL = /^error general contacte con soporte\.?\s*/i

export function textoErrorEpayco(error: unknown): string {
  if (typeof error === 'string') {
    const campo = error.match(/:\s*(\w+)\s*$/)?.[1]
    if (campo && CAMPOS[campo]) return `Revisa ${CAMPOS[campo]}: está vacío o no tiene el formato correcto.`
    return `ePayco no aceptó los datos: ${error}`
  }
  if (error && typeof error === 'object') {
    const datos = (error as { data?: { description?: unknown } }).data
    const descripcion = typeof datos?.description === 'string' ? datos.description.replace(PREFIJO_GENERAL, '').trim() : ''
    const mensaje = (error as { message?: unknown }).message
    const detalle = descripcion || (typeof mensaje === 'string' ? mensaje : '')
    return detalle
      ? `ePayco rechazó la tarjeta: ${detalle}`
      : 'ePayco rechazó la tarjeta. Revisa los datos e inténtalo de nuevo.'
  }
  return 'ePayco no devolvió la confirmación de la tarjeta. Inténtalo de nuevo en un momento.'
}

/**
 * ePayco.js guarda en `localStorage.keyUserIndex` la sesión con la que cifra la tarjeta. La primera
 * vez que corre en un navegador, la crea DESPUÉS de pedir la llave de cifrado: pide la llave con una
 * sesión vacía y tokeniza con la nueva, y la API, que no encuentra la llave, responde «El campo
 * card[exp_year] es requerido» (medido contra la API el 2026-10-14). El segundo intento sí funciona.
 * Crearla antes evita que el primer intento de todo navegador nuevo falle.
 */
export function asegurarSesionEpayco(almacen: Pick<Storage, 'getItem' | 'setItem'>, nueva: () => string): void {
  try {
    if (!almacen.getItem('keyUserIndex')) almacen.setItem('keyUserIndex', nueva())
  } catch {
    // Sin almacenamiento (navegación privada estricta): ePayco.js tampoco podrá guardarla; sigue igual.
  }
}
