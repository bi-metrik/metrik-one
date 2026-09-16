import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { AceptacionUsuarioRegistrada } from './entrada'
import { POLITICA_DATOS_VALIDA } from './politica'
import type { DocumentoContractual } from './resultados'
import { terminosAprobados, type HuellasVersion } from './terminos-aprobados'

/**
 * La pestaña Términos muestra la versión que ESE usuario aprobó, con su texto exacto, o un error.
 * Nunca otra versión y nunca un texto cuya huella no sea la registrada.
 */

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

const TEXTO_V10 = '# Términos v1.0\n\n3.1. Las credenciales se entregan únicamente después de la aceptación.'
const TEXTO_V11 = '# Términos v1.1\n\n3.1. Texto nuevo de la versión 1.1.'
const PDF_V10 = 'a'.repeat(64)
const PDF_V11 = 'b'.repeat(64)

const doc = (o: Partial<DocumentoContractual> & Pick<DocumentoContractual, 'documentoId' | 'version' | 'textoMd' | 'pdfSha256'>): DocumentoContractual => ({
  slug: 'terminos-uso-valida',
  titulo: 'Términos de Uso de VALIDA',
  vigenteDesde: '2026-09-15',
  vigenteHasta: null,
  aceptadoAt: null,
  aceptadoPor: null,
  aceptadoCalidad: null,
  aceptadoCanal: null,
  ...o,
})

const V10 = doc({
  documentoId: '00000000-0000-4000-8000-0000000000a1',
  version: 'v1.0',
  textoMd: TEXTO_V10,
  pdfSha256: PDF_V10,
  aceptadoAt: '2026-09-15T13:25:06Z',
  aceptadoPor: 'Juan Guillermo',
  aceptadoCanal: 'whatsapp',
})
const V11 = doc({ documentoId: '00000000-0000-4000-8000-0000000000b1', version: 'v1.1', textoMd: TEXTO_V11, pdfSha256: PDF_V11 })

const HUELLAS = new Map<string, HuellasVersion>([
  [V10.documentoId, { textoSha256: sha(TEXTO_V10), pdfSha256: PDF_V10 }],
  [V11.documentoId, { textoSha256: sha(TEXTO_V11), pdfSha256: PDF_V11 }],
])

const constancia = (version: string, pdf: string | null, at: string, slug = 'terminos-uso-valida'): AceptacionUsuarioRegistrada => ({
  documento_slug: slug,
  documento_version: version,
  documento_sha256: pdf,
  aceptada_at: at,
})
const POLITICA = constancia(POLITICA_DATOS_VALIDA.version, null, '2026-09-16T19:27:28Z', POLITICA_DATOS_VALIDA.slug)

const correr = (p: { aceptaciones: AceptacionUsuarioRegistrada[]; documentos?: DocumentoContractual[]; huellas?: Map<string, HuellasVersion> }) =>
  terminosAprobados({ documentos: [V10, V11], huellas: HUELLAS, huella: sha, ...p })

