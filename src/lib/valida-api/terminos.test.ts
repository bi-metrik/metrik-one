import { describe, expect, it } from 'vitest'
import type { DocumentoContractual } from './resultados'
import {
  LARGO_MAXIMO_DECLARACION,
  documentoVigente,
  estadoTerminos,
  prepararAceptacion,
  puedeAceptarTerminos,
  textoDeclaracionTerminos,
  validarDatosAceptante,
  type VersionContratada,
} from './terminos'

/**
 * Las reglas de los términos del contrato en el módulo Valida API.
 *
 * El caso que las fija es el real de 4D SOFT (2026-09-16): la v1.0 de sus términos YA está
 * aceptada por WhatsApp (def579c7) y `mis_documentos_de_servicio` la devuelve con fecha de
 * aceptación. Con esa fila, el módulo no puede volver a pedirla.
 */

const HOY = '2026-09-17'
const PDF_V10 = '85e6d157f7556a00b70e8525e7168b9dcc199dd30f6d3fcdb7567242d2575ccd'
const PDF_V11 = 'f'.repeat(64)

function doc(extra: Partial<DocumentoContractual> = {}): DocumentoContractual {
  return {
    documentoId: 'b91b4a14-cce1-4cfa-88d5-f235aa9e1060',
    slug: 'terminos-uso-valida',
    titulo: 'Términos de Uso, Confidencialidad y Encargo de Tratamiento de Datos — VALIDA',
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

const ACEPTADA_4DSOFT = doc({
  aceptadoAt: '2026-09-15T13:25:06.494446+00:00',
  aceptadoPor: 'Juan Guillermo',
  aceptadoCalidad: 'apoderado',
  aceptadoCanal: 'whatsapp',
})

const V11_ID = '00000000-0000-4000-8000-0000000000e2'
const V11 = doc({ documentoId: V11_ID, version: 'v1.1', pdfSha256: PDF_V11, vigenteDesde: '2026-09-17' })

const VERSION_V11: VersionContratada = {
  documentoId: V11_ID,
  workspaceCobradorId: 'a21bfc88-1a60-48c3-afcd-144226aa2392',
  titulo: V11.titulo,
  version: 'v1.1',
  textoSha256: 'd'.repeat(64),
  pdfSha256: PDF_V11,
  empresaNombre: '4D SOFT S.A.S.',
  empresaNit: '901220269-6',
  negocioId: 'bc069e90-4205-41ec-96c5-a2e98ec9e293',
}

const DATOS = { nombre: 'Johann Manuel Valbuena Alfonso', cedula: '79123456', calidad: 'representante_legal' as const }

describe('estadoTerminos: qué falta aceptar', () => {
  it('4D SOFT: la v1.0 aceptada por WhatsApp NO se vuelve a pedir', () => {
    expect(estadoTerminos([ACEPTADA_4DSOFT], HOY)).toEqual({ estado: 'aceptados' })
  })

  it('una versión vigente sin constancia queda pendiente', () => {
    expect(estadoTerminos([doc()], HOY)).toEqual({ estado: 'pendientes', pendientes: [doc()] })
  })

  it('una versión nueva vigente se pide aunque la anterior esté aceptada', () => {
    const r = estadoTerminos([ACEPTADA_4DSOFT, V11], HOY)
    expect(r.estado).toBe('pendientes')
    expect(r.estado === 'pendientes' && r.pendientes.map((d) => d.version)).toEqual(['v1.1'])
  })

  it('un documento con dos filas (dos constancias) cuenta como aceptado si alguna trae fecha', () => {
    expect(estadoTerminos([doc(), ACEPTADA_4DSOFT], HOY)).toEqual({ estado: 'aceptados' })
  })

  it('sin versiones vigentes no hay nada aceptado: sin_documentos, no aceptados', () => {
    expect(estadoTerminos([], HOY)).toEqual({ estado: 'sin_documentos' })
    const futura = doc({ vigenteDesde: '2027-01-01' })
    const retirada = doc({ vigenteHasta: '2026-09-16' })
    expect(estadoTerminos([futura, retirada], HOY)).toEqual({ estado: 'sin_documentos' })
  })

  it('una versión retirada ya no se exige, y la que rige hoy sí', () => {
    expect(documentoVigente(doc({ vigenteHasta: HOY }), HOY)).toBe(true)
    expect(documentoVigente(doc({ vigenteDesde: HOY }), HOY)).toBe(true)
    expect(documentoVigente(doc({ vigenteHasta: '2026-09-16' }), HOY)).toBe(false)
  })
})

describe('quién acepta', () => {
  const WS = '64010015-a9a2-4aca-be83-e456cf217d96'

  it('el dueño del espacio sí', () => {
    expect(puedeAceptarTerminos({ role: 'owner', workspaceId: WS, platformAdmin: false }, WS)).toEqual({ puede: true })
  })

  it('un admin u operador no: no obligan a la empresa', () => {
    expect(puedeAceptarTerminos({ role: 'admin', workspaceId: WS, platformAdmin: false }, WS)).toEqual({
      puede: false,
      razon: 'no_owner',
    })
  })

  it('el soporte de MeTRIK no, aunque figure como owner del espacio que visita', () => {
    expect(puedeAceptarTerminos({ role: 'owner', workspaceId: WS, platformAdmin: true }, WS)).toEqual({
      puede: false,
      razon: 'soporte',
    })
  })

  it('el perfil tiene que estar en ESTE espacio', () => {
    expect(puedeAceptarTerminos({ role: 'owner', workspaceId: 'otro', platformAdmin: false }, WS)).toEqual({
      puede: false,
      razon: 'otro_espacio',
    })
  })
})

describe('los datos de quien acepta', () => {
  it('normaliza espacios y puntos de la cédula', () => {
    expect(
      validarDatosAceptante({ nombre: '  Johann   Manuel Valbuena ', cedula: '79.123.456', calidad: 'apoderado', declaraFacultades: true }),
    ).toEqual({ ok: true, datos: { nombre: 'Johann Manuel Valbuena', cedula: '79123456', calidad: 'apoderado' } })
  })

  it('exige nombre completo, cédula numérica, calidad que obligue y la declaración marcada', () => {
    const base = { ...DATOS, declaraFacultades: true }
    expect(validarDatosAceptante({ ...base, nombre: 'Johann' }).ok).toBe(false)
    expect(validarDatosAceptante({ ...base, nombre: 'Juan 123' }).ok).toBe(false)
    expect(validarDatosAceptante({ ...base, cedula: 'CE-1234' }).ok).toBe(false)
    expect(validarDatosAceptante({ ...base, cedula: '1234' }).ok).toBe(false)
    expect(validarDatosAceptante({ ...base, calidad: 'autorizado' }).ok).toBe(false)
    expect(validarDatosAceptante({ ...base, declaraFacultades: false }).ok).toBe(false)
    expect(validarDatosAceptante({ ...base, declaraFacultades: 'true' }).ok).toBe(false)
  })
})

describe('la declaración que se firma', () => {
  const texto = textoDeclaracionTerminos(VERSION_V11, DATOS)

  it('nombra a la persona, su cédula, su calidad, la empresa con NIT, la versión y la huella del PDF', () => {
    expect(texto).toContain('Johann Manuel Valbuena Alfonso')
    expect(texto).toContain('cédula 79123456')
    expect(texto).toContain('REPRESENTANTE LEGAL de 4D SOFT S.A.S. (NIT 901220269-6)')
    expect(texto).toContain(`${VERSION_V11.titulo} v1.1`)
    expect(texto).toContain(PDF_V11)
    // Lo que la cláusula 16.2 hace declarar por WhatsApp.
    expect(texto).toContain('Declaro bajo la gravedad de juramento que tengo facultades para obligarla')
    expect(texto).toContain('Si no tuviera esas facultades, respondo personalmente')
  })

  it('cabe en la columna aun con un nombre y una empresa largos', () => {
    const largo = textoDeclaracionTerminos(
      { ...VERSION_V11, empresaNombre: 'X'.repeat(90) },
      { ...DATOS, nombre: 'Nombre '.repeat(17).trim() },
    )
    expect(largo.length).toBeLessThanOrEqual(LARGO_MAXIMO_DECLARACION)
  })
})

describe('prepararAceptacion: lo que se decide antes de escribir', () => {
  const base = {
    documentos: [ACEPTADA_4DSOFT, V11],
    hoy: HOY,
    documentoId: V11_ID,
    version: VERSION_V11,
    input: { ...DATOS, declaraFacultades: true },
    declaracionMostrada: textoDeclaracionTerminos(VERSION_V11, DATOS),
    usuarioId: '123fc989-2520-4128-9e52-3283a524a75d',
    workspaceClienteId: '64010015-a9a2-4aca-be83-e456cf217d96',
    ip: '190.24.1.10',
    userAgent: 'Mozilla/5.0',
  }

  it('arma la fila del canal módulo con la evidencia de la base, no del navegador', () => {
    const r = prepararAceptacion(base)
    expect(r.tipo).toBe('fila')
    if (r.tipo !== 'fila') return
    expect(r.fila).toEqual({
      workspace_id: VERSION_V11.workspaceCobradorId,
      negocio_id: VERSION_V11.negocioId,
      canal: 'modulo',
      estado: 'aceptado',
      nombre_aceptante: 'Johann Manuel Valbuena Alfonso',
      cedula_aceptante: '79123456',
      calidad: 'representante_legal',
      empresa_nombre: '4D SOFT S.A.S.',
      empresa_nit: '901220269-6',
      usuario_id: base.usuarioId,
      workspace_cliente_id: base.workspaceClienteId,
      documento_version_id: V11_ID,
      documento_titulo: VERSION_V11.titulo,
      documento_version: 'v1.1',
      documento_sha256: PDF_V11,
      texto_documento_sha256: 'd'.repeat(64),
      texto_aceptacion: base.declaracionMostrada,
      ip: '190.24.1.10',
      user_agent: 'Mozilla/5.0',
    })
  })

  it('lo ya aceptado (4D SOFT por WhatsApp) no se registra otra vez', () => {
    expect(prepararAceptacion({ ...base, documentoId: ACEPTADA_4DSOFT.documentoId })).toEqual({ tipo: 'ya_aceptado' })
  })

  it('un documento que la sesión no ve no se acepta', () => {
    expect(prepararAceptacion({ ...base, documentos: [ACEPTADA_4DSOFT] }).tipo).toBe('error')
  })

  it('una versión que no rige hoy no se acepta', () => {
    const r = prepararAceptacion({ ...base, hoy: '2026-09-16' })
    expect(r).toEqual({ tipo: 'error', error: 'Esa versión de los términos no está vigente hoy.' })
  })

  it('sin contrato, o con un contrato de otra versión, no se acepta', () => {
    expect(prepararAceptacion({ ...base, version: null }).tipo).toBe('error')
    expect(prepararAceptacion({ ...base, version: { ...VERSION_V11, pdfSha256: 'e'.repeat(64) } }).tipo).toBe('error')
  })

  it('si el texto que se tenía a la vista no es el que arma el servidor, no se registra', () => {
    const r = prepararAceptacion({ ...base, declaracionMostrada: base.declaracionMostrada.replace('79123456', '79123457') })
    expect(r.tipo).toBe('error')
    expect(prepararAceptacion({ ...base, declaracionMostrada: undefined }).tipo).toBe('error')
  })

  it('sin la declaración de facultades marcada no se registra', () => {
    expect(prepararAceptacion({ ...base, input: { ...DATOS, declaraFacultades: false } }).tipo).toBe('error')
  })
})
