/**
 * BloqueDatosMultiPago: el cobro que crea «Guardar pagos» queda con la fecha del PAGO en
 * ePayco, no con la del registro (sigue a SOE-013; decisión 2026-08-18). Y desde el
 * 2026-10-19 (sin autoguardado): escribir despacio no crea cobros, editar una fila corrige
 * SU cobro, quitarla lo anula, una fila confirmada no se toca, y el permiso es el de la
 * pantalla. Pasa por la acción real (`guardarPagosMulti`) con el doble de base de
 * `guardado-bloque-concurrente.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MODULES, reiniciarModulo } from '../../../../test/exigir-modulo-doble'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
let historial: Fila[] = []
let version = 0

const HOY = '2026-10-02'
const consultas: number[] = []
type RespuestaEpayco = { fecha: string | null; estado?: string; monto_bruto?: number }
const aceptada = (fecha: string | null): RespuestaEpayco => ({ fecha, estado: 'Aceptada', monto_bruto: 10_000_000 })
let respuestaEpayco: (ref: number) => Promise<RespuestaEpayco> = async () => aceptada('2026-09-16 20:15:00')
vi.mock('@/lib/epayco', () => ({
  consultarTransaccionEpayco: async (ref: number) => { consultas.push(ref); return respuestaEpayco(ref) },
}))
vi.mock('@/lib/modulos/exigir-modulo', async () =>
  (await import('../../../../test/exigir-modulo-doble')).dobleExigirModulo())
vi.mock('@/lib/dates/bogota', async (original) => ({
  ...(await original<typeof import('@/lib/dates/bogota')>()),
  todayBogotaISO: () => HOY,
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/cobros/aviso-sobrepago-servidor', () => ({ avisarSobrepagoSiCorresponde: async () => null }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(),
    workspaceId: 'ws-1',
    userId: 'user-1',
    staffId: 'staff-1',
    role: rol,
    error: null,
  }),
}))
vi.mock('@/lib/permissions/guard-negocio', () => ({
  guardEditarBloque: async () => ({ ok: true }),
  guardVerNegocio: async () => ({ ok: true }),
  guardAvanzarStage: async () => ({ ok: true }),
}))
let compartidoCon: string | null = null
let rol = 'owner'
vi.mock('@/lib/negocios/casilla-compartida', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/negocios/casilla-compartida')>()),
  resolverDestinoCompartido: async (_s: unknown, id: string) => compartidoCon ?? id,
}))
vi.mock('@/lib/correcciones/registrar', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/correcciones/registrar')>()),
  contextoCorreccion: async () => null,
}))
vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: async (_s: unknown, fila: Fila) => {
    historial.push(fila)
    return { ok: true, id: `log-${historial.length}` }
  },
}))
vi.mock('@/lib/actions/conciliacion-actions', () => ({
  leerModeloDineroCompleto: async () => null,
  leerModeloDineroNegocio: async () => null,
  crearCobrosSoenaCore: async () => ({ success: true }),
}))
vi.mock('@/lib/siigo/segundo-plano', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/siigo/segundo-plano')>()),
  abonarEnSegundoPlano: async () => {},
}))

function clienteFalso() {
  return { from: (tabla: string) => consulta(tabla), rpc: async () => ({ data: null, error: null }) }
}

function consulta(tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = []
  let op: 'select' | 'update' | 'insert' = 'select'
  let payload: Fila | Fila[] = {}
  const ejecutar = (): Fila[] => {
    tablas[tabla] ??= []
    if (op === 'insert') {
      const filas = (Array.isArray(payload) ? payload : [payload]).map(f => ({ id: `${tabla}-${tablas[tabla].length + 1}`, ...f }))
      tablas[tabla].push(...filas)
      return filas
    }
    const filas = tablas[tabla].filter(f => filtros.every(p => p(f)))
    if (op === 'update') {
      // Como el trigger `negocio_bloques_updated_at`: cada escritura es una versión nueva.
      for (const f of filas) Object.assign(f, payload, { updated_at: `v${++version}` })
      return filas.map(f => ({ id: f.id }))
    }
    return filas.map(f => structuredClone(f))
  }
  const api: Record<string, unknown> = {
    select: () => api,
    update: (p: Fila) => { op = 'update'; payload = p; return api },
    insert: (p: Fila | Fila[]) => { op = 'insert'; payload = p; return api },
    eq: (c: string, v: unknown) => { filtros.push(f => f[c] === v); return api },
    is: (c: string, v: unknown) => { filtros.push(f => (f[c] ?? null) === v); return api },
    neq: (c: string, v: unknown) => { filtros.push(f => f[c] !== v); return api },
    in: (c: string, vs: unknown[]) => { filtros.push(f => vs.includes(f[c])); return api },
    order: () => api,
    limit: () => api,
    single: async () => ({ data: ejecutar()[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: ejecutar()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: ejecutar(), error: null }).then(res, rej),
  }
  return api
}

const { marcarBloqueCompleto, actualizarBloqueData, guardarPagosMulti } = await import('./negocio-v2-actions')

const NEG = 'neg-1'

function bloquePagos(): Fila {
  return {
    id: 'nb-pagos',
    negocio_id: NEG,
    estado: 'pendiente',
    data: {},
    updated_at: 'v0',
    bloque_config_id: 'cfg-pagos',
    bloque_configs: {
      es_gate: false,
      slug: null,
      etapa_id: 'et-7',
      nombre: 'Pagos ePayco',
      config_extra: {
        fields: [
          { slug: 'referencia_epayco', label: 'Referencia ePayco', tipo: 'texto', required: true },
          { slug: 'valor_pago', label: 'Valor del pago', tipo: 'numero', required: true },
        ],
        es_multi_pago: true,
        triggers: [{ event: 'on_complete', action: 'auto_cobros_multi', params: { tipo: 'pago' } }],
      },
      bloque_definitions: { tipo: 'datos', nombre: 'datos' },
    },
  }
}

const cobros = () => tablas.cobros
const vivos = () => tablas.cobros.filter(c => !c.anulado_at)
const guardadas = () => ((tablas.negocio_bloques[0].data as Fila).pagos ?? []) as Array<Fila>

beforeEach(() => {
  version = 0
  historial = []
  compartidoCon = null
  consultas.length = 0
  respuestaEpayco = async () => aceptada('2026-09-16 20:15:00')
  rol = 'owner'
  reiniciarModulo('ws-1', MODULES.soena)
  tablas = { negocio_bloques: [bloquePagos()], cobros: [], negocios: [{ id: NEG, workspace_id: 'ws-1' }], etapas_negocio: [] }
})

describe('la fecha del cobro de BloqueDatosMultiPago', () => {
  it('es la del pago en ePayco, no la del registro', async () => {
    const r = await guardarPagosMulti('nb-pagos', [{ referencia_epayco: '386159602', valor_pago: 500_000 }])
    expect(r.error).toBeNull()
    expect(cobros()).toHaveLength(1)
    expect(cobros()[0]).toMatchObject({ external_ref: '386159602', monto: 500_000, fecha: '2026-09-16', notas: 'Pago' })
    expect(consultas).toEqual([386159602])
  })

  it('sin fecha legible usa el día del registro y lo anota', async () => {
    respuestaEpayco = async () => aceptada(null)
    await guardarPagosMulti('nb-pagos', [{ referencia_epayco: '386159602', valor_pago: 500_000 }])
    expect(cobros()[0].fecha).toBe(HOY)
    expect(cobros()[0].notas).toMatch(/fecha de registro: ePayco no devolvio una fecha legible para la ref 386159602/)
  })

  it('ePayco caído no frena el guardado: día del registro, anotado', async () => {
    respuestaEpayco = async () => { throw new Error('ePayco transaction/detail failed: 500') }
    const r = await guardarPagosMulti('nb-pagos', [{ referencia_epayco: '386159602', valor_pago: 500_000 }])
    expect(r.error).toBeNull()
    expect(cobros()[0]).toMatchObject({ fecha: HOY })
    expect(cobros()[0].notas).toMatch(/fecha de registro/)
  })

  it('re-guardar el mismo pago no duplica el cobro ni vuelve a consultar ePayco', async () => {
    const p1 = { referencia_epayco: '386159602', valor_pago: 500_000 }
    await guardarPagosMulti('nb-pagos', [p1])
    // Se agrega un segundo pago: el primero ya tiene cobro, solo el nuevo se crea y consulta.
    respuestaEpayco = async () => aceptada('2026-09-20 09:00:00')
    const p2 = { referencia_epayco: '386159700', valor_pago: 200_000 }
    await guardarPagosMulti('nb-pagos', [p1, p2])
    await guardarPagosMulti('nb-pagos', [p1, p2])
    expect(cobros().map(c => [c.external_ref, c.fecha])).toEqual([
      ['386159602', '2026-09-16'],
      ['386159700', '2026-09-20'],
    ])
    expect(consultas).toEqual([386159602, 386159700])
  })

  it('un workspace sin ePayco no consulta la cuenta global: día del registro, anotado', async () => {
    reiniciarModulo('ws-1', MODULES.termotech)
    await guardarPagosMulti('nb-pagos', [{ referencia_epayco: '386159602', valor_pago: 500_000 }])
    expect(consultas).toEqual([])
    expect(cobros()[0]).toMatchObject({ fecha: HOY })
    expect(cobros()[0].notas).toMatch(/fecha de registro/)
  })
})

const fila = (id: string, ref: string, valor: number | '') => ({ id, referencia_epayco: ref, valor_pago: valor })

describe('sin autoguardado: el bloque se escribe solo con «Guardar pagos»', () => {
  it('escribir despacio no crea cobros: el guardado genérico lo rechaza', async () => {
    const r1 = await actualizarBloqueData('nb-pagos', { pagos: [{ referencia_epayco: '386159602', valor_pago: 150 }] })
    const r2 = await marcarBloqueCompleto('nb-pagos', { pagos: [{ referencia_epayco: '386159602', valor_pago: 150 }] })
    expect(r1.error).toMatch(/Guardar pagos/)
    expect(r2.error).toMatch(/Guardar pagos/)
    expect(cobros()).toHaveLength(0)
  })

  it('editar una fila corrige SU cobro: no duplica', async () => {
    await guardarPagosMulti('nb-pagos', [fila('f1', '386159602', 150)])
    const r = await guardarPagosMulti('nb-pagos', [{ ...fila('f1', '386159602', 1_500_000), cobro_id: guardadas()[0].cobro_id as string }])
    expect(r.error).toBeNull()
    expect(vivos()).toHaveLength(1)
    expect(vivos()[0].monto).toBe(1_500_000)
  })

  it('borrar una fila anula su cobro no confirmado', async () => {
    await guardarPagosMulti('nb-pagos', [fila('f1', '386159602', 500_000), fila('f2', '386159700', 200_000)])
    const [g1] = guardadas()
    await guardarPagosMulti('nb-pagos', [{ ...fila('f1', '386159602', 500_000), cobro_id: g1.cobro_id as string }])
    expect(vivos().map(c => c.external_ref)).toEqual(['386159602'])
    const anulado = cobros().find(c => c.external_ref === '386159700')!
    expect(anulado).toMatchObject({ monto: 0, monto_anulado: 200_000 })
  })

  it('una fila confirmada por la financiera no se edita', async () => {
    await guardarPagosMulti('nb-pagos', [fila('f1', '386159602', 500_000)])
    tablas.negocio_conciliacion = [{ negocio_id: NEG, workspace_id: 'ws-1', conciliado: true }]
    const r = await guardarPagosMulti('nb-pagos', [{ ...fila('f1', '386159602', 400_000), cobro_id: guardadas()[0].cobro_id as string }])
    expect(r.error).toMatch(/ya lo confirmó/)
    expect(vivos()[0].monto).toBe(500_000)
  })

  it('una referencia no Aceptada en ePayco no se registra', async () => {
    respuestaEpayco = async () => ({ fecha: null, estado: 'Rechazada', monto_bruto: 500_000 })
    const r = await guardarPagosMulti('nb-pagos', [fila('f1', '386159602', 500_000)])
    expect(r.error).toMatch(/Rechazada/)
    expect(cobros()).toHaveLength(0)
  })

  it('permiso igual en pantalla y servidor: un supervisor no guarda aunque llame la acción', async () => {
    rol = 'supervisor'
    const r = await guardarPagosMulti('nb-pagos', [fila('f1', '386159602', 500_000)])
    expect(r.error).toMatch(/dueño o un administrador/)
    expect(cobros()).toHaveLength(0)
  })
})
