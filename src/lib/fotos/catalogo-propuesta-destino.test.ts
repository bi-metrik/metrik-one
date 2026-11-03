/**
 * La imagen del destino de la portada (regla de fotos, 2026-10-29): el catálogo pide también las
 * ciudades del viaje que no son la llave de un hotel. En la COT-2026-0008 el hotel dice «Willemstad /
 * Curacao» (llave `willemstad`) y la parada del documento es «Curacao» (QA G7): la foto de Curazao,
 * guardada como `curacao`, tiene que llegar.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('./catalogo-almacen', async (original) => ({
  ...(await original<typeof import('./catalogo-almacen')>()),
  bytesDeCatalogo: async () => Buffer.from([0xff, 0xd8, 0xff]),
}))

import { catalogoParaLaPropuesta } from './catalogo-propuesta'
import type { CotizacionPDFProps } from '@/lib/pdf/cotizacion-props'

const WS = '00000000-0000-4000-8000-000000000001'

function doble(filas: Record<string, unknown>[]) {
  const pedidas: string[] = []
  const q = {
    select: () => q,
    eq: () => q,
    in: (_k: string, v: string[]) => {
      pedidas.push(...v)
      return Promise.resolve({ data: filas.filter((f) => v.includes(f.clave_pedida as string)), error: null })
    },
  }
  return { cliente: { from: () => q }, pedidas }
}

describe('el catálogo de la propuesta pide las ciudades del viaje', () => {
  it('cada parte de «Willemstad / Curacao» y el destino; la foto de `curacao` llega a la portada', async () => {
    const fila = {
      id: 'f1', tipo: 'ciudad', clave: 'curacao', clave_pedida: 'curacao', nombre_clave: 'curacao', nombre: 'Curaçao', ciudad: null,
      ref: `one://fotos-catalogo/${WS}/ciudad/abc.jpg`, origen: 'wikimedia', fuente_url: 'https://commons.wikimedia.org/wiki/File:X.jpg',
      titulo_fuente: null, autor: 'Autor de Ejemplo', licencia: 'CC BY-SA 2.0', foco_x: null, foco_y: null, proporcion: 3, revisada: true,
      descartadas: [], principal: true, posicion: 1, orden: 1, imagen_url: null, categoria: null,
    }
    const { cliente, pedidas } = doble([fila])
    const props = { viaje: { destino: 'CURAZAO', hoteles: [{ hotel: 'Hotel Ficticio', linea: 'Hotel Ficticio', ciudad: 'Willemstad / Curacao' }] } } as unknown as CotizacionPDFProps
    const c = await catalogoParaLaPropuesta(cliente, WS, props)
    expect(pedidas).toEqual(expect.arrayContaining(['willemstad', 'curacao', 'curazao']))
    expect(c?.ciudad('Curacao')).toMatchObject({ origen: 'wikimedia', revisada: true })
  })
})
