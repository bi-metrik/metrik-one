/**
 * `guardarDatosSarlaft` y `recalcularScoreNegocio` solo escriben sobre negocios del
 * workspace de la sesion.
 *
 * El hueco (riesgo 11): las dos server actions tomaban un `negocioId` del navegador y
 * escribian con el cliente de servicio sin comprobar de quien era el negocio. Los upserts
 * van por `onConflict: 'negocio_id'`, asi que con el id de un negocio ajeno se le
 * sobrescribian los datos SARLAFT y el score, las filas quedaban reasignadas al workspace
 * de quien llama, y un cambio de nivel mandaba el codigo y nombre del negocio ajeno como
 * notificacion a este workspace.
 *
 * Lo que se fija aqui:
 *   - un negocio propio se guarda y se recalcula como siempre;
 *   - un negocio de OTRO workspace no se escribe, no se calcula y no se persiste score;
 *   - un id inexistente responde igual que uno ajeno.
 *
 * EL DOBLE APLICA TODOS LOS `.eq()` Y REGISTRA LOS UPSERTS: sin eso el caso del negocio
 * ajeno no tendria contra que fallar.
 *
 * VISTO FALLAR (2026-09-16) contra `valida-score.ts` de `origin/main`: cayeron los 4
 * casos del negocio ajeno o inexistente; los 2 del negocio propio siguieron verdes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Fila = Record<string, unknown>

const TABLAS: Record<string, Fila[]> = {
  negocios: [
    { id: 'neg-propio', workspace_id: 'ws-1' },
    { id: 'neg-ajeno', workspace_id: 'ws-2' },
  ],
  valida_sarlaft_datos_negocio: [
    { negocio_id: 'neg-propio', workspace_id: 'ws-1', universo: 'contraparte' },
    { negocio_id: 'neg-ajeno', workspace_id: 'ws-2', universo: 'contraparte' },
  ],
}

const upserts: Array<{ tabla: string; payload: Fila }> = []

const RESULTADO = {
  puntaje: 42,
  nivel: 'medio',
  factores_aplicados: {},
  proxima_revision: null,
  valida_consulta_id_ultima: null,
}
const calcularScoreNegocio = vi.fn(async (_input: unknown) => ({ ok: true, resultado: RESULTADO }))
const persistirScore = vi.fn(async (_input: unknown) => ({ ok: true, cambioNivel: false }))

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ workspaceId: 'ws-1', role: 'owner', error: null }),
}))

vi.mock('@/lib/supabase/auth-user', () => ({
  getCachedUser: async () => ({ user: { id: 'user-1' } }),
}))

vi.mock('@/lib/valida/calculo-score', () => ({
  calcularScoreNegocio: (input: unknown) => calcularScoreNegocio(input),
  persistirScore: (input: unknown) => persistirScore(input),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({ from: (tabla: string) => constructor(tabla) }),
}))

function constructor(tabla: string) {
  const filtros: Fila = {}
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
    maybeSingle: async () => resolver(),
    single: async () => resolver(),
    upsert: async (payload: Fila) => {
      upserts.push({ tabla, payload })
      return { error: null }
    },
  }
  return q
}

import { guardarDatosSarlaft, recalcularScoreNegocio } from './valida-score'

const INPUT = { universo: 'contraparte' as const, pais_codigo_iso: 'CO' }

beforeEach(() => {
  upserts.length = 0
  calcularScoreNegocio.mockClear()
  persistirScore.mockClear()
})

describe('guardarDatosSarlaft — de quien es el negocio', () => {
  it('un negocio propio se guarda y se recalcula', async () => {
    const r = await guardarDatosSarlaft('neg-propio', INPUT)
    expect(r.ok).toBe(true)
    expect(upserts).toHaveLength(1)
    expect(persistirScore).toHaveBeenCalledTimes(1)
  })

  it('un negocio de otro workspace no se escribe', async () => {
    const r = await guardarDatosSarlaft('neg-ajeno', INPUT)
    expect(r).toEqual({ ok: false, error: 'negocio_no_encontrado' })
    expect(upserts).toHaveLength(0)
  })

  it('un negocio de otro workspace no dispara calculo ni score', async () => {
    await guardarDatosSarlaft('neg-ajeno', INPUT)
    expect(calcularScoreNegocio).not.toHaveBeenCalled()
    expect(persistirScore).not.toHaveBeenCalled()
  })
})

describe('recalcularScoreNegocio — de quien es el negocio', () => {
  it('un negocio propio se recalcula', async () => {
    const r = await recalcularScoreNegocio('neg-propio')
    expect(r.ok).toBe(true)
    expect(persistirScore).toHaveBeenCalledTimes(1)
  })

  it('un negocio de otro workspace no se calcula ni se persiste', async () => {
    const r = await recalcularScoreNegocio('neg-ajeno')
    expect(r).toEqual({ ok: false, error: 'negocio_no_encontrado' })
    expect(calcularScoreNegocio).not.toHaveBeenCalled()
    expect(persistirScore).not.toHaveBeenCalled()
  })

  it('un id inexistente responde igual que uno ajeno', async () => {
    const r = await recalcularScoreNegocio('neg-que-no-existe')
    expect(r).toEqual({ ok: false, error: 'negocio_no_encontrado' })
    expect(persistirScore).not.toHaveBeenCalled()
  })
})
