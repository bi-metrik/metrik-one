/**
 * Las acciones del módulo Valida API frente a la entrada única.
 *
 * Lo que se fija aquí es la PUERTA DEL SERVIDOR, no la pantalla: cada export de `acciones.ts` es
 * un endpoint que se alcanza por POST aunque la página no dibuje las pestañas. Sin la aprobación
 * completa (Política + términos leídos por el usuario + contrato aceptado) ninguna acción llega a
 * Valida ni a las RPC del contrato. Y el «Acepto» registra primero lo contractual (solo el dueño
 * real), y solo si eso sale bien, las constancias del usuario.
 *
 * La puerta que se prueba es la REAL (`entrada-servidor.ts` + `entrada.ts`): se simulan solo las
 * lecturas de la base y las llamadas a Valida.
 */

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { textoCasillaEntrada, type AceptacionUsuarioRegistrada } from './entrada'
import { POLITICA_DATOS_VALIDA, textoAvisoPolitica } from './politica'
import type { DocumentoContractual } from './resultados'
import { textoDeclaracionTerminos, type VersionContratada } from './terminos'

const WS = '64010015-a9a2-4aca-be83-e456cf217d96'
const USUARIO = '123fc989-2520-4128-9e52-3283a524a75d'
const DOC_ID = 'b91b4a14-cce1-4cfa-88d5-f235aa9e1060'
const PDF = '85e6d157f7556a00b70e8525e7168b9dcc199dd30f6d3fcdb7567242d2575ccd'

const DOC: DocumentoContractual = {
  documentoId: DOC_ID,
  slug: 'terminos-uso-valida',
  titulo: 'Términos de Uso de VALIDA',
  version: 'v1.0',
  textoMd: '# Términos\n\n3.1. Las credenciales se entregan únicamente después de la aceptación.',
  pdfSha256: PDF,
  vigenteDesde: '2026-09-15',
  vigenteHasta: null,
  aceptadoAt: null,
  aceptadoPor: null,
  aceptadoCalidad: null,
  aceptadoCanal: null,
}
const DOC_ACEPTADO: DocumentoContractual = { ...DOC, aceptadoAt: '2026-09-15T13:25:06Z', aceptadoPor: 'Juan Guillermo', aceptadoCanal: 'whatsapp' }

const VERSION: VersionContratada = {
  documentoId: DOC_ID,
  workspaceCobradorId: 'a21bfc88-1a60-48c3-afcd-144226aa2392',
  titulo: DOC.titulo,
  version: 'v1.0',
  textoSha256: 'd'.repeat(64),
  pdfSha256: PDF,
  empresaNombre: '4D SOFT S.A.S.',
  empresaNit: '901220269-6',
  negocioId: 'bc069e90-4205-41ec-96c5-a2e98ec9e293',
}

const POLITICA: AceptacionUsuarioRegistrada = {
  documento_slug: POLITICA_DATOS_VALIDA.slug,
  documento_version: POLITICA_DATOS_VALIDA.version,
  documento_sha256: null,
  aceptada_at: '2026-09-17T10:00:00Z',
}
const LEYO: AceptacionUsuarioRegistrada = {
  documento_slug: DOC.slug,
  documento_version: DOC.version,
  documento_sha256: PDF,
  aceptada_at: '2026-09-17T10:00:00Z',
}

/** La fila registrada de la versión: sus dos huellas (`documentos_contractuales_versiones`). */
const VERSION_REGISTRADA = { id: DOC_ID, texto_sha256: createHash('sha256').update(DOC.textoMd, 'utf8').digest('hex'), pdf_sha256: PDF }

const escenario: {
  documentos: DocumentoContractual[] | null
  aceptaciones: AceptacionUsuarioRegistrada[] | null
  versiones: (typeof VERSION_REGISTRADA)[] | null
  perfil: { role: string | null; workspaceId: string | null; platformAdmin: boolean } | null
  errorContrato: { code: string; message: string } | null
  errorUsuario: { code: string; message: string } | null
} = { documentos: [DOC_ACEPTADO], aceptaciones: [], versiones: [VERSION_REGISTRADA], perfil: null, errorContrato: null, errorUsuario: null }

