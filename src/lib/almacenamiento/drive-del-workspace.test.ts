/**
 * ¿Un id de Drive cuelga de una carpeta del workspace? Ver `drive-del-workspace.ts`.
 *
 * Los casos de uso (borrar el archivo anterior, reprocesar, leer un documento de negocio)
 * los prueba `src/lib/actions/documentos-ruta-workspace.test.ts`. Aquí, la subida por
 * padres y el cierre ante lo que no se puede comprobar.
 *
 * VISTO FALLAR (2026-09-16), mutando `drive-del-workspace.ts`:
 *   - dejando pasar el id que ES una raíz (`archivoDriveOperable`): cae 1;
 *   - contando el propio id como descendiente en la subida pura: cae 1;
 *   - sin el registro de vistos: cae 1 (el ciclo termina igual por el tope de niveles, pero
 *     preguntando a Drive una vez por nivel);
 *   - dejando pasar cuando la comprobación lanza: cae 1.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const drive: { global: boolean | Error; padres: Record<string, string[]> } = { global: true, padres: {} }

vi.mock('@/lib/google-drive', () => ({
  usaCredencialesDriveGlobales: async () => {
    if (drive.global instanceof Error) throw drive.global
    return drive.global
  },
  padresDeArchivoDrive: async (id: string) => drive.padres[id] ?? null,
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (tabla: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () =>
          tabla === 'workspaces'
            ? { data: { drive_folder_id: 'raiz-ws' }, error: null }
            : { data: { carpeta_url: 'https://drive.google.com/drive/folders/carpeta-neg' }, error: null },
      }
      return q
    },
  }),
}))

import { archivoDriveOperable, desciendeDeAlgunaRaiz } from './drive-del-workspace'

const padresDe = (mapa: Record<string, string[]>) => async (id: string) => mapa[id] ?? null

beforeEach(() => {
  drive.global = true
  drive.padres = {}
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('desciendeDeAlgunaRaiz', () => {
  it('un archivo dentro de la carpeta del negocio desciende', async () => {
    const mapa = { f: ['sub'], sub: ['carpeta-neg'] }
    expect(await desciendeDeAlgunaRaiz('f', new Set(['carpeta-neg']), padresDe(mapa))).toBe(true)
  })

  it('la raíz misma no es su propio descendiente', async () => {
    expect(await desciendeDeAlgunaRaiz('carpeta-neg', new Set(['carpeta-neg']), padresDe({ 'carpeta-neg': ['raiz'] }))).toBe(false)
  })

  it('un ciclo en los padres termina sin volver a preguntar por lo ya visto', async () => {
    const mapa: Record<string, string[]> = { a: ['b'], b: ['a'] }
    const preguntas: string[] = []
    const r = await desciendeDeAlgunaRaiz('a', new Set(['carpeta-neg']), async (id) => {
      preguntas.push(id)
      return mapa[id] ?? null
    })
    expect(r).toBe(false)
    expect(preguntas).toEqual(['a', 'b'])
  })

  it('sin raíces, nada desciende', async () => {
    expect(await desciendeDeAlgunaRaiz('f', new Set(), padresDe({ f: ['x'] }))).toBe(false)
  })
})

describe('archivoDriveOperable', () => {
  it('con Drive propio no se sube por padres', async () => {
    drive.global = false
    expect(await archivoDriveOperable({ fileId: 'cualquiera', workspaceId: 'ws' })).toBe(true)
  })

  it('sin Drive propio, un archivo de otra carpeta no se opera', async () => {
    drive.padres = { f: ['carpeta-de-otro-cliente'], 'carpeta-de-otro-cliente': ['raiz-de-otro'] }
    expect(await archivoDriveOperable({ fileId: 'f', workspaceId: 'ws', negocioId: 'neg' })).toBe(false)
  })

  it('sin Drive propio, la carpeta del negocio no pasa por archivo', async () => {
    drive.padres = { 'carpeta-neg': ['raiz-ws'] }
    expect(await archivoDriveOperable({ fileId: 'carpeta-neg', workspaceId: 'ws', negocioId: 'neg' })).toBe(false)
  })

  it('CONTROL — sin Drive propio, un archivo del negocio sí', async () => {
    drive.padres = { f: ['sub'], sub: ['carpeta-neg'] }
    expect(await archivoDriveOperable({ fileId: 'f', workspaceId: 'ws', negocioId: 'neg' })).toBe(true)
  })

  it('si no se puede comprobar, no se opera', async () => {
    drive.global = new Error('credenciales Drive incompletas')
    expect(await archivoDriveOperable({ fileId: 'f', workspaceId: 'ws' })).toBe(false)
  })
})
