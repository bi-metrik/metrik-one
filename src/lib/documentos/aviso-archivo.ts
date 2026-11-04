/**
 * Qué decirle a quien subió un documento cuando la lectura no sale, según de quién es el problema.
 *
 * Caso que lo motivó (V0634, SOENA, 2026-11-04): se subió un PDF sin páginas, el modelo respondió
 * `400 INVALID_ARGUMENT "The document has no pages."` y la pantalla dijo «Error de Gemini (400)» con
 * un botón «Reintentar». Quien lo subió pensó que el sistema estaba caído; reintentar el mismo archivo
 * falla igual. Lo que resolvía era reemplazar el archivo.
 *
 * Dos causas, dos avisos:
 *  · `archivo`: el archivo está vacío, dañado, protegido o en un formato que no se lee. Es accionable
 *    por quien lo subió: aviso en ámbar y la salida es REEMPLAZAR.
 *  · sistema (402, 403, 429, 5xx, tiempo agotado…): `MENSAJE_FALLA_NUESTRA`. Nunca el nombre del
 *    proveedor ni el código HTTP: eso queda en el log y en `_extraction_error`.
 *
 * Puro y sin dependencias de servidor: lo importa también la tarjeta del bloque.
 */

export type MotivoArchivo = 'vacio' | 'sin_paginas' | 'danado' | 'protegido' | 'formato' | 'ilegible' | 'muy_grande'

const SALIDA = 'Vuelve a descargarlo o escanéalo y súbelo de nuevo con «Reemplazar».'

export const MENSAJES_ARCHIVO: Record<MotivoArchivo, string> = {
  vacio: `El archivo está vacío. ${SALIDA}`,
  sin_paginas: `El archivo está dañado o no tiene páginas. ${SALIDA}`,
  danado: `El archivo está dañado y no se puede abrir. ${SALIDA}`,
  protegido: 'El PDF está protegido con contraseña. Súbelo sin contraseña con «Reemplazar».',
  formato: 'Este tipo de archivo no se puede leer. Súbelo como PDF, JPG, PNG o WebP con «Reemplazar».',
  ilegible: 'La imagen no se puede leer. Toma la foto o el escaneo de nuevo y súbelo con «Reemplazar».',
  muy_grande: 'El archivo es demasiado pesado para leerlo. Súbelo en menor resolución con «Reemplazar».',
}

export const MENSAJE_FALLA_NUESTRA = 'No pudimos leer el documento por una falla nuestra; ya estamos en eso.'

const AVISOS_ARCHIVO = new Set(Object.values(MENSAJES_ARCHIVO))

/** ¿El mensaje es un aviso de archivo (del usuario) y no una falla del sistema? */
export function esAvisoDeArchivo(mensaje: string | null | undefined): boolean {
  return !!mensaje && AVISOS_ARCHIVO.has(mensaje)
}

export function esMotivoArchivo(v: unknown): v is MotivoArchivo {
  return typeof v === 'string' && v in MENSAJES_ARCHIVO
}

/**
 * El motivo de archivo detrás de una respuesta de error del modelo (Gemini o Anthropic), o `null` si es
 * una falla del sistema. Solo los 400/413 pueden ser del archivo: un 402, 403, 429 o 5xx nunca lo es,
 * diga lo que diga el cuerpo.
 */
export function motivoDesdeRespuestaModelo(estado: number, cuerpo: string): MotivoArchivo | null {
  if (estado === 413) return 'muy_grande'
  if (estado !== 400) return null
  const t = cuerpo.toLowerCase()
  if (/no pages|zero pages|0 pages/.test(t)) return 'sin_paginas'
  if (/password|encrypted/.test(t)) return 'protegido'
  if (/too large|payload size|exceeds the maximum|request entity/.test(t)) return 'muy_grande'
  if (/(could not|unable to|failed to) process (input )?image|image .*(invalid|not valid|corrupt)|invalid image/.test(t)) return 'ilegible'
  if (/(pdf|document).*(invalid|not valid|corrupt|malformed|could not be (processed|parsed|read))/.test(t)) return 'danado'
  if (/unsupported (mime|file|media)|mime type .*not supported/.test(t)) return 'formato'
  return null
}

/** El texto para la pantalla a partir del motivo (si es del archivo) o de cualquier otra falla. */
export function mensajeDeLectura(motivo: MotivoArchivo | null | undefined): string {
  return motivo ? MENSAJES_ARCHIVO[motivo] : MENSAJE_FALLA_NUESTRA
}
