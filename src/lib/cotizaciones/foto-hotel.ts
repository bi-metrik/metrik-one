/**
 * La foto del hotel de una opción (Trappvel, pedido de Mauricio del 2026-09-24).
 *
 * El asesor la pone sobre la hoja de «Así lo ve el cliente», como la nota: pegándola,
 * arrastrándola o subiéndola. Sale en el documento en el MISMO lugar que la foto provisional
 * de la ciudad (la miniatura al lado de la tarjeta del hotel), y la reemplaza: no hay un
 * segundo lugar para fotos.
 *
 * Reglas:
 *  · Se comprime en el navegador antes de subir: el lado mayor a lo sumo 1600 px, en JPEG.
 *  · Se guarda en el almacenamiento propio del workspace (el bucket privado de las capturas,
 *    #892) y se abre por enlace firmado. Nunca al Drive de MeTRIK.
 *  · Se borra al cambiarla, al quitarla y al borrar la opción (también cuando la opción
 *    vuelve a la bandeja: la foto no es una captura, no vuelve con ella).
 *
 * Este módulo es puro (lo usan el navegador y el servidor): medidas y textos.
 */

/** El lado mayor de la foto guardada, en píxeles. */
export const LADO_MAXIMO_FOTO_HOTEL = 1600

/** Calidad del JPEG comprimido. */
export const CALIDAD_FOTO_HOTEL = 0.82

/** Lo más que puede pesar la foto ya comprimida. Una de 1600 px en JPEG pesa bastante menos. */
export const BYTES_MAXIMOS_FOTO_HOTEL = 3 * 1024 * 1024

export const TEXTO_AGREGAR_FOTO_HOTEL = 'Agrega una foto del hotel'

/**
 * Las medidas de la foto comprimida: el lado mayor a lo sumo `LADO_MAXIMO_FOTO_HOTEL`, sin
 * deformarla y sin agrandar una foto chica. `null` si las medidas no sirven.
 */
export function medidasFotoHotel(ancho: number, alto: number, maximo = LADO_MAXIMO_FOTO_HOTEL): { ancho: number; alto: number } | null {
  if (!Number.isFinite(ancho) || !Number.isFinite(alto) || ancho <= 0 || alto <= 0) return null
  const escala = Math.min(1, maximo / Math.max(ancho, alto))
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) }
}

/** El enlace de una foto guardada: lo firma la ruta de archivos, que valida la sesión. */
export function urlDeFotoHotel(ref: string | null | undefined): string | null {
  return ref ? `/api/archivos/abrir?ref=${encodeURIComponent(ref)}` : null
}
