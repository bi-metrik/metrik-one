/**
 * Puerta del documento de soporte de una consulta de listas restrictivas.
 *
 * Fija cuatro cosas que la pantalla no puede comprobar sola:
 *   (a) un `operator` obtiene el PDF (200), no un 403 — el menu ya lo deja
 *       entrar a /compliance/listas y `listarHistorialDual` no filtra por rol,
 *       asi que el unico bloqueo era esta ruta;
 *   (b) un rol sin acceso (`contador`) sigue rebotando con 403;
 *   (c) `?descargar=1` entrega `attachment` y sin el parametro `inline`;
 *   (d) una consulta de OTRO workspace sigue devolviendo 404.
 *
 * VISTOS FALLAR (2026-09-11), mutando una pieza por vez sobre `route.ts`:
 *   - quitar 'operator' de la lista de roles -> cayeron 6 de 12 (todo lo que
 *     pide como operator, que es el rol por defecto de los casos);
 *   - AGREGAR 'contador' a la lista -> cayo 1, el de (b);
 *   - `descargar ? 'attachment' : 'inline'` -> `'attachment'` fijo -> cayeron 2,
 *     los que comprueban que SIN parametro se conserva `inline`.
 * La mutacion que importa es la segunda: sin ella, "operator entra" y "entra
 * cualquiera" se ven exactamente igual desde este archivo.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const CONSULTA = {
  id: '8f2c1b4a-1111-2222-3333-444455556666',
  workspace_id: 'ws-alma',
  dual_id: 'dual-9',
  tipo: 'puntual',
  titulo_lote: null,
  tipo_persona: 'natural',
  nombre_consultado: 'Juan Pérez Gómez',
  documento_tipo: 'CC',
  documento_numero: '1020304050',
  severidad: 'sin_hallazgo',
  total_matches: 0,
  matches: [],
  error_mensaje: null,
  created_at: '2026-09-11T14:05:00Z',
}

// Estado que cada caso ajusta antes de pedir. Vive fuera de los mocks porque
// `vi.mock` se iza: la fabrica no puede capturar constantes del cuerpo.
const escenario = {
  role: 'operator',
  workspaceId: 'ws-alma' as string | null,
  modules: { compliance: true } as Record<string, boolean>,
}

vi.mock('@/lib/supabase/auth-user', () => ({
  getCachedUser: async () => ({ user: { id: 'user-1', email: 'op@alma.co' } }),
}))

// El PDF real arrastra @react-pdf/renderer: aqui no se prueba el documento,
// se prueba quien puede pedirlo y con que cabecera sale.
vi.mock('@/lib/compliance/pdf-soporte-dual', () => ({
  generarPDFSoporteDual: async () => Buffer.from('%PDF-1.4 falso'),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({ from: (tabla: string) => constructor(tabla) }),
}))

/**
 * Doble del query builder de Supabase. Recuerda los `.eq()` y los APLICA: sin
 * eso el caso (d) pasaria siempre, porque el filtro por workspace de la ruta no
 * tendria nada contra que fallar.
 */
function constructor(tabla: string) {
  const filtros: Record<string, unknown> = {}
  const resolver = () => {
    if (tabla === 'profiles') {
      return escenario.workspaceId
        ? { data: { workspace_id: escenario.workspaceId, role: escenario.role } }
        : { data: null }
    }
    if (tabla === 'workspaces') {
      return { data: { name: 'ALMA', slug: 'alma-afi', modules: escenario.modules } }
    }
    if (tabla === 'consultas_listas_dual') {
      const coincide =
        filtros.id === CONSULTA.id && filtros.workspace_id === CONSULTA.workspace_id
      return { data: coincide ? CONSULTA : null }
    }
    throw new Error(`tabla inesperada en el doble: ${tabla}`)
  }
  const q = {
    select: () => q,
    eq: (columna: string, valor: unknown) => {
      filtros[columna] = valor
      return q
    },
    single: async () => resolver(),
    maybeSingle: async () => resolver(),
  }
  return q
}

import { GET } from './route'

function pedir(consultaId: string, query = '') {
  const req = new Request(
    `https://alma-afi.metrikone.co/api/compliance/listas/soporte/${consultaId}${query}`,
  )
  return GET(req as unknown as Parameters<typeof GET>[0], {
    params: Promise.resolve({ consulta_id: consultaId }),
  })
}

beforeEach(() => {
  escenario.role = 'operator'
  escenario.workspaceId = 'ws-alma'
  escenario.modules = { compliance: true }
})

describe('GET /api/compliance/listas/soporte/[consulta_id] — quien puede pedirlo', () => {
  it('un operator recibe el PDF, no un 403', async () => {
    const res = await pedir(CONSULTA.id)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
  })

  it.each(['owner', 'admin', 'supervisor', 'read_only'])('%s sigue entrando', async (rol) => {
    escenario.role = rol
    const res = await pedir(CONSULTA.id)
    expect(res.status).toBe(200)
  })

  it('un contador sigue recibiendo 403', async () => {
    escenario.role = 'contador'
    const res = await pedir(CONSULTA.id)
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'permiso_denegado' })
  })

  it('sin el modulo compliance no pasa ni el operator', async () => {
    escenario.modules = {}
    const res = await pedir(CONSULTA.id)
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'modulo_no_activo' })
  })

  it('la consulta de otro workspace devuelve 404, tambien para el operator', async () => {
    escenario.workspaceId = 'ws-otro'
    const res = await pedir(CONSULTA.id)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'consulta_no_encontrada' })
  })
})

describe('GET /api/compliance/listas/soporte/[consulta_id] — abrir contra descargar', () => {
  it('sin parametro se conserva inline', async () => {
    const res = await pedir(CONSULTA.id)
    expect(res.headers.get('Content-Disposition')).toMatch(/^inline; /)
  })

  it('?descargar=1 sale como attachment y conserva el nombre', async () => {
    const res = await pedir(CONSULTA.id, '?descargar=1')
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="soporte-listas-juan-perez-gomez-1020304050-2026-09-11.pdf"',
    )
  })

  it('el nombre es el mismo con y sin el parametro', async () => {
    const abierto = await pedir(CONSULTA.id)
    const bajado = await pedir(CONSULTA.id, '?descargar=1')
    const soloNombre = (cd: string | null) => (cd ?? '').replace(/^(inline|attachment); /, '')
    expect(soloNombre(abierto.headers.get('Content-Disposition'))).toBe(
      soloNombre(bajado.headers.get('Content-Disposition')),
    )
  })

  it('un valor que no pide descarga se trata como abrir', async () => {
    const res = await pedir(CONSULTA.id, '?descargar=0')
    expect(res.headers.get('Content-Disposition')).toMatch(/^inline; /)
  })
})
