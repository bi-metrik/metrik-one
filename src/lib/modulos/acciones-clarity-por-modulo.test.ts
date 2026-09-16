/**
 * Las acciones que CREAN en Clarity (negocios, gastos, horas, cobros) y la de la línea activa
 * piden el módulo, no solo la sesión.
 *
 * El hueco (riesgo 11, tercera ronda): el gate por ruta cierra `/negocios` y `/nuevo` a un
 * workspace sin Clarity, pero la acción es un endpoint. Con la sesión de 4D SOFT (solo
 * `valida_api`) se creaban negocios en su propio workspace (y con ellos la carpeta de Drive con
 * las credenciales de MeTRIK y todo lo que cuelga de un negocio), se subían soportes, se
 * registraban gastos y horas, y se clasificaba con Gemini a cargo de MeTRIK.
 *
 * Lo que se fija: sin el módulo, la acción responde antes de tocar la base, Storage o Gemini.
 * Con Clarity (CONTROL), la acción pasa la puerta y llega a la base.
 *
 * VISTO FALLAR (2026-09-16) contra `origin/main`: caen los 8 casos de 4D SOFT; los CONTROL
 * siguen verdes. Quitando cada guarda de módulo cae el caso de su acción (8 mutaciones).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const tocadas: string[] = []

function clienteQueRegistra() {
  const q: Record<string, unknown> = {}
  const cadena = () => q
  Object.assign(q, {
    select: cadena, eq: cadena, in: cadena, or: cadena, order: cadena, limit: cadena, is: cadena,
    not: cadena, ilike: cadena, gte: cadena, lte: cadena, update: cadena, insert: cadena, upsert: cadena,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: { message: 'sin fila en el doble' } }),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
  })
  return {
    from: (tabla: string) => {
      tocadas.push(tabla)
      return q
    },
    rpc: async (fn: string) => {
      tocadas.push(`rpc:${fn}`)
      return { data: null, error: null }
    },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  }
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteQueRegistra(),
    workspaceId: 'ws-1',
    userId: 'user-1',
    staffId: 'staff-1',
    role: 'owner',
    areas: [],
    error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteQueRegistra() }))
vi.mock('@/lib/modulos/exigir-modulo', async () =>
  (await import('../../../test/exigir-modulo-doble')).dobleExigirModulo())

const clasificarGastoConIA = vi.fn(async (_d: string) => null)
vi.mock('@/lib/gastos/clasificar-gasto-ia', () => ({
  clasificarGastoConIA: (d: string) => clasificarGastoConIA(d),
}))
const subirAOne = vi.fn(async () => ({ referencia: 'one://x' }))
vi.mock('@/lib/almacenamiento/one', () => ({ subirAOne: () => subirAOne() }))

import { crearNegocio, crearNegocioDesdeInteraccion } from '@/app/(app)/negocios/negocio-v2-actions'
import { createGasto, uploadSoporteGasto, clasificarGastoAction } from '@/app/(app)/nuevo/gasto/gasto-action'
import { addHorasDestino } from '@/app/(app)/nuevo/horas/horas-action'
import { addCobro } from '@/lib/actions/cobros-horas-rapidos'
import { updateLineaActiva } from '@/app/(app)/mi-negocio/actions'
import { MODULES, reiniciarModulo } from '../../../test/exigir-modulo-doble'
import { ORIGENES_NEGOCIO, ORIGEN_ALIANZA } from '@/lib/catalogos/constants'

// Un origen VÁLIDO: con uno inválido `crearNegocio` corta antes de la base también en
// `origin/main`, y la prueba de 4D SOFT pasaría por la razón equivocada.
const ORIGEN = ORIGENES_NEGOCIO.find((o) => o.value !== ORIGEN_ALIANZA)!.value

function soporte(): FormData {
  const fd = new FormData()
  fd.set('file', new File([new Uint8Array([37, 80, 68, 70])], 'soporte.pdf', { type: 'application/pdf' }))
  return fd
}

beforeEach(() => {
  tocadas.length = 0
  clasificarGastoConIA.mockClear()
  subirAOne.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('4D SOFT (solo valida_api) no crea en Clarity', () => {
  beforeEach(() => reiniciarModulo('ws-1', { ...MODULES.cuatroDSoft }))

  it('crearNegocio no toca la base', async () => {
    const r = await crearNegocio({ nombre: 'Negocio de prueba', origen: ORIGEN })
    expect(r.negocio_id).toBeNull()
    expect(r.error).toBeTruthy()
    expect(tocadas).toEqual([])
  })

  it('crearNegocioDesdeInteraccion tampoco', async () => {
    const r = await crearNegocioDesdeInteraccion({ interaccion_id: 'int-1', tipo_persona: 'natural' })
    expect(r.negocio_id).toBeNull()
    expect(tocadas).toEqual([])
  })

  it('createGasto no registra', async () => {
    const r = await createGasto({ monto: 10_000, categoria: 'otros', fecha: '2026-09-16' })
    expect(r.success).toBe(false)
    expect(tocadas).toEqual([])
  })

  it('uploadSoporteGasto no sube', async () => {
    const r = await uploadSoporteGasto(soporte())
    expect(r.success).toBe(false)
    expect(subirAOne).not.toHaveBeenCalled()
  })

  it('clasificarGastoAction no gasta Gemini de MeTRIK', async () => {
    expect(await clasificarGastoAction('almuerzo con cliente')).toBeNull()
    expect(clasificarGastoConIA).not.toHaveBeenCalled()
  })

  it('addHorasDestino no registra horas en un negocio', async () => {
    const r = await addHorasDestino('neg-1', 'negocio', { fecha: '2026-09-16', horas: 2 })
    expect(r.success).toBe(false)
    expect(tocadas).toEqual([])
  })

  it('addCobro no registra', async () => {
    const r = await addCobro('fac-1', { monto: 10_000 })
    expect(r.success).toBe(false)
    expect(tocadas).toEqual([])
  })

  it('updateLineaActiva no cambia la línea, ni siendo owner', async () => {
    const r = await updateLineaActiva('linea-1')
    expect(r.success).toBe(false)
    expect(tocadas).toEqual([])
  })
})

describe('CONTROL — con Clarity las acciones pasan la puerta', () => {
  beforeEach(() => reiniciarModulo('ws-1', { business: true }))

  it('crearNegocio llega a la base', async () => {
    await crearNegocio({ nombre: 'Negocio de prueba', origen: ORIGEN }).catch(() => null)
    expect(tocadas.length).toBeGreaterThan(0)
  })

  it('clasificarGastoAction llama al clasificador', async () => {
    await clasificarGastoAction('almuerzo con cliente')
    expect(clasificarGastoConIA).toHaveBeenCalledTimes(1)
  })

  it('updateLineaActiva lee la línea antes de decidir', async () => {
    await updateLineaActiva('linea-1')
    expect(tocadas).toContain('lineas_negocio')
  })
})
