/**
 * El PDF imprime el precio por adulto, por niño y por infante, por línea y en total.
 *
 * ⚠️ El texto se lee del BINARIO, no se recalcula desde los props: la regla puede estar bien
 * y el documento imprimir otra cosa. @react-pdf escribe el texto en HEX con Helvetica
 * estándar, así que el código hexadecimal es el del carácter (ver
 * `cotizacion-alternativas-e2e.test.ts`).
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { inflateSync } from 'node:zlib'

import CotizacionPDF from './cotizacion-pdf'
import type { CotizacionPDFProps } from './cotizacion-props'

function textoDelPDF(buf: Buffer): string {
  const trozos: string[] = []
  let desde = 0
  for (;;) {
    const ini = buf.indexOf('stream', desde)
    if (ini === -1) break
    let inicio = ini + 'stream'.length
    if (buf[inicio] === 0x0d) inicio++
    if (buf[inicio] === 0x0a) inicio++
    const fin = buf.indexOf('endstream', inicio)
    if (fin === -1) break
    try {
      trozos.push(inflateSync(buf.subarray(inicio, fin)).toString('latin1'))
    } catch {
      // fuente o imagen
    }
    desde = fin + 1
  }
  const contenido = trozos.join('\n')
  const piezas: string[] = []
  const reOperador = /(\[[^\]]*\]\s*TJ|(?:<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\))\s*Tj)/g
  let op: RegExpExecArray | null
  while ((op = reOperador.exec(contenido)) !== null) {
    let linea = ''
    const reTrozo = /<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^\\)])*)\)/g
    let t: RegExpExecArray | null
    while ((t = reTrozo.exec(op[0])) !== null) {
      if (t[1] !== undefined) {
        const hex = t[1].replace(/\s+/g, '')
        for (let i = 0; i + 1 < hex.length; i += 2) linea += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
      } else {
        linea += (t[2] ?? '').replace(/\\([()\\])/g, '$1')
      }
    }
    piezas.push(linea)
  }
  return piezas.join(' ')
}

const base = (over: Partial<CotizacionPDFProps>): CotizacionPDFProps => ({
  cotizacion: {
    consecutivo: 'COT-2026-0100',
    descripcion: null,
    valor_total: 6200000,
    modo: 'detallada',
    fecha_envio: null,
    fecha_validez: null,
    condiciones_pago: null,
    notas: null,
    descuento_porcentaje: 0,
    descuento_valor: 0,
  },
  empresa: { nombre: 'Cliente', nit: null, contacto_nombre: null, contacto_email: null, telefono: null, direccion: null, ciudad: null },
  vendedor: { nombre: 'Trappvel', razon_social: null, nit: null, logo_url: null, color_primario: '#10B981', telefono: null, email: null, direccion: null, ciudad: null },
  items: [],
  fiscal: null,
  ...over,
})

async function texto(props: CotizacionPDFProps): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buf = await renderToBuffer(createElement(CotizacionPDF, props) as any)
  // El espacio de no separación que pone Intl en «$ 1.000» se normaliza para comparar.
  return textoDelPDF(Buffer.from(buf)).split(String.fromCharCode(0xa0)).join(' ')
}

describe('PDF · precio por pasajero', () => {
  it('por línea y en total, con lo que va por grupo nombrado', async () => {
    const t = await texto(base({
      items: [
        {
          nombre: 'LATAM Bogotá–Orlando', descripcion: null, precio_venta: 4000000, descuento_porcentaje: 0, cantidad: 1,
          precioPorPasajero: [{ tipo: 'adulto', cantidad: 2, precioUnitario: 1500000 }, { tipo: 'nino', cantidad: 1, precioUnitario: 1000000 }],
        },
        {
          nombre: 'Hotel Crown Paradise', descripcion: null, precio_venta: 2000000, descuento_porcentaje: 0, cantidad: 1,
          precioPorPasajero: [{ tipo: 'adulto', cantidad: 2, precioUnitario: 800000 }, { tipo: 'nino', cantidad: 1, precioUnitario: 400000 }],
        },
        { nombre: 'Asistencia médica', descripcion: null, precio_venta: 200000, descuento_porcentaje: 0, cantidad: 1 },
      ],
      preciosPorPasajero: {
        filas: [{ tipo: 'adulto', precioUnitario: 2300000 }, { tipo: 'nino', precioUnitario: 1400000 }],
        sinReparto: ['Asistencia médica'],
      },
    }))
    expect(t).toMatch(/Por pasajero: Adulto \$ ?1\.500\.000 · Niño \$ ?1\.000\.000/)
    expect(t).toMatch(/Por pasajero: Adulto \$ ?800\.000 · Niño \$ ?400\.000/)
    expect(t).toContain('PRECIO POR PASAJERO')
    expect(t).toMatch(/Adulto\s+\$ ?2\.300\.000/)
    expect(t).toMatch(/Niño\s+\$ ?1\.400\.000/)
    expect(t).toContain('No incluye lo que se cobra por el grupo: Asistencia médica.')
    expect(t).not.toContain('Infante')
  })

  it('sin tarifa por pasajero el documento no imprime nada nuevo', async () => {
    const t = await texto(base({
      items: [{ nombre: 'Bomba sumergible', descripcion: null, precio_venta: 1000000, descuento_porcentaje: 0, cantidad: 2 }],
    }))
    expect(t).not.toContain('Por pasajero')
    expect(t).not.toContain('PRECIO POR PASAJERO')
  })
})
