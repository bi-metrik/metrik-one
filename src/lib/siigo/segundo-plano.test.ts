/**
 * Siigo después de responder (`segundo-plano.ts`).
 *
 * LO QUE IMPORTA: la acción que registra la plata le responde a la persona SIN esperar a
 * Siigo. Se prueba con un Siigo que no contesta nunca: si la acción lo esperara, la
 * prueba se colgaría en vez de pasar.
 *
 * Y su CONTROL: la rutina no se pierde — queda agendada con `after()` y, al correrla,
 * abona el negocio que se tocó. Fuera de un request se corre en línea, como antes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WS, estado, reiniciarDoble, servicioFalso } from '../../../test/redistribucion-doble'

const agendadas: Array<() => unknown> = []
let hayRequest = true
vi.mock('next/server', () => ({
  after: (tarea: () => unknown) => {
    if (!hayRequest) throw new Error('`after` was called outside a request scope.')
    agendadas.push(tarea)
  },
}))

const abonar = vi.fn((_ws: string, _negocio: string) => new Promise<void>(() => { /* Siigo colgado */ }))
const registrarCobro = vi.fn(async (_ws: string, _cobro: string) => {})
vi.mock('./recibo-automatico', () => ({
  abonarAlRegistrarPago: (ws: string, negocio: string) => abonar(ws, negocio),
  alRegistrarCobro: (ws: string, cobro: string) => registrarCobro(ws, cobro),
}))

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    workspaceId: WS, userId: 'p-1', staffId: 'staff-1', role: 'owner', areas: ['financiera'],
    supabase: servicioFalso(),
  }),
}))
vi.mock('@/app/(app)/negocios/negocio-v2-actions', () => ({
  recalcularNegocioPorCambioDeRecaudo: async () => ({ gates_reabiertos: 0 }),
  cambiarEtapaNegocio: async () => ({ error: null }),
}))
vi.mock('@/lib/activity/registrar-actividad', () => ({ registrarActividad: async () => ({ error: null }) }))
vi.mock('@/lib/cobros/aviso-sobrepago-servidor', () => ({ avisarSobrepagoSiCorresponde: async () => {} }))
vi.mock('@/lib/epayco', () => ({ consultarTransaccionEpayco: async () => null }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { registrarPagoEnNegocio } from '@/lib/actions/conciliacion-actions'
import { abonarEnSegundoPlano, alRegistrarCobroEnSegundoPlano, enSegundoPlano } from './segundo-plano'

beforeEach(() => {
  agendadas.length = 0
  hayRequest = true
  abonar.mockClear()
  registrarCobro.mockClear()
  reiniciarDoble()
  estado.fixtures.workspaces = [{ id: WS, modules: {} }]
  estado.fixtures.negocios = [
    { id: 'n-1', workspace_id: WS, codigo: 'V0001', estado: 'abierto', metadata: {} },
  ]
})

describe('registrar un pago no espera a Siigo', () => {
  it('responde con Siigo colgado, y el abono queda agendado para después', async () => {
    const r = await registrarPagoEnNegocio(servicioFalso(), WS, 'staff-1', {
      negocio_id: 'n-1', fuente: 'otra', fuente_nombre: 'Transferencia', referencia: 'TRF-1', monto: 100_000,
    })
    expect(r.success).toBe(true)
    expect(estado.fixtures.cobros ?? []).toHaveLength(1)
    // Nada de Siigo corrió mientras la persona esperaba…
    expect(abonar).not.toHaveBeenCalled()
    expect(agendadas).toHaveLength(1)

    // …y CONTROL: la rutina no se perdió. Al correr lo agendado, abona ese negocio.
    void agendadas[0]()
    await Promise.resolve()
    expect(abonar).toHaveBeenCalledWith(WS, 'n-1')
  })
})

describe('abonarEnSegundoPlano', () => {
  it('recorre los negocios uno tras otro y sin repetir', async () => {
    abonar.mockImplementation(async () => {})
    await abonarEnSegundoPlano(WS, ['n-1', 'n-2', 'n-1'])
    expect(abonar).not.toHaveBeenCalled()
    await agendadas[0]()
    expect(abonar.mock.calls).toEqual([[WS, 'n-1'], [WS, 'n-2']])
  })

  it('sin negocios no agenda nada', async () => {
    await abonarEnSegundoPlano(WS, [])
    expect(agendadas).toHaveLength(0)
  })

  it('fuera de un request (script, cron) corre EN LÍNEA y se espera, como antes', async () => {
    hayRequest = false
    abonar.mockImplementation(async () => {})
    await abonarEnSegundoPlano(WS, ['n-1'])
    expect(agendadas).toHaveLength(0)
    expect(abonar).toHaveBeenCalledWith(WS, 'n-1')
  })

  it('alRegistrarCobroEnSegundoPlano agenda el abono + RC-3 del cobro', async () => {
    await alRegistrarCobroEnSegundoPlano(WS, 'cob-1')
    expect(registrarCobro).not.toHaveBeenCalled()
    await agendadas[0]()
    expect(registrarCobro).toHaveBeenCalledWith(WS, 'cob-1')
  })
})

describe('enSegundoPlano', () => {
  it('una tarea que lanza queda en el log con [siigo], no como rechazo sin dueño', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await enSegundoPlano('prueba', async () => { throw new Error('Siigo caído') })
    await expect(Promise.resolve(agendadas[0]())).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledWith('[siigo] prueba falló en segundo plano:', 'Siigo caído')
    log.mockRestore()
  })
})
