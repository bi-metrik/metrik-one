import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WS, estado, reiniciarDoble, servicioFalso } from '../../../test/redistribucion-doble'

// Crear un negocio no espera a Drive para crear los bloques (2026-10-04).
//
// EL CASO QUE IMPORTA: la carpeta de Drive (raíz + 5 subcarpetas) corría ANTES de los
// bloques y en serie con ellos. Ahora arranca en el mismo punto y corre mientras se
// crean los bloques. La prueba usa un Drive que no contesta hasta que se le suelte: los
// bloques tienen que quedar creados mientras Drive sigue pendiente.
//
// CONTROL: la respuesta SÍ espera a Drive. No va a `after()`: la ficha que abre a
// continuación muestra `carpeta_url`, y una carpeta a medio crear se cruzaría con el
// cron `ensure-negocio-folders`.

let soltarDrive: () => void = () => {}
const drive = vi.fn((_s: unknown, _ws: string, _n: string) =>
  new Promise<{ created: boolean; carpeta_url: string | null }>(r => {
    soltarDrive = () => r({ created: true, carpeta_url: 'https://drive.google.com/drive/folders/x' })
  }),
)
vi.mock('@/lib/negocios/ensure-drive-folder', () => ({
  ensureNegocioDriveFolder: (s: unknown, ws: string, n: string) => drive(s, ws, n),
}))
vi.mock('@/lib/activity/registrar-actividad', () => ({ registrarActividad: async () => ({ ok: true, id: null }) }))
vi.mock('@/lib/negocios/responsable-rol', () => ({ asignarResponsable: async () => {} }))

import { crearNegocioEnWorkspace } from './crear-negocio'

beforeEach(() => {
  drive.mockClear()
  reiniciarDoble()
  estado.fixtures.workspaces = [{ id: WS, stages_activos: ['venta'], linea_activa_id: 'linea-1', config_extra: {} }]
  estado.fixtures.etapas_negocio = [{ id: 'etapa-1', stage: 'venta', linea_id: 'linea-1', orden: 1 }]
  estado.fixtures.bloque_configs = [
    { id: 'bc-1', etapa_id: 'etapa-1', workspace_id: WS, estado: 'editable', es_gate: false, config_extra: {}, bloque_definitions: { tipo: 'datos' } },
  ]
})

describe('crearNegocioEnWorkspace solapa Drive con los bloques', () => {
  it('los bloques quedan creados mientras Drive sigue pendiente, y la respuesta espera a Drive', async () => {
    let respondio = false
    const p = crearNegocioEnWorkspace(
      { supabase: servicioFalso() as never, workspaceId: WS, userId: 'p-1', role: 'owner', staffId: 'staff-1' },
      { nombre: 'Negocio de prueba', origen: 'referido' },
    ).then(r => { respondio = true; return r })

    // Que corra todo lo que no depende de Drive.
    for (let i = 0; i < 50; i++) await Promise.resolve()

    expect(drive).toHaveBeenCalledTimes(1)
    expect(estado.fixtures.negocio_bloques ?? []).toHaveLength(1)
    // CONTROL: con Drive pendiente, la acción todavía no respondió.
    expect(respondio).toBe(false)

    soltarDrive()
    const r = await p
    expect(r.error).toBeNull()
    expect(respondio).toBe(true)
  })
})
