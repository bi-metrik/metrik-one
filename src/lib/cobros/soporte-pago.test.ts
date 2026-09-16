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

/** Cuántas veces se abrió el archivo a "cualquiera con el enlace". Tiene que ser 0. */
const aperturas: string[] = []
/** Bytes que Storage devuelve. `null` = Drive nunca se alcanza. */
let bytesDeStorage: Blob | null = null

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    storage: {
      from: () => ({
        getPublicUrl: () => ({ data: { publicUrl: 'https://storage/x' } }),
        download: async () =>
          bytesDeStorage
            ? { data: bytesDeStorage, error: null }
            : { data: null, error: new Error('sin red') },
      }),
    },
  }),
}))
vi.mock('@/lib/google-drive', () => ({
  createSubfolderPath: async () => 'folder',
  uploadFileToDrive: async () => ({ fileId: 'f', webViewLink: 'https://drive/file/d/f/view' }),
  // Sigue declarado a propósito aunque el módulo ya no lo importe: si alguien lo
  // reintroduce, la prueba de abajo lo cuenta en vez de dejarlo pasar en silencio.
  setFilePublicByLink: async (fileId: string) => { aperturas.push(fileId) },
}))

import { archivarSoporte } from './soporte-pago'
import { duenoDeReferencia } from '@/lib/almacenamiento/referencia'

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

  // Lo que se guarda cuando Drive no responde ES lo que después hay que poder abrir.
  // Con la URL pública que había antes, el día que el bucket se cierre la fila quedaría
  // con un enlace muerto y nadie se enteraría hasta que un usuario lo abriera.
  it('sin Drive queda una REFERENCIA, y la puerta le reconoce dueño', async () => {
    const WS_UUID = '7dea141d-d4da-483d-a78d-b14ef35500c5'
    const r = await archivarSoporte(
      supabaseFalso, WS_UUID, 'negocio-1',
      { storage_path: `${WS_UUID}/pagos-fab/mio.jpg`, file_name: 'mio.jpg' },
      null, 'user-1',
    )
    expect(r?.url).toBe(`one://ve-documentos/${WS_UUID}/pagos-fab/mio.jpg`)
    expect(duenoDeReferencia(r?.url)).toEqual({ workspaceId: WS_UUID, negocioId: null })
  })
})

// ── El soporte NACE CERRADO en Drive ─────────────────────────────────────────
//
// Un soporte de pago es la captura de una transferencia bancaria. Hasta el 2026-09-16
// se abría a "cualquiera con el enlace", un permiso que no vence y sobrevive al cierre
// del negocio. Nadie sin cuenta en ONE tiene que abrirlo: lo lee el equipo, con sesión,
// por `/api/archivos/cobro`, que necesita `drive_file_id`.

const WS_UUID = '7dea141d-d4da-483d-a78d-b14ef35500c5'

/** Un negocio CON carpeta de Drive: es el único camino que llega a subir el archivo. */
const supabaseConCarpeta = {
  from: () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { carpeta_url: 'https://drive.google.com/drive/folders/CARPETA1' },
          }),
        }),
      }),
    }),
  }),
}

describe('el soporte empujado a Drive', () => {
  it('NO se abre a cualquiera con el enlace, y guarda el id que la ruta necesita', async () => {
    aperturas.length = 0
    bytesDeStorage = new Blob(['bytes'])
    try {
      const r = await archivarSoporte(
        supabaseConCarpeta, WS_UUID, 'negocio-1',
        { storage_path: `${WS_UUID}/pagos-externos/mio.jpg`, file_name: 'mio.jpg' },
        null, 'user-1',
      )
      // CONTROL: sin esto, un fallo de la subida daría el mismo cero de aperturas.
      expect(r?.drive_file_id).toBe('f')
      expect(aperturas).toEqual([])
    } finally {
      bytesDeStorage = null
    }
  })
})
