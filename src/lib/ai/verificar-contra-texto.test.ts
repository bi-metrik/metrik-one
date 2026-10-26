/**
 * Datos inventados: ningún correo, documento ni radicado de estas pruebas es de un cliente.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { CampoExtraccion, CampoResultado } from './extract-fields'
import { extractFieldsFromDocument, verificarConCapaDeTexto } from './extract-fields'
import { textoDelPdf } from './texto-pdf'
import {
  candidatoCorrector,
  confusionesEntre,
  estaEnTexto,
  tipoVerificable,
  verificarContraTexto,
} from './verificar-contra-texto'

const campo = (slug: string, tipo: CampoExtraccion['tipo'] = 'texto'): CampoExtraccion => ({
  slug, label: slug, tipo, required: false, descripcion_ai: slug,
})
const leido = (value: string | null, confidence = 1): CampoResultado => ({ value, confidence, manual: false })

const TEXTO_CERTIFICADO = `
RADICADO No. VEH_GEE2099000123  FECHA 2099-01-15
BENEFICIARIOS
Dueño del Proyecto  PERSONA DE PRUEBA  C.C. 1.234.567.890  CORREO DE NOTIFICACIÓN XXPATERN@EJEMPLO.COM
BIENES APROBADOS  VIN 9ZZTEST0A1B234567
`

describe('tipoVerificable', () => {
  it('reconoce la forma del valor', () => {
    expect(tipoVerificable('xxpatem@ejemplo.com')).toBe('correo')
    expect(tipoVerificable('1234567890')).toBe('documento')
    expect(tipoVerificable('9ZZTEST0A1B234567')).toBe('vin')
    expect(tipoVerificable('VEH_GEE2099000123')).toBe('radicado')
  })
  it('no verifica nombres, fechas, montos ni textos con espacios', () => {
    expect(tipoVerificable('PERSONA DE PRUEBA')).toBeNull()
    expect(tipoVerificable('BYD')).toBeNull()
    expect(tipoVerificable('2099-01-15')).toBeNull()
    expect(tipoVerificable('FVM 3903')).toBeNull()
    expect(tipoVerificable('123')).toBeNull()
  })
})

describe('confusionesEntre', () => {
  it('cuenta las confusiones típicas de lectura', () => {
    expect(confusionesEntre('xxpatem', 'xxpatern')).toBe(1)
    expect(confusionesEntre('ana.clara', 'ana.dara')).toBe(1)
    expect(confusionesEntre('vvilson', 'wilson')).toBe(1)
    expect(confusionesEntre('ab1c0', 'ablco')).toBe(2)
    expect(confusionesEntre('ABC', 'abc')).toBe(0)
  })
  it('una diferencia que no es confusión típica no se acerca', () => {
    expect(confusionesEntre('xxpatern', 'xxpaterm')).toBe(Infinity)
    expect(confusionesEntre('12345', '12346')).toBe(Infinity)
  })
})

describe('estaEnTexto', () => {
  it('sin importar mayúsculas', () => {
    expect(estaEnTexto('xxpatern@ejemplo.com', 'correo', TEXTO_CERTIFICADO)).toBe(true)
  })
  it('un correo partido en dos renglones', () => {
    expect(estaEnTexto('nombre.largo@ejemplo.com', 'correo', 'CORREO nombre.lar\ngo@ejemplo.com CIUDAD')).toBe(true)
  })
  it('un correo recortado no está', () => {
    expect(estaEnTexto('xxpatern@ejemplo.co', 'correo', TEXTO_CERTIFICADO)).toBe(false)
  })
  it('un documento escrito con puntos', () => {
    expect(estaEnTexto('1234567890', 'documento', TEXTO_CERTIFICADO)).toBe(true)
    expect(estaEnTexto('123456789', 'documento', TEXTO_CERTIFICADO)).toBe(false)
  })
  it('radicado y VIN', () => {
    expect(estaEnTexto('veh_gee2099000123', 'radicado', TEXTO_CERTIFICADO)).toBe(true)
    expect(estaEnTexto('9ZZTEST0A1B234567', 'vin', TEXTO_CERTIFICADO)).toBe(true)
  })
})

describe('candidatoCorrector', () => {
  it('dos candidatos igual de cerca: no elige', () => {
    const texto = 'uno: casa1@ejemplo.com dos: casal@ejemplo.com'
    expect(candidatoCorrector('casai@ejemplo.com', 'correo', texto)).toBeNull()
  })
  it('a más de dos confusiones: no hay candidato', () => {
    expect(candidatoCorrector('rnrnrn@ejemplo.com', 'correo', 'mmm@ejemplo.com')).toBeNull()
  })
})

describe('verificarContraTexto', () => {
  it('el correo mal leído se toma del texto y queda la lectura de la IA', () => {
    const r = { correo: leido('xxpatem@ejemplo.com') }
    const v = verificarContraTexto([campo('correo')], r, TEXTO_CERTIFICADO)
    expect(r.correo).toMatchObject({ value: 'xxpatern@ejemplo.com', leido: 'xxpatem@ejemplo.com', origen: 'texto_pdf' })
    expect(v).toEqual([expect.objectContaining({ slug: 'correo', estado: 'corregido' })])
  })
  it('el valor que está en el texto queda', () => {
    const r = { correo: leido('xxpatern@ejemplo.com'), doc: leido('1234567890') }
    const v = verificarContraTexto([campo('correo'), campo('doc')], r, TEXTO_CERTIFICADO)
    expect(r.correo.value).toBe('xxpatern@ejemplo.com')
    expect(r.correo.origen).toBeUndefined()
    expect(v.map(x => x.estado)).toEqual(['en_texto', 'en_texto'])
  })
  it('radicado y VIN con O↔0 e I↔1', () => {
    const r = { rad: leido('VEH_GEE2O99000123'), vin: leido('9ZZTESTOA1B234567') }
    verificarContraTexto([campo('rad'), campo('vin')], r, TEXTO_CERTIFICADO)
    expect(r.rad.value).toBe('VEH_GEE2099000123')
    expect(r.vin.value).toBe('9ZZTEST0A1B234567')
  })
  it('un documento que no está no se inventa: queda como lo leyó la IA', () => {
    const r = { doc: leido('1234567899') }
    const v = verificarContraTexto([campo('doc')], r, TEXTO_CERTIFICADO)
    expect(r.doc.value).toBe('1234567899')
    expect(v[0].estado).toBe('ausente')
  })
  it('no toca un campo editado a mano ni uno que no es texto', () => {
    const editado: CampoResultado = {
      ...leido('xxpatem@ejemplo.com'),
      edicion: { editado_por_id: 'x', editado_por_nombre: 'Persona', editado_en: '2099-01-01' },
    }
    const r = { correo: editado, monto: leido('1234567890') }
    const v = verificarContraTexto([campo('correo'), campo('monto', 'currency')], r, TEXTO_CERTIFICADO)
    expect(r.correo.value).toBe('xxpatem@ejemplo.com')
    expect(v).toEqual([])
  })
})

// ── Con un PDF de verdad ────────────────────────────────────────────────────────

async function pdfConTexto(lineas: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([600, 400])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  lineas.forEach((l, i) => page.drawText(l, { x: 40, y: 350 - i * 20, size: 11, font }))
  return Buffer.from(await doc.save())
}

/** Un «escaneo»: solo dibujo, sin una letra de texto. */
async function pdfSinTexto(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([600, 400])
  for (let i = 0; i < 20; i++) {
    page.drawRectangle({ x: 40 + i * 25, y: 100, width: 10, height: 200, color: rgb(0.1, 0.1, 0.1) })
  }
  return Buffer.from(await doc.save())
}

