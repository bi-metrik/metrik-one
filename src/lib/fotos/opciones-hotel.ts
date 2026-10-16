import 'server-only'

/**
 * Las opciones del selector de un HOTEL, ya clasificadas por pestaña (Mauricio, 2026-10-16):
 * Fachada · Habitaciones · Zonas comunes. Precisión antes que cantidad:
 *
 *   · Commons: la categoría exacta del hotel y los archivos cuyo título lo nombra
 *     (`candidatasDeHotelEnCommons`). Cada candidata se clasifica con el modelo; lo que «no es un
 *     hotel» (monumentos, parques, calles) se descarta. Una de la categoría cuyo título NO nombra
 *     el hotel solo pasa si el modelo la reconoce como foto de hotel.
 *   · Página oficial (solo con el interruptor del workspace, lo revisa la acción): las imágenes de
 *     la galería, clasificadas igual. Es la fuente real de habitaciones y zonas comunes.
 *
 * Una candidata que el modelo no pudo mirar (sin llave, red caída) queda SIN clasificar
 * (`categoria: null`): el selector la muestra aparte, con aviso, si su título nombra el hotel o
 * viene de la página oficial; si no, no se muestra.
 *
 * Lo que dijo el modelo se recuerda por archivo (en memoria del servidor) para no volver a
 * preguntarlo en la misma instancia; al elegirla, la categoría queda en la fila de la biblioteca.
 * Nada de esto se guarda hasta que la asesora elige. Hoteles nunca automáticos.
 */
import { clasificarFotosDeHotel } from '@/lib/ai/clasificar-fotos-hotel'
import type { CategoriaHotel, Clasificacion } from './categoria'
import { opcionesDeSitioOficial, type Resolver } from './sitio-oficial'
import type { OpcionFoto } from './vista'
import { AGENTE_COMMONS, candidatasDeHotelEnCommons, esDeWikimedia } from './wikimedia'

const TOPE_MEMORIA = 5000
const memoria = new Map<string, Clasificacion>()

function recordar(clave: string, c: Clasificacion): void {
  if (memoria.size >= TOPE_MEMORIA) memoria.delete(memoria.keys().next().value as string)
  memoria.set(clave, c)
}

/** Solo para las pruebas. */
export function olvidarClasificaciones(): void {
  memoria.clear()
}

interface ParaClasificar {
  clave: string
  /** Los bytes de la miniatura; `null` = no se pudo bajar. */
  leer: () => Promise<{ bytes: Buffer; mime: string } | null>
}

/** Clasifica lo que no está en memoria. Devuelve la clasificación (o `null`) en el mismo orden. */
export async function clasificar(
  items: ParaClasificar[],
  a: { apiKey: string | undefined; hotel: string; ciudad: string | null; fetch?: typeof fetch },
): Promise<(Clasificacion | null)[]> {
  const salida: (Clasificacion | null)[] = items.map((x) => memoria.get(x.clave) ?? null)
  const faltan = items.map((x, i) => ({ x, i })).filter(({ i }) => salida[i] === null)
  if (faltan.length === 0 || !a.apiKey) return salida
  const leidas = await Promise.all(faltan.map(({ x }) => x.leer().catch(() => null)))
  const conBytes = faltan.map((f, k) => ({ ...f, foto: leidas[k] })).filter((f): f is typeof f & { foto: { bytes: Buffer; mime: string } } => !!f.foto)
  const r = await clasificarFotosDeHotel(conBytes.map((f) => f.foto), { apiKey: a.apiKey, hotel: a.hotel, ciudad: a.ciudad, fetch: a.fetch })
  conBytes.forEach((f, k) => {
    const c = r[k]
    if (c) {
      salida[f.i] = c
      recordar(f.x.clave, c)
    }
  })
  return salida
}

/** Una opción del selector con su pestaña (`null` = sin clasificar). */
export type OpcionHotel = OpcionFoto & { categoria: CategoriaHotel | null }

/**
 * Qué queda de una candidata según lo que dijo el modelo. PURO.
 *  · «no es un hotel» → fuera;
 *  · sin clasificar → solo si es seguro que es del hotel (`segura`), en «sin clasificar»;
 *  · si no, su pestaña.
 */
