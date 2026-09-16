import { describe, expect, it } from 'vitest'
import {
  evaluarEntrada,
  filasAceptacionUsuario,
  puedeAprobarEntrada,
  textoCasillaEntrada,
  type AceptacionUsuarioRegistrada,
} from './entrada'
import { POLITICA_DATOS_VALIDA } from './politica'
import type { DocumentoContractual } from './resultados'

/**
 * La entrada única del módulo Valida API.
 *
 * El caso que la fija es el real de 4D SOFT (medido en producción el 2026-09-16): la v1.0 de sus
 * términos ya está aceptada por WhatsApp, `documentos_aceptaciones_usuario` está VACÍA y el espacio
 * tiene dos perfiles owner (el cliente y el soporte de MeTRIK). Con la entrada de dos pasos,
 * ninguno de los dos veía los términos al entrar.
 */

const HOY = '2026-09-17'
const WS = '64010015-a9a2-4aca-be83-e456cf217d96'
const PDF_V10 = '85e6d157f7556a00b70e8525e7168b9dcc199dd30f6d3fcdb7567242d2575ccd'
const PDF_V11 = 'f'.repeat(64)

function doc(extra: Partial<DocumentoContractual> = {}): DocumentoContractual {
  return {
    documentoId: 'b91b4a14-cce1-4cfa-88d5-f235aa9e1060',
    slug: 'terminos-uso-valida',
    titulo: 'Términos de Uso de VALIDA',
    version: 'v1.0',
    textoMd: '# Términos',
    pdfSha256: PDF_V10,
    vigenteDesde: '2026-09-15',
    vigenteHasta: null,
    aceptadoAt: null,
    aceptadoPor: null,
    aceptadoCalidad: null,
    aceptadoCanal: null,
    ...extra,
  }
}

const V10_ACEPTADA = doc({ aceptadoAt: '2026-09-15T13:25:06Z', aceptadoPor: 'Juan Guillermo', aceptadoCanal: 'whatsapp' })
const V11 = doc({ documentoId: '00000000-0000-4000-8000-0000000000e2', version: 'v1.1', pdfSha256: PDF_V11, vigenteDesde: '2026-09-17' })

const POLITICA: AceptacionUsuarioRegistrada = {
  documento_slug: POLITICA_DATOS_VALIDA.slug,
  documento_version: POLITICA_DATOS_VALIDA.version,
  documento_sha256: null,
  aceptada_at: '2026-09-17T10:00:00Z',
}
const LEYO_V10: AceptacionUsuarioRegistrada = {
  documento_slug: 'terminos-uso-valida',
  documento_version: 'v1.0',
  documento_sha256: PDF_V10,
  aceptada_at: '2026-09-17T10:00:00Z',
}

const DUENO = { role: 'owner', workspaceId: WS, platformAdmin: false }
const SOPORTE = { role: 'owner', workspaceId: WS, platformAdmin: true }
const OPERADOR = { role: 'operator', workspaceId: WS, platformAdmin: false }

const evaluar = (p: Partial<Parameters<typeof evaluarEntrada>[0]> = {}) =>
  evaluarEntrada({ documentos: [V10_ACEPTADA], hoy: HOY, aceptacionesUsuario: [], perfil: DUENO, workspaceId: WS, ...p })

