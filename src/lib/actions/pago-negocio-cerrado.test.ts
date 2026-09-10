/**
 * Un negocio cerrado no recibe plata: el corte va en `registrarPagoEnNegocio`.
 *
 * EL CASO QUE IMPORTA: por qué el corte vive AHÍ y no en las pantallas. Esa función
 * es la vía ÚNICA de escritura de pagos — entran por ella el panel de conciliación y
 * el FAB global (`agregarPagoFab`), y cualquier puerta que se agregue después. Puesto
 * en cada pantalla, la primera que se olvide vuelve a abrir el hueco; es el mismo
 * motivo por el que `esAreaFinanciera()` se resuelve aquí dentro y no en el caller.
 *
 * ⚠️ CADA CASO NECESITA SU CONTROL. "Devuelve un error" no prueba nada: la función
 * rechaza por diez razones distintas. Lo que prueba el corte es que la MISMA entrada
 * cambie de error solo por el `estado` del negocio — con la referencia vacía, un
 * negocio abierto se queja de la referencia y uno cerrado, del cierre.
 *
 * MUTACIONES MEDIDAS el 2026-09-10 (26 verdes en la linea base de las 4 suites):
 *   · quitar el `if (negocioCerrado(...))`             → 2 rojas (el mensaje, y el
 *     cobro que SÍ queda escrito sobre el cerrado)
 *   · mover el corte DESPUÉS de validar la referencia  → 1 roja (el mensaje cambia;
 *     el cobro sigue sin escribirse, que es justo por qué hacía falta el otro caso)
 *   · `negocioCerrado` con `estado !== 'abierto'`      → 6 rojas (aquí, "`activo`
 *     sigue recibiendo")
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WS, estado, reiniciarDoble, servicioFalso } from '../../../test/redistribucion-doble'
import { MENSAJE_NEGOCIO_CERRADO } from '@/lib/negocios/motivo-cierre'

vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({
    workspaceId: WS,
    userId: 'profile-diana',
    staffId: 'staff-diana',
    role: 'owner',
    areas: ['financiera'],
    supabase: servicioFalso(),
  }),
}))

vi.mock('@/app/(app)/negocios/negocio-v2-actions', () => ({
  recalcularNegocioPorCambioDeRecaudo: async () => ({ gates_reabiertos: 0 }),
  cambiarEtapaNegocio: async () => ({ error: null }),
}))
vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: async () => ({ error: null }),
}))
vi.mock('@/lib/epayco', () => ({ consultarTransaccionEpayco: async () => null }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { registrarPagoEnNegocio } from './conciliacion-actions'

/**
 * Misma entrada para todos los casos: lo único que cambia es el negocio destino.
 *
 * `referencia` vacía a propósito en la mayoría: es lo PRIMERO que se valida después
 * del corte, así que su mensaje es el control de "pasó el corte".
 */
async function intentarPago(negocioId: string, referencia = '') {
  return registrarPagoEnNegocio(servicioFalso(), WS, 'staff-diana', {
    negocio_id: negocioId,
    fuente: 'otra',
    fuente_nombre: 'Davivienda',
    referencia,
    monto: 100_000,
  })
}

beforeEach(() => {
  reiniciarDoble()
  estado.fixtures.negocios = [
    { id: 'n-abierto', workspace_id: WS, codigo: 'V0001', estado: 'abierto', metadata: {} },
    { id: 'n-activo', workspace_id: WS, codigo: 'V0002', estado: 'activo', metadata: {} },
    { id: 'n-completado', workspace_id: WS, codigo: 'V0003', estado: 'completado', metadata: {} },
    { id: 'n-perdido', workspace_id: WS, codigo: 'V0004', estado: 'perdido', metadata: {} },
    { id: 'n-cancelado', workspace_id: WS, codigo: 'V0005', estado: 'cancelado', metadata: {} },
  ]
})

describe('registrarPagoEnNegocio sobre un negocio cerrado', () => {
  it('rechaza los tres desenlaces con el mensaje del cierre', async () => {
    for (const id of ['n-completado', 'n-perdido', 'n-cancelado']) {
      const r = await intentarPago(id)
      expect(r.success, id).toBe(false)
      expect(r.success === false && r.error, id).toBe(MENSAJE_NEGOCIO_CERRADO)
    }
  })

  it('CONTROL — el mismo pago sobre un abierto pasa el corte y se queja de otra cosa', async () => {
    const r = await intentarPago('n-abierto')
    expect(r.success).toBe(false)
    expect(r.success === false && r.error).toContain('referencia')
    expect(r.success === false && r.error).not.toBe(MENSAJE_NEGOCIO_CERRADO)
  })

  it('⚠️ un negocio `activo` sigue recibiendo: no es uno de los tres cierres', async () => {
    const r = await intentarPago('n-activo')
    expect(r.success === false && r.error).not.toBe(MENSAJE_NEGOCIO_CERRADO)
  })

  it('un negocio que no existe se rechaza por eso, no por cerrado', async () => {
    const r = await intentarPago('n-inventado')
    expect(r.success === false && r.error).toBe('Negocio no encontrado')
  })

  it('con un pago COMPLETO y válido, el cerrado no deja ni una fila de cobro', async () => {
    // ⚠️ Con la referencia vacía este caso pasaría por la razón equivocada: la
    // validación de referencia frena el insert igual. Con una referencia real, el
    // único motivo por el que no se escribe es el corte.
    for (const id of ['n-completado', 'n-perdido', 'n-cancelado']) {
      await intentarPago(id, `DAV-${id}`)
    }
    expect(estado.fixtures.cobros ?? []).toHaveLength(0)
  })

  it('CONTROL — el mismo pago completo sobre un abierto SÍ escribe el cobro', async () => {
    const r = await intentarPago('n-abierto', 'DAV-n-abierto')
    expect(r.success).toBe(true)
    expect(estado.fixtures.cobros ?? []).toHaveLength(1)
  })
})