const llamarValida = vi.fn()
const rpc = vi.fn()
const escrituras: { tabla: string; op: 'insert' | 'upsert'; filas: unknown }[] = []

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/dates/bogota', () => ({ todayBogotaISO: () => '2026-09-17' }))
vi.mock('@/lib/actions/get-workspace', () => ({ getWorkspace: async () => ({ supabase: { rpc } }) }))
vi.mock('./cliente', () => ({ llamarValida: (...args: unknown[]) => llamarValida(...args) }))
vi.mock('./contexto', () => ({
  contextoValidaApi: async () => ({
    tipo: 'ok',
    workspaceId: WS,
    userId: USUARIO,
    // El rol de la sesión puede venir de «Ver como»: quién firma lo decide el perfil REAL.
    role: 'owner',
    clienteId: '8c211c68-6c25-4beb-b364-c91c284d6379',
    actor: { usuario_id: USUARIO, email: 'juan@4dsoft.co' },
  }),
  origenPeticion: async () => ({ ip: '190.24.1.10', userAgent: 'Mozilla/5.0' }),
}))
vi.mock('./terminos-servidor', () => ({
  documentosDelCliente: async () =>
    escenario.documentos ? { ok: true, documentos: escenario.documentos } : { ok: false, motivo: 'base' },
  perfilReal: async () => escenario.perfil,
  versionContratada: async () => VERSION,
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (tabla: string) => {
      const filas = tabla === 'documentos_contractuales_versiones' ? escenario.versiones : escenario.aceptaciones
      const lectura = {
        select: () => lectura,
        eq: () => lectura,
        in: () => lectura,
        order: () => lectura,
        then: (resolver: (r: unknown) => unknown) =>
          resolver(filas === null ? { data: null, error: { message: 'caída' } } : { data: filas, error: null }),
      }
      return {
        ...lectura,
        insert: async (filas: unknown) => {
          escrituras.push({ tabla, op: 'insert', filas })
          return { error: escenario.errorContrato }
        },
        upsert: async (filas: unknown) => {
          escrituras.push({ tabla, op: 'upsert', filas })
          return { error: escenario.errorUsuario }
        },
      }
    },
  }),
}))

const {
  aprobarEntradaValidaApi,
  estadoEntradaValidaApi,
  generarLlaveValidaApi,
  leerLlavesValidaApi,
  leerPagosValidaApi,
  leerResumenValidaApi,
  leerTerminosAprobadosValidaApi,
  revocarLlaveValidaApi,
} = await import('./acciones')

const DATOS = { nombre: 'Johann Manuel Valbuena Alfonso', cedula: '79123456', calidad: 'representante_legal' as const }
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

const DUENO = { role: 'owner', workspaceId: WS, platformAdmin: false }

beforeEach(() => {
  escenario.documentos = [DOC_ACEPTADO]
  escenario.aceptaciones = []
  escenario.versiones = [VERSION_REGISTRADA]
  escenario.perfil = DUENO
  escenario.errorContrato = null
  escenario.errorUsuario = null
  escrituras.length = 0
  llamarValida.mockReset()
  llamarValida.mockResolvedValue({ tipo: 'ok', datos: { llaves: [], limite_vigentes: 3 } })
  rpc.mockReset()
  rpc.mockResolvedValue({ data: [], error: null })
})

