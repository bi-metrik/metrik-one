/**
 * Las acciones del cargue masivo en el servidor (2026-10-15): crear el lote (con la bolsa ANTES de
 * arrancar), el progreso (que renueva la autorización o pausa el lote), y el PDF por partes en el
 * orden del archivo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { crearDobleLotes, type DobleLotes } from '../../../test/valida-lotes-doble'

let doble: DobleLotes
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => doble }))
vi.mock('@/lib/secretos/workspace', () => ({ leerSecretosWorkspace: async () => ({}), secretoConRespaldo: () => 'llave-ws' }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ workspaceId: 'ws-1', role: 'owner', error: null }),
}))
vi.mock('@/lib/supabase/auth-user', () => ({ getCachedUser: async () => ({ user: { id: 'user-1' } }) }))
vi.mock('@/lib/modulos/exigir-modulo', async () => (await import('../../../test/exigir-modulo-doble')).dobleExigirModulo())
const puerta: { consultar: { ok: true } | { ok: false; error: string } } = { consultar: { ok: true } }
vi.mock('@/lib/valida-cda/puerta', () => ({
  validaCdaPermiteOperar: async () => ({ ok: true }),
  validaCdaPermiteConsultar: async () => puerta.consultar,
}))

import { crearLoteValida, pdfLoteValida, progresoLoteValida } from './valida-lotes'
import { MODULES, reiniciarModulo } from '../../../test/exigir-modulo-doble'

// El saldo de la bolsa que responde `GET /cuenta/consumo` (null = sin bolsa: plan mensual o CDA).
let bolsa: { saldo: number; estado?: string } | null = null
const reportes: string[][] = []
const fetchFalso = vi.fn(async (url: string, init?: { body?: string }) => {
  if (url.endsWith('/api/v1/cuenta/consumo')) {
    return {
      ok: true,
      status: 200,
      json: async () =>
        bolsa
          ? { modalidad: 'bolsa', bolsa: { saldo: bolsa.saldo, consultas_compradas: 50, estado: bolsa.estado ?? 'activa', vence_en: '2027-01-01T00:00:00Z' } }
          : { modalidad: 'mensual' },
    }
  }
  if (url.endsWith('/api/v1/reporte-lote')) {
    reportes.push(JSON.parse(init!.body!).consulta_ids)
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) }
  }
  throw new Error(`fetch inesperado: ${url}`)
})

function xlsx(filas: unknown[][]): FormData {
  const hoja = XLSX.utils.aoa_to_sheet([['tipo_persona', 'nombre_completo', 'tipo_documento', 'numero_documento', 'negocio_codigo'], ...filas])
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, hoja, 'Consultas')
  const buf = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const fd = new FormData()
  fd.set('archivo', new File([new Uint8Array(buf)], 'lote.xlsx'))
  return fd
}

const personas = (n: number) => Array.from({ length: n }, (_, i) => ['natural', `Persona ${i + 1}`, '', '', ''])

beforeEach(() => {
  doble = crearDobleLotes({
    tablas: {
      workspaces: [{ id: 'ws-1', config_extra: {}, modules: { valida_consulta: true } }],
      negocios: [
        { id: 'neg-propio', workspace_id: 'ws-1', codigo: 'P 26 1' },
        { id: 'neg-ajeno', workspace_id: 'ws-2', codigo: 'A 26 9' },
      ],
    },
  })
  bolsa = null
  reportes.length = 0
  puerta.consultar = { ok: true }
  reiniciarModulo('ws-1', { ...MODULES.cda })
  vi.stubGlobal('fetch', fetchFalso)
})

describe('crear el lote', () => {
  it('guarda el lote y sus filas en el orden del archivo, en cola, con la autorización de la sesión', async () => {
    const r = await crearLoteValida(xlsx([...personas(2), ['juridica', 'Acme SAS', 'NIT', '900123456', 'P 26 1']]), { titulo: 'Mayo' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.lote).toMatchObject({ estado: 'en_cola', total: 3, titulo: 'Mayo', procesadas: 0 })
    const filas = doble.tablas.valida_lote_filas
    expect(filas.map((f) => f.posicion)).toEqual([1, 2, 3])
    expect(filas[2]).toMatchObject({
      entrada: { tipo: 'juridica', nombre: 'Acme SAS', documento: { tipo: 'NIT', numero: '900123456' } },
      negocio_id: 'neg-propio',
    })
    const lote = doble.tablas.valida_lotes[0]
    expect(lote.created_by).toBe('user-1')
    expect(Date.parse(lote.autorizado_hasta as string)).toBeGreaterThan(Date.now())
    expect(lote.huella_acceso).toBe('')
  })

  it('más de 10.000 filas no entran (pide dividir el archivo)', async () => {
    const r = await crearLoteValida(xlsx(personas(10_001)))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/máximo por cargue es 10\.000/)
    expect(doble.tablas.valida_lotes ?? []).toHaveLength(0)
  })

  it('10.000 filas sí entran', async () => {
    const r = await crearLoteValida(xlsx(personas(10_000)))
    expect(r.ok && r.lote.total).toBe(10_000)
  }, 30_000)

  it('la bolsa que no alcanza NO arranca: dice cuántas alcanzan', async () => {
    bolsa = { saldo: 3 }
    const r = await crearLoteValida(xlsx(personas(5)))
    expect(r).toEqual({ ok: false, error: 'saldo_insuficiente', alcanzan: 3, consultables: 5, total: 5 })
    expect(doble.tablas.valida_lotes ?? []).toHaveLength(0)
  })

  it('aceptando, procesa solo las primeras que alcanzan y cuenta las omitidas', async () => {
    bolsa = { saldo: 3 }
    const r = await crearLoteValida(xlsx(personas(5)), { limite: 3 })
    expect(r.ok && r.lote).toMatchObject({ total: 3, omitidas: 2 })
    expect(doble.tablas.valida_lote_filas.map((f) => (f.entrada as { nombre: string }).nombre)).toEqual(['Persona 1', 'Persona 2', 'Persona 3'])
  })

  it('un límite mayor que el saldo no se acepta', async () => {
    bolsa = { saldo: 3 }
    const r = await crearLoteValida(xlsx(personas(5)), { limite: 4 })
    expect(r.ok).toBe(false)
    expect(doble.tablas.valida_lotes ?? []).toHaveLength(0)
  })

  it('con la bolsa ya cortada no se crea nada y se dice el corte', async () => {
    bolsa = { saldo: 0, estado: 'agotada' }
    const r = await crearLoteValida(xlsx(personas(2)))
    expect(r).toEqual({ ok: false, error: 'bolsa_agotada', corte: true })
  })

  it('sin bolsa (plan mensual, licencia CDA) no hay contador que comparar', async () => {
    const r = await crearLoteValida(xlsx(personas(5)))
    expect(r.ok).toBe(true)
  })

  it('un negocio ajeno para todo el lote no se reparte', async () => {
    const r = await crearLoteValida(xlsx(personas(1)), { negocio_id_lote: 'neg-ajeno' })
    expect(r).toEqual({ ok: false, error: 'negocio_no_encontrado' })
  })

  it('un código de negocio de otro espacio no se resuelve', async () => {
    await crearLoteValida(xlsx([['natural', 'Ana', '', '', 'A 26 9']]))
    expect(doble.tablas.valida_lote_filas[0].negocio_id).toBeNull()
  })

  it('un solo lote en curso por espacio', async () => {
    expect((await crearLoteValida(xlsx(personas(1)))).ok).toBe(true)
    const r = await crearLoteValida(xlsx(personas(1)))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Ya hay un cargue en curso/)
  })

  it('la puerta de consulta nueva manda: restringido por mora, no se crea', async () => {
    puerta.consultar = { ok: false, error: 'Las consultas nuevas están restringidas.' }
    expect(await crearLoteValida(xlsx(personas(1)))).toEqual({ ok: false, error: 'Las consultas nuevas están restringidas.' })
    expect(doble.tablas.valida_lotes ?? []).toHaveLength(0)
  })

  it('sin el módulo, no se crea', async () => {
    reiniciarModulo('ws-1', { ...MODULES.cuatroDSoft })
    expect((await crearLoteValida(xlsx(personas(1)))).ok).toBe(false)
  })
})

describe('el progreso renueva la autorización o pausa el lote', () => {
  it('con la puerta abierta, renueva la autorización del lote activo', async () => {
    const r = await crearLoteValida(xlsx(personas(1)))
    if (!r.ok) throw new Error('no creó')
    doble.tablas.valida_lotes[0].autorizado_hasta = '2026-01-01T00:00:00Z'
    const p = await progresoLoteValida(r.lote.id)
    expect(p.ok).toBe(true)
    expect(Date.parse(doble.tablas.valida_lotes[0].autorizado_hasta as string)).toBeGreaterThan(Date.now())
  })

  it('si la puerta se cierra (mora, términos), el lote se pausa', async () => {
    const r = await crearLoteValida(xlsx(personas(1)))
    if (!r.ok) throw new Error('no creó')
    puerta.consultar = { ok: false, error: 'Las consultas nuevas están restringidas.' }
    const p = await progresoLoteValida(r.lote.id)
    expect(p).toEqual({ ok: false, error: 'Las consultas nuevas están restringidas.' })
    expect(doble.tablas.valida_lotes[0]).toMatchObject({ estado: 'pausado', motivo_pausa: 'acceso' })
  })

  it('un lote de otro espacio no se ve', async () => {
    ;(doble.tablas.valida_lotes ??= []).push({ id: 'lote-ajeno', workspace_id: 'ws-2', estado: 'en_cola', total: 1, severidades: {} })
    expect(await progresoLoteValida('lote-ajeno')).toEqual({ ok: false, error: 'lote_no_encontrado' })
  })
})

describe('el PDF del lote', () => {
  it('sale en partes de 500, en el orden del ARCHIVO', async () => {
    ;(doble.tablas.valida_lotes ??= []).push({ id: 'L', workspace_id: 'ws-1', estado: 'completado', total: 1200, titulo: 'Mayo', severidades: {} })
    // Terminadas en desorden (concurrencia): la posición manda.
    const posiciones = Array.from({ length: 1200 }, (_, i) => i + 1).sort(() => Math.random() - 0.5)
    doble.tablas.valida_lote_filas = posiciones.map((p) => ({ id: `f${p}`, lote_id: 'L', posicion: p, valida_consulta_id: `val-${p}` }))
    const r1 = await pdfLoteValida('L', 0)
    const r3 = await pdfLoteValida('L', 2)
    expect(r1.ok && r1.data.filename).toMatch(/-parte-1\.pdf$/)
    expect(r3.ok && r3.data.filename).toMatch(/-parte-3\.pdf$/)
    expect(reportes[0]).toHaveLength(500)
    expect(reportes[0].slice(0, 3)).toEqual(['val-1', 'val-2', 'val-3'])
    expect(reportes[1]).toEqual(Array.from({ length: 200 }, (_, i) => `val-${1001 + i}`))
  })
})
