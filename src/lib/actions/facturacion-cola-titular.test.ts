/**
 * La cola de facturación muestra el titular con el que la factura va a salir DE VERDAD.
 *
 * Con un titular corregido (`metadata.titular_corregido`), «Así saldría la factura»
 * tiene que decir el corregido: la emisión lo usa, y una revisión que pintara el del RUT
 * sería una pantalla sana que miente. El RUT no se pierde: viaja aparte, para que la
 * pantalla diga qué se reemplazó.
 *
 * Mismo doble que las demás pruebas de la cola (`test/cola-facturacion-doble`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WS, reiniciarDoble, sembrar, servicioFalso, estado } from '../../../test/cola-facturacion-doble'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => servicioFalso(),
  createClient: async () => servicioFalso(),
}))

vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({
    workspaceId: WS, staffId: 'staff-diana', role: 'owner', areas: ['financiera'], supabase: null,
  }),
}))

vi.mock('@/lib/siigo/client', () => ({ siigoRequest: async () => ({ results: [] }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { getColaFacturacion } from './facturacion-actions'

const CORRECCION = {
  tipo_documento: '13', numero: '52100200', dv: '4', nombre: ['PAULA ANDREA', 'OLIVEROS'],
  por: 'Diana Parra', por_staff_id: 'staff-diana', at: '2026-09-22T15:00:00.000Z',
  rut: { identificacion: '9771470', nombre: 'VICTOR RESTREPO' },
}

beforeEach(reiniciarDoble)

const unCaso = async () => {
  const { data, error } = await getColaFacturacion()
  expect(error).toBeUndefined()
  return data!.casos[0]
}

describe('cola de facturación — el titular que se pinta es el que va a salir', () => {
  it('sin corrección: el del RUT, y el contacto aparte', async () => {
    sembrar({ casos: 1 })
    estado.fixtures.contactos[0].nombre = 'PAULA ANDREA OLIVEROS'
    const caso = await unCaso()

    expect(caso.identificacion).toBe('9771470')
    expect(caso.cliente).toBe('VICTOR RESTREPO')
    expect(caso.titular).toMatchObject({ tipo_documento: '13', numero: '9771470', corregido: null })
    expect(caso.contacto_nombre).toBe('PAULA ANDREA OLIVEROS')
  })

  it('con corrección: el corregido, con quién la hizo y lo que dice el RUT', async () => {
    sembrar({ casos: 1, metadata: () => ({ titular_corregido: CORRECCION }) })
    const caso = await unCaso()

    expect(caso.identificacion).toBe('52100200')
    expect(caso.cliente).toBe('PAULA ANDREA OLIVEROS')
    expect(caso.titular).toMatchObject({
      numero: '52100200', nombre: ['PAULA ANDREA', 'OLIVEROS'],
      corregido: { por: 'Diana Parra', rut: { identificacion: '9771470', nombre: 'VICTOR RESTREPO' } },
    })
    // La corrección solo cubre nombre y documento: el caso sigue listo.
    expect(caso.faltan_cliente).toEqual([])
  })

  it('una corrección a medias se ignora: se pinta el RUT, no medio titular', async () => {
    sembrar({ casos: 1, metadata: () => ({ titular_corregido: { ...CORRECCION, nombre: ['PAULA'] } }) })
    const caso = await unCaso()
    expect(caso.identificacion).toBe('9771470')
    expect(caso.titular.corregido).toBeNull()
  })

  it('los recibos que ya salieron y el tercero amarrado viajan para los avisos', async () => {
    sembrar({
      casos: 1,
      metadata: () => ({ siigo_cliente: { identificacion: '9771470', siigo_id: 'x', branch_office: 0 } }),
    })
    estado.fixtures.cobros[0].siigo_recibo = [
      { numero: 'RC-3-12', siigo_id: 'a', valor: 1, archivo_url: null, at: '', por: null },
      { numero: 'RC-1-90', siigo_id: 'b', valor: 1, archivo_url: null, at: '', por: null },
    ]
    const caso = await unCaso()
    expect(caso.tercero_siigo).toBe('9771470')
    expect(caso.recibos_emitidos).toEqual(['RC-3-12', 'RC-1-90'])
  })
})
