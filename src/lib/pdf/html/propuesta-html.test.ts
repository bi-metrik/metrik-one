/**
 * El motor `html` de punta a punta, con el COT-2026-0026 de muestra (`test/propuesta-europa.ts`).
 *
 * - Sin Chromium (siempre): las fotos salen reducidas con sharp, dentro del HTML, y el HTML no
 *   pide nada a la red.
 * - Con Chromium (solo con `PROPUESTA_PDF_SALIDA=<ruta.pdf>` y `CHROMIUM_EJECUTABLE`): imprime
 *   el PDF, lo deja en esa ruta y revisa su texto. En CI no corre: no hay navegador.
 */
import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ENTRADA_EUROPA, PRECIO_E, PRECIO_P, PRECIO_R } from '../../../../test/propuesta-europa'
import { fotosDeCiudad } from '@/lib/pdf/fotos-ciudad'
import { fotosDelViaje } from '@/lib/pdf/fotos-del-viaje'
import { textoDelPdf } from '@/lib/ai/texto-pdf'
import { pdfDePropuestaHtml, prepararPropuestaHtml, reducirFoto } from './propuesta-html'
import { pesos } from './trappvel/plantilla'
import { CATALOGO_EUROPA, CREDITO_HOTEL_DE_COMMONS, sinFotosDeHotel } from '../../../../test/catalogo-europa'

const bancoComoFotoPDF = (ciudad: string) =>
  fotosDeCiudad(ciudad).map((f) => ({ url: f.ruta, rotulo: f.rotulo, credito: f.credito, foco: f.foco, proporcion: f.proporcion }))

/** Como la acción: la portada sale del banco de ciudades. */
function entradaComoLaAccion() {
  const v = ENTRADA_EUROPA.props.viaje!
  const fotos = fotosDelViaje({ destino: v.destino, vuelos: v.vuelos, hoteles: v.hoteles }, fotosDeCiudad)
  return {
    ...ENTRADA_EUROPA,
    props: { ...ENTRADA_EUROPA.props, viaje: { ...v, foto: fotos.portada, fotosCiudades: fotos.ciudades } },
  }
}

describe('reducirFoto', () => {
  it('baja una foto de disco a JPEG del ancho pedido, como data URL', async () => {
    const url = await reducirFoto(`${process.cwd()}/src/lib/pdf/templates/fotos-ciudad/madrid-1.jpg`, 300)
    expect(url).toMatch(/^data:image\/jpeg;base64,/)
    expect(Buffer.from(url!.split(',')[1], 'base64').byteLength).toBeLessThan(60_000)
  })

  it('lo que no se puede leer es null, no un error', async () => {
    expect(await reducirFoto('/no/existe.jpg', 300)).toBeNull()
    expect(await reducirFoto('data:image/jpeg;base64,AAAA', 300)).toBeNull()
    expect(await reducirFoto('ftp://x/y.jpg', 300)).toBeNull()
    expect(await reducirFoto(null, 300)).toBeNull()
  })
})