describe('sin la entrada aprobada no hay NINGUNA acción, tampoco por el servidor', () => {
  const todas = async () => [
    await leerResumenValidaApi(),
    await leerLlavesValidaApi(),
    await leerPagosValidaApi(),
    await leerTerminosAprobadosValidaApi(),
    await generarLlaveValidaApi({ nombre: 'ERP' }),
    await generarLlaveValidaApi({ reemplazaA: '00000000-0000-4000-8000-00000000abcd' }),
    await revocarLlaveValidaApi('00000000-0000-4000-8000-00000000abcd'),
  ]
  const negada = (r: unknown) => {
    const x = r as { estado?: string; ok?: boolean }
    return x.estado === 'sin_acceso' || x.ok === false
  }

  it('4D SOFT hoy (contrato aceptado por WhatsApp, usuario sin constancias): todo se niega', async () => {
    const resultados = await todas()
    expect(resultados.every(negada)).toBe(true)
    expect(llamarValida).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('con solo la Política, o solo la lectura de los términos, también', async () => {
    for (const aceptaciones of [[POLITICA], [LEYO]]) {
      escenario.aceptaciones = aceptaciones
      expect((await todas()).every(negada)).toBe(true)
    }
    expect(llamarValida).not.toHaveBeenCalled()
  })

  it('con el usuario al día pero el contrato sin aceptar, también', async () => {
    escenario.documentos = [DOC]
    escenario.aceptaciones = [POLITICA, LEYO]
    expect((await todas()).every(negada)).toBe(true)
    expect(llamarValida).not.toHaveBeenCalled()
  })

  it('si no se pueden leer las aceptaciones o los documentos, se niega (fail-closed)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    escenario.aceptaciones = null
    expect((await todas()).every(negada)).toBe(true)
    escenario.aceptaciones = [POLITICA, LEYO]
    escenario.documentos = null
    expect((await todas()).every(negada)).toBe(true)
    expect(llamarValida).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('con la entrada aprobada, el consumo y las llaves sí llegan a Valida', async () => {
    escenario.aceptaciones = [POLITICA, LEYO]
    expect((await leerResumenValidaApi()).estado).toBe('ok')
    expect((await leerLlavesValidaApi()).estado).toBe('ok')
    expect(llamarValida).toHaveBeenCalledTimes(2)
  })
})

describe('releer los términos aprobados', () => {
  it('con la entrada aprobada, entrega el texto de la versión que el usuario aprobó, verificado', async () => {
    escenario.aceptaciones = [POLITICA, LEYO]
    const r = await leerTerminosAprobadosValidaApi()
    expect(r).toEqual({
      estado: 'ok',
      datos: [
        {
          estado: 'verificado',
          documentoId: DOC_ID,
          titulo: DOC.titulo,
          version: 'v1.0',
          textoMd: DOC.textoMd,
          aprobadoAt: LEYO.aceptada_at,
          contrato: { aceptadoAt: '2026-09-15T13:25:06Z', aceptadoPor: 'Juan Guillermo', canal: 'whatsapp' },
        },
      ],
    })
  })

  it('si la huella registrada del texto no coincide, no entrega texto', async () => {
    escenario.aceptaciones = [POLITICA, LEYO]
    escenario.versiones = [{ ...VERSION_REGISTRADA, texto_sha256: 'e'.repeat(64) }]
    const r = await leerTerminosAprobadosValidaApi()
    expect(r.estado === 'ok' && r.datos).toEqual([expect.objectContaining({ estado: 'no_verificado', motivo: 'huella_distinta' })])
    expect(JSON.stringify(r)).not.toContain('3.1. Las credenciales')
  })

  it('si no se pueden leer las huellas de las versiones, «no disponible», no una lista vacía', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    escenario.aceptaciones = [POLITICA, LEYO]
    escenario.versiones = null
    expect(await leerTerminosAprobadosValidaApi()).toEqual({ estado: 'no_disponible', motivo: 'base' })
    log.mockRestore()
  })
})

describe('lo que muestra la entrada', () => {
  it('aprobada no pinta la entrada', async () => {
    escenario.aceptaciones = [POLITICA, LEYO]
    expect(await estadoEntradaValidaApi()).toEqual({ estado: 'aprobada' })
  })

  it('con el contrato aceptado, cualquier usuario lee los términos y aprueba sin firmar', async () => {
    const e = await estadoEntradaValidaApi()
    expect(e.estado).toBe('pendiente')
    if (e.estado !== 'pendiente') return
    expect(e.documentos).toEqual([
      { documentoId: DOC_ID, slug: DOC.slug, titulo: DOC.titulo, version: 'v1.0', textoMd: DOC.textoMd },
    ])
    expect(e.contrato).toEqual({ estado: 'aceptado' })
  })

  it('con el contrato pendiente, el dueño ve lo que firma', async () => {
    escenario.documentos = [DOC]
    const e = await estadoEntradaValidaApi()
    expect(e.estado === 'pendiente' && e.contrato).toEqual({
      estado: 'pendiente',
      puede: true,
      empresas: ['4D SOFT S.A.S.'],
      porFirmar: [
        { documentoId: DOC_ID, titulo: DOC.titulo, version: 'v1.0', pdfSha256: PDF, empresaNombre: '4D SOFT S.A.S.', empresaNit: '901220269-6' },
      ],
    })
  })

  it('con el contrato pendiente, el soporte ve por qué no puede', async () => {
    escenario.documentos = [DOC]
    escenario.perfil = { ...DUENO, platformAdmin: true }
    const e = await estadoEntradaValidaApi()
    expect(e.estado === 'pendiente' && e.contrato).toEqual({ estado: 'pendiente', puede: false, razon: 'soporte' })
  })

  it('sin documentos vigentes, y con la lectura caída, el módulo no se abre', async () => {
    escenario.documentos = []
    expect(await estadoEntradaValidaApi()).toEqual({ estado: 'sin_documentos' })
    escenario.documentos = null
    expect(await estadoEntradaValidaApi()).toEqual({ estado: 'no_disponible' })
  })
})

describe('aprobar la entrada: un usuario con el contrato ya aceptado', () => {
  const casilla = textoCasillaEntrada({ documentos: [DOC], firmaPor: null })
  const aprobar = (extra: Record<string, unknown> = {}) =>
    aprobarEntradaValidaApi({ leyoHastaElFinal: true, casillaMostrada: casilla, ...extra } as Parameters<
      typeof aprobarEntradaValidaApi
    >[0])

  it('registra en UNA sentencia la Política y la lectura de cada documento, y nada contractual', async () => {
    expect(await aprobar()).toEqual({ ok: true, yaEstaba: false })
    expect(escrituras).toHaveLength(1)
    expect(escrituras[0]).toMatchObject({ tabla: 'documentos_aceptaciones_usuario', op: 'upsert' })
    expect(escrituras[0].filas).toEqual([
      expect.objectContaining({
        usuario_id: USUARIO,
        workspace_id: WS,
        documento_slug: 'politica-datos-valida',
        documento_version: '1.5',
        aviso_texto_sha256: sha(textoAvisoPolitica()),
      }),
      expect.objectContaining({
        usuario_id: USUARIO,
        documento_slug: DOC.slug,
        documento_version: 'v1.0',
        documento_sha256: PDF,
        aviso_texto_sha256: sha(casilla),
        ip: '190.24.1.10',
        user_agent: 'Mozilla/5.0',
      }),
    ])
  })

  it('el soporte de MeTRIK también hace SU aprobación cuando el contrato ya está aceptado', async () => {
    escenario.perfil = { ...DUENO, platformAdmin: true }
    expect((await aprobar()).ok).toBe(true)
    expect(escrituras.map((e) => e.tabla)).toEqual(['documentos_aceptaciones_usuario'])
  })

  it('sin haber llegado al final de los términos, nada', async () => {
    expect((await aprobar({ leyoHastaElFinal: false })).ok).toBe(false)
    expect(escrituras).toHaveLength(0)
  })

  it('si la casilla que tenía a la vista no es la que arma el servidor, nada', async () => {
    expect((await aprobar({ casillaMostrada: 'Acepto todo.' })).ok).toBe(false)
    expect(escrituras).toHaveLength(0)
  })

  it('sin documentos vigentes o con la lectura caída, nada', async () => {
    escenario.documentos = []
    expect((await aprobar()).ok).toBe(false)
    escenario.documentos = null
    expect((await aprobar()).ok).toBe(false)
    expect(escrituras).toHaveLength(0)
  })

  it('si ya estaba aprobada, responde ok sin escribir', async () => {
    escenario.aceptaciones = [POLITICA, LEYO]
    expect(await aprobar()).toEqual({ ok: true, yaEstaba: true })
    expect(escrituras).toHaveLength(0)
  })

  it('si la base rechaza la constancia, se dice: no se da por aprobada', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    escenario.errorUsuario = { code: '23514', message: 'check' }
    expect((await aprobar()).ok).toBe(false)
    log.mockRestore()
  })
})

describe('aprobar la entrada: el contrato está pendiente', () => {
  const casillaFirma = textoCasillaEntrada({ documentos: [DOC], firmaPor: ['4D SOFT S.A.S.'] })
  const firma = (extra: Record<string, unknown> = {}) => ({
    ...DATOS,
    declaraciones: [{ documentoId: DOC_ID, texto: textoDeclaracionTerminos(VERSION, DATOS) }],
    ...extra,
  })
  const aprobar = (extra: Record<string, unknown> = {}) =>
    aprobarEntradaValidaApi({ leyoHastaElFinal: true, casillaMostrada: casillaFirma, firma: firma(), ...extra } as Parameters<
      typeof aprobarEntradaValidaApi
    >[0])

  beforeEach(() => {
    escenario.documentos = [DOC]
  })

  it('el dueño real: primero la aceptación contractual, después sus constancias', async () => {
    expect(await aprobar()).toEqual({ ok: true, yaEstaba: false })
    expect(escrituras.map((e) => `${e.op}:${e.tabla}`)).toEqual([
      'insert:aceptaciones_terminos',
      'upsert:documentos_aceptaciones_usuario',
    ])
    expect(escrituras[0].filas).toEqual([
      expect.objectContaining({
        canal: 'modulo',
        usuario_id: USUARIO,
        workspace_cliente_id: WS,
        documento_version_id: DOC_ID,
        documento_sha256: PDF,
        cedula_aceptante: '79123456',
        texto_aceptacion: textoDeclaracionTerminos(VERSION, DATOS),
      }),
    ])
    expect((escrituras[1].filas as { aviso_texto_sha256: string }[])[1].aviso_texto_sha256).toBe(sha(casillaFirma))
  })

  it('si la aceptación contractual falla, no se registra nada más', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    escenario.errorContrato = { code: 'P0001', message: 'solo el dueño del espacio acepta' }
    const r = await aprobar()
    expect(r.ok).toBe(false)
    expect(escrituras.map((e) => e.tabla)).toEqual(['aceptaciones_terminos'])
    log.mockRestore()
  })

  it('si otra pestaña (o WhatsApp) ya la registró, sigue con las constancias del usuario', async () => {
    escenario.errorContrato = { code: '23505', message: 'duplicate key' }
    expect((await aprobar()).ok).toBe(true)
    expect(escrituras.map((e) => e.tabla)).toEqual(['aceptaciones_terminos', 'documentos_aceptaciones_usuario'])
  })

  it('si lo contractual quedó y las constancias del usuario no, lo dice', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    escenario.errorUsuario = { code: '23514', message: 'check' }
    const r = await aprobar()
    expect(r).toEqual({ ok: false, error: 'La aceptación del contrato quedó registrada, pero no tu aprobación. Intenta de nuevo.' })
    log.mockRestore()
  })

  it('sin datos de firma, o con una declaración distinta de la que arma el servidor, nada', async () => {
    expect((await aprobar({ firma: null })).ok).toBe(false)
    expect((await aprobar({ firma: firma({ declaraciones: [{ documentoId: DOC_ID, texto: 'Acepto.' }] }) })).ok).toBe(false)
    expect((await aprobar({ firma: firma({ cedula: 'CE-12' }) })).ok).toBe(false)
    // La casilla sin la declaración de facultades no sirve para firmar.
    expect((await aprobar({ casillaMostrada: textoCasillaEntrada({ documentos: [DOC], firmaPor: null }) })).ok).toBe(false)
    expect(escrituras).toHaveLength(0)
  })

  it('el soporte de MeTRIK nunca firma el contrato, ni su aprobación queda registrada', async () => {
    escenario.perfil = { ...DUENO, platformAdmin: true }
    expect(await aprobar()).toEqual({
      ok: false,
      error: 'El soporte de MeTRIK no acepta términos por un cliente: los acepta el dueño del espacio.',
    })
    expect(escrituras).toHaveLength(0)
  })

  it('quien no es dueño del espacio no escribe nada, aunque «Ver como» diga owner', async () => {
    escenario.perfil = { role: 'operator', workspaceId: WS, platformAdmin: false }
    expect((await aprobar()).ok).toBe(false)
    expect(escrituras).toHaveLength(0)
  })
})
