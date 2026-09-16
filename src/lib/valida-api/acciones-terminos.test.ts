/**
 * Las acciones del módulo Valida API frente a los términos del contrato.
 *
 * Lo que se fija aquí es la PUERTA DEL SERVIDOR, no la pantalla: cada export de `acciones.ts` es
 * un endpoint que se alcanza por POST aunque la pestaña Llaves no se dibuje. Sin términos vigentes
 * aceptados, ni leer ni generar llaves llega a Valida. Y la aceptación la registra solo el dueño
 * real del espacio, con la fila que arma el servidor.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentoContractual } from './resultados'
import { textoDeclaracionTerminos, type EstadoTerminos, type VersionContratada } from './terminos'

const WS = '64010015-a9a2-4aca-be83-e456cf217d96'
const USUARIO = '123fc989-2520-4128-9e52-3283a524a75d'
const DOC_ID = '00000000-0000-4000-8000-0000000000e2'
const PDF = 'f'.repeat(64)

const DOC: DocumentoContractual = {
  documentoId: DOC_ID,
  slug: 'terminos-uso-valida',
  titulo: 'Términos de Uso — VALIDA',
  version: 'v1.1',
  textoMd: '# Términos',
  pdfSha256: PDF,
  vigenteDesde: '2026-09-01',
  vigenteHasta: null,
  aceptadoAt: null,
  aceptadoPor: null,
  aceptadoCalidad: null,
  aceptadoCanal: null,
}

const VERSION: VersionContratada = {
  documentoId: DOC_ID,
  workspaceCobradorId: 'a21bfc88-1a60-48c3-afcd-144226aa2392',
  titulo: DOC.titulo,
  version: 'v1.1',
  textoSha256: 'd'.repeat(64),
  pdfSha256: PDF,
  empresaNombre: '4D SOFT S.A.S.',
  empresaNit: '901220269-6',
  negocioId: 'bc069e90-4205-41ec-96c5-a2e98ec9e293',
}

const escenario: {
  terminos: EstadoTerminos | { estado: 'no_disponible' }
  documentos: DocumentoContractual[]
  perfil: { role: string | null; workspaceId: string | null; platformAdmin: boolean } | null
  politicaAceptada: boolean
  errorInsert: { code: string; message: string } | null
} = {
  terminos: { estado: 'pendientes', pendientes: [DOC] },
  documentos: [DOC],
  perfil: { role: 'owner', workspaceId: WS, platformAdmin: false },
  politicaAceptada: true,
  errorInsert: null,
}

const llamarValida = vi.fn()
const inserts: { tabla: string; fila: unknown }[] = []

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({ getWorkspace: async () => ({ supabase: {} }) }))
vi.mock('./cliente', () => ({ llamarValida: (...args: unknown[]) => llamarValida(...args) }))
vi.mock('./contexto', () => ({
  contextoValidaApi: async () => ({
    tipo: 'ok',
    workspaceId: WS,
    userId: USUARIO,
    // El rol de la sesión puede venir de «Ver como»: quién acepta lo decide el perfil REAL.
    role: 'owner',
    clienteId: '8c211c68-6c25-4beb-b364-c91c284d6379',
    actor: { usuario_id: USUARIO, email: 'juan@4dsoft.co' },
  }),
  origenPeticion: async () => ({ ip: '190.24.1.10', userAgent: 'Mozilla/5.0' }),
}))
vi.mock('./terminos-servidor', () => ({
  terminosDelCliente: async () => escenario.terminos,
  documentosDelCliente: async () => ({ ok: true, documentos: escenario.documentos }),
  perfilReal: async () => escenario.perfil,
  versionContratada: async () => VERSION,
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (tabla: string) => {
      if (tabla === 'documentos_aceptaciones_usuario') {
        const q = {
          select: () => q,
          eq: () => q,
          order: () => q,
          then: (resolver: (r: unknown) => unknown) =>
            resolver({
              data: escenario.politicaAceptada ? [{ documento_version: '1.5', aceptada_at: '2026-09-16' }] : [],
              error: null,
            }),
        }
        return q
      }
      return {
        insert: async (fila: unknown) => {
          inserts.push({ tabla, fila })
          return { error: escenario.errorInsert }
        },
      }
    },
  }),
}))

const { aceptarTerminosValidaApi, generarLlaveValidaApi, leerLlavesValidaApi, revocarLlaveValidaApi } = await import(
  './acciones'
)

const DATOS = { nombre: 'Johann Manuel Valbuena Alfonso', cedula: '79123456', calidad: 'representante_legal' as const }
const aceptar = (extra: Record<string, unknown> = {}) =>
  aceptarTerminosValidaApi({
    documentoId: DOC_ID,
    ...DATOS,
    declaraFacultades: true,
    declaracionMostrada: textoDeclaracionTerminos(VERSION, DATOS),
    ...extra,
  } as Parameters<typeof aceptarTerminosValidaApi>[0])

beforeEach(() => {
  escenario.terminos = { estado: 'pendientes', pendientes: [DOC] }
  escenario.documentos = [DOC]
  escenario.perfil = { role: 'owner', workspaceId: WS, platformAdmin: false }
  escenario.politicaAceptada = true
  escenario.errorInsert = null
  inserts.length = 0
  llamarValida.mockReset()
  llamarValida.mockResolvedValue({ tipo: 'ok', datos: { llaves: [], limite_vigentes: 3 } })
})

describe('sin términos aceptados no hay llaves, tampoco por el servidor', () => {
  it('leer llaves no llega a Valida', async () => {
    const estados: (EstadoTerminos | { estado: 'no_disponible' })[] = [
      { estado: 'pendientes', pendientes: [DOC] },
      { estado: 'sin_documentos' },
      { estado: 'no_disponible' },
    ]
    for (const estado of estados) {
      escenario.terminos = estado
      const r = await leerLlavesValidaApi()
      expect(r.estado, estado.estado).toBe('sin_acceso')
    }
    expect(llamarValida).not.toHaveBeenCalled()
  })

  it('generar y regenerar tampoco', async () => {
    const nueva = await generarLlaveValidaApi({ nombre: 'ERP' })
    const regenerada = await generarLlaveValidaApi({ reemplazaA: '00000000-0000-4000-8000-00000000abcd' })
    expect(nueva.ok).toBe(false)
    expect(regenerada.ok).toBe(false)
    expect(llamarValida).not.toHaveBeenCalled()
  })

  it('con los términos aceptados, leer llaves sí llega a Valida', async () => {
    escenario.terminos = { estado: 'aceptados' }
    const r = await leerLlavesValidaApi()
    expect(r.estado).toBe('ok')
    expect(llamarValida).toHaveBeenCalledTimes(1)
  })

  it('revocar NO se bloquea: quita acceso, no lo entrega', async () => {
    llamarValida.mockResolvedValue({ tipo: 'ok', datos: { ok: true, key_id: 'k' } })
    const r = await revocarLlaveValidaApi('00000000-0000-4000-8000-00000000abcd')
    expect(r.ok).toBe(true)
    expect(llamarValida).toHaveBeenCalledTimes(1)
  })
})

describe('aceptar los términos', () => {
  it('el dueño real del espacio los acepta: se escribe la fila del canal módulo', async () => {
    expect(await aceptar()).toEqual({ ok: true, yaEstaba: false })
    expect(inserts).toHaveLength(1)
    expect(inserts[0].tabla).toBe('aceptaciones_terminos')
    expect(inserts[0].fila).toMatchObject({
      canal: 'modulo',
      usuario_id: USUARIO,
      workspace_cliente_id: WS,
      documento_version_id: DOC_ID,
      documento_sha256: PDF,
      texto_aceptacion: textoDeclaracionTerminos(VERSION, DATOS),
      ip: '190.24.1.10',
    })
  })

  it('quien no es dueño del espacio no escribe nada, aunque «Ver como» diga owner', async () => {
    escenario.perfil = { role: 'operator', workspaceId: WS, platformAdmin: false }
    const r = await aceptar()
    expect(r.ok).toBe(false)
    expect(inserts).toHaveLength(0)
  })

  it('el soporte de MeTRIK no acepta por el cliente', async () => {
    escenario.perfil = { role: 'owner', workspaceId: WS, platformAdmin: true }
    const r = await aceptar()
    expect(r).toEqual({
      ok: false,
      error: 'El soporte de MeTRIK no acepta términos por un cliente: los acepta el dueño del espacio.',
    })
    expect(inserts).toHaveLength(0)
  })

  it('sin la Política aceptada primero, no', async () => {
    escenario.politicaAceptada = false
    expect((await aceptar()).ok).toBe(false)
    expect(inserts).toHaveLength(0)
  })

  it('un texto distinto del que arma el servidor no se registra', async () => {
    const r = await aceptar({ declaracionMostrada: 'Acepto todo.' })
    expect(r.ok).toBe(false)
    expect(inserts).toHaveLength(0)
  })

  it('lo ya aceptado responde ok sin escribir otra constancia', async () => {
    escenario.documentos = [{ ...DOC, aceptadoAt: '2026-09-15T13:25:06Z', aceptadoPor: 'Juan Guillermo' }]
    expect(await aceptar()).toEqual({ ok: true, yaEstaba: true })
    expect(inserts).toHaveLength(0)
  })

  it('si la base ya la tenía (otra pestaña), se da por aceptada', async () => {
    escenario.errorInsert = { code: '23505', message: 'duplicate key' }
    expect(await aceptar()).toEqual({ ok: true, yaEstaba: true })
  })

  it('cualquier otro rechazo de la base se dice, no se da por aceptado', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    escenario.errorInsert = { code: 'P0001', message: 'solo el dueño del espacio acepta' }
    const r = await aceptar()
    expect(r.ok).toBe(false)
    log.mockRestore()
  })
})