describe('qué versión se muestra', () => {
  it('la que el usuario aprobó, con su texto, aunque el espacio tenga otra más nueva', () => {
    const r = correr({ aceptaciones: [POLITICA, constancia('v1.0', PDF_V10, '2026-09-16T19:27:28Z')] })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ estado: 'verificado', documentoId: V10.documentoId, version: 'v1.0', textoMd: TEXTO_V10 })
    expect(JSON.stringify(r)).not.toContain(TEXTO_V11)
  })

  it('con dos versiones aprobadas, la aprobación más reciente', () => {
    const r = correr({
      aceptaciones: [constancia('v1.1', PDF_V11, '2026-10-02T10:00:00Z'), constancia('v1.0', PDF_V10, '2026-09-16T19:27:28Z')],
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ estado: 'verificado', version: 'v1.1', textoMd: TEXTO_V11, aprobadoAt: '2026-10-02T10:00:00Z' })
  })

  it('la fecha del sello es la aprobación del usuario, y el contrato trae quién y por qué canal', () => {
    const [t] = correr({ aceptaciones: [constancia('v1.0', PDF_V10, '2026-09-16T19:27:28.420248+00:00')] })
    expect(t).toMatchObject({
      estado: 'verificado',
      aprobadoAt: '2026-09-16T19:27:28.420248+00:00',
      contrato: { aceptadoAt: '2026-09-15T13:25:06Z', aceptadoPor: 'Juan Guillermo', canal: 'whatsapp' },
    })
  })

  it('sin aceptación contractual, el contrato va null (no se afirma un canal)', () => {
    const [t] = correr({ aceptaciones: [constancia('v1.1', PDF_V11, '2026-10-02T10:00:00Z')] })
    expect(t.estado === 'verificado' && t.contrato).toBeNull()
  })

  it('la Política y las constancias de slugs ajenos al espacio no producen nada', () => {
    expect(correr({ aceptaciones: [POLITICA, constancia('v9.0', 'c'.repeat(64), '2026-09-20T00:00:00Z', 'terminos-otro-cliente')] })).toEqual([])
  })

  it('una constancia de otro espacio con el mismo slug no desplaza la que sí es de este espacio', () => {
    const r = correr({
      aceptaciones: [constancia('v1.0', PDF_V10, '2026-09-16T19:27:28Z'), constancia('v3.0', 'd'.repeat(64), '2026-12-01T00:00:00Z')],
    })
    expect(r).toEqual([expect.objectContaining({ estado: 'verificado', version: 'v1.0', textoMd: TEXTO_V10 })])
  })
})

describe('nunca otro texto', () => {
  it('misma versión pero otra huella de PDF: error, sin texto de ninguna versión', () => {
    const r = correr({ aceptaciones: [constancia('v1.0', 'e'.repeat(64), '2026-09-16T19:27:28Z')] })
    expect(r).toEqual([
      { estado: 'no_verificado', titulo: null, version: 'v1.0', aprobadoAt: '2026-09-16T19:27:28Z', motivo: 'version_no_encontrada' },
    ])
    expect(JSON.stringify(r)).not.toContain('Términos v1')
  })

  it('el texto que llega no es el registrado para esa versión: error, sin texto', () => {
    const alterado = { ...V10, textoMd: `${TEXTO_V10}\n\n3.2. Cláusula agregada después.` }
    const r = correr({ documentos: [alterado, V11], aceptaciones: [constancia('v1.0', PDF_V10, '2026-09-16T19:27:28Z')] })
    expect(r).toEqual([
      expect.objectContaining({ estado: 'no_verificado', titulo: V10.titulo, version: 'v1.0', motivo: 'huella_distinta' }),
    ])
    expect(JSON.stringify(r)).not.toContain('3.2. Cláusula agregada')
  })

  it('sin huellas registradas para la versión: error', () => {
    const r = correr({ huellas: new Map(), aceptaciones: [constancia('v1.0', PDF_V10, '2026-09-16T19:27:28Z')] })
    expect(r[0]).toMatchObject({ estado: 'no_verificado', motivo: 'huella_distinta' })
  })

  it('la versión registrada tiene otro PDF que la constancia: error', () => {
    const huellas = new Map(HUELLAS)
    huellas.set(V10.documentoId, { textoSha256: sha(TEXTO_V10), pdfSha256: 'f'.repeat(64) })
    const r = correr({ huellas, aceptaciones: [constancia('v1.0', PDF_V10, '2026-09-16T19:27:28Z')] })
    expect(r[0]).toMatchObject({ estado: 'no_verificado', motivo: 'huella_distinta' })
  })

  it('la huella se compara contra el texto tal cual: un salto de línea de más ya no es el mismo', () => {
    const conSalto = { ...V10, textoMd: `${TEXTO_V10}\n` }
    const r = correr({ documentos: [conSalto], aceptaciones: [constancia('v1.0', PDF_V10, '2026-09-16T19:27:28Z')] })
    expect(r[0].estado).toBe('no_verificado')
  })
})
