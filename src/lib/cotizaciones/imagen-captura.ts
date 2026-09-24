import 'server-only'

// ============================================================
// El pantallazo de una opción, guardado (pedido de Mauricio del 2026-09-24: la miniatura de
// cada habitación se amplía y es el soporte de su precio).
//
// Reglas:
//  · Se sube al ACEPTAR (o al pegar una habitación en su opción), nunca mientras sigue en la
//    bandeja: lo que no entra a la cotización no se guarda.
//  · Va al almacenamiento PROPIO del workspace (`supabase_externo`: el proyecto de
//    Trappvel, bucket privado). Un workspace en Drive no guarda la imagen: sigue solo con su
//    huella, como antes. Nunca al Drive de MeTRIK: son datos personales de viajeros.
//  · Solo se sube la imagen que se LEYÓ: su huella tiene que ser la de la lectura firmada.
//    Otra imagen con la lectura de esta no entra.
//  · Nunca tumba la aceptación: si no se puede guardar, la captura entra igual sin miniatura
//    y el fallo queda en el log.
//  · Se abre por `/api/archivos/abrir`, que exige sesión, workspace y poder ver el negocio.
// ============================================================

import { almacenamientoExternoDe } from '@/lib/almacenamiento/supabase-externo'
import { huellaDeImagen } from './captura-repetida'
import type { LecturaCasilla, TarifaPax } from './tarifa-pasajero'

const EXTENSIONES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
}

/** Mime y bytes de un data URL de imagen. `null` si no es una imagen en base64. */
export function bytesDeDataUrl(dataUrl: string): { mime: string; ext: string; buffer: Buffer } | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(dataUrl ?? '')
  if (!m) return null
  const mime = m[1].toLowerCase()
  const ext = EXTENSIONES[mime]
  if (!ext) return null
  return { mime, ext, buffer: Buffer.from(m[2].trim(), 'base64') }
}

/**
 * Guarda el pantallazo de una lectura y devuelve su referencia, o `null` si no aplica o no se
 * pudo. No escribe en la lectura: quien llama decide cuándo (`lectura.imagenRef = …`).
 */
export async function guardarImagenDeCaptura(a: {
  workspaceId: string | null | undefined
  negocioId: string | null | undefined
  cotizacionId: string
  dataUrl: string | null | undefined
  lectura: Pick<LecturaCasilla, 'huellaImagen'>
}): Promise<string | null> {
  if (!a.workspaceId || !a.negocioId || !a.dataUrl) return null
  const partes = bytesDeDataUrl(a.dataUrl)
  if (!partes) return null
  const huella = await huellaDeImagen(a.dataUrl)
  if (!huella) return null
  // La imagen tiene que ser la que se leyó. Sin huella en la lectura (lecturas viejas) no hay
  // con qué compararla: no se guarda.
  if (!a.lectura.huellaImagen || a.lectura.huellaImagen !== huella) return null
  try {
    const almacen = await almacenamientoExternoDe(a.workspaceId)
    if (!almacen) return null
    const g = await almacen.subirArchivo({
      negocioId: a.negocioId,
      subcarpeta: `capturas/${a.cotizacionId}`,
      nombre: `${huella}.${partes.ext}`,
      buffer: partes.buffer,
      mime: partes.mime,
      tipoBloque: 'captura_cotizacion',
    })
    return g.referencia
  } catch (e) {
    console.warn('[imagen-captura] no se pudo guardar el pantallazo:', e instanceof Error ? e.message : e)
    return null
  }
}

/** Borra pantallazos guardados. Nunca lanza: un archivo que no se pudo borrar lo recoge el barrido. */
export async function borrarImagenesDeCaptura(workspaceId: string | null | undefined, refs: readonly (string | null | undefined)[]): Promise<void> {
  const validas = refs.filter((r): r is string => typeof r === 'string' && r.startsWith('sbext://'))
  if (!workspaceId || validas.length === 0) return
  try {
    const almacen = await almacenamientoExternoDe(workspaceId)
    if (!almacen) return
    for (const r of validas) {
      try {
        await almacen.borrar(r)
      } catch (e) {
        console.warn('[imagen-captura] no se pudo borrar un pantallazo:', e instanceof Error ? e.message : e)
      }
    }
  } catch (e) {
    console.warn('[imagen-captura] sin almacenamiento para borrar:', e instanceof Error ? e.message : e)
  }
}

/** Todas las imágenes guardadas de una tarifa: sus casillas y sus habitaciones. */
export function imagenesDeTarifa(t: TarifaPax): string[] {
  const refs = new Set<string>()
  for (const l of Object.values(t.casillas ?? {})) if (l?.imagenRef) refs.add(l.imagenRef)
  for (const h of t.habitaciones ?? []) if (h.lectura?.imagenRef) refs.add(h.lectura.imagenRef)
  return [...refs]
}