export function destinoDeCandidata(c: Clasificacion | null, segura: boolean): CategoriaHotel | null | 'fuera' {
  if (c === 'no_es_hotel') return 'fuera'
  if (c === null) return segura ? null : 'fuera'
  return c
}

async function bajarMiniatura(url: string, f: typeof fetch): Promise<{ bytes: Buffer; mime: string } | null> {
  if (!esDeWikimedia(url)) return null
  const r = await f(url, { headers: { 'User-Agent': AGENTE_COMMONS }, signal: AbortSignal.timeout(8000) })
  if (!r.ok) return null
  const mime = (r.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim()
  const bytes = Buffer.from(await r.arrayBuffer())
  return bytes.length > 0 && bytes.length < 4_000_000 ? { bytes, mime } : null
}

/** Las opciones de Commons para un hotel, clasificadas. Nunca lanza. */
export async function opcionesDeHotelEnCommons(
  o: { nombre: string; ciudad: string | null },
  a: { apiKey: string | undefined; categoriaWikidata?: string | null; fetch?: typeof fetch },
): Promise<{ opciones: OpcionHotel[]; categoriaCommons: string | null; clasificadas: boolean }> {
  const f = a.fetch ?? fetch
  const { candidatas, categoria } = await candidatasDeHotelEnCommons(o, { fetch: f, categoriaWikidata: a.categoriaWikidata })
  const clases = await clasificar(
    candidatas.map((c) => ({ clave: `commons:${c.titulo}`, leer: () => bajarMiniatura(c.descarga, f) })),
    { apiKey: a.apiKey, hotel: o.nombre, ciudad: o.ciudad, fetch: f },
  )
  const opciones: OpcionHotel[] = []
  candidatas.forEach((c, i) => {
    const destino = destinoDeCandidata(clases[i], c.nombraElHotel)
    if (destino === 'fuera') return
    opciones.push({
      id: c.titulo,
      fuente: 'wikimedia',
      miniatura: c.descarga,
      ancho: c.ancho,
      alto: c.alto,
      titulo: c.titulo,
      credito: `${c.autor} · ${c.licencia}`,
      pagina: c.pagina,
      categoria: destino,
    })
  })
  return { opciones, categoriaCommons: categoria, clasificadas: clases.some((c) => c !== null) }
}

/** Las opciones de la página oficial de un hotel (una tanda), clasificadas. */
export async function opcionesDeHotelEnSitio(
  paginaUrl: string,
  o: { nombre: string; ciudad: string | null },
  a: { apiKey: string | undefined; desde?: number; red?: { fetch?: typeof fetch; resolver?: Resolver }; fetchModelo?: typeof fetch },
): Promise<{ ok: true; pagina: string; opciones: OpcionHotel[]; siguiente: number | null } | { ok: false; error: string }> {
  const r = await opcionesDeSitioOficial(paginaUrl, { ...a.red, desde: a.desde })
  if (!r.ok) return r
  const clases = await clasificar(
    r.candidatas.map((c) => ({
      clave: `sitio:${c.imagen}`,
      leer: async () => {
        const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(c.miniatura)
        return m ? { mime: m[1], bytes: Buffer.from(m[2], 'base64') } : null
      },
    })),
    { apiKey: a.apiKey, hotel: o.nombre, ciudad: o.ciudad, fetch: a.fetchModelo },
  )
  const opciones: OpcionHotel[] = []
  r.candidatas.forEach((c, i) => {
    // La página oficial ES del hotel: sin clasificar, igual se ofrece (aparte, con aviso).
    const destino = destinoDeCandidata(clases[i], true)
    if (destino === 'fuera') return
    opciones.push({
      id: c.imagen,
      fuente: 'sitio_oficial',
      miniatura: c.miniatura,
      ancho: c.ancho,
      alto: c.alto,
      titulo: c.imagen,
      credito: (() => {
        try {
          return new URL(c.pagina).hostname.replace(/^www\./, '')
        } catch {
          return null
        }
      })(),
      pagina: c.pagina,
      imagen: c.imagen,
      categoria: destino,
    })
  })
  return { ok: true, pagina: r.pagina, opciones, siguiente: r.siguiente }
}
