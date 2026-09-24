import 'server-only'

// La foto del hotel, guardada (reglas en `foto-hotel.ts`). Va al mismo almacenamiento que los
// pantallazos (`imagen-captura.ts`): el bucket privado del workspace, bajo
// negocios/<id>/fotos-hotel/<cotización>/<opción>-<huella>.jpg.

import { createHash } from 'node:crypto'

import { almacenamientoExternoDe } from '@/lib/almacenamiento/supabase-externo'
import { BYTES_MAXIMOS_FOTO_HOTEL } from './foto-hotel'
import { bytesDeDataUrl } from './imagen-captura'

export type ResultadoGuardarFoto =
  | { ok: true; ref: string }
  | { ok: false; mensaje: string }

export const MENSAJE_FOTO_NO_ES_IMAGEN = 'Ese archivo no es una foto. Usa un JPG o un PNG.'
export const MENSAJE_FOTO_MUY_PESADA = 'La foto pesa demasiado. Prueba con otra.'
export const MENSAJE_SIN_ALMACEN = 'Este espacio no tiene dónde guardar fotos. Avísale a MeTRIK.'
export const MENSAJE_FOTO_NO_GUARDADA = 'No se pudo guardar la foto. Vuelve a intentarlo.'

/** Revisa lo que llegó del navegador. Puro: se prueba sin almacenamiento. */
export function validarFotoHotel(dataUrl: unknown): { ok: true; buffer: Buffer; mime: string; ext: string } | { ok: false; mensaje: string } {
  if (typeof dataUrl !== 'string') return { ok: false, mensaje: MENSAJE_FOTO_NO_ES_IMAGEN }
  const partes = bytesDeDataUrl(dataUrl)
  // El navegador la manda ya comprimida en JPEG; otro formato es que la compresión no corrió.
  if (!partes || partes.mime !== 'image/jpeg') return { ok: false, mensaje: MENSAJE_FOTO_NO_ES_IMAGEN }
  if (partes.buffer.length === 0) return { ok: false, mensaje: MENSAJE_FOTO_NO_ES_IMAGEN }
  if (partes.buffer.length > BYTES_MAXIMOS_FOTO_HOTEL) return { ok: false, mensaje: MENSAJE_FOTO_MUY_PESADA }
  return { ok: true, ...partes }
}

export async function guardarFotoHotel(a: {
  workspaceId: string | null | undefined
  negocioId: string | null | undefined
  cotizacionId: string
  itemId: string
  dataUrl: unknown
}): Promise<ResultadoGuardarFoto> {
  const v = validarFotoHotel(a.dataUrl)
  if (!v.ok) return v
  if (!a.workspaceId || !a.negocioId) return { ok: false, mensaje: MENSAJE_SIN_ALMACEN }
  try {
    const almacen = await almacenamientoExternoDe(a.workspaceId)
    if (!almacen) return { ok: false, mensaje: MENSAJE_SIN_ALMACEN }
    // La huella en el nombre: cambiar la foto crea otro archivo y el enlace viejo no la sirve.
    const huella = createHash('sha256').update(v.buffer).digest('hex').slice(0, 16)
    const g = await almacen.subirArchivo({
      negocioId: a.negocioId,
      subcarpeta: `fotos-hotel/${a.cotizacionId}`,
      nombre: `${a.itemId}-${huella}.${v.ext}`,
      buffer: v.buffer,
      mime: v.mime,
      tipoBloque: 'foto_hotel_cotizacion',
    })
    return { ok: true, ref: g.referencia }
  } catch (e) {
    console.warn('[foto-hotel] no se pudo guardar la foto:', e instanceof Error ? e.message : e)
    return { ok: false, mensaje: MENSAJE_FOTO_NO_GUARDADA }
  }
}
