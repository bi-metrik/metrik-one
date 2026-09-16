/**
 * Las consultas a Valida solo se atan a negocios del workspace de la sesion.
 *
 * El hueco (riesgo 11, segunda ronda): `consultarValida`, `prepararLoteValida` y
 * `listarConsultasValida` leen y escriben con el cliente de servicio y tomaban el
 * `negocio_id` del navegador sin mirar de quien era. Con el id de un negocio ajeno:
 *   - `consultarValida` persistia la consulta atada a el y le recalculaba y guardaba el
 *     score SARLAFT (el mismo hueco que el #752 cerro en `valida-score.ts`, por otra
 *     puerta);
 *   - `prepararLoteValida` repartia ese id a cada fila del lote;
 *   - `listarConsultasValida` devolvia el codigo y el nombre del negocio ajeno.
 *
 * Lo que se fija aqui:
 *   - un negocio propio se consulta, se persiste y se recalcula como siempre;
 *   - un negocio ajeno o inexistente responde `negocio_no_encontrado` ANTES de llamar a
 *     Valida (cada consulta se cobra): sin fetch, sin insert, sin score;
 *   - el lote con un negocio ajeno no se prepara;
 *   - el historial no trae codigo ni nombre de un negocio ajeno.
 *
 * EL DOBLE APLICA LOS `.eq()` Y LOS `.in()` Y REGISTRA LOS INSERTS: sin eso el negocio
 * ajeno no tendria contra que fallar.
 *
 * VISTO FALLAR (2026-09-16) contra `valida-consultas.ts` de `origin/main`: cayeron 5 de 8
 * (los tres de `consultarValida` con negocio ajeno o inexistente, el del lote ajeno y el
 * del historial); los 3 del camino sano siguieron verdes. Mutaciones medidas sobre el
 * archivo nuevo: quitar solo la guarda de `consultarValida` tumba sus 3; quitar solo la
 * de `prepararLoteValida`, 1; quitar solo el `.eq('workspace_id')` del historial, 1; y
 * que el helper deje de mirar el workspace tumba 3 (los dos ajenos de `consultarValida`
 * y el del lote; el del id inexistente sigue verde, porque ese id no existe en ningun
 * workspace y la mutacion no lo toca).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as XLSX from 'xlsx'

type Fila = Record<string, unknown>

const TABLAS: Record<string, Fila[]> = {
  negocios: [
    { id: 'neg-propio', workspace_id: 'ws-1', codigo: 'P 26 1', nombre: 'Negocio propio' },
    { id: 'neg-ajeno', workspace_id: 'ws-2', codigo: 'A 26 9', nombre: 'Negocio de otro cliente' },
  ],
  workspaces: [{ id: 'ws-1', config_extra: {} }],
  valida_sarlaft_datos_negocio: [
    { negocio_id: 'neg-propio', workspace_id: 'ws-1', universo: 'contraparte' },
    { negocio_id: 'neg-ajeno', workspace_id: 'ws-2', universo: 'contraparte' },
  ],
  valida_consultas: [
    // Fila vieja: una consulta del ws-1 que quedo atada a un negocio ajeno antes de la guarda.
    {
      id: 'c-vieja', workspace_id: 'ws-1', negocio_id: 'neg-ajeno', tipo: 'puntual',
      tipo_persona: 'natural', nombre_consultado: 'X', severidad: 'sin_hallazgo',
      total_matches: 0, created_at: '2026-09-01T00:00:00Z', created_by: null, lote_id: null,
    },
  ],
}

const inserts: Array<{ tabla: string; payload: Fila }> = []

const calcularScoreNegocio = vi.fn(async (_input: unknown) => ({ ok: true, resultado: { puntaje: 1 } }))
const persistirScore = vi.fn(async (_input: unknown) => ({ ok: true }))
const fetchValida = vi.fn(async (_url: unknown, _init?: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({
    consulta_id: 'val-1', severidad: 'sin_hallazgo', total_matches: 0, matches: [],
    hash_reporte: 'h', fecha_reporte: '2026-09-16',
  }),
}))

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ workspaceId: 'ws-1', role: 'owner', error: null }),
}))

vi.mock('@/lib/supabase/auth-user', () => ({
  getCachedUser: async () => ({ user: { id: 'user-1' } }),
}))

vi.mock('@/lib/secretos/workspace', () => ({
  leerSecretosWorkspace: async () => ({}),
  secretoConRespaldo: () => 'llave-de-prueba',
}))

vi.mock('@/lib/actions/_usuarios', () => ({
  resolverNombresUsuarios: async () => new Map(),
}))

vi.mock('@/lib/valida/calculo-score', () => ({
  calcularScoreNegocio: (input: unknown) => calcularScoreNegocio(input),
  persistirScore: (input: unknown) => persistirScore(input),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({ from: (tabla: string) => constructor(tabla) }),
}))

function constructor(tabla: string) {
  const eqs: Fila = {}
  const ins: Record<string, unknown[]> = {}
  let insertado: Fila | null = null

  const filtradas = () => {
    const filas = TABLAS[tabla]
    if (!filas) throw new Error(`tabla inesperada en el doble: ${tabla}`)
    return filas.filter(
      (f) =>
        Object.entries(eqs).every(([c, v]) => f[c] === v) &&
        Object.entries(ins).every(([c, vs]) => vs.includes(f[c])),
    )
  }

  const q = {
    select: () => q,
    order: () => q,
    limit: () => q,
    gte: () => q,
    lte: () => q,
    eq: (columna: string, valor: unknown) => {
      eqs[columna] = valor
      return q
    },
    in: (columna: string, valores: unknown[]) => {
      ins[columna] = valores
      return q
    },
    insert: (payload: Fila) => {
      inserts.push({ tabla, payload })
      insertado = { id: `nuevo-${inserts.length}`, ...payload }
      return q
    },
    maybeSingle: async () => ({ data: filtradas()[0] ?? null, error: null }),
    single: async () => (insertado ? { data: insertado, error: null } : { data: filtradas()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve({ data: filtradas(), error: null }).then(ok, ko),
  }
  return q
}

import { consultarValida, prepararLoteValida, listarConsultasValida } from './valida-consultas'

const PERSONA = { tipo: 'natural' as const, nombre: 'Juan Perez' }

function loteSinCodigo(): FormData {
  const hoja = XLSX.utils.aoa_to_sheet([
    ['tipo_persona', 'nombre_completo', 'tipo_documento', 'numero_documento', 'negocio_codigo'],
    ['natural', 'Juan Perez', '', '', ''],
  ])
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, hoja, 'Consultas')
  const buf = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const fd = new FormData()
  fd.set('archivo', new File([new Uint8Array(buf)], 'lote.xlsx'))
  return fd
}

beforeEach(() => {
  inserts.length = 0
  calcularScoreNegocio.mockClear()
  persistirScore.mockClear()
  fetchValida.mockClear()
  vi.stubGlobal('fetch', fetchValida)
})

describe('consultarValida — de quien es el negocio', () => {
  it('un negocio propio se consulta, se persiste y recalcula el score', async () => {
    const r = await consultarValida(PERSONA, { negocio_id: 'neg-propio' })
    expect(r.ok).toBe(true)
    expect(fetchValida).toHaveBeenCalledTimes(1)
    expect(inserts).toHaveLength(1)
    expect(inserts[0].payload.negocio_id).toBe('neg-propio')
    expect(persistirScore).toHaveBeenCalledTimes(1)
  })

  it('un negocio de otro workspace no llama a Valida ni persiste nada', async () => {
    const r = await consultarValida(PERSONA, { negocio_id: 'neg-ajeno' })
    expect(r).toEqual({ ok: false, error: 'negocio_no_encontrado' })
    expect(fetchValida).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
  })

  it('un negocio de otro workspace no recalcula ni persiste score', async () => {
    await consultarValida(PERSONA, { negocio_id: 'neg-ajeno' })
    expect(calcularScoreNegocio).not.toHaveBeenCalled()
    expect(persistirScore).not.toHaveBeenCalled()
  })

  it('un id inexistente responde igual que uno ajeno', async () => {
    const r = await consultarValida(PERSONA, { negocio_id: 'neg-que-no-existe' })
    expect(r).toEqual({ ok: false, error: 'negocio_no_encontrado' })
    expect(fetchValida).not.toHaveBeenCalled()
  })

  it('sin negocio la consulta sigue funcionando', async () => {
    const r = await consultarValida(PERSONA)
    expect(r.ok).toBe(true)
    expect(inserts).toHaveLength(1)
    expect(inserts[0].payload.negocio_id).toBeNull()
  })
})

describe('prepararLoteValida — el negocio del lote', () => {
  it('un negocio propio se reparte a las filas sin codigo', async () => {
    const r = await prepararLoteValida(loteSinCodigo(), { negocio_id_lote: 'neg-propio' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.filas.map((f) => f.negocio_id)).toEqual(['neg-propio'])
  })

  it('un negocio de otro workspace no se reparte a las filas', async () => {
    const r = await prepararLoteValida(loteSinCodigo(), { negocio_id_lote: 'neg-ajeno' })
    expect(r).toEqual({ ok: false, error: 'negocio_no_encontrado' })
  })
})

describe('listarConsultasValida — codigo y nombre del negocio', () => {
  it('una consulta atada a un negocio ajeno no trae su codigo ni su nombre', async () => {
    const r = await listarConsultasValida()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const vieja = r.consultas.find((c) => c.id === 'c-vieja')
    expect(vieja).toBeDefined()
    expect(vieja!.negocio_codigo).toBeNull()
    expect(vieja!.negocio_nombre).toBeNull()
  })
})
