import 'server-only'

/**
 * La foto del hotel que la asesora pone en una opción (`ponerFotoDelHotel`) queda también en el
 * catálogo del espacio: la próxima cotización con ese hotel la trae sola (plan §2.5: «la foto que
 * el asesor subió para un hotel se ofrece la próxima vez»).
 *
 * Solo con la propuesta nueva encendida (es la única que lee el catálogo). Best-effort: si no se
 * puede (sin migración, sin nombre de hotel), la foto de la opción igual quedó guardada.
 */
import { hotelesDeItems, type ItemConLectura } from '@/lib/cotizaciones/detalle-viaje'
import { bytesDeDataUrl } from '@/lib/cotizaciones/imagen-captura'
import { PLANTILLA_POR_DEFECTO, usaMotorHtml } from '@/lib/pdf/plantillas-cotizacion'
import { ponerFotoPropia } from './catalogo'
import { objetivo } from './clave'

export async function copiarFotoDeHotelAlCatalogo(a: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  workspaceId: string | null | undefined
  staffId: string | null | undefined
  item: ItemConLectura
  dataUrl: string
}): Promise<void> {
  if (!a.workspaceId) return
  try {
    const { data } = await a.supabase.from('workspaces').select('cotizacion_template_slug, config_extra').eq('id', a.workspaceId).maybeSingle()
    const ws = data as { cotizacion_template_slug?: string | null; config_extra?: unknown } | null
    if (!usaMotorHtml(ws?.cotizacion_template_slug ?? PLANTILLA_POR_DEFECTO, ws?.config_extra)) return
    const h = hotelesDeItems([a.item])[0]
    const o = h ? objetivo('hotel', h.hotel, h.ciudad) : null
    const partes = bytesDeDataUrl(a.dataUrl)
    if (!o || !partes) return
    const r = await ponerFotoPropia({ supabase: a.supabase, workspaceId: a.workspaceId, staffId: a.staffId ?? null, objetivo: o, bytes: partes.buffer })
    if (!r.ok) console.warn('[fotos-catalogo] la foto del hotel no quedó en el catálogo:', r.mensaje)
  } catch (e) {
    console.warn('[fotos-catalogo] la foto del hotel no quedó en el catálogo:', e instanceof Error ? e.message : e)
  }
}
