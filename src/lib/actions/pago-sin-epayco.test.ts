/**
 * Un workspace sin pasarela registra sus ingresos igual.
 *
 * EL CASO QUE IMPORTA: la regla "solo el área financiera registra pagos que no
 * entraron por ePayco" se escribió pensando en SOENA, donde el comercial cobra por
 * la pasarela y salirse de ella es la excepción. En un workspace que cobra por
 * transferencia y consignación, TODO pago es "fuera de ePayco": la misma regla deja
 * de proteger algo y apaga el módulo entero. Termotech tenía el FAB de pago
 * encendido y cero cobros registrados.
 *
 * Por eso la regla se condiciona a que el workspace TENGA la pasarela
 * (`modules.fab_pago_epayco`), y quién puede registrar en el otro caso lo decide
 * `rolHabilitadoParaPagoFab`, que es el guard de ese camino.
 *
 * ⚠️ CADA CASO NECESITA SU CONTROL. Que un comercial pueda registrar sin pasarela no
 * prueba nada por sí solo: lo que prueba el corte es que la MISMA entrada, del MISMO
 * usuario, cambie de resultado solo por el flag del workspace.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WS, estado, reiniciarDoble, servicioFalso } from '../../../test/redistribucion-doble'

// Un comercial puro: NO es área financiera. Es quien la regla vieja bloqueaba.
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

import { registrarPagoEnNegocio } from './conciliacion-actions'

const MENSAJE_SOLO_FINANCIERA =
  'Solo el área financiera puede registrar pagos que no entraron por ePayco.'

/** Un pago por transferencia, completo y válido. Lo único que cambia es el workspace. */
async function pagoPorTransferencia() {
  return registrarPagoEnNegocio(servicioFalso(), WS, 'staff-comercial', {
    negocio_id: 'n-abierto',
    fuente: 'otra',
    fuente_nombre: 'Transferencia Bancolombia',
    referencia: 'TRF-0001',
    monto: 500_000,
  })
}

function sembrar(modules: Record<string, boolean>) {
  reiniciarDoble()
  estado.fixtures.workspaces = [{ id: WS, modules }]
  estado.fixtures.negocios = [
    { id: 'n-abierto', workspace_id: WS, codigo: 'V0001', estado: 'abierto', metadata: {} },
  ]
}

beforeEach(() => sembrar({}))

describe('pago sin pasarela: el workspace decide si la regla de ePayco aplica', () => {
  it('sin pasarela, un comercial registra el ingreso por transferencia', () => {
    return pagoPorTransferencia().then((r) => {
      expect(r.success).toBe(true)
      expect(estado.fixtures.cobros ?? []).toHaveLength(1)
    })
  })

  it('CONTROL — el MISMO pago, del MISMO comercial, se rechaza donde SÍ hay pasarela', async () => {
    sembrar({ fab_pago_epayco: true })
    const r = await pagoPorTransferencia()
    expect(r.success).toBe(false)
    expect(r.success === false && r.error).toBe(MENSAJE_SOLO_FINANCIERA)
    expect(estado.fixtures.cobros ?? []).toHaveLength(0)
  })

  it('un workspace sin la fila de configuración se trata como sin pasarela, no revienta', async () => {
    reiniciarDoble()
    estado.fixtures.negocios = [
      { id: 'n-abierto', workspace_id: WS, codigo: 'V0001', estado: 'abierto', metadata: {} },
    ]
    const r = await pagoPorTransferencia()
    expect(r.success).toBe(true)
  })

  it('la fuente escrita a mano queda guardada en el cobro: es de dónde entró la plata', async () => {
    await pagoPorTransferencia()
    const cobro = (estado.fixtures.cobros ?? [])[0] as Record<string, unknown>
    expect(cobro.fuente).toBe('Transferencia Bancolombia')
    expect(cobro.monto).toBe(500_000)
    expect(cobro.negocio_id).toBe('n-abierto')
  })

  it('sin pasarela sigue exigiendo el nombre de la fuente: "otra" a secas no dice nada', async () => {
    const r = await registrarPagoEnNegocio(servicioFalso(), WS, 'staff-comercial', {
      negocio_id: 'n-abierto',
      fuente: 'otra',
      fuente_nombre: '   ',
      referencia: 'TRF-0002',
      monto: 500_000,
    })
    expect(r.success).toBe(false)
    expect(estado.fixtures.cobros ?? []).toHaveLength(0)
  })
})
