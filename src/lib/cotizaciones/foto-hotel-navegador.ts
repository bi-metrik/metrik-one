/**
 * Comprime la foto del hotel en el navegador antes de subirla (`foto-hotel.ts`): el lado
 * mayor a lo sumo 1600 px, en JPEG. Solo corre en el navegador (usa `canvas`).
 */

import { CALIDAD_FOTO_HOTEL, medidasFotoHotel } from './foto-hotel'

export interface FotoComprimida {
  dataUrl: string
  /** Ancho entre alto, para encuadrar el recorte del documento. */
  proporcion: number
}

function cargarImagen(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('imagen ilegible'))
    img.src = url
  })
}

/** `null` si el archivo no es una imagen que el navegador pueda leer. */
export async function comprimirFotoHotel(archivo: Blob): Promise<FotoComprimida | null> {
  if (!archivo.type.startsWith('image/')) return null
  const url = URL.createObjectURL(archivo)
  try {
    const img = await cargarImagen(url)
    const m = medidasFotoHotel(img.naturalWidth, img.naturalHeight)
    if (!m) return null
    const canvas = document.createElement('canvas')
    canvas.width = m.ancho
    canvas.height = m.alto
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // Fondo blanco: un PNG con transparencia saldría negro en JPEG.
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, m.ancho, m.alto)
    ctx.drawImage(img, 0, 0, m.ancho, m.alto)
    return { dataUrl: canvas.toDataURL('image/jpeg', CALIDAD_FOTO_HOTEL), proporcion: m.ancho / m.alto }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}
