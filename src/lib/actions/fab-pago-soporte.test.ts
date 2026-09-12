/**
 * El comprobante del pago registrado desde el FAB.
 *
 * EL CASO QUE IMPORTA: aquí el comprobante es OPCIONAL, al revés que en el panel de
 * pagos externos de /conciliacion, donde es la barrera. La razón es el uso: este modal
 * anota plata que entró por transferencia, efectivo o cheque, muchas veces desde el
 * celular y en caliente. Exigir el pantallazo para poder anotar el ingreso no produce
 * comprobantes, produce ingresos sin registrar, que es el problema peor.
 *
 * De ahí las dos decisiones que estas pruebas fijan:
 *   1. sin comprobante el pago entra igual, sin error;
 *   2. si el archivado del comprobante FALLA, el pago entra igual. Perder el registro
 *      del dinero porque Drive no respondió sería cambiar un problema chico por uno
 *      grande.
 *
 * MUTACIONES MEDIDAS el 2026-09-12:
 *   · devolver error cuando `archivarSoporte` da null  → 1 roja
 *   · no pasar el soporte al INSERT                    → 1 roja
 *   · aceptar un path fuera del workspace              → 1 roja
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WS, estado, reiniciarDoble, servicioFalso } from '../../../test/redistribucion-doble'

vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({
    workspaceId: WS,
    userId: 'profile-comercial',
    staffId: 'staff-comercial',
    role: 'operator',
    areas: ['comercial'],
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

/** El archivado real toca Storage y Drive; lo que se prueba aquí es qué hace el FAB
 *  con su respuesta, no el archivado en sí. */
const archivarSoporte = vi.fn()
vi.mock('@/lib/cobros/soporte-pago', () => ({
  archivarSoporte: (...args: unknown[]) => archivarSoporte(...args),
}))

import { agregarPagoFab } from './fab-pago-actions'

const COMPROBANTE = { storage_path: `${WS}/pagos-fab/abc.jpg`, file_name: 'transferencia.jpg' }

function pago(extra: Record<string, unknown> = {}) {
  return {
    negocio_id: 'n-abierto',
    fuente: 'otra' as const,
    fuente_nombre: 'Transferencia Bancolombia',
    referencia: 'TRF-0001',
    monto: 500_000,
    ...extra,
  }
}

function cobroGuardado(): Record<string, unknown> | undefined {
  return (estado.fixtures.cobros ?? [])[0] as Record<string, unknown> | undefined
}

beforeEach(() => {
  archivarSoporte.mockReset()
  reiniciarDoble()
  estado.fixtures.workspaces = [{ id: WS, modules: {} }]
  estado.fixtures.negocios = [
    { id: 'n-abierto', workspace_id: WS, codigo: 'V0001', estado: 'abierto', metadata: {} },
  ]
})

describe('comprobante del pago del FAB', () => {
  it('con comprobante, el cobro queda con su soporte', async () => {
    archivarSoporte.mockResolvedValue({ url: 'https://drive/x', file_name: 'transferencia.jpg' })
    const r = await agregarPagoFab(pago({ soporte_subido: COMPROBANTE }))
    expect(r.success).toBe(true)
    expect(cobroGuardado()?.soporte).toMatchObject({ file_name: 'transferencia.jpg' })
  })

  it('sin comprobante el pago entra igual: es opcional, no una barrera', async () => {
    const r = await agregarPagoFab(pago())
    expect(r.success).toBe(true)
    expect(archivarSoporte).not.toHaveBeenCalled()
    expect(cobroGuardado()?.soporte ?? null).toBeNull()
  })

  it('si el archivado falla, NO se pierde el pago', async () => {
    archivarSoporte.mockResolvedValue(null)
    const r = await agregarPagoFab(pago({ soporte_subido: COMPROBANTE }))
    expect(r.success).toBe(true)
    expect(cobroGuardado()?.monto).toBe(500_000)
  })

  it('el comprobante se archiva contra el workspace de la sesión, no contra uno que venga del navegador', async () => {
    archivarSoporte.mockResolvedValue({ url: 'https://drive/x' })
    await agregarPagoFab(pago({ soporte_subido: COMPROBANTE }))
    expect(archivarSoporte.mock.calls[0][1]).toBe(WS)
  })
})
