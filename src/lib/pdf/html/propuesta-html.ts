/**
 * El motor `html` de la propuesta de viaje: del modelo al PDF con Chromium (PR 2 del plan del
 * 2026-10-14). Lo usa `generateCotizacionPDF` cuando el workspace lo tiene encendido
 * (`usaMotorHtml`); si algo aquí falla, la acción imprime el PDF de @react-pdf de siempre.
 *
 * Plantilla: el formato de Edgar del 2026-10-14 (carta, Inter + Poppins), ver `trappvel/plantilla.ts`.
 *
 * Pasos:
 *  1. el modelo (`modeloDePropuesta`), con las mismas cifras que el PDF de hoy;
 *  2. las fotos: cada una se baja a lo que el documento necesita con `sharp` (JPEG, ancho
 *     tope por uso) y viaja dentro del HTML como data URL. El prototipo pesaba 8,4 MB por
 *     fotos de 1280 px; la meta es que el PDF pase por WhatsApp;
 *  3. el HTML (`htmlDePropuesta`, puro) con Inter y Poppins embebidas;
 *  4. Chromium, sin red, con la franja de arriba y la banda del pie en cada hoja.
 */
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { modeloDePropuesta, type EntradaModeloPropuesta, type ModeloPropuesta } from '@/lib/cotizaciones/propuesta/modelo-documento'
import type { FotoPDF } from '@/lib/pdf/cotizacion-props'
import { fotoImprimible, type OrigenFoto } from '@/lib/fotos/clave'
import { fuentesDelDocumento } from '@/lib/pdf/chromium/fuentes'
import { cssDeFuentes, inyectarEstilo } from '@/lib/pdf/chromium/recursos'
import { imprimirHtmlAPdf, type MedidasRender } from '@/lib/pdf/chromium/render-chromium'
import { avisosDeFotosDeHoteles, COLUMNAS_HOTELES, COLUMNAS_OPCIONALES, encabezadoDeHoja, extrasQueCaben, htmlDePropuesta, pieDeHoja, type FotoResuelta, type RecursosPropuesta } from './trappvel/plantilla'

/** Ancho tope por uso, en px (a ~150 ppp sobre el ancho impreso). */
export const ANCHO_FOTO = { portada: 1400, tarjeta: 700, extra: 400, logo: 600 } as const

async function bytesDe(src: string, timeoutMs: number): Promise<Buffer | null> {
  try {
    if (src.startsWith('data:')) {
      const coma = src.indexOf(',')
      if (coma < 0) return null
      const meta = src.slice(5, coma)
      const datos = src.slice(coma + 1)
      return meta.includes(';base64') ? Buffer.from(datos, 'base64') : Buffer.from(decodeURIComponent(datos), 'utf8')
    }
    if (src.startsWith('https://') || src.startsWith('http://')) {
      const r = await fetch(src, { signal: AbortSignal.timeout(timeoutMs) })
      if (!r.ok) return null
      return Buffer.from(await r.arrayBuffer())
    }
    if (src.startsWith('/')) return await readFile(src)
    return null
  } catch {
    return null
  }
}

/**
 * Una foto, reducida a `ancho` px como JPEG, en data URL. `null` si no se puede leer o no es
 * una imagen: el documento sale sin esa foto, nunca con un hueco roto.
 */
export async function reducirFoto(src: string | null | undefined, ancho: number, calidad = 72, timeoutMs = 6000): Promise<string | null> {
  return (await reducirFotoConProporcion(src, ancho, calidad, timeoutMs))?.src ?? null
}

/**
 * Lo mismo que `reducirFoto`, con el ancho entre el alto de la foto ya girada: la plantilla lo usa
 * para no imprimir collages ni verticales y para escoger cómo van las fotos de cada ficha de hotel
 * (regla de fotos del 2026-10-29). Medida aquí, sirve también para las fotos sin `proporcion` en la
 * base y para la foto propia de una opción.
 */
export async function reducirFotoConProporcion(
  src: string | null | undefined,
  ancho: number,
  calidad = 72,
  timeoutMs = 6000,
): Promise<{ src: string; proporcion: number | null } | null> {
  if (!src) return null
  const datos = await bytesDe(src, timeoutMs)
  if (!datos) return null
  try {
    const { data, info } = await sharp(datos)
      .rotate()
      .resize({ width: ancho, withoutEnlargement: true })
      .jpeg({ quality: calidad, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })
    const proporcion = info.width > 0 && info.height > 0 ? info.width / info.height : null
    return { src: `data:image/jpeg;base64,${data.toString('base64')}`, proporcion }
  } catch {
    return null
  }
}