const LINEAS = [
  'RADICADO No. VEH_GEE2099000123',
  'BENEFICIARIOS',
  'Dueño del Proyecto PERSONA DE PRUEBA 1234567890',
  'CORREO DE NOTIFICACIÓN XXPATERN@EJEMPLO.COM',
]

describe('capa de texto de un PDF', () => {
  it('lee el texto de un PDF generado', async () => {
    const texto = await textoDelPdf(await pdfConTexto(LINEAS))
    expect(texto).toContain('XXPATERN@EJEMPLO.COM')
  })
  it('un PDF sin capa de texto devuelve null', async () => {
    expect(await textoDelPdf(await pdfSinTexto())).toBeNull()
  })
  it('un archivo que no es PDF devuelve null sin lanzar', async () => {
    expect(await textoDelPdf(Buffer.from('no soy un pdf'))).toBeNull()
  })
  it('no consume el buffer original', async () => {
    const buf = await pdfConTexto(LINEAS)
    const largo = buf.length
    await textoDelPdf(buf)
    expect(buf.length).toBe(largo)
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('con capa de texto: la IA dice «xxpatem@…», el texto dice «XXPATERN@…», se guarda el del texto', async () => {
    const r = { correo: leido('xxpatem@ejemplo.com') }
    await verificarConCapaDeTexto(await pdfConTexto(LINEAS), [campo('correo')], r)
    expect(r.correo).toMatchObject({ value: 'xxpatern@ejemplo.com', leido: 'xxpatem@ejemplo.com', origen: 'texto_pdf' })
  })
  it('escaneado sin capa de texto: el valor de la IA no cambia', async () => {
    const r = { correo: leido('xxpatem@ejemplo.com') }
    const v = await verificarConCapaDeTexto(await pdfSinTexto(), [campo('correo')], r)
    expect(v).toEqual([])
    expect(r.correo).toEqual(leido('xxpatem@ejemplo.com'))
  })
})

describe('extractFieldsFromDocument', () => {
  afterEach(() => vi.unstubAllGlobals())

  const respuestaGemini = (campos: Record<string, { value: string; confidence: number }>) => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(campos) }] } }] }),
  })

  it('corrige al extraer un PDF con capa de texto', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuestaGemini({ correo: { value: 'xxpatem@ejemplo.com', confidence: 1 } })))
    const r = await extractFieldsFromDocument(await pdfConTexto(LINEAS), 'application/pdf', [campo('correo')], 'k')
    expect(r.data?.correo).toMatchObject({ value: 'xxpatern@ejemplo.com', leido: 'xxpatem@ejemplo.com', origen: 'texto_pdf' })
  })
  it('no toca lo leído de un PDF escaneado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuestaGemini({ correo: { value: 'xxpatem@ejemplo.com', confidence: 1 } })))
    const r = await extractFieldsFromDocument(await pdfSinTexto(), 'application/pdf', [campo('correo')], 'k')
    expect(r.data?.correo).toEqual({ value: 'xxpatem@ejemplo.com', confidence: 1, manual: false })
  })
})
