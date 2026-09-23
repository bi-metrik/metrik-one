import { describe, expect, it } from 'vitest'
import { evaluarEntrada, puedeAprobarEntrada, textoCasillaEntrada, type AceptacionUsuarioRegistrada } from './entrada'
import { POLITICA_DATOS_VALIDA, textoAvisoPolitica } from './politica'
import type { DocumentoContractual } from './resultados'
import { puedeAceptarTerminos, textoDeclaracionTerminos } from './terminos'

/**
 * La entrada de términos sirve desde el 2026-09-23 a dos productos: Valida API (4D SOFT) y Valida de
 * los CDA. Lo que se fija aquí:
 *
 *   1. Los textos que ya firmó 4D SOFT NO cambian ni una letra con el producto por defecto. La base
 *      guarda su huella: un espacio o una tilde de más es otro documento.
 *   2. En los CDA solo la persona designada firma, y a los operadores no se les pide nada propio:
 *      el módulo se abre cuando el contrato tiene su aceptación.
 */

const HOY = '2026-09-23'
const WS = 'b58e4b68-8bed-48b6-85f8-01995f64ffe6'
const DESIGNADA = '11111111-1111-4111-8111-111111111111'
const OPERADOR = '22222222-2222-4222-8222-222222222222'
const PDF = 'a'.repeat(64)

function doc(extra: Partial<DocumentoContractual> = {}): DocumentoContractual {
  return {
    documentoId: '33333333-3333-4333-8333-333333333333',
    slug: 'terminos-suscripcion-valida-cda',
    titulo: 'Términos de Suscripción VALIDA · Licencia CDA',
    version: 'v1.1',
    textoMd: '# TÉRMINOS DE SUSCRIPCIÓN VALIDA · LICENCIA CDA v1.1',
    pdfSha256: PDF,
    vigenteDesde: '2026-09-23',
    vigenteHasta: null,
    aceptadoAt: null,
    aceptadoPor: null,
    aceptadoCalidad: null,
    aceptadoCanal: null,
    ...extra,
  }
}
const PENDIENTE = doc()
const ACEPTADO = doc({ aceptadoAt: '2026-09-24T14:00:00Z', aceptadoPor: 'Alba Yurany Rosas Escandón', aceptadoCanal: 'modulo' })

const perfil = (role: string, extra: Partial<{ workspaceId: string; platformAdmin: boolean }> = {}) => ({
  role,
  workspaceId: WS,
  platformAdmin: false,
  ...extra,
})

describe('los textos que ya firmó 4D SOFT no cambian', () => {
  const doc4d = {
    titulo: 'Términos de Uso, Confidencialidad y Encargo de Tratamiento de Datos — VALIDA',
    version: 'v1.0',
    pdfSha256: '85e6d157f7556a00b70e8525e7168b9dcc199dd30f6d3fcdb7567242d2575ccd',
    empresaNombre: '4D SOFT S.A.S.',
    empresaNit: '901220269-6',
  }
  const datos = { nombre: 'Juan Guillermo Pérez', cedula: '79123456', calidad: 'apoderado' as const }

  // Copiados de la salida de `origin/main` (2026-09-23) antes del cambio.
  it('el aviso de la Política', () => {
    expect(textoAvisoPolitica()).toBe(
      'Al continuar, autoriza a METRIK IA S.A.S. a tratar su correo, dirección IP y navegador para darle acceso al módulo Valida API y proteger la cuenta, conforme a la Política de Tratamiento de Datos Personales v1.5.',
    )
  })

  it('la declaración que se firma', () => {
    expect(textoDeclaracionTerminos(doc4d, datos)).toBe(
      'Yo, Juan Guillermo Pérez, identificado(a) con cédula 79123456, actúo como APODERADO de 4D SOFT S.A.S. (NIT 901220269-6). Declaro bajo la gravedad de juramento que tengo facultades para obligarla y, en su nombre, ACEPTO los Términos de Uso, Confidencialidad y Encargo de Tratamiento de Datos — VALIDA v1.0 que leí en el módulo Valida API de MeTRIK ONE (huella SHA-256 del PDF: 85e6d157f7556a00b70e8525e7168b9dcc199dd30f6d3fcdb7567242d2575ccd). 4D SOFT S.A.S. conoce y ratifica esta actuación. Si no tuviera esas facultades, respondo personalmente. Esta aceptación vale como firma (Ley 527 de 1999).',
    )
  })

  it('la casilla', () => {
    expect(textoCasillaEntrada({ documentos: [doc4d, { titulo: 'Otro', version: 'v2' }], firmaPor: ['A', 'B'] })).toBe(
      'Leí hasta el final «Términos de Uso, Confidencialidad y Encargo de Tratamiento de Datos — VALIDA» (v1.0) y «Otro» (v2) y los acepto para mi uso de Valida API. Autorizo a METRIK IA S.A.S. a tratar mis datos conforme a la Política de Tratamiento de Datos Personales v1.5. Declaro bajo la gravedad de juramento que tengo facultades para obligar a A y B y firmo en su nombre la declaración de arriba.',
    )
  })

  it('en Valida de los CDA los tres nombran «Valida», no «Valida API»', () => {
    const cda = { ...doc4d, empresaNombre: 'CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA' }
    for (const texto of [
      textoAvisoPolitica('valida_cda'),
      textoDeclaracionTerminos(cda, datos, 'valida_cda'),
      textoCasillaEntrada({ documentos: [cda], firmaPor: [cda.empresaNombre], producto: 'valida_cda' }),
    ]) {
      expect(texto).toMatch(/\bValida\b/)
      expect(texto).not.toContain('Valida API')
    }
  })
})

