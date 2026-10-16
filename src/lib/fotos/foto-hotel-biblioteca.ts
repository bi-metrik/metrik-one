import 'server-only'

/**
 * La foto que la asesora pega, arrastra o sube en la tarjeta del hotel (`ponerFotoDelHotel`) va a
 * la biblioteca del espacio (`fotos_catalogo`, llave `hotel|ciudad`), no a la opción: es la misma
 * que ven el panel «Fotos de la propuesta», `/fotos` y el documento (Mauricio, 2026-10-16: «dónde
 * quedó lo de la biblioteca, debería ser aquí»). Ver `foto-hotel-documento.ts`.
 *
 * Solo en los espacios con propuesta de viaje (`tienePropuestaHtml`, el mismo criterio de `/fotos`).
 * En los demás devuelve `null` y la foto se guarda en la opción, como antes.
 */
import { hotelesDeItems, type ItemConLectura } from '@/lib/cotizaciones/detalle-viaje'
import { bytesDeDataUrl } from '@/lib/cotizaciones/imagen-captura'
import { tienePropuestaHtml } from '@/lib/pdf/motor-html'
import { revisarAutorizacion } from './autorizacion'
import { elementosDe, ponerFotoPropia, TABLA_CATALOGO, type FilaCatalogo } from './catalogo'
import { enlacesDeCatalogo } from './catalogo-almacen'
import { objetivo, usaFotosDeSitioOficial, type ObjetivoFoto } from './clave'
import { vistaDeElemento, type ElementoVista } from './vista'

const ROLES_SIN_ESCRITURA = new Set(['read_only', 'contador'])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

/** ¿El espacio tiene biblioteca de fotos? `null` = no (otra plantilla). */
export async function bibliotecaDelEspacio(supabase: Cliente, workspaceId: string): Promise<{ sitioOficial: boolean } | null> {
  const { data } = await supabase.from('workspaces').select('cotizacion_template_slug, config_extra').eq('id', workspaceId).maybeSingle()
  const ws = data as { cotizacion_template_slug?: string | null; config_extra?: unknown } | null
  if (!tienePropuestaHtml(ws?.cotizacion_template_slug)) return null
  return { sitioOficial: usaFotosDeSitioOficial(ws?.config_extra) }
}

/** El hotel de la opción como elemento de la biblioteca (la llave la calcula el servidor). */
export function objetivoDelHotel(item: ItemConLectura): ObjetivoFoto | null {
  const h = hotelesDeItems([item])[0]
  return h ? objetivo('hotel', h.hotel ?? h.linea, h.ciudad) : null
}

/** El elemento como está en la biblioteca, para la tarjeta (`null` = sin fotos). */
export async function elementoDeBiblioteca(supabase: Cliente, workspaceId: string, o: Pick<ObjetivoFoto, 'tipo' | 'clave'>, sitioOficial: boolean): Promise<ElementoVista | null> {
  const { data, error } = await supabase
    .from(TABLA_CATALOGO)
    .select('id, tipo, clave, nombre_clave, nombre, ciudad, ref, origen, fuente_url, titulo_fuente, autor, licencia, foco_x, foco_y, proporcion, revisada, descartadas, principal, posicion, imagen_url')
    .eq('workspace_id', workspaceId)
    .eq('tipo', o.tipo)
    .eq('clave', o.clave)
  if (error) return null
  const filas = (data ?? []) as FilaCatalogo[]
  const urls = await enlacesDeCatalogo(workspaceId, filas.map((f) => f.ref))
  const [e] = elementosDe(filas).map((x) => vistaDeElemento(x, urls, { sitioOficial }))
  return e ?? null
}

export type FotoHotelEnBiblioteca = { ok: true; elemento: ElementoVista | null } | { ok: false; mensaje: string }

/**
 * Guarda la foto de la tarjeta en la biblioteca: `reemplaza` = la foto que se cambia; sin él,
 * cambia la principal (o entra como la primera). `null` = el espacio no tiene biblioteca o el
 * hotel no tiene nombre: quien llama la guarda en la opción, como antes.
 */
export async function fotoDeHotelABiblioteca(a: {
  supabase: Cliente
  workspaceId: string | null | undefined
  staffId: string | null | undefined
  role: string | null | undefined
  item: ItemConLectura
  dataUrl: string
  reemplaza?: string | null
  /** El usuario de la sesión, que marcó «Tengo autorización para usar esta foto». */
  userId: string | null | undefined
  /** La casilla y la procedencia que mandó el navegador (`revisarAutorizacion`). */
  autorizacion: unknown
}): Promise<FotoHotelEnBiblioteca | null> {
  if (!a.workspaceId) return null
  const biblioteca = await bibliotecaDelEspacio(a.supabase, a.workspaceId)
  if (!biblioteca) return null
  const o = objetivoDelHotel(a.item)
  if (!o) return null
  if (a.role && ROLES_SIN_ESCRITURA.has(a.role)) return { ok: false, mensaje: 'Tu rol puede ver las fotos pero no cambiarlas.' }
  const permiso = revisarAutorizacion(a.autorizacion)
  if (!permiso.ok) return { ok: false, mensaje: permiso.error }
  if (!a.userId) return { ok: false, mensaje: 'No se pudo saber quién sube la foto. Vuelve a entrar.' }
  const partes = bytesDeDataUrl(a.dataUrl)
  if (!partes || !/^image\/(jpeg|png|webp)$/.test(partes.mime)) return { ok: false, mensaje: 'Ese archivo no es una foto. Usa un JPG o un PNG.' }
  const r = await ponerFotoPropia({
    supabase: a.supabase,
    workspaceId: a.workspaceId,
    staffId: a.staffId ?? null,
    objetivo: o,
    bytes: partes.buffer,
    reemplaza: typeof a.reemplaza === 'string' && a.reemplaza ? a.reemplaza : null,
    autorizacion: { userId: a.userId, procedencia: permiso.procedencia },
  })
  if (!r.ok) return { ok: false, mensaje: r.mensaje }
  return { ok: true, elemento: await elementoDeBiblioteca(a.supabase, a.workspaceId, o, biblioteca.sitioOficial) }
}