/** El logo: PNG con transparencia, a `ancho` px. */
export async function reducirLogo(src: string | null | undefined, ancho: number = ANCHO_FOTO.logo): Promise<string | null> {
  if (!src) return null
  const datos = await bytesDe(src, 6000)
  if (!datos) return null
  try {
    const salida = await sharp(datos).resize({ width: ancho, withoutEnlargement: true }).png().toBuffer()
    return `data:image/png;base64,${salida.toString('base64')}`
  } catch {
    return null
  }
}

/** Una foto del catálogo del workspace (`fotos_catalogo`), ya leída. */
export interface FotoDeCatalogo {
  /** data URL (o ruta en disco); `prepararPropuestaHtml` la reduce como las demás. */
  src: string
  /** De dónde salió: un hotel solo se imprime con la que eligió una persona (`fotoImprimible`). */
  origen: OrigenFoto
  /** Una persona la eligió o la confirmó. */
  revisada?: boolean
  /**
   * Hasta dos fotos más del mismo elemento (biblioteca, 2026-10-16). Salen en el MISMO recuadro de
   * la principal (mosaico), solo en hoteles y planes, y solo si caben (`extrasQueCaben`): nunca
   * agregan altura, ni hojas, ni huecos.
   */
  extras?: FotoDeCatalogo[]
  /** La línea de crédito («Park Güell, Autora (Wikimedia Commons, CC BY-SA 3.0)»); `null` = propia. */
  credito: string | null
  foco?: { x: number; y: number } | null
  /** Ancho entre alto guardado en la biblioteca (`null` = sin dato: se mide al reducirla). */
  proporcion?: number | null
  /** Hotel: qué muestra (fachada, habitación, zonas comunes, otra). Ordena las fotos de la ficha. */
  categoria?: string | null
}

/** Lo que el documento le pide al catálogo. Cada uno `null` = no hay foto. */
export interface CatalogoPropuesta {
  ciudad: (ciudad: string) => FotoDeCatalogo | null
  hotel: (hotel: string, ciudad: string | null) => FotoDeCatalogo | null
  actividad: (nombre: string) => FotoDeCatalogo | null
}

const claveHotel = (ciudad: string | null, hotel: string) => `${ciudad ?? ''}|${hotel}`

export interface OpcionesPropuestaHtml {
  /** Nombre del workspace: va escrito si no hay logo. */
  marca: string
  logoUrl: string | null
  /** El banco de fotos de ciudad (`fotosDeCiudad` → FotoPDF). Sin él, la portada y los días van sin fotos de ciudad. */
  fotoDeCiudad?: (ciudad: string) => FotoPDF[]
  /**
   * El catálogo de fotos del workspace (PR 4). Manda sobre el banco en las ciudades (alguien la
   * eligió), llena el hotel sin foto propia y pone foto a los planes opcionales. Sin él, como antes.
   */
  catalogo?: CatalogoPropuesta | null
  timeoutMs?: number
}

export interface ResultadoPropuestaHtml {
  pdf: Buffer
  modelo: ModeloPropuesta
  html: string
  medidas: MedidasRender
  /** Los hoteles cuya ficha sale con menos de 3 fotos (aviso de «Revisar y enviar», no bloquea). */
  avisosFotos: AvisoFotosDeHotel[]
}

export type AvisoFotosDeHotel = ReturnType<typeof avisosDeFotosDeHoteles>[number]

