/**
 * El tipo real de un archivo sale de sus BYTES, no de su nombre.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * `mimeTypeFromName('Factura.pdf')` devuelve `application/pdf` aunque el archivo sea
 * un PNG. Y en este producto eso pasa de verdad: el cargue masivo guarda todo con el
 * nombre del documento («Factura.pdf», «RUT.pdf») independientemente de lo que el
 * cliente haya mandado, y la gente manda fotos.
 *
 * Medido contra producción el 2026-09-07: el «Factura.pdf» de V0181 son 9.507 bytes
 * cuya cabecera es `\x89PNG`. Al reprocesarlo, Gemini recibía un PNG declarado como
 * PDF y devolvía **todos los campos vacíos** — así que el reproceso no solo no
 * recuperaba nada, sino que borraba la marca, la línea, el modelo y el tipo de
 * vehículo que el bloque sí tenía. El fallo es mudo: la extracción «funciona» y
 * responde que el documento no dice nada.
 *
 * La firma se lee de los primeros bytes y solo se reconocen los cuatro formatos que
 * la extracción acepta. Si no se reconoce ninguno, se devuelve `null` y quien llama
 * decide — normalmente cayendo al nombre, que es el comportamiento de siempre.
 */

/** Formatos que la extracción sabe leer. Un tipo fuera de esta lista no se adivina. */
const FIRMAS: { mime: string; bytes: number[] }[] = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] }, // \x89PNG
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
]

/** `image/webp` es RIFF....WEBP: la marca no está al principio del todo. */
function esWebp(b: Uint8Array): boolean {
  return (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  )
}

/** El mime deducido de los bytes, o `null` si la firma no se reconoce. */
export function mimeDeContenido(buf: Uint8Array | null | undefined): string | null {
  if (!buf || buf.length < 3) return null
  for (const { mime, bytes } of FIRMAS) {
    if (bytes.every((v, i) => buf[i] === v)) return mime
  }
  return esWebp(buf) ? 'image/webp' : null
}

/**
 * El mime que hay que usar: manda el contenido, y el nombre queda de respaldo.
 *
 * El orden NO es negociable. Al revés (nombre primero) se reproduce exactamente el
 * defecto que este módulo vino a cerrar, porque el nombre casi siempre resuelve a
 * algo — y a algo equivocado.
 */
export function mimeEfectivo(buf: Uint8Array | null | undefined, porNombre: string): string {
  return mimeDeContenido(buf) ?? porNombre
}