describe('prepararPropuestaHtml', () => {
  it('lleva las fotos y las fuentes dentro, y nada que pida red', { timeout: 30_000 }, async () => {
    const { html, pie, encabezado, modelo } = await prepararPropuestaHtml(entradaComoLaAccion(), {
      marca: 'Agencia de ejemplo',
      logoUrl: null,
      fotoDeCiudad: bancoComoFotoPDF,
    })
    // Sin URLs externas ni rutas de disco: todo es data URL.
    expect(html).not.toMatch(/url\((?!data:)/)
    expect(html).not.toMatch(/src="(?!data:)/)
    // 12 hoteles con foto + portada + ciudades del banco (Madrid y París).
    expect((html.match(/data:image\/jpeg;base64/g) ?? []).length).toBeGreaterThanOrEqual(13)
    expect(html).toContain("font-family:'Montserrat'")
    // Meta de peso: el prototipo pesaba 8,4 MB por fotos de 1280 px.
    expect(Buffer.byteLength(html)).toBeLessThan(3_000_000)
    expect(pie).toContain('COT-2026-0026')
    expect(pie).toContain('pageNumber')
    expect(encabezado).toContain('linear-gradient')
    expect(modelo.tarifas.map((t) => t.precio)).toEqual([PRECIO_E, PRECIO_R, PRECIO_P])
  })
})

describe('prepararPropuestaHtml con el catálogo de fotos (PR 4)', () => {
  /** El HTML de una sección, por su título. */
  const seccion = (html: string, titulo: string) => {
    const i = html.indexOf(`>${titulo}<`)
    return html.slice(i, html.indexOf('</section>', i))
  }

  it('foto en cada plan opcional, ciudades sin banco con foto, y su crédito al pie', { timeout: 30_000 }, async () => {
    const { html } = await prepararPropuestaHtml(entradaComoLaAccion(), {
      marca: 'Agencia de ejemplo',
      logoUrl: null,
      fotoDeCiudad: bancoComoFotoPDF,
      catalogo: CATALOGO_EUROPA,
    })
    const planes = seccion(html, 'Planes para los días libres')
    expect((planes.match(/<div class="img" style="background-image:url\(data:image\/jpeg/g) ?? []).length).toBe(8)
    expect(planes).not.toContain('sinfoto')
    // «Lo que van a vivir»: Barcelona y Ámsterdam ya no van con el degradado.
    const vivir = seccion(html, 'Lo que van a vivir')
    expect(vivir).not.toContain('sinfoto')
    // Los créditos de Commons, como el prototipo.
    expect(html).toContain('Park Güell, Isiwal (Wikimedia Commons, CC BY-SA 3.0)')
    expect(html).toContain('Casa Batlló, Txllxt TxllxT (Wikimedia Commons, CC BY-SA 4.0)')
    expect(Buffer.byteLength(html)).toBeLessThan(3_000_000)
  })

  it('sin catálogo, los planes van sin imagen y las ciudades sin banco con el degradado (como antes)', { timeout: 30_000 }, async () => {
    const { html } = await prepararPropuestaHtml(entradaComoLaAccion(), { marca: 'A', logoUrl: null, fotoDeCiudad: bancoComoFotoPDF })
    expect(seccion(html, 'Planes para los días libres')).not.toContain('class="img')
    expect(seccion(html, 'Lo que van a vivir')).toContain('sinfoto')
  })

  it('con foto en algunos planes, los demás llevan el degradado; el hotel sin foto en la opción toma la que subió la asesora', { timeout: 30_000 }, async () => {
    const e = entradaComoLaAccion()
    const v = e.props.viaje!
    const sinFoto = { ...e, props: { ...e.props, viaje: { ...v, hoteles: v.hoteles.map((h, i) => (i === 0 ? { ...h, foto: undefined } : h)) } } }
    const hotel0 = v.hoteles[0]
    const { html, modelo } = await prepararPropuestaHtml(sinFoto, {
      marca: 'A',
      logoUrl: null,
      fotoDeCiudad: bancoComoFotoPDF,
      catalogo: {
        ciudad: () => null,
        hotel: (nombre, ciudad) => (nombre === hotel0.hotel && ciudad === 'Madrid' ? { src: hotel0.foto!.url, origen: 'asesora', credito: null } : null),
        actividad: (nombre) => (nombre === 'Palacio Real de Madrid' ? CATALOGO_EUROPA.actividad(nombre) : null),
      },
    })
    const planes = seccion(html, 'Planes para los días libres')
    expect((planes.match(/class="img sinfoto"/g) ?? []).length).toBe(7)
    expect(modelo.hoteles[0].opciones.find((o) => o.hotel === hotel0.hotel)!.foto?.url).toBe(hotel0.foto!.url)
  })

  it('un hotel NUNCA sale con una foto de Commons del catálogo: va con el degradado y sin su crédito', { timeout: 30_000 }, async () => {
    const e = sinFotosDeHotel(entradaComoLaAccion())
    const commons = { src: `${process.cwd()}/src/lib/pdf/chromium/ensayo/fotos/catalonia.jpg`, origen: 'wikimedia' as const, credito: 'Hotel, Autora (Wikimedia Commons, CC BY 4.0)' }
    const { html, modelo } = await prepararPropuestaHtml(e, {
      marca: 'A',
      logoUrl: null,
      fotoDeCiudad: bancoComoFotoPDF,
      catalogo: { ciudad: () => null, hotel: () => commons, actividad: () => null },
    })
    expect(modelo.hoteles.flatMap((c) => c.opciones).every((o) => !o.foto)).toBe(true)
    expect(html).not.toContain('Hotel, Autora (Wikimedia Commons, CC BY 4.0)')
    // Ningún hotel con foto: las tarjetas van sin imagen, como antes.
    expect(seccion(html, 'Dónde duermen')).not.toContain('class="img')
  })

  it('la muestra: solo los 3 hoteles con foto subida la llevan; los demás, el degradado', { timeout: 30_000 }, async () => {
    const { html, modelo } = await prepararPropuestaHtml(sinFotosDeHotel(entradaComoLaAccion()), {
      marca: 'A',
      logoUrl: null,
      fotoDeCiudad: bancoComoFotoPDF,
      catalogo: CATALOGO_EUROPA,
    })
    const conFoto = modelo.hoteles.flatMap((c) => c.opciones).filter((o) => o.foto).map((o) => o.hotel)
    expect(conFoto).toEqual(['Catalonia Puerta del Sol', 'H10 Metropolitan', 'Pullman Paris Tour Eiffel'])
    const hoteles = seccion(html, 'Dónde duermen')
    expect((hoteles.match(/class="img" style="background-image:url\(data:image\/jpeg/g) ?? []).length).toBe(3)
    expect((hoteles.match(/class="img sinfoto"/g) ?? []).length).toBe(9)
    // Le Meurice tiene en el catálogo una de Commons: ni la foto ni su crédito.
    expect(html).not.toContain(CREDITO_HOTEL_DE_COMMONS)
  })
})

const SALIDA = process.env.PROPUESTA_PDF_SALIDA

describe.skipIf(!SALIDA)('pdfDePropuestaHtml (con Chromium local)', () => {
  it('imprime el COT-2026-0026 de muestra', { timeout: 120_000 }, async () => {
    // Como en producción tras la regla de hoteles: la asesora subió foto solo para 3.
    const { pdf, medidas } = await pdfDePropuestaHtml(sinFotosDeHotel(entradaComoLaAccion()), {
      marca: 'Agencia de ejemplo',
      logoUrl: process.env.PROPUESTA_LOGO ?? null,
      fotoDeCiudad: bancoComoFotoPDF,
      catalogo: CATALOGO_EUROPA,
    })
    writeFileSync(SALIDA!, pdf)
    console.info('[propuesta-html]', JSON.stringify(medidas))
    expect(medidas.peticionesBloqueadas).toEqual([])
    const texto = ((await textoDelPdf(pdf)) ?? '').replace(/\s+/g, ' ')
    for (const precio of [PRECIO_E, PRECIO_R, PRECIO_P]) expect(texto).toContain(pesos(precio))
    expect(texto).toContain('Superior')
    expect(texto).not.toMatch(/cancelaci[oó]n gratis|no reembolsable/i)
    expect(pdf.byteLength).toBeLessThan(3_000_000)
  })
})
