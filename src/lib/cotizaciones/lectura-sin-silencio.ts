/**
 * Un pantallazo pegado en una casilla nunca falla en silencio (brief del 2026-10-01, punto 7).
 *
 * La casilla llama a una server action que lee la imagen con el modelo (8 a 25 s) y la guarda.
 * Si esa llamada LANZA —la conexión se corta, el servidor no responde a tiempo, la respuesta no
 * se entiende— la casilla hacía `try { … } finally { … }` sin `catch`: se apagaba el «Leyendo…»,
 * no aparecía ningún mensaje y en la base no quedaba nada. Es la forma exacta de «pegué el
 * pantallazo 2 y no pasó nada» (COT-2026-0020).
 *
 * Aquí toda salida de la lectura se vuelve un resultado que la casilla sabe pintar: lo que
 * devolvió el servidor, o un rechazo con su mensaje.
 */

export const MENSAJE_LECTURA_INTERRUMPIDA =
  'No se pudo leer el pantallazo: la conexión se cortó o el servidor no respondió a tiempo. Vuelve a pegarlo o súbelo con «Subir foto».'

export const MENSAJE_ARCHIVO_ILEGIBLE = 'No se pudo abrir esa imagen. Vuelve a copiarla o súbela con «Subir foto».'

export type FalloDeLectura = { ok: false; codigo: 'INTERRUMPIDA'; mensaje: string }

/** Corre la lectura y devuelve SIEMPRE un resultado: si lanza, un rechazo con su mensaje. */
export async function leerSinSilencio<R>(lectura: () => Promise<R>): Promise<R | FalloDeLectura> {
  try {
    const r = await lectura()
    // Una respuesta vacía tampoco puede pasar callada.
    if (r === undefined || r === null) return { ok: false, codigo: 'INTERRUMPIDA', mensaje: MENSAJE_LECTURA_INTERRUMPIDA }
    return r
  } catch {
    return { ok: false, codigo: 'INTERRUMPIDA', mensaje: MENSAJE_LECTURA_INTERRUMPIDA }
  }
}

/** Una imagen del portapapeles o del selector, como data URL. Rechaza si no se puede leer. */
export function archivoComoDataUrl(archivo: Blob): Promise<string> {
  return new Promise((ok, mal) => {
    const lector = new FileReader()
    lector.onload = ev => {
      const r = ev.target?.result
      if (typeof r === 'string' && r.startsWith('data:')) ok(r)
      else mal(new Error(MENSAJE_ARCHIVO_ILEGIBLE))
    }
    lector.onerror = () => mal(new Error(MENSAJE_ARCHIVO_ILEGIBLE))
    lector.readAsDataURL(archivo)
  })
}

/**
 * Lo que se dice cuando un pantallazo pegado fuera de toda casilla entra a la bandeja y la
 * bandeja no está a la vista: la persona creyó pegarlo en su casilla y no vio pasar nada.
 */
export const MENSAJE_PEGADO_EN_BANDEJA =
  'El pantallazo entró a la bandeja de Pantallazos, arriba. Para ponerlo en una casilla, haz clic en ella antes de pegar.'

/** ¿La caja quedó entera fuera de la pantalla (arriba o abajo)? */
export function fueraDeVista(caja: { top: number; bottom: number }, altoDeLaVentana: number): boolean {
  return caja.bottom <= 0 || caja.top >= altoDeLaVentana
}