describe('aprobada = Política vigente + términos leídos por el usuario + contrato aceptado', () => {
  it('4D SOFT hoy: el contrato aceptado por WhatsApp NO abre el módulo a nadie', () => {
    for (const perfil of [DUENO, SOPORTE, OPERADOR]) {
      const e = evaluar({ perfil })
      expect(e.estado).toBe('pendiente')
      if (e.estado !== 'pendiente') continue
      // Todos ven los términos, y todos pueden aprobar: el contrato ya no está pendiente.
      expect(e.documentos.map((d) => d.doc.version)).toEqual(['v1.0'])
      expect(e.contratoPendiente).toEqual([])
      expect(e.aceptante).toBeNull()
      expect(puedeAprobarEntrada(e)).toBe(true)
    }
  })

  it('con las tres cosas, aprobada', () => {
    expect(evaluar({ aceptacionesUsuario: [POLITICA, LEYO_V10] })).toEqual({ estado: 'aprobada' })
  })

  it('falta cualquiera de las tres, y no entra', () => {
    // Sin la Política.
    expect(evaluar({ aceptacionesUsuario: [LEYO_V10] }).estado).toBe('pendiente')
    // Sin la lectura propia de los términos.
    expect(evaluar({ aceptacionesUsuario: [POLITICA] }).estado).toBe('pendiente')
    // Sin el contrato aceptado, aunque el usuario tenga su parte.
    expect(evaluar({ documentos: [doc()], aceptacionesUsuario: [POLITICA, LEYO_V10] }).estado).toBe('pendiente')
  })

  it('una Política de versión anterior no cuenta', () => {
    const vieja = { ...POLITICA, documento_version: '1.4' }
    const e = evaluar({ aceptacionesUsuario: [vieja, LEYO_V10] })
    expect(e.estado === 'pendiente' && e.politicaAceptada).toBe(false)
  })

  it('la lectura se ata a la huella del PDF: mismo nombre y versión con otra huella no es este documento', () => {
    const otra = { ...LEYO_V10, documento_sha256: 'e'.repeat(64) }
    const e = evaluar({ aceptacionesUsuario: [POLITICA, otra] })
    expect(e.estado).toBe('pendiente')
    if (e.estado !== 'pendiente') return
    // Y como la tabla no admite otra fila con ese nombre y versión, no se puede completar aquí.
    expect(e.conflictos.map((d) => d.documentoId)).toEqual([V10_ACEPTADA.documentoId])
    expect(puedeAprobarEntrada(e)).toBe(false)
  })

  it('una versión nueva vigente se lee y se acepta aunque la anterior ya esté hecha', () => {
    const e = evaluar({ documentos: [V10_ACEPTADA, V11], aceptacionesUsuario: [POLITICA, LEYO_V10] })
    expect(e.estado).toBe('pendiente')
    if (e.estado !== 'pendiente') return
    expect(e.documentos.map((d) => [d.doc.version, d.contratoAceptado, d.leidoPorUsuario])).toEqual([
      ['v1.0', true, true],
      ['v1.1', false, false],
    ])
    expect(e.contratoPendiente.map((d) => d.version)).toEqual(['v1.1'])
  })
})

describe('fail-closed: no poder comprobarlo no es haberlo aceptado', () => {
  it('si la lectura de los documentos falla, no_disponible', () => {
    expect(evaluar({ documentos: null, aceptacionesUsuario: [POLITICA, LEYO_V10] })).toEqual({ estado: 'no_disponible' })
  })

  it('si la lectura de las aceptaciones del usuario falla, no_disponible', () => {
    expect(evaluar({ aceptacionesUsuario: null })).toEqual({ estado: 'no_disponible' })
  })

  it('sin documentos vigentes el módulo no se abre, aunque la Política esté aceptada', () => {
    expect(evaluar({ documentos: [], aceptacionesUsuario: [POLITICA] })).toEqual({ estado: 'sin_documentos' })
    const retirada = doc({ vigenteHasta: '2026-09-16', aceptadoAt: '2026-09-15T13:25:06Z' })
    expect(evaluar({ documentos: [retirada], aceptacionesUsuario: [POLITICA, LEYO_V10] })).toEqual({
      estado: 'sin_documentos',
    })
  })

  it('con el contrato pendiente y sin el perfil real, no se adivina quién firma', () => {
    expect(evaluar({ documentos: [doc()], perfil: null })).toEqual({ estado: 'no_disponible' })
  })

  it('con el contrato aceptado, el perfil no hace falta', () => {
    expect(evaluar({ perfil: null }).estado).toBe('pendiente')
  })
})

