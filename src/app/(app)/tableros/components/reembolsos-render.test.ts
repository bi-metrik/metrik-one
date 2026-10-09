/**
 * El indicador de reembolsos (SOE-007) renderizado de verdad: las filas de la pestaña
 * Dirección y el panel con la lista y el corte por vendedor.
 *
 * ⚠️ Se queda en `.ts`: el `include` de `vitest.config.ts` es `src/**\/*.test.ts`.
 * ⚠️ Sin DOM: el clic no se ejercita. Lo que queda fijado es qué cifra es botón, qué dice
 * cada fila y qué trae el panel.
 *
 * Datos sintéticos con la forma de V0494 (637.500 con IVA, 535.714 sin IVA).
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReembolsosMes, Reembolso } from '@/lib/tableros/reembolsos'
import type { DirectivoData } from '../directivo-actions'

// `directivo-actions` es `'use server'` y depende del runtime de Next. Aquí solo se pinta.
vi.mock('../directivo-actions', () => ({ getDirectivo: vi.fn() }))

const { default: TabDireccion } = await import('./tab-direccion')
const { ReembolsosDrawer } = await import('./reembolsos-drawer')

const V0494: Reembolso = {
  devolucion_id: 'd1', negocio_id: 'id-V0494', codigo: 'V0494', nombre: 'CATHERINE CHACON',
  fecha: '2026-10-08', valor: 535714.29, monto: 637500,
  motivo: 'La clienta desistió y se le devolvió el anticipo', cierre: 'ya_cerrado',
  venta_anulada: true, responsable_id: 'v1', responsable: 'Daniela',
}

const PARCIAL: Reembolso = {
  ...V0494, devolucion_id: 'd2', negocio_id: 'id-V9001', codigo: 'V9001', nombre: 'COBRO DOBLE',
  fecha: '2026-10-09', valor: 84033.61, monto: 100000, motivo: 'Pagó dos veces la misma cuota',
  cierre: 'abierto', venta_anulada: false, responsable_id: null, responsable: null,
}

const RE: ReembolsosMes = {
  anio: 2026, mes: 10, reembolsos: 2, negocios: 2, valor: 619747.9, monto: 737500,
  ventas_anuladas: 1, detalle: [PARCIAL, V0494], anterior: { reembolsos: 0, valor: 0 },
}

const vacias = { Bogotá: 0 } as unknown as DirectivoData['citas']['columnas']

const DATOS: DirectivoData = {
  anio: 2026, mes: 10,
  comercial: {
    leads_generados: 10, leads_calificados: 5, negocios_cerrados: 3,
    primer_pago: 1000000, segundo_pago: 0, ventas_totales: 1000000,
  },
  metas: { meta_ventas_mensual: null },
  operaciones: [],
  citas: { columnas: vacias, total: 0 },
  totalCartera: 0,
  segundoPago: null,
  reembolsos: RE,
}

// `Intl` separa el signo de la cifra con un espacio duro: se normaliza para comparar texto.
const html = (d: DirectivoData) =>
  renderToStaticMarkup(React.createElement(TabDireccion, { inicial: d })).replace(/ /g, ' ')
const fila = (h: string, nombre: string) => {
  const i = h.indexOf(`>${nombre}`)
  expect(i).toBeGreaterThan(-1)
  return h.slice(i, h.indexOf('</tr>', i))
}

describe('Dirección: reembolsos del mes', () => {
  it('cuenta los reembolsos, dice de dónde sale la cifra y cuántos ya no son venta, y se abre', () => {
    const f = fila(html(DATOS), 'Reembolsos')
    expect(f).toContain('>2<')
    expect(f).toContain('Por fecha de la devolución')
    expect(f).toContain('sin IVA')
    expect(f).toContain('1 con todo devuelto: ya no cuentan como venta')
    expect(f).toContain('<button')
  })

  it('el dinero devuelto va sin IVA y cita lo que salió con IVA', () => {
    const f = fila(html(DATOS), 'Dinero devuelto')
    expect(f).toContain('$ 619.748')
    expect(f).toContain('$ 737.500 con IVA')
  })

  it('«Negocios cerrados» declara que no cuenta las ventas devueltas en su totalidad', () => {
    expect(fila(html(DATOS), 'Negocios cerrados')).toContain('devolvió todo')
  })

  it('sin reembolsos la cifra es cero y no es botón', () => {
    const cero: ReembolsosMes = { ...RE, reembolsos: 0, negocios: 0, valor: 0, monto: 0, ventas_anuladas: 0, detalle: [] }
    const f = fila(html({ ...DATOS, reembolsos: cero }), 'Reembolsos')
    expect(f).toContain('>0<')
    expect(f).not.toContain('<button')
  })

  it('si la RPC falla dice «sin dato», no un cero', () => {
    const h = html({ ...DATOS, reembolsos: null })
    expect(fila(h, 'Reembolsos')).toContain('sin dato')
    expect(fila(h, 'Dinero devuelto')).toContain('sin dato')
  })
})

describe('Panel de reembolsos', () => {
  const panel = (porVendedor: boolean) =>
    renderToStaticMarkup(React.createElement(ReembolsosDrawer, { datos: RE, porVendedor, onClose: () => {} }))

  it('trae caso, nombre, fecha, valor, motivo, cierre y comercial, y abre el negocio', () => {
    const h = panel(false)
    expect(h).toContain('Reembolsos · Octubre 2026')
    expect(h).toContain('href="/negocios/id-V0494"')
    const v = h.slice(h.indexOf('V0494'), h.indexOf('</li>', h.indexOf('V0494')))
    expect(v).toContain('CATHERINE CHACON')
    expect(v).toContain('08/10')
    expect(v).toContain('$535.714')
    expect(v).toContain('La clienta desistió')
    expect(v).toContain('El caso ya estaba cerrado')
    expect(v).toContain('ya no es venta')
    expect(v).toContain('Daniela')
    const p = h.slice(h.indexOf('V9001'), h.indexOf('</li>', h.indexOf('V9001')))
    expect(p).toContain('El caso sigue abierto')
    expect(p).toContain('Sin comercial')
    expect(p).not.toContain('ya no es venta')
    expect(h).toContain('2 reembolsos')
  })

  it('en Comercial abre el corte por vendedor; en Dirección no', () => {
    expect(panel(false)).not.toContain('Por vendedor')
    const h = panel(true)
    const corte = h.slice(h.indexOf('Por vendedor'), h.indexOf('</ul>', h.indexOf('Por vendedor')))
    expect(corte).toContain('Daniela')
    expect(corte).toContain('$535.714')
    expect(corte).toContain('Sin comercial')
    expect(corte.indexOf('Daniela')).toBeLessThan(corte.indexOf('Sin comercial'))
  })
})
