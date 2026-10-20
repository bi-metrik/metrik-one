import { describe, expect, it } from 'vitest'

import { rutaValida } from './archivos'
import {
  claveDeNombre,
  decidirTamano,
  emparejar,
  extensionEnBucket,
  formatoDeArchivo,
  huellaDeContenido,
  mimeDelContenido,
  partesDeNombreEnDisco,
  partesDeOrigenRef,
  type ArchivoEnCarpeta,
  type FilaImportada,
} from './subir-importados'

/** Datos INVENTADOS: ningún nombre, proveedor ni id de Airtable reales. */
const PROV = '11111111-1111-4111-8111-111111111111'
const WS = '22222222-2222-4222-8222-222222222222'
let n = 0
function fila(origenRef: string | null, ref: string | null = null): FilaImportada {
  n++
  return { id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, proveedor_id: PROV, origen_ref: origenRef, ref }
}
const arch = (nombre: string, bytes = 1000): ArchivoEnCarpeta => ({ nombre, bytes })

describe('nombres en disco y origen_ref', () => {
  it('parte el nombre en disco (el nombre original puede tener guiones bajos)', () => {
    expect(partesDeNombreEnDisco('recFICT0000000001_tar3_Tarifas_2026 final.pdf')).toEqual({ rec: 'recFICT0000000001', clase: 'tar', indice: 3, original: 'Tarifas_2026 final.pdf' })
    expect(partesDeNombreEnDisco('recFICT0000000001_doc0_RNT.pdf')?.clase).toBe('doc')
    expect(partesDeNombreEnDisco('suelto.pdf')).toBeNull()
    expect(partesDeNombreEnDisco('recFICT_xls0_a.pdf')).toBeNull()
  })

  it('corta origen_ref en el primer dos puntos', () => {
    expect(partesDeOrigenRef('recFICT1:Hora 10:30 (1).pdf')).toEqual({ rec: 'recFICT1', original: 'Hora 10:30 (1).pdf' })
    expect(partesDeOrigenRef('sin-dos-puntos')).toBeNull()
    expect(partesDeOrigenRef(null)).toBeNull()
    expect(partesDeOrigenRef('recX:')).toBeNull()
  })

  it('la clave iguala el nombre original con el saneado en disco', () => {
    // Paréntesis, comas, %, + → `_`.
    expect(claveDeNombre('Tarifas (1), 10% + IVA.pdf')).toBe(claveDeNombre('Tarifas _1__ 10_ _ IVA.pdf'))
    // Tilde descompuesta (letra + marca combinada) que el que bajó cambió por `_`.
    expect(claveDeNombre('Piña Colada.pdf')).toBe(claveDeNombre('Pin_a Colada.pdf'))
    // Tilde compuesta en un lado, descompuesta en el otro.
    expect(claveDeNombre('Piña.pdf')).toBe(claveDeNombre('Piña.pdf'))
    // Espacios dobles y puntos seguidos se respetan.
    expect(claveDeNombre('Hotel  Ficticio .. (2).pdf')).toBe(claveDeNombre('Hotel  Ficticio .. _2_.pdf'))
    expect(claveDeNombre('Hotel  Ficticio .. (2).pdf')).not.toBe(claveDeNombre('Hotel Ficticio .. _2_.pdf'))
    // Idempotente.
    const c = claveDeNombre('Año № 1 (copia).PDF')
    expect(claveDeNombre(c)).toBe(c)
  })
})