describe('quién puede aprobar cuando el contrato está pendiente', () => {
  const pendiente = (perfil: typeof DUENO) => evaluar({ documentos: [doc()], perfil })

  it('el dueño real del espacio sí: firma el contrato en la misma aprobación', () => {
    const e = pendiente(DUENO)
    expect(e.estado === 'pendiente' && e.aceptante).toEqual({ puede: true })
    expect(puedeAprobarEntrada(e)).toBe(true)
  })

  it('el soporte de MeTRIK no, aunque figure como owner del espacio que visita', () => {
    const e = pendiente(SOPORTE)
    expect(e.estado === 'pendiente' && e.aceptante).toEqual({ puede: false, razon: 'soporte' })
    expect(puedeAprobarEntrada(e)).toBe(false)
  })

  it('un operador o admin tampoco: ve los términos pero no aprueba', () => {
    const e = pendiente(OPERADOR)
    expect(e.estado === 'pendiente' && e.aceptante).toEqual({ puede: false, razon: 'no_owner' })
    expect(e.estado === 'pendiente' && e.documentos.length).toBe(1)
    expect(puedeAprobarEntrada(e)).toBe(false)
  })

  it('nada que no sea una entrada pendiente se puede aprobar', () => {
    expect(puedeAprobarEntrada({ estado: 'aprobada' })).toBe(false)
    expect(puedeAprobarEntrada({ estado: 'no_disponible' })).toBe(false)
    expect(puedeAprobarEntrada({ estado: 'sin_documentos' })).toBe(false)
  })
})

describe('la casilla única', () => {
  it('nombra los documentos leídos, a METRIK IA S.A.S. y la Política vigente', () => {
    const t = textoCasillaEntrada({ documentos: [V10_ACEPTADA], firmaPor: null })
    expect(t).toBe(
      'Leí hasta el final «Términos de Uso de VALIDA» (v1.0) y los acepto para mi uso de Valida API. ' +
        'Autorizo a METRIK IA S.A.S. a tratar mis datos conforme a la Política de Tratamiento de Datos Personales v1.5.',
    )
    expect(t).not.toMatch(/[—–]/)
  })

  it('con varios documentos los enumera todos', () => {
    const t = textoCasillaEntrada({ documentos: [V10_ACEPTADA, V11], firmaPor: null })
    expect(t).toContain('«Términos de Uso de VALIDA» (v1.0) y «Términos de Uso de VALIDA» (v1.1)')
  })

  it('cuando firma el contrato, declara las facultades para obligar a la empresa', () => {
    const t = textoCasillaEntrada({ documentos: [V11], firmaPor: ['4D SOFT S.A.S.'] })
    expect(t).toContain('Declaro bajo la gravedad de juramento que tengo facultades para obligar a 4D SOFT S.A.S.')
    expect(t).not.toBe(textoCasillaEntrada({ documentos: [V11], firmaPor: null }))
  })
})

describe('las constancias del usuario', () => {
  it('una de la Política con la huella de su aviso, y una por documento con su PDF y la huella de la casilla', () => {
    const filas = filasAceptacionUsuario({
      documentos: [V10_ACEPTADA, V11],
      workspaceId: WS,
      usuarioId: '123fc989-2520-4128-9e52-3283a524a75d',
      huellaAvisoPolitica: 'a'.repeat(64),
      huellaCasilla: 'c'.repeat(64),
      ip: '190.24.1.10',
      userAgent: 'Mozilla/5.0',
    })
    expect(filas).toEqual([
      {
        workspace_id: WS,
        usuario_id: '123fc989-2520-4128-9e52-3283a524a75d',
        documento_slug: 'politica-datos-valida',
        documento_version: '1.5',
        documento_sha256: null,
        documento_url: 'https://valida.metrik.com.co/recursos/privacidad',
        aviso_texto_sha256: 'a'.repeat(64),
        ip: '190.24.1.10',
        user_agent: 'Mozilla/5.0',
      },
      expect.objectContaining({ documento_slug: 'terminos-uso-valida', documento_version: 'v1.0', documento_sha256: PDF_V10, aviso_texto_sha256: 'c'.repeat(64) }),
      expect.objectContaining({ documento_slug: 'terminos-uso-valida', documento_version: 'v1.1', documento_sha256: PDF_V11, aviso_texto_sha256: 'c'.repeat(64) }),
    ])
  })
})