/** Arma el HTML listo para imprimir (con fotos y fuentes dentro) y su pie. Sin Chromium. */
export async function prepararPropuestaHtml(
  entrada: EntradaModeloPropuesta,
  opts: OpcionesPropuestaHtml,
): Promise<{ html: string; pie: string; encabezado: string; modelo: ModeloPropuesta; avisosFotos: AvisoFotosDeHotel[] }> {
  const modelo = modeloDePropuesta(entrada)
  const catalogo = opts.catalogo ?? null
  const comoFotoPDF = (f: FotoDeCatalogo, rotulo: string | null): FotoPDF => ({
    url: f.src,
    rotulo,
    credito: f.credito,
    ...(f.foco ? { foco: { x: f.foco.x, y: f.foco.y } } : {}),
  })

  // Sin foto de portada en el banco (Barcelona, Ámsterdam), la del catálogo de la primera parada que la tenga.
  if (!modelo.portada.foto && catalogo) {
    for (const p of modelo.ruta.paradas) {
      const f = catalogo.ciudad(p.ciudad)
      if (f) {
        modelo.portada.foto = comoFotoPDF(f, p.ciudad.toUpperCase())
        modelo.formal.creditos = [...new Set([...modelo.formal.creditos, ...(f.credito ? [f.credito] : [])])]
        break
      }
    }
  }

  // Fotos de ciudad por parada: la del catálogo (alguien la eligió) o la del banco. La de la
  // portada no se repite en su tarjeta.
  const portadaUrl = modelo.portada.foto?.url ?? null
  const deCiudad = new Map<string, FotoPDF>()
  for (const p of modelo.ruta.paradas) {
    const delCatalogo = catalogo?.ciudad(p.ciudad) ?? null
    if (delCatalogo && delCatalogo.src !== portadaUrl) {
      deCiudad.set(p.ciudad, comoFotoPDF(delCatalogo, null))
      continue
    }
    const fotos = opts.fotoDeCiudad?.(p.ciudad) ?? []
    const elegida = fotos.find((f) => f.url !== portadaUrl) ?? fotos[0]
    if (elegida) deCiudad.set(p.ciudad, elegida)
  }

  // El hotel sin foto propia en esta cotización: la que una persona eligió para ese hotel en la
  // biblioteca. Una automática NUNCA (`fotoImprimible`): sin elegida, el degradado. El catálogo ya
  // filtró lo que no se imprime; aquí se repite la regla del hotel.
  // Las extras solo acompañan a la principal de la biblioteca (con la foto propia de la opción no:
  // podrían ser la misma).
  const imprimibleHotel = (f: FotoDeCatalogo) => fotoImprimible('hotel', f.origen, f.revisada)
  const creditosCatalogo: string[] = []
  const extrasHotel = new Map<string, { src: string; extras: FotoDeCatalogo[] }>()
  if (catalogo) {
    for (const c of modelo.hoteles) {
      const caben = extrasQueCaben('hotel', COLUMNAS_HOTELES)
      for (const o of c.opciones) {
        if (o.foto) continue
        const f = catalogo.hotel(o.hotel, c.ciudad)
        if (!f || !imprimibleHotel(f)) continue
        o.foto = { url: f.src, proporcion: null }
        if (f.credito) creditosCatalogo.push(f.credito)
        const extras = (f.extras ?? []).filter(imprimibleHotel).slice(0, caben)
        if (extras.length > 0) extrasHotel.set(claveHotel(c.ciudad, o.hotel), { src: f.src, extras })
      }
    }
  }
  // Los planes opcionales, por su nombre.
  const deOpcional = new Map<string, FotoDeCatalogo>()
  const cabenEnPlan = extrasQueCaben('opcional', COLUMNAS_OPCIONALES)
  if (catalogo) {
    for (const o of modelo.opcionales) {
      const f = catalogo.actividad(o.nombre)
      if (f) deOpcional.set(o.nombre, { ...f, extras: (f.extras ?? []).slice(0, cabenEnPlan) })
    }
  }

  // Las actividades incluidas, por su nombre corto: su foto va al lado de su día en el itinerario.
  const deActividad = new Map<string, FotoDeCatalogo>()
  if (catalogo) {
    for (const d of modelo.dias) {
      for (const e of d.eventos) {
        if (e.tipo !== 'actividad') continue
        const nombre = e.texto.split(' · ')[0].trim()
        if (deActividad.has(nombre)) continue
        const f = catalogo.actividad(nombre)
        if (f) deActividad.set(nombre, f)
      }
    }
  }

  const pedidos = new Map<string, number>()
  const pedir = (url: string | null | undefined, ancho: number) => {
    if (!url) return
    pedidos.set(url, Math.max(pedidos.get(url) ?? 0, ancho))
  }
  pedir(portadaUrl, ANCHO_FOTO.portada)
  for (const f of deCiudad.values()) pedir(f.url, ANCHO_FOTO.tarjeta)
  for (const c of modelo.hoteles) for (const o of c.opciones) pedir(o.foto?.url, ANCHO_FOTO.tarjeta)
  for (const f of deOpcional.values()) pedir(f.src, ANCHO_FOTO.tarjeta)
  for (const f of deActividad.values()) pedir(f.src, ANCHO_FOTO.tarjeta)
  for (const h of extrasHotel.values()) for (const f of h.extras) pedir(f.src, ANCHO_FOTO.extra)
  for (const f of deOpcional.values()) for (const x of f.extras ?? []) pedir(x.src, ANCHO_FOTO.extra)

  const [resueltas, logo] = await Promise.all([
    Promise.all([...pedidos].map(async ([url, ancho]) => [url, await reducirFotoConProporcion(url, ancho)] as const)),
    reducirLogo(opts.logoUrl),
  ])
  const conMedida = resueltas.filter((x): x is readonly [string, { src: string; proporcion: number | null }] => x[1] !== null)
  const porUrl = new Map(conMedida.map(([url, f]) => [url, f.src] as const))
  const proporcionDe = new Map(conMedida.map(([url, f]) => [url, f.proporcion] as const))
  const focoDe = new Map<string, FotoPDF['foco']>()
  if (modelo.portada.foto) focoDe.set(modelo.portada.foto.url, modelo.portada.foto.foco)
  for (const f of deCiudad.values()) focoDe.set(f.url, f.foco)
  for (const f of deOpcional.values()) if (f.foco) focoDe.set(f.src, f.foco)
  for (const f of deActividad.values()) if (f.foco) focoDe.set(f.src, f.foco)
  for (const lista of [...[...extrasHotel.values()].map((h) => h.extras), ...[...deOpcional.values()].map((f) => f.extras ?? [])]) {
    for (const f of lista) if (f.foco) focoDe.set(f.src, f.foco)
  }
  const resolver = (url: string | null | undefined): FotoResuelta | null => {
    if (!url) return null
    const src = porUrl.get(url)
    return src ? { src, foco: focoDe.get(url) ?? null, proporcion: proporcionDe.get(url) ?? null } : null
  }

  // Las extras solo salen junto a su principal: sin ella, ni foto ni crédito.
  const conArchivo = (lista: FotoDeCatalogo[] | undefined) => (lista ?? []).filter((f) => porUrl.has(f.src))
  const extrasDeHotelResueltas = (h: { src: string; extras: FotoDeCatalogo[] } | undefined) => (h && porUrl.has(h.src) ? conArchivo(h.extras) : [])
  const creditosExtra = [
    ...[...deCiudad.values()].filter((f) => porUrl.has(f.url)).map((f) => f.credito),
    ...creditosCatalogo,
    ...[...extrasHotel.values()].flatMap(extrasDeHotelResueltas).map((f) => f.credito),
    ...[...deOpcional.values()].filter((f) => porUrl.has(f.src)).flatMap((f) => [f.credito, ...conArchivo(f.extras).map((x) => x.credito)]),
    ...[...deActividad.values()].filter((f) => porUrl.has(f.src)).map((f) => f.credito),
  ].filter((c): c is string => !!c)

  const recursos: RecursosPropuesta = {
    foto: resolver,
    fotoDeCiudad: (ciudad) => (ciudad ? resolver(deCiudad.get(ciudad)?.url) : null),
    fotoDeOpcional: (nombre) => resolver(deOpcional.get(nombre)?.src),
    fotoDeActividad: (nombre) => resolver(deActividad.get(nombre)?.src),
    extrasDeHotel: (ciudad, hotel) => extrasDeHotelResueltas(extrasHotel.get(claveHotel(ciudad, hotel))).map((f) => resolver(f.src)!),
    extrasDeOpcional: (nombre) => conArchivo(deOpcional.get(nombre)?.extras).map((f) => resolver(f.src)!),
    logo,
    marca: opts.marca,
    creditosExtra,
  }
  const crudo = htmlDePropuesta(modelo, recursos)
  const fuentes = fuentesDelDocumento()
  const inter = fuentes.find((f) => f.familia === 'Inter' && f.peso === 400 && f.estilo === 'normal')
  return {
    html: inyectarEstilo(crudo, cssDeFuentes(fuentes)),
    pie: pieDeHoja({
      texto: modelo.formal.pie,
      codigo: modelo.portada.consecutivo,
      cssFuente: inter ? cssDeFuentes([inter]) : null,
    }),
    encabezado: encabezadoDeHoja(),
    modelo,
    avisosFotos: avisosDeFotosDeHoteles(modelo, recursos),
  }
}

export async function pdfDePropuestaHtml(entrada: EntradaModeloPropuesta, opts: OpcionesPropuestaHtml): Promise<ResultadoPropuestaHtml> {
  const { html, pie, encabezado, modelo, avisosFotos } = await prepararPropuestaHtml(entrada, opts)
  const { pdf, medidas } = await imprimirHtmlAPdf(html, { pie, encabezado, timeoutMs: opts.timeoutMs ?? 40_000 })
  return { pdf, modelo, html, medidas, avisosFotos }
}
