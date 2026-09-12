/**
 * Geometria de la tarjeta Open Graph por inquilino.
 *
 * El diseno aprobado se escribio en CSS y el navegador lo resolvia con
 * `object-fit: contain`, `max-width`/`max-height` y un ancho de placa por
 * contenido. Satori (el motor de `next/og`) NO implementa esa parte del modelo
 * de caja: medido contra el logo real de soena, la placa se fue al `max-width`
 * y el logo se quedo en su tamano intrinseco. Asi que aqui se hace la misma
 * cuenta a mano y a la imagen se le pasan alto y ancho EXPLICITOS.
 *
 * Las medidas salen del artboard aprobado, no de una descripcion.
 */

export const PLACA = {
  /** Alto FIJO. Es lo que impide que la composicion baile entre inquilinos:
   *  los logos van de 3.29:1 (dimpro) a 0.67:1 (hjbc). */
  alto: 196,
  padding: 22,
  anchoMinimo: 180,
  anchoMaximo: 360,
  radio: 22,
  logoAltoMaximo: 148,
  logoAnchoMaximo: 300,
} as const

export type ImagenMedida = {
  mime: 'image/png' | 'image/jpeg'
  ancho: number
  alto: number
}

export type GeometriaPlaca = {
  placaAncho: number
  logoAncho: number
  logoAlto: number
}

/**
 * Replica `object-fit: contain` dentro de la caja del logo y despues resuelve
 * el ancho de la placa por contenido, con sus topes.
 */
export function geometriaPlaca(imagen: { ancho: number; alto: number }): GeometriaPlaca {
  const escala = Math.min(
    PLACA.logoAnchoMaximo / imagen.ancho,
    PLACA.logoAltoMaximo / imagen.alto,
    // Un logo mas chico que la caja NO se estira: `contain` solo reduce cuando
    // hace falta, y agrandar un logo de 192x69 a 300px lo dejaria pixelado.
    1
  )
  const logoAncho = imagen.ancho * escala
  const logoAlto = imagen.alto * escala

  const placaAncho = Math.min(
    Math.max(logoAncho + PLACA.padding * 2, PLACA.anchoMinimo),
    PLACA.anchoMaximo
  )

  return { placaAncho, logoAncho, logoAlto }
}

/**
 * Lee mime y medidas de los bytes crudos. Deliberadamente reconoce SOLO PNG y
 * JPEG: son los unicos formatos que hay en el bucket, y un formato que no se
 * reconoce tiene que apagar la tarjeta propia en vez de producir una placa
 * vacia. Devuelve null cuando no lo entiende.
 *
 * El mime se deduce de los bytes, no de la cabecera `content-type` de la
 * respuesta: el tipo declarado por el almacenamiento no siempre coincide con
 * el contenido, y de esos bytes depende que resvg pueda decodificar.
 */
export function medirImagen(bytes: Uint8Array): ImagenMedida | null {
  if (bytes.length < 24) return null

  // PNG: firma de 8 bytes y despues el chunk IHDR con ancho y alto.
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const ancho = vista.getUint32(16)
    const alto = vista.getUint32(20)
    return ancho > 0 && alto > 0 ? { mime: 'image/png', ancho, alto } : null
  }

  // JPEG: se recorren los segmentos hasta el SOF, que es el que trae las
  // medidas. Se aceptan todos los SOF, no solo el baseline (0xC0): el logo de
  // soena es PROGRESIVO (0xC2) y resvg lo decodifica sin problema (verificado).
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let i = 2
    while (i < bytes.length - 9) {
      if (bytes[i] !== 0xff) {
        i++
        continue
      }
      const marcador = bytes[i + 1]
      const esSof =
        marcador >= 0xc0 && marcador <= 0xcf &&
        marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc
      if (esSof) {
        const alto = vista.getUint16(i + 5)
        const ancho = vista.getUint16(i + 7)
        return ancho > 0 && alto > 0 ? { mime: 'image/jpeg', ancho, alto } : null
      }
      const largo = vista.getUint16(i + 2)
      if (largo < 2) return null
      i += 2 + largo
    }
  }

  return null
}
