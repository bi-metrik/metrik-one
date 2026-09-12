/**
 * Rechazar un movimiento tiene que hacerlo DESAPARECER.
 *
 * EL CASO QUE IMPORTA: el botón "Rechazar" llamaba a `desmarcarRevisado`, que solo pone
 * `revisado = false`. El movimiento volvía a la fila de pendientes, el motivo que el
 * modal exigía se tiraba, y quien lo rechazaba lo veía reaparecer. El badge "Rechazado"
 * llevaba tiempo apagado con un `{false && …}`, así que ni siquiera se distinguía de lo
 * que nunca se había revisado.
 *
 * El gasto se BORRA, y no se marca con una bandera, porque `gastos` se lee desde 42
 * sitios incluidas las edge functions de WhatsApp: una bandera obliga a recordar el
 * filtro en cada uno y el olvido aparece como plata que no cuadra. Lo borrado queda
 * entero en `movimientos_rechazados`.
 *
 * El cobro NO se borra: su monto sostiene el saldo del negocio y la cuenta de cobro
 * emitida. Se anula por la vía que ya existe.
 *
 * MUTACIONES MEDIDAS el 2026-09-12:
 *   · archivar DESPUÉS de borrar                     → 1 roja
 *   · aceptar cualquier motivo                       → 1 roja
 *   · borrar el cobro en vez de anularlo             → 2 rojas
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WS, estado, reiniciarDoble, servicioFalso } from '../../../../test/redistribucion-doble'

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    workspaceId: WS,
    userId: 'user-1',
    role: 'owner',
    supabase: servicioFalso(),
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

/** El archivo se escribe con el cliente de servicio: la tabla es server-only. */
let archivoFalla = false
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => {
    const real = servicioFalso()
    if (!archivoFalla) return real
    return {
      from: (tabla: string) =>
        tabla === 'movimientos_rechazados'
          ? { insert: () => ({ then: (r: (v: unknown) => unknown) => r({ error: { message: 'sin red' } }) }) }
          : real.from(tabla),
    }
  },
}))

const anularCobro = vi.fn()
vi.mock('@/lib/actions/pagos-externos', () => ({
  anularCobro: (...args: unknown[]) => anularCobro(...args),
}))

import { rechazarMovimiento } from './actions'

const MOTIVO = 'El proveedor devolvió la plata'

function gastos() { return estado.fixtures.gastos ?? [] }
function archivados() { return estado.fixtures.movimientos_rechazados ?? [] }

beforeEach(() => {
  archivoFalla = false
  anularCobro.mockReset().mockResolvedValue({ success: true })
  reiniciarDoble()
  estado.fixtures.gastos = [
    { id: 'g-1', workspace_id: WS, monto: 343300, descripcion: 'SOA', revisado: false },
    { id: 'g-2', workspace_id: WS, monto: 47600, descripcion: 'Otro', revisado: false },
  ]
  estado.fixtures.movimientos_rechazados = []
  estado.fixtures.gastos_fijos_borradores = []
})

describe('rechazar un gasto', () => {
  it('desaparece: la fila se borra, no vuelve a pendientes', async () => {
    const r = await rechazarMovimiento('g-1', 'gastos', MOTIVO)
    expect(r.success).toBe(true)
    expect(gastos().map((g) => g.id)).toEqual(['g-2'])
  })

  it('queda el motivo, el autor y la fila completa', async () => {
    await rechazarMovimiento('g-1', 'gastos', MOTIVO)
    expect(archivados()[0]).toMatchObject({
      workspace_id: WS,
      tabla: 'gastos',
      fila_id: 'g-1',
      motivo: MOTIVO,
      rechazado_por: 'user-1',
    })
    expect((archivados()[0].fila as { monto: number }).monto).toBe(343300)
  })

  it('si el archivo falla, el gasto NO se borra: se puede reintentar', async () => {
    archivoFalla = true
    const r = await rechazarMovimiento('g-1', 'gastos', MOTIVO)
    expect(r.success).toBe(false)
    expect(gastos().map((g) => g.id)).toContain('g-1')
  })

  it('CONTROL — un motivo de dos letras no borra nada', async () => {
    const r = await rechazarMovimiento('g-1', 'gastos', 'no')
    expect(r.success).toBe(false)
    expect(gastos()).toHaveLength(2)
    expect(archivados()).toHaveLength(0)
  })

  it('un gasto de otro workspace no se encuentra', async () => {
    estado.fixtures.gastos = [{ id: 'g-ajeno', workspace_id: 'ws-otro', monto: 1 }]
    const r = await rechazarMovimiento('g-ajeno', 'gastos', MOTIVO)
    expect(r.success).toBe(false)
    expect(gastos()).toHaveLength(1)
  })
})

describe('rechazar un cobro', () => {
  it('no se borra: se anula por la vía que ya controla el dinero', async () => {
    estado.fixtures.cobros = [{ id: 'c-1', workspace_id: WS, monto: 500000 }]
    const r = await rechazarMovimiento('c-1', 'cobros', MOTIVO)
    expect(r.success).toBe(true)
    expect(anularCobro).toHaveBeenCalledWith('c-1', MOTIVO)
    expect(estado.fixtures.cobros).toHaveLength(1)
    expect(archivados()).toHaveLength(0)
  })

  it('si la anulación no procede, el rechazo devuelve su error', async () => {
    anularCobro.mockResolvedValue({ success: false, error: 'Está en una cuenta de cobro emitida' })
    const r = await rechazarMovimiento('c-1', 'cobros', MOTIVO)
    expect(r).toEqual({ success: false, error: 'Está en una cuenta de cobro emitida' })
  })
})
