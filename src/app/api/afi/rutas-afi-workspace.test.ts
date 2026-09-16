/**
 * Las dos rutas que disparan motores de AFI solo actuan sobre negocios del workspace
 * de quien llama.
 *
 * El hueco (riesgo 11): `POST /api/afi/generar/[negocio_id]` y
 * `POST /api/afi/contrato/[negocio_id]` buscaban el negocio SOLO por id con el service
 * client y despues miraban que el negocio fuera de `afi`. Nunca comparaban el workspace
 * de la sesion: un owner o admin de CUALQUIER workspace podia disparar la generacion del
 * paquete o el armado del contrato sobre un negocio de AFI con solo conocer el id.
 *
 * Lo que se fija aqui, para las dos rutas:
 *   - el owner de AFI sobre un negocio de AFI dispara el motor (200);
 *   - el owner de OTRO workspace sobre un negocio de AFI recibe 404 y el motor no corre;
 *   - ese 404 es identico al de un id inexistente (no confirma que el negocio existe);
 *   - un negocio propio que no es de AFI sigue rebotando con 403;
 *   - un rol que no es owner/admin sigue rebotando con 403.
 *
 * EL DOBLE APLICA TODOS LOS `.eq()`: con un doble que ignora filtros, el caso del
 * workspace ajeno pasaria o fallaria por razones que no tienen que ver con la ruta.
 *
 * VISTO FALLAR (2026-09-16) contra las dos rutas de `origin/main` (sin
 * `.eq('workspace_id', workspaceId)`): cayeron los 6 casos del workspace ajeno, 3 por
 * ruta (el 404, el motor sin disparar y el 404 indistinguible); los otros 6 siguieron
 * verdes, que es lo esperado porque describen comportamiento que no cambio.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Fila = Record<string, unknown>

const TABLAS: Record<string, Fila[]> = {
  negocios: [
    { id: 'neg-afi', workspace_id: 'ws-afi' },
    { id: 'neg-otro', workspace_id: 'ws-otro' },
  ],
  workspaces: [
    { id: 'ws-afi', slug: 'afi' },
    { id: 'ws-otro', slug: 'otro' },
  ],
}

const sesion = { workspaceId: 'ws-afi' as string | null, role: 'owner' }

const disparararGeneracionAFI = vi.fn(async (_negocioId: string) => ({ ok: true }))
const generarContratoAFI = vi.fn(async (_negocioId: string) => ({ ok: true }))

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    workspaceId: sesion.workspaceId,
    role: sesion.role,
    error: sesion.workspaceId ? null : 'No autenticado',
  }),
}))

// Los motores reales arrastran docx y Drive: aqui se prueba quien puede dispararlos.
vi.mock('@/lib/afi/generar-paquete', () => ({
  disparararGeneracionAFI: (id: string) => disparararGeneracionAFI(id),
}))
vi.mock('@/lib/afi/generar-contrato', () => ({
  generarContratoAFI: (id: string) => generarContratoAFI(id),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({ from: (tabla: string) => constructor(tabla) }),
}))

function constructor(tabla: string) {
  const filtros: Record<string, unknown> = {}
  const resolver = () => {
    const filas = TABLAS[tabla]
    if (!filas) throw new Error(`tabla inesperada en el doble: ${tabla}`)
    const hallada = filas.find((f) => Object.entries(filtros).every(([c, v]) => f[c] === v))
    return { data: hallada ?? null, error: null }
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

import { POST as postGenerar } from './generar/[negocio_id]/route'
import { POST as postContrato } from './contrato/[negocio_id]/route'

const RUTAS = [
  { nombre: 'generar', post: postGenerar, motor: disparararGeneracionAFI },
  { nombre: 'contrato', post: postContrato, motor: generarContratoAFI },
] as const

function pedir(post: typeof postGenerar, negocioId: string) {
  const req = new Request(`https://afi.metrikone.co/api/afi/x/${negocioId}`, { method: 'POST' })
  return post(req as unknown as Parameters<typeof postGenerar>[0], {
    params: Promise.resolve({ negocio_id: negocioId }),
  })
}

beforeEach(() => {
  sesion.workspaceId = 'ws-afi'
  sesion.role = 'owner'
  disparararGeneracionAFI.mockClear()
  generarContratoAFI.mockClear()
})

for (const ruta of RUTAS) {
  describe(`POST /api/afi/${ruta.nombre}/[negocio_id] — workspace de la sesion`, () => {
    it('el owner de AFI dispara el motor sobre un negocio de AFI', async () => {
      const res = await pedir(ruta.post, 'neg-afi')
      expect(res.status).toBe(200)
      expect(ruta.motor).toHaveBeenCalledWith('neg-afi')
    })

    it('el owner de OTRO workspace recibe 404 sobre un negocio de AFI', async () => {
      sesion.workspaceId = 'ws-otro'
      const res = await pedir(ruta.post, 'neg-afi')
      expect(res.status).toBe(404)
    })

    it('el owner de OTRO workspace no dispara el motor', async () => {
      sesion.workspaceId = 'ws-otro'
      await pedir(ruta.post, 'neg-afi')
      expect(ruta.motor).not.toHaveBeenCalled()
    })

    it('el 404 del negocio ajeno es identico al de un id inexistente', async () => {
      sesion.workspaceId = 'ws-otro'
      const ajeno = await pedir(ruta.post, 'neg-afi')
      const inexistente = await pedir(ruta.post, 'neg-que-no-existe')
      expect(ajeno.status).toBe(inexistente.status)
      expect(await ajeno.json()).toEqual(await inexistente.json())
    })

    it('un negocio propio que no es de AFI sigue en 403', async () => {
      sesion.workspaceId = 'ws-otro'
      const res = await pedir(ruta.post, 'neg-otro')
      expect(res.status).toBe(403)
      expect(ruta.motor).not.toHaveBeenCalled()
    })

    it('un rol que no es owner ni admin sigue en 403', async () => {
      sesion.role = 'operator'
      const res = await pedir(ruta.post, 'neg-afi')
      expect(res.status).toBe(403)
      expect(ruta.motor).not.toHaveBeenCalled()
    })
  })
}
