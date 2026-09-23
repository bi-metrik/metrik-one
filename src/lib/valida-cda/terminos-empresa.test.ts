import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { DocumentoContractual } from '@/lib/valida-api/resultados'
import { terminosAceptadosPorEmpresa } from './terminos-empresa'

const huella = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')
const TEXTO = '# TÉRMINOS DE SUSCRIPCIÓN VALIDA · LICENCIA CDA v1.1\n\n1.1. METRIK concede...'

const DOC: DocumentoContractual = {
  documentoId: '33333333-3333-4333-8333-333333333333',
  slug: 'terminos-suscripcion-valida-cda',
  titulo: 'Términos de Suscripción VALIDA · Licencia CDA',
  version: 'v1.1',
  textoMd: TEXTO,
  pdfSha256: 'a'.repeat(64),
  vigenteDesde: '2026-09-23',
  vigenteHasta: null,
  aceptadoAt: '2026-09-25T14:00:00Z',
  aceptadoPor: 'Alba Yurany Rosas Escandón',
  aceptadoCalidad: 'representante_legal',
  aceptadoCanal: 'modulo',
}
const HUELLAS = new Map([[DOC.documentoId, { textoSha256: huella(TEXTO), pdfSha256: 'a'.repeat(64) }]])

describe('los términos que aceptó la empresa, para releerlos', () => {
  it('con la constancia del contrato y el texto íntegro: verificado, con quién y cuándo', () => {
    expect(terminosAceptadosPorEmpresa({ documentos: [DOC], huellas: HUELLAS, huella })).toEqual([
      {
        estado: 'verificado',
        documentoId: DOC.documentoId,
        titulo: DOC.titulo,
        version: 'v1.1',
        textoMd: TEXTO,
        aprobadoAt: '2026-09-25T14:00:00Z',
        contrato: { aceptadoAt: '2026-09-25T14:00:00Z', aceptadoPor: 'Alba Yurany Rosas Escandón', canal: 'modulo' },
      },
    ])
  })

  it('sin aceptación del contrato no hay nada que releer', () => {
    expect(terminosAceptadosPorEmpresa({ documentos: [{ ...DOC, aceptadoAt: null }], huellas: HUELLAS, huella })).toEqual([])
  })

  it('un texto que no es el registrado no se pinta: no verificado, sin texto', () => {
    const r = terminosAceptadosPorEmpresa({ documentos: [{ ...DOC, textoMd: `${TEXTO} ` }], huellas: HUELLAS, huella })
    expect(r).toEqual([
      { estado: 'no_verificado', titulo: DOC.titulo, version: 'v1.1', aprobadoAt: DOC.aceptadoAt, motivo: 'huella_distinta' },
    ])
  })

  it('sin la huella registrada de la versión, tampoco', () => {
    expect(terminosAceptadosPorEmpresa({ documentos: [DOC], huellas: new Map(), huella })[0].estado).toBe('no_verificado')
  })

  it('una versión repetida por varias constancias sale una vez, con la primera aceptación', () => {
    const r = terminosAceptadosPorEmpresa({
      documentos: [{ ...DOC, aceptadoAt: '2026-09-28T10:00:00Z' }, DOC],
      huellas: HUELLAS,
      huella,
    })
    expect(r).toHaveLength(1)
    expect(r[0].aprobadoAt).toBe('2026-09-25T14:00:00Z')
  })
})
