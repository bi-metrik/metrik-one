/**
 * El comprobante se lee con el cliente de SERVICIO, que no pasa por RLS.
 *
 * EL CASO QUE IMPORTA: el `storage_path` lo escribe el navegador. Sin la comprobación
 * de prefijo, un path apuntado a otro workspace se descargaría con privilegios de
 * servicio y terminaría archivado en la carpeta de un negocio ajeno como soporte
 * propio. La policy del bucket exige que la primera carpeta sea el workspace; esta
 * función lo vuelve a exigir del lado del servidor porque es quien lo elude.
 *
 * Antes tenía un solo caller (el panel de pagos externos). Desde que el FAB también
 * adjunta comprobantes son dos, y ninguno de los dos revalida el path por su cuenta.
 *
 * MUTACIÓN MEDIDA el 2026-09-12: anular el guard entero pone 2 en rojo.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    storage: {
      from: () => ({
        getPublicUrl: () => ({ data: { publicUrl: 'https://storage/x' } }),
        download: async () => ({ data: null, error: new Error('sin red') }),
      }),
    },
  }),
}))
vi.mock('@/lib/google-drive', () => ({
  createSubfolderPath: async () => 'folder',
  uploadFileToDrive: async () => ({ fileId: 'f', webViewLink: 'https://drive/f' }),
  setFilePublicByLink: async () => {},
}))

import { archivarSoporte } from './soporte-pago'

const WS = 'ws-propio'

/** Un supabase que responde "el negocio no tiene carpeta de Drive": basta para que la
 *  función llegue hasta el final sin salir a la red. */
const supabaseFalso = {
  from: () => ({
    select: () => ({
      eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { carpeta_url: null } }) }) }),
    }),
  }),
}

function archivar(storage_path: string) {
  return archivarSoporte(
    supabaseFalso, WS, 'negocio-1',
    { storage_path, file_name: 'transferencia.jpg' },
    null, 'user-1',
  )
}

describe('guard del path del comprobante', () => {
  it('un path de OTRO workspace se descarta', async () => {
    expect(await archivar('ws-ajeno/pagos-fab/robado.jpg')).toBeNull()
  })

  it('un path que trepa con ".." se descarta', async () => {
    expect(await archivar(`${WS}/../ws-ajeno/robado.jpg`)).toBeNull()
  })

  it('CONTROL — el path propio sí se archiva', async () => {
    const r = await archivar(`${WS}/pagos-fab/mio.jpg`)
    expect(r).toMatchObject({ file_name: 'transferencia.jpg', storage_path: `${WS}/pagos-fab/mio.jpg` })
  })

  it('el mime se deduce del nombre cuando el navegador no lo manda', async () => {
    const r = await archivarSoporte(
      supabaseFalso, WS, 'negocio-1',
      { storage_path: `${WS}/pagos-fab/a.pdf`, file_name: 'a.pdf' },
      null, 'user-1',
    )
    expect(r?.mime_type).toBe('application/pdf')
  })
})
