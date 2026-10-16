import 'server-only'

/**
 * La foto que llega por `ponerFotoDelHotel` (la acción vieja de la opción de hotel) en un espacio
 * con biblioteca va al PERFIL del hotel (`fotos_catalogo`, por la llave del perfil, resolviendo el
 * alias), no a la opción: es la misma que ven la tarjeta, «Hoteles y tours» y el documento. La
 * tarjeta nueva sube directo al perfil (`subirFotoABiblioteca`); esta vía queda para el caso en que
 * la tarjeta todavía no sabía que el espacio tiene biblioteca.
 *
 * Solo en los espacios con propuesta de viaje (`tienePropuestaHtml`). En los demás devuelve `null`
 * y la foto se guarda en la opción, como antes.
 */
import { hotelesDeItems, type ItemConLectura } from '@/lib/cotizaciones/detalle-viaje'
import { bytesDeDataUrl } from '@/lib/cotizaciones/imagen-captura'
import { tienePropuestaHtml } from '@/lib/pdf/motor-html'
import { revisarAutorizacion } from './autorizacion'
import { elementosDe, ponerFotoPropia, TABLA_CATALOGO, COLUMNAS, type FilaCatalogo } from './catalogo'
import { enlacesDeCatalogo } from './catalogo-almacen'
import { objetivo, type ObjetivoFoto } from './clave'
import { leerConocidos, resolverPedidos } from './perfiles-db'
import { vistaDeElemento, type ElementoVista } from './vista'

const ROLES_SIN_ESCRITURA = new Set(['read_only', 'contador'])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

/** ¿El espacio tiene biblioteca de fotos? */
async function tieneBiblioteca(supabase: Cliente, workspaceId: string): Promise<boolean> {
  const { data } = await supabase.from('workspaces').select('cotizacion_template_slug').eq('id', workspaceId).maybeSingle()
  return tienePropuestaHtml((data as { cotizacion_template_slug?: string | null } | null)?.cotizacion_template_slug)
}

/** El hotel de la opción como lo nombra la cotización (la llave la calcula el servidor). */
function objetivoDelHotel(item: ItemConLectura): ObjetivoFoto | null {
  const h = hotelesDeItems([item])[0]
  return h ? objetivo('hotel', h.hotel ?? h.linea, h.ciudad) : null
}

/** El perfil como está, para la tarjeta (`null` = sin fotos). */
async function elementoDeBiblioteca(supabase: Cliente, workspaceId: string, o: Pick<ObjetivoFoto, 'tipo' | 'clave'>): Promise<ElementoVista | null> {
  const { data, error } = await supabase.from(TABLA_CATALOGO).select(COLUMNAS).eq('workspace_id', workspaceId).eq('tipo', o.tipo).eq('clave', o.clave)
  if (error) return null
  const filas = (data ?? []) as FilaCatalogo[]
  const urls = await enlacesDeCatalogo(workspaceId, filas.map((f) => f.ref))
  const [e] = elementosDe(filas).map((x) => vistaDeElemento(x, urls))
  return e ?? null
}

export type FotoHotelEnBiblioteca = { ok: true; elemento: ElementoVista | null } | { ok: false; mensaje: string }

/**
 * Guarda la foto en el perfil del hotel: `reemplaza` = la foto que se cambia; sin él, se agrega
 * (hasta 3). `null` = el espacio no tiene biblioteca o el hotel no tiene nombre: quien llama la
 * guarda en la opción, como antes.
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
  if (!a.workspaceId || !(await tieneBiblioteca(a.supabase, a.workspaceId))) return null
  const o = objetivoDelHotel(a.item)
  if (!o) return null
  if (a.role && ROLES_SIN_ESCRITURA.has(a.role)) return { ok: false, mensaje: 'Tu rol puede ver las fotos pero no cambiarlas.' }
  const permiso = revisarAutorizacion(a.autorizacion)
  if (!permiso.ok) return { ok: false, mensaje: permiso.error }
  if (!a.userId) return { ok: false, mensaje: 'No se pudo saber quién sube la foto. Vuelve a entrar.' }
  const partes = bytesDeDataUrl(a.dataUrl)
  if (!partes || !/^image\/(jpeg|png|webp)$/.test(partes.mime)) return { ok: false, mensaje: 'Ese archivo no es una foto. Usa un JPG o un PNG.' }
  const leidos = await leerConocidos(a.supabase, a.workspaceId)
  if (!leidos.ok) return { ok: false, mensaje: leidos.mensaje }
  const [r] = await resolverPedidos(a.supabase, a.workspaceId, a.staffId ?? null, [o], leidos.conocidos, { escribir: true })
  if (!r?.perfil) return { ok: false, mensaje: `Primero dinos si es el mismo hotel que «${r?.duda?.nombre ?? ''}».` }
  const g = await ponerFotoPropia({
    supabase: a.supabase,
    workspaceId: a.workspaceId,
    staffId: a.staffId ?? null,
    objetivo: r.perfil,
    bytes: partes.buffer,
    reemplaza: typeof a.reemplaza === 'string' && a.reemplaza ? a.reemplaza : null,
    autorizacion: { userId: a.userId, procedencia: permiso.procedencia },
  })
  if (!g.ok) return { ok: false, mensaje: g.mensaje }
  return { ok: true, elemento: await elementoDeBiblioteca(a.supabase, a.workspaceId, r.perfil) }
}