describe('quién firma: la persona designada', () => {
  const designada = { designadoId: DESIGNADA, exigida: true, usuarioId: DESIGNADA }

  it('la designada firma aunque sea operadora', () => {
    expect(puedeAceptarTerminos(perfil('operator'), WS, designada)).toEqual({ puede: true })
  })

  it('con alguien designado, el dueño no firma', () => {
    expect(puedeAceptarTerminos(perfil('owner'), WS, { ...designada, usuarioId: OPERADOR })).toEqual({
      puede: false,
      razon: 'no_designado',
    })
  })

  it('un usuario sin identificar nunca es la designada', () => {
    expect(puedeAceptarTerminos(perfil('owner'), WS, { ...designada, usuarioId: null })).toEqual({
      puede: false,
      razon: 'no_designado',
    })
  })

  it('designar al soporte de MeTRIK no lo habilita, ni desde otro espacio', () => {
    expect(puedeAceptarTerminos(perfil('owner', { platformAdmin: true }), WS, designada)).toEqual({
      puede: false,
      razon: 'soporte',
    })
    expect(puedeAceptarTerminos(perfil('owner', { workspaceId: 'otro' }), WS, designada)).toEqual({
      puede: false,
      razon: 'otro_espacio',
    })
  })

  it('en los CDA, sin designada nadie firma; en Valida API sigue la regla del dueño', () => {
    expect(puedeAceptarTerminos(perfil('owner'), WS, { designadoId: null, exigida: true, usuarioId: OPERADOR })).toEqual({
      puede: false,
      razon: 'sin_designado',
    })
    expect(puedeAceptarTerminos(perfil('owner'), WS, { designadoId: null, exigida: false, usuarioId: OPERADOR })).toEqual({
      puede: true,
    })
    expect(puedeAceptarTerminos(perfil('owner'), WS)).toEqual({ puede: true })
  })
})

describe('la entrada de Valida de los CDA', () => {
  const base = {
    hoy: HOY,
    workspaceId: WS,
    producto: 'valida_cda' as const,
    designacion: { designadoId: DESIGNADA, designadoNombre: 'Alba Yurany Rosas Escandón' },
  }

  it('con el contrato aceptado, el módulo se abre a todos sin pedirles nada propio', () => {
    const e = evaluarEntrada({
      ...base,
      documentos: [ACEPTADO],
      aceptacionesUsuario: [],
      perfil: perfil('operator'),
      usuarioId: OPERADOR,
    })
    expect(e).toEqual({ estado: 'aprobada' })
  })

  it('con el contrato pendiente, el operador espera y sabe a quién', () => {
    const e = evaluarEntrada({
      ...base,
      documentos: [PENDIENTE],
      aceptacionesUsuario: [],
      perfil: perfil('operator'),
      usuarioId: OPERADOR,
    })
    expect(e.estado).toBe('pendiente')
    if (e.estado !== 'pendiente') return
    expect(e.aceptante).toEqual({ puede: false, razon: 'no_designado' })
    expect(e.designadoNombre).toBe('Alba Yurany Rosas Escandón')
    expect(puedeAprobarEntrada(e)).toBe(false)
  })

  it('la designada puede aprobar', () => {
    const e = evaluarEntrada({
      ...base,
      documentos: [PENDIENTE],
      aceptacionesUsuario: [],
      perfil: perfil('operator'),
      usuarioId: DESIGNADA,
    })
    expect(e.estado === 'pendiente' && e.aceptante).toEqual({ puede: true })
    expect(puedeAprobarEntrada(e)).toBe(true)
  })

  it('una constancia vieja con el mismo nombre y versión no le impide firmar el contrato', () => {
    const otraHuella: AceptacionUsuarioRegistrada = {
      documento_slug: PENDIENTE.slug,
      documento_version: PENDIENTE.version,
      documento_sha256: 'b'.repeat(64),
      aceptada_at: '2026-09-23T10:00:00Z',
    }
    const e = evaluarEntrada({
      ...base,
      documentos: [PENDIENTE],
      aceptacionesUsuario: [otraHuella],
      perfil: perfil('operator'),
      usuarioId: DESIGNADA,
    })
    expect(e.estado === 'pendiente' && e.conflictos).toEqual([])
    expect(puedeAprobarEntrada(e)).toBe(true)
  })

  it('sin documentos vigentes, o con la lectura caída, no se abre', () => {
    const comun = { ...base, perfil: perfil('owner'), usuarioId: DESIGNADA }
    expect(evaluarEntrada({ ...comun, documentos: [], aceptacionesUsuario: [] })).toEqual({ estado: 'sin_documentos' })
    expect(evaluarEntrada({ ...comun, documentos: null, aceptacionesUsuario: [] })).toEqual({ estado: 'no_disponible' })
  })

  it('en Valida API, en cambio, el contrato aceptado no basta: cada usuario aprueba lo suyo', () => {
    const e = evaluarEntrada({
      hoy: HOY,
      workspaceId: WS,
      documentos: [ACEPTADO],
      aceptacionesUsuario: [],
      perfil: perfil('operator'),
    })
    expect(e.estado).toBe('pendiente')
    const alDia = evaluarEntrada({
      hoy: HOY,
      workspaceId: WS,
      documentos: [ACEPTADO],
      aceptacionesUsuario: [
        { documento_slug: POLITICA_DATOS_VALIDA.slug, documento_version: POLITICA_DATOS_VALIDA.version, documento_sha256: null, aceptada_at: 'x' },
        { documento_slug: ACEPTADO.slug, documento_version: ACEPTADO.version, documento_sha256: PDF, aceptada_at: 'x' },
      ],
      perfil: perfil('operator'),
    })
    expect(alDia).toEqual({ estado: 'aprobada' })
  })
})
