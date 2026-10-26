import { beforeEach, describe, expect, it, vi } from 'vitest'

// Las cinco subcarpetas de un negocio nuevo se piden A LA VEZ (2026-10-04).
//
// EL CASO QUE IMPORTA: en serie eran cinco idas y vueltas a Drive después de la raíz, y
// llevaban «Crear negocio» a 7,5 s de p95 en SOENA. La prueba usa un Drive que solo
// contesta las subcarpetas cuando le llegaron las cinco: en serie se queda esperando la
// primera para siempre (y la prueba vence), en paralelo pasa.
//
// CONTROLES: la raíz se crea ANTES que las hijas (son sus hijas), `carpeta_url` queda
// escrita, y una subcarpeta que falla no tumba a las otras ni a la carpeta.

const pedidas: Array<{ nombre: string; padre: string }> = []
let fallaUna: string | null = null
let liberarHijas: () => void = () => {}
let hijasListas = new Promise<void>(r => { liberarHijas = r })

vi.mock('@/lib/almacenamiento/proveedor', () => ({ usaAlmacenamientoExterno: async () => false }))
vi.mock('@/lib/activity/registrar-actividad', () => ({ registrarActividad: async () => ({ ok: true, id: null }) }))
vi.mock('@/lib/google-drive', () => ({
  createDriveFolder: async (nombre: string, padre: string) => {
    pedidas.push({ nombre, padre })
    if (padre === 'padre-drive') return 'raiz-1'
    // Una hija: espera a que lleguen las cinco.
    if (pedidas.filter(p => p.padre === 'raiz-1').length === 5) liberarHijas()
    await hijasListas
    if (nombre === fallaUna) throw new Error('Drive 500')
    return `hija-${nombre}`
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
        update: (v: Record<string, unknown>) => { updates.push(v); return q },
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
  pedidas.length = 0
  updates.length = 0
  fallaUna = null
  hijasListas = new Promise<void>(r => { liberarHijas = r })
})

describe('ensureNegocioDriveFolder pide las subcarpetas en paralelo', () => {
  it('las cinco hijas salen a la vez, después de la raíz, y carpeta_url queda escrita', async () => {
    const r = await ensureNegocioDriveFolder(clienteFalso(), 'ws-soena', 'neg-1')
    expect(r).toEqual({ created: true, carpeta_url: 'https://drive.google.com/drive/folders/raiz-1', reason: 'creada' })
    expect(pedidas[0]).toEqual({ nombre: 'V0001 - Ana', padre: 'padre-drive' })
    expect(pedidas.slice(1).map(p => p.nombre)).toEqual(['1. Legal', '2. Comercial', '3. UPME', '4. DIAN', '5. Otros'])
    expect(pedidas.slice(1).every(p => p.padre === 'raiz-1')).toBe(true)
    expect(updates).toEqual([{ carpeta_url: 'https://drive.google.com/drive/folders/raiz-1' }])
  }, 2000)

  it('una subcarpeta que falla no tumba las demás ni la carpeta', async () => {
    fallaUna = '3. UPME'
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await ensureNegocioDriveFolder(clienteFalso(), 'ws-soena', 'neg-1')
    expect(r.created).toBe(true)
    expect(pedidas).toHaveLength(6)
    expect(aviso).toHaveBeenCalledTimes(1)
    expect(String(aviso.mock.calls[0][0])).toContain('3. UPME')
    aviso.mockRestore()
  }, 2000)
})
