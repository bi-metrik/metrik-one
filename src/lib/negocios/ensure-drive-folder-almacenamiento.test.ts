import { beforeEach, describe, expect, it, vi } from 'vitest'

// Un negocio que nace en un workspace con almacenamiento externo NO recibe carpeta en
// Drive: ni desde `crearNegocio`, ni desde el cron, ni desde un backfill (los tres
// pasan por este helper). Y si la marca no se puede leer, tampoco (fail-closed).

let externo: boolean | Error = false
const carpetasCreadas: string[] = []
const actividades: string[] = []

vi.mock('@/lib/almacenamiento/proveedor', () => ({
  usaAlmacenamientoExterno: async () => {
    if (externo instanceof Error) throw externo
    return externo
  },
}))
vi.mock('@/lib/google-drive', () => ({
  createDriveFolder: async (nombre: string) => {
    carpetasCreadas.push(nombre)
    return `id-${carpetasCreadas.length}`
  },
}))
vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: async (_s: unknown, fila: { tipo: string }) => {
    actividades.push(fila.tipo)
    return { ok: true, id: null }
  },
}))

import { ensureNegocioDriveFolder } from './ensure-drive-folder'

const updates: Array<Record<string, unknown>> = []

function clienteFalso() {
  return {
    from: (tabla: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        update: (v: Record<string, unknown>) => {
          updates.push(v)
          return q
        },
        single: async () => {
          if (tabla === 'negocios') {
            return {
              data: { id: 'neg-1', linea_id: null, carpeta_url: null, codigo: 'V0001', nombre: 'Viaje', empresas: null, contactos: { nombre: 'Ana' } },
              error: null,
            }
          }
          if (tabla === 'workspaces') return { data: { drive_folder_id: 'padre-drive' }, error: null }
          return { data: null, error: null }
        },
        then: (r: (v: unknown) => unknown) => r({ data: null, error: null }),
      }
      return q
    },
  }
}

beforeEach(() => {
  externo = false
  carpetasCreadas.length = 0
  actividades.length = 0
  updates.length = 0
})

describe('ensureNegocioDriveFolder y el almacenamiento externo', () => {
  it('workspace externo: no crea carpeta, no escribe carpeta_url y no ensucia el timeline', async () => {
    externo = true
    const r = await ensureNegocioDriveFolder(clienteFalso(), 'ws-trappvel', 'neg-1')
    expect(r).toEqual({ created: false, carpeta_url: null, reason: 'almacenamiento_externo' })
    expect(carpetasCreadas).toHaveLength(0)
    expect(updates).toHaveLength(0)
    expect(actividades).toHaveLength(0)
  })

  it('si la marca no se puede leer, tampoco crea carpeta', async () => {
    externo = new Error('red caída')
    const r = await ensureNegocioDriveFolder(clienteFalso(), 'ws-x', 'neg-1')
    expect(r.reason).toBe('error')
    expect(carpetasCreadas).toHaveLength(0)
  })

  it('control: workspace en Drive crea la carpeta y sus subcarpetas como siempre', async () => {
    const r = await ensureNegocioDriveFolder(clienteFalso(), 'ws-soena', 'neg-1')
    expect(r.created).toBe(true)
    expect(carpetasCreadas[0]).toBe('V0001 - Ana')
    expect(carpetasCreadas).toHaveLength(6)
    expect(updates).toEqual([{ carpeta_url: 'https://drive.google.com/drive/folders/id-1' }])
  })
})
