/**
 * La capa de texto de un PDF, si la tiene.
 *
 * Un PDF generado por un sistema (el certificado de la UPME, una factura electrónica)
 * trae el texto tal cual se escribió. Un PDF escaneado no trae nada o casi nada. Ese
 * texto es la referencia contra la que se verifica lo que LEE la IA mirando la imagen
 * (ver `verificar-contra-texto.ts`): la IA confunde «rn» con «m», el texto no.
 *
 * Nunca lanza: si el PDF no se puede abrir o no trae capa de texto, devuelve `null` y la
 * extracción sigue como siempre.
 */

import { extractText } from 'unpdf'

/**
 * Por debajo de esto no hay capa de texto que valga: un escaneo a veces trae un pie de
 * página o un sello digital como texto y nada más. Se cuentan caracteres que no son
 * espacio.
 */
export const MINIMO_CARACTERES_CAPA_TEXTO = 40

export async function textoDelPdf(buffer: Buffer | Uint8Array): Promise<string | null> {
  try {
    // Copia: pdf.js puede quedarse con el ArrayBuffer que recibe, y el buffer original
    // sigue en uso (se sube a Drive después de extraer).
    const datos = new Uint8Array(buffer)
    const { text } = await extractText(datos, { mergePages: true })
    const texto = typeof text === 'string' ? text : ''
    if (texto.replace(/\s/g, '').length < MINIMO_CARACTERES_CAPA_TEXTO) return null
    return texto
  } catch (err) {
    console.warn('[texto-pdf] No se pudo leer la capa de texto:', String(err).slice(0, 160))
    return null
  }
}
