/**
 * Las dos cifras de segundo pago (SOE-002) renderizadas de verdad: la pestaña Dirección
 * y el panel con los negocios detrás de cada cifra.
 *
 * ⚠️ Se queda en `.ts`: el `include` de `vitest.config.ts` es `src/**\/*.test.ts`.
 * ⚠️ Sin DOM: el clic no se ejercita. Lo que queda fijado es qué cifra es botón, qué
 * suma «Ventas totales», que cada cifra lleva la nota de dónde sale, y qué trae el panel.
 *
 * Datos sintéticos con la forma de septiembre de 2026.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SegundoPagoMes } from '@/lib/tableros/segundo-pago'
import type { DirectivoData } from '../directivo-actions'

// `directivo-actions` es `'use server'` y depende del runtime de Next. Aquí solo se pinta.
vi.mock('../directivo-actions', () => ({ getDirectivo: vi.fn() }))

const { default: TabDireccion } = await import('./tab-direccion')
const { SegundoPagoDrawer } = await import('./segundo-pago-drawer')

const caso = (codigo: string, extra: Partial<SegundoPagoMes['recibido']['detalle'][number]>) => ({
  negocio_id: `id-${codigo}`, codigo, nombre: `Caso ${codigo}`, fecha_venta: '2026-09-05',
  fecha_pago: '2026-09-20', valor: 357142.86, responsable_id: 'v1', responsable: 'Vendedora Uno',
  de_venta_del_mes: true, ...extra,
})

const SP: SegundoPagoMes = {
  anio: 2026, mes: 9, umbral_migaja: 1000,
  recibido: {
    total: 1071415.13, negocios: 3, de_ventas_del_mes: 357142.86, de_ventas_anteriores: 714272.27,
    detalle: [
      caso('TE', {}),
      caso('TD', { fecha_venta: '2026-08-12', fecha_pago: '2026-09-18', valor: 357139.5, de_venta_del_mes: false }),
      caso('TB', { fecha_venta: '2026-07-22', fecha_pago: '2026-09-01', valor: 357132.77, de_venta_del_mes: false, responsable: null }),
    ],
  },
  de_ventas_del_mes: { total: 0, negocios: 0, detalle: [] },
  anterior: { recibido: 0, de_ventas_del_mes: 1338813.45 },
}

const vacias = { Bogotá: 0 } as unknown as DirectivoData['citas']['columnas']

const DATOS: DirectivoData = {
  anio: 2026, mes: 9,
  comercial: {
    leads_generados: 10, leads_calificados: 5, negocios_cerrados: 3,
    primer_pago: 1000000, segundo_pago: 1071447.06, ventas_totales: 2071447.06,
  },
  metas: { meta_ventas_mensual: null },
  operaciones: [],
  citas: { columnas: vacias, total: 0 },
  totalCartera: 0,
  segundoPago: SP,
  reembolsos: null,
}

const html = (d: DirectivoData) => renderToStaticMarkup(React.createElement(TabDireccion, { inicial: d }))
const fila = (h: string, nombre: string) => {
  const i = h.indexOf(nombre)
  expect(i).toBeGreaterThan(-1)
  return h.slice(i, h.indexOf('</tr>', i))
}

describe('Dirección: las dos cifras de segundo pago', () => {
  it('nombra las dos cifras y dice de dónde sale cada una', () => {
    const h = html(DATOS)
    expect(h).not.toContain('Ingresos segundo pago')
    expect(fila(h, '2º pago recibido este mes')).toContain('Por fecha de pago')
    expect(fila(h, '2º pago de las ventas de este mes')).toContain('Por mes de venta')
    expect(fila(h, '2º pago de las ventas de este mes')).toContain('No suma en Ventas totales')
  })

  it('el recibido parte en ventas de este mes y de meses anteriores, y se abre', () => {
    const f = fila(html(DATOS), '2º pago recibido este mes')
    expect(f).toContain('$ 357.143 de ventas de este mes')
    expect(f).toContain('$ 714.272 de ventas de meses anteriores')
    expect(f).toContain('<button')
  })

  it('Ventas totales = primer pago + 2º pago recibido (con el umbral), no la cifra vieja', () => {
    const f = fila(html(DATOS), 'Ventas totales')
    expect(f).toContain('$ 2.071.415')
    expect(f).not.toContain('2.071.447')
  })

  it('la cifra de cohorte en cero no es botón', () => {
    expect(fila(html(DATOS), '2º pago de las ventas de este mes')).not.toContain('<button')
  })

  it('sin la RPC de segundo pago cae a las cifras del directivo y no inventa la de cohorte', () => {
    const h = html({ ...DATOS, segundoPago: null })
    expect(fila(h, '2º pago recibido este mes')).toContain('1.071.447')
    expect(fila(h, 'Ventas totales')).toContain('2.071.447')
    expect(fila(h, '2º pago de las ventas de este mes')).toContain('sin dato')
  })
})

describe('Panel de segundo pago', () => {
  const panel = (cifra: 'recibido' | 'de_ventas_del_mes') =>
    renderToStaticMarkup(React.createElement(SegundoPagoDrawer, { datos: SP, cifra, onClose: () => {} }))

  it('trae cada negocio con su mes de venta, la fecha del 2º pago, el valor y el comercial, y abre el negocio', () => {
    const h = panel('recibido')
    expect(h).toContain('2º pago recibido este mes · Septiembre 2026')
    expect(h).toContain('href="/negocios/id-TB"')
    const tb = h.slice(h.indexOf('TB'), h.indexOf('</li>', h.indexOf('TB')))
    expect(tb).toContain('Jul 26')
    expect(tb).toContain('01/09')
    expect(tb).toContain('$357.133')
    expect(tb).toContain('Sin comercial')
    expect(h).toContain('3 casos')
  })

  it('cita la nota de la cifra y el umbral', () => {
    expect(panel('de_ventas_del_mes')).toContain('Por mes de venta')
    expect(panel('de_ventas_del_mes')).toContain('$1.000')
    expect(panel('de_ventas_del_mes')).toContain('No hay casos aquí.')
  })
})
