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

const SALIDA = process.env.PROPUESTA_PDF_SALIDA

describe.skipIf(!SALIDA)('pdfDePropuestaHtml (con Chromium local)', () => {
  it('imprime el COT-2026-0026 de muestra', { timeout: 120_000 }, async () => {
    const { pdf, medidas } = await pdfDePropuestaHtml(entradaComoLaAccion(), {
      marca: 'Agencia de ejemplo',
      logoUrl: process.env.PROPUESTA_LOGO ?? null,
      fotoDeCiudad: bancoComoFotoPDF,
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