describe('emparejar', () => {
  it('empareja por origen_ref aunque el nombre en disco esté saneado', () => {
    const f1 = fila('recFICT0000000001:Tarifas Isla Inventada (1).pdf')
    const f2 = fila('recFICT0000000002:Piña, 10% + niños.docx')
    const a1 = arch('recFICT0000000001_tar0_Tarifas Isla Inventada _1_.pdf')
    const a2 = arch('recFICT0000000002_tar1_Pin_a_ 10_ _ niños.docx')
    const r = emparejar([f1, f2], [a2, a1])
    expect(r.pares).toEqual([
      { fila: f1, archivo: a1 },
      { fila: f2, archivo: a2 },
    ])
    expect(r.filasSinArchivo).toEqual([])
    expect(r.archivosSinFila).toEqual([])
  })

  it('reporta el archivo sin fila y la fila sin archivo, sin fallar', () => {
    const f1 = fila('recFICT0000000001:Tarifas.pdf')
    const f2 = fila('recFICT0000000003:Sin archivo.pdf')
    const a1 = arch('recFICT0000000001_tar0_Tarifas.pdf')
    const huerfano = arch('recFICT0000000009_tar0_Nadie lo pidió.pdf')
    const r = emparejar([f1, f2], [a1, huerfano])
    expect(r.pares.map((p) => p.fila)).toEqual([f1])
    expect(r.filasSinArchivo).toEqual([f2])
    expect(r.archivosSinFila).toEqual([huerfano])
  })

  it('el mismo nombre en otro registro de Airtable no empareja', () => {
    const f = fila('recFICT0000000001:Tarifas.pdf')
    const r = emparejar([f], [arch('recFICT0000000002_tar0_Tarifas.pdf')])
    expect(r.pares).toEqual([])
    expect(r.filasSinArchivo).toEqual([f])
    expect(r.archivosSinFila).toHaveLength(1)
  })

  it('idempotente: la fila con ref lleno se ignora y su archivo no se reporta como huérfano', () => {
    const subida = fila('recFICT0000000001:Tarifas.pdf', `one://fotos-catalogo/${WS}/proveedores/${PROV}/tarifarios/${'a'.repeat(32)}.pdf`)
    const r = emparejar([subida], [arch('recFICT0000000001_tar0_Tarifas.pdf')])
    expect(r.pares).toEqual([])
    expect(r.yaSubidas).toEqual([subida])
    expect(r.archivosSinFila).toEqual([])
    expect(r.filasSinArchivo).toEqual([])
  })

  it('los docN no se suben ni cuentan como huérfanos; los nombres ajenos van aparte', () => {
    const r = emparejar([], [arch('recFICT0000000001_doc0_Certificado.pdf'), arch('desconocido.pdf')])
    expect(r.documentos).toHaveLength(1)
    expect(r.otros).toHaveLength(1)
    expect(r.archivosSinFila).toEqual([])
  })

  it('no adivina: dos archivos que dan la misma clave para una fila quedan ambiguos', () => {
    const f = fila('recFICT0000000001:Tarifas (1).pdf')
    const a = arch('recFICT0000000001_tar0_Tarifas _1_.pdf')
    const b = arch('recFICT0000000001_tar1_Tarifas _1_.pdf')
    const r = emparejar([f], [a, b])
    expect(r.pares).toEqual([])
    expect(r.ambiguos).toEqual([{ filas: [f], archivos: [a, b] }])
    expect(r.archivosSinFila).toEqual([])
  })

  it('origen_ref cortado a 400: empareja por el comienzo del nombre', () => {
    const largo = `Tarifas ${'x'.repeat(420)}.pdf`
    const ref = `recFICT0000000001:${largo}`.slice(0, 400)
    const f = fila(ref)
    const a = arch(`recFICT0000000001_tar0_${largo}`)
    expect(emparejar([f], [a]).pares).toEqual([{ fila: f, archivo: a }])
    // Sin cortar, un nombre que solo empieza igual NO empareja.
    expect(emparejar([fila('recFICT0000000001:Tarifas.pdf')], [arch('recFICT0000000001_tar0_Tarifas.pdf.pdf')]).pares).toEqual([])
  })

  it('una fila con origen_ref ilegible se reporta', () => {
    const f = fila('sin-formato')
    expect(emparejar([f], []).filasSinOrigen).toEqual([f])
  })
})

describe('formato', () => {
  it('decide por la extensión: directo, convertir o no soportado', () => {
    expect(formatoDeArchivo('a.PDF')).toEqual({ tipo: 'directo', mime: 'application/pdf' })
    expect(formatoDeArchivo('a.jpeg')).toEqual({ tipo: 'directo', mime: 'image/jpeg' })
    expect(formatoDeArchivo('a.jpg')).toEqual({ tipo: 'directo', mime: 'image/jpeg' })
    expect(formatoDeArchivo('a.png')).toEqual({ tipo: 'directo', mime: 'image/png' })
    for (const ext of ['doc', 'docx', 'pptx', 'DOCX']) expect(formatoDeArchivo(`x.${ext}`).tipo).toBe('convertir')
    expect(formatoDeArchivo('x.zip')).toEqual({ tipo: 'no_soportado', extension: 'zip' })
    expect(formatoDeArchivo('sin extension')).toEqual({ tipo: 'no_soportado', extension: '' })
  })

  it('reconoce el tipo real por los primeros bytes', () => {
    const b = (s: number[]) => new Uint8Array([...s, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(mimeDelContenido(new TextEncoder().encode('%PDF-1.7\n'))).toBe('application/pdf')
    expect(mimeDelContenido(b([0xff, 0xd8, 0xff]))).toBe('image/jpeg')
    expect(mimeDelContenido(b([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png')
    expect(mimeDelContenido(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
    expect(mimeDelContenido(new TextEncoder().encode('PK\u0003\u0004 docx'))).toBeNull()
    expect(extensionEnBucket('image/jpeg')).toBe('jpg')
    expect(extensionEnBucket('application/msword')).toBeNull()
  })
})

describe('tamaño', () => {
  const MB = 1_000_000
  it('≤ 20 MB cabe; un PDF más grande se comprime una vez; después, o una imagen, se salta', () => {
    expect(decidirTamano(20 * MB, 'application/pdf', false)).toBe('cabe')
    expect(decidirTamano(20 * MB + 1, 'application/pdf', false)).toBe('comprimir')
    expect(decidirTamano(25 * MB, 'application/pdf', true)).toBe('saltar')
    expect(decidirTamano(12 * MB, 'application/pdf', true)).toBe('cabe')
    expect(decidirTamano(21 * MB, 'image/jpeg', false)).toBe('saltar')
  })
})

describe('huella y ruta', () => {
  it('determinística por fila y contenido, con la forma que acepta la app', () => {
    const datos = new TextEncoder().encode('%PDF-1.4 ficticio')
    const h = huellaDeContenido('fila-1', datos)
    expect(h).toMatch(/^[0-9a-f]{32}$/)
    expect(huellaDeContenido('fila-1', datos)).toBe(h)
    expect(huellaDeContenido('fila-2', datos)).not.toBe(h)
    expect(rutaValida(`${WS}/proveedores/${PROV}/tarifarios/${h}.pdf`, WS, PROV, 'tarifarios')).not.toBeNull()
  })
})
