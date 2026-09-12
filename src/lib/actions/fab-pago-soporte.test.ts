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
import { PREFIJO_REF_AUTOGENERADA } from '@/lib/cobros/referencia-externa'

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

/**
 * La referencia del pago.
 *
 * EL CASO QUE IMPORTA: `cobros.external_ref` no puede ir vacío, pero PEDIRLO solo tiene
 * sentido donde hay pasarela. Ahí se teclea del comprobante de ePayco y sostiene el
 * control de duplicados. En un workspace que cobra por transferencia no hay nada que
 * teclear: el campo salía vacío o con lo que cupiera, y el duplicado que debía atrapar
 * no existe. Lo que dice de dónde entró la plata es el comprobante adjunto.
 *
 * ⚠️ EL CONTROL ES LA MITAD DE LA PRUEBA: que sin pasarela no se pida no vale nada si
 * con pasarela tampoco se pidiera.
 *
 * MUTACIÓN MEDIDA el 2026-09-12: generar la referencia también donde hay pasarela
 * pone 1 en rojo.
 */
describe('referencia del pago del FAB', () => {
  it('sin pasarela y sin referencia, el pago entra con una referencia interna', async () => {
    const r = await agregarPagoFab(pago({ referencia: '' }))
    expect(r.success).toBe(true)
    expect(String(cobroGuardado()?.external_ref)).toContain(PREFIJO_REF_AUTOGENERADA)
  })

  it('CONTROL — donde SÍ hay pasarela, la referencia se sigue exigiendo', async () => {
    estado.fixtures.workspaces = [{ id: WS, modules: { fab_pago_epayco: true } }]
    // Fuente 'epayco' a propósito: con 'otra' lo que rechazaría el pago sería el gate
    // de área financiera, y la prueba diría que pasa por una razón que no es la suya.
    const r = await agregarPagoFab(pago({ referencia: '', fuente: 'epayco' }))
    expect(r.success).toBe(false)
    expect((r as { error: string }).error).toBe('Ingresa la referencia del pago')
    expect(estado.fixtures.cobros ?? []).toHaveLength(0)
  })

  it('la referencia escrita a mano se respeta, no se pisa con una generada', async () => {
    const r = await agregarPagoFab(pago({ referencia: 'TRF-0001' }))
    expect(r.success).toBe(true)
    expect(cobroGuardado()?.external_ref).toBe('TRF-0001')
  })
})
