/**
 * Con la llave de Valida vencida, la descarga funciona y la consulta nueva no (defecto de Vera,
 * 2026-10-28; cláusula 11.2 de los Términos).
 *
 * Las acciones de verdad (`descargarPDFConsultaValida`, `generarPDFLoteValida`, `pdfLoteValida`,
 * `consultarValida`) y el cliente firmado de verdad (`valida-api/cliente.ts`) contra una Valida de
 * juguete que se porta como producción después del corte:
 *   - toda llamada con `Authorization: Bearer` responde 401 invalid_api_key (`authenticate_api_key`
 *     filtra `vence_en > now()`);
 *   - las rutas firmadas de metrik-valida#83 (`/api/one/v1/clientes/{id}/reportes*`) devuelven el PDF
 *     SOLO si la firma de ONE cuadra con el cuerpo y el secreto.
 *
 * Dos causas de la llave vencida, dos formas de `config_extra`: el fin de la prueba (`valida_prueba`
 * vencida) y el reverso del pago (`valida_cliente_id` + `valida_plan`, sin `valida_prueba`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { crearDobleLotes, type DobleLotes } from '../../../test/valida-lotes-doble'

vi.hoisted(() => {
  process.env.VALIDA_API_BASE = 'https://valida.test'
  process.env.ONE_VALIDA_SECRET = 'secreto-de-prueba'
})

const CLIENTE = '8c211c68-6c25-4beb-b364-c91c284d6379'
const ACTOR = { id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', email: 'Gerencia@CDA.co' }
const C1 = '11111111-2222-4333-8444-555555555555'
const C2 = '22222222-3333-4444-8555-666666666666'

let doble: DobleLotes
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => doble }))
vi.mock('@/lib/secretos/workspace', () => ({ leerSecretosWorkspace: async () => ({}), secretoConRespaldo: () => 'llave-vencida' }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ workspaceId: 'ws-1', role: 'owner', error: null }),
}))
vi.mock('@/lib/supabase/auth-user', () => ({ getCachedUser: async () => ({ user: ACTOR }) }))
vi.mock('@/lib/modulos/exigir-modulo', async () => (await import('../../../test/exigir-modulo-doble')).dobleExigirModulo())
vi.mock('@/lib/valida-cda/puerta', () => ({
  validaCdaPermiteOperar: async () => ({ ok: true }),
  validaCdaPermiteConsultar: async () => ({ ok: true }),
}))
vi.mock('@/lib/actions/_usuarios', () => ({ resolverNombresUsuarios: async () => new Map() }))

import { consultarValida, descargarPDFConsultaValida, generarPDFLoteValida } from './valida-consultas'
import { pdfLoteValida } from './valida-lotes'
import { MODULES, reiniciarModulo } from '../../../test/exigir-modulo-doble'

type Llamada = { url: string; metodo: string; bearer: boolean; firmaValida: boolean; cuerpo: string }
const llamadas: Llamada[] = []
const PDF = new TextEncoder().encode('%PDF-1.4 reporte')

function firmaCuadra(h: Record<string, string>, cuerpo: string): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(h['X-One-Firma'] ?? '')
  if (!m) return false
  const esperada = createHmac('sha256', 'secreto-de-prueba').update(`${m[1]}.${cuerpo}`).digest('hex')
  return m[2] === esperada && h['X-One-Actor'] === ACTOR.id && h['X-One-Actor-Correo'] === ACTOR.email.toLowerCase()
}

const validaTrasElCorte = vi.fn(async (url: string, init?: RequestInit) => {
  const h = (init?.headers ?? {}) as Record<string, string>
  const cuerpo = typeof init?.body === 'string' ? init.body : ''
  const bearer = typeof h.Authorization === 'string'
  const firmaValida = firmaCuadra(h, cuerpo)
  llamadas.push({ url, metodo: init?.method ?? 'GET', bearer, firmaValida, cuerpo })
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  if (bearer) return json(401, { error: 'invalid_api_key' })
  const ruta = url.replace('https://valida.test', '')
  if (!firmaValida) return json(401, { error: 'one_firma_invalida' })
  if (ruta.startsWith(`/api/one/v1/clientes/${CLIENTE}/reportes/`) || ruta === `/api/one/v1/clientes/${CLIENTE}/reportes-lote`) {
    return new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf' } })
  }
  return json(404, { error: 'not_found' })
})

const VENCIDA = '2026-10-20T00:00:00.000Z'
const CONFIGS: Array<[string, Record<string, unknown>]> = [
  ['fin de la prueba gratis', { origen_registro: 'valida_autogestion', valida_prueba: { cliente_id: CLIENTE, consultas: 10, vence_en: VENCIDA } }],
  [
    'reverso del pago',
    {
      origen_registro: 'valida_autogestion',
      valida_cliente_id: CLIENTE,
      valida_plan: { cliente_id: CLIENTE, cobro_id: 'cobro-1', reversado: { corte: { estado: 'anulado' } } },
    },
  ],
]

describe.each(CONFIGS)('llave vencida por %s', (_causa, config) => {
  beforeEach(() => {
    llamadas.length = 0
    validaTrasElCorte.mockClear()
    vi.stubGlobal('fetch', validaTrasElCorte)
    reiniciarModulo('ws-1', { ...MODULES.cda })
    doble = crearDobleLotes({
      tablas: {
        workspaces: [{ id: 'ws-1', config_extra: config, modules: { valida_consulta: true } }],
        valida_consultas: [
          { id: 'l1', workspace_id: 'ws-1', lote_id: 'L', valida_consulta_id: C1, created_at: '2026-10-10T00:00:00Z' },
          { id: 'l2', workspace_id: 'ws-1', lote_id: 'L', valida_consulta_id: C2, created_at: '2026-10-10T00:01:00Z' },
        ],
        valida_lotes: [{ id: 'L', workspace_id: 'ws-1', estado: 'completado', total: 2, titulo: 'Octubre', severidades: {} }],
        valida_lote_filas: [
          { id: 'f1', lote_id: 'L', posicion: 1, valida_consulta_id: C1 },
          { id: 'f2', lote_id: 'L', posicion: 2, valida_consulta_id: C2 },
        ],
      },
    })
  })

  it('el PDF de una consulta se descarga (por la ruta firmada, tras el 401 de la llave)', async () => {
    const r = await descargarPDFConsultaValida(C1)
    expect(r.ok).toBe(true)
    if (r.ok) expect(Buffer.from(r.data.base64, 'base64').subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(llamadas.map((l) => [l.url, l.bearer, l.firmaValida])).toEqual([
      [`https://valida.test/api/v1/reporte/${C1}`, true, false],
      [`https://valida.test/api/one/v1/clientes/${CLIENTE}/reportes/${C1}`, false, true],
    ])
  })

  it('el PDF del lote se descarga, por las dos acciones que lo arman', async () => {
    const a = await generarPDFLoteValida('L', 'Octubre')
    const b = await pdfLoteValida('L', 0)
    expect([a.ok, b.ok]).toEqual([true, true])
    const firmadas = llamadas.filter((l) => !l.bearer)
    expect(firmadas).toHaveLength(2)
    for (const l of firmadas) {
      expect(l.url).toBe(`https://valida.test/api/one/v1/clientes/${CLIENTE}/reportes-lote`)
      expect(l.firmaValida).toBe(true)
      expect(JSON.parse(l.cuerpo)).toMatchObject({ consulta_ids: [C1, C2], actor: { usuario_id: ACTOR.id } })
    }
  })

  it('la consulta nueva NO pasa, y nunca se intenta por la ruta firmada', async () => {
    const r = await consultarValida({ tipo: 'natural', nombre: 'Juan Perez' })
    expect(r.ok).toBe(false)
    expect(llamadas.map((l) => [l.url, l.bearer])).toEqual([['https://valida.test/api/v1/validate', true]])
    expect(llamadas.some((l) => l.url.includes('/api/one/v1/'))).toBe(false)
  })
})

describe('la ruta firmada solo se usa con la llave vencida', () => {
  it('con la llave viva, la descarga va con la llave y no se firma nada', async () => {
    llamadas.length = 0
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      llamadas.push({ url, metodo: init?.method ?? 'GET', bearer: true, firmaValida: false, cuerpo: '' })
      return new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf' } })
    })
    reiniciarModulo('ws-1', { ...MODULES.cda })
    doble = crearDobleLotes({ tablas: { workspaces: [{ id: 'ws-1', config_extra: CONFIGS[1][1], modules: { valida_consulta: true } }] } })
    expect((await descargarPDFConsultaValida(C1)).ok).toBe(true)
    expect(llamadas.map((l) => l.url)).toEqual([`https://valida.test/api/v1/reporte/${C1}`])
  })
})
