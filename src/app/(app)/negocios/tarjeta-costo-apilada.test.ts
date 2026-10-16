/**
 * «Costo y precio» no monta cifras (brief del 2026-10-16, Trappvel).
 *
 * En la cotización por pasos la tarjeta de la opción queda angosta (≈ 280 px de tabla con «Lo que
 * suma» abierta) y las cinco columnas de `fr` con `minmax(0, …)` se encogían por debajo de la
 * cifra: el precio c/u quedaba encima del precio total. Con el interruptor encendido la tabla mide su
 * PROPIO ancho (`@container`): si las columnas no caben, se apila en una tarjeta por fila con
 * «Cant. · Costo c/u · Precio c/u · Precio total» como pares de etiqueta y valor; si caben, las
 * columnas de números toman el ancho de su cifra (subgrid), así que ninguna se sale de su celda.
 *
 * Que las cifras no se monten es geometría y no se ve sin navegador: se midió con Chromium a
 * 280 px (montaje en `main`, ninguno con el arreglo). Aquí se fija lo que la sostiene:
 *  1. Apagado (sin `apilable`), la tabla es byte a byte la de `main`
 *     (`tarjeta-costo-apagado.fixture.html`, grabado UNA vez sobre `origin/main` con
 *     `GRABAR_TARJETA_COSTO=1`; no se regenera para que pase).
 *  2. Encendido, la tabla es un contenedor, la vista apilada trae los cuatro pares de cada fila
 *     con su cifra, y ninguna cifra puede partirse ni encogerse por debajo de su ancho.
 *
 * Las cifras son sintéticas, con el mismo número de dígitos que la fila de la evidencia (2 adultos,
 * siete dígitos por cifra): $850.000 de costo c/u y $2.000.000 de precio total.
 * Se queda en `.ts`: el `include` de vitest es `src/**\/*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {} }) }))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({
  ajustarOpcion: async () => ({ success: true }),
  elegirMonedaDeTarifa: async () => ({ success: true }),
  confirmarTarifaPorPasajero: async () => ({ success: true }),
}))
vi.mock('@/app/(app)/negocios/adicional-actions', () => ({
  agregarAdicional: async () => ({ success: true }),
  actualizarAdicional: async () => ({ success: true }),
  eliminarAdicional: async () => ({ success: true }),
}))

const { default: TarjetaCosto } = await import('./tarjeta-costo')
type Props = React.ComponentProps<typeof TarjetaCosto>

const FIXTURE = path.join(__dirname, 'tarjeta-costo-apagado.fixture.html')

/** Una fila como la de la evidencia, con cifras inventadas del mismo ancho. */
const PROPS: Props = {
  itemId: 'item-1',
  editable: true,
  confirmada: {
    composicion: { adultos: 2, ninos: 0, infantes: 0 },
    costos: [{ tipo: 'adulto', cantidad: 2, unitarioCOP: 850_000, totalCOP: 1_700_000 }],
    costoTotalCOP: 1_700_000,
    moneda: 'COP',
    tasa: null,
    confirmadaEn: '2026-10-16T10:00:00Z',
  },
  preciosAMano: undefined,
  precioLinea: 2_000_000,
  costoLinea: 1_700_000,
  margenAplicado: 15,
  convencion: 'sobre_venta',
  administrativosPct: 0,
  pisoPct: 8,
  adicionales: [],
  adicionalesDisponible: true,
  margenCotizacion: { margenPct: 15, convencion: 'sobre_venta' },
  moneda: { moneda: 'COP', asumida: false, origen: 'captura', leida: 'COP', decision: null },
  onCambio: () => {},
}

const pintar = (extra: Partial<Props> = {}) => renderToStaticMarkup(React.createElement(TarjetaCosto, { ...PROPS, ...extra }))

describe('«Costo y precio» con el interruptor apagado', () => {
  it('es byte a byte la tabla de main', () => {
    const html = pintar()
    if (process.env.GRABAR_TARJETA_COSTO === '1' && !existsSync(FIXTURE)) writeFileSync(FIXTURE, html)
    expect(html).toBe(readFileSync(FIXTURE, 'utf8'))
  })
})

describe('«Costo y precio» en la cotización por pasos', () => {
  const html = pintar({ apilable: true } as Partial<Props>)
  const filaAdulto = html.slice(html.indexOf('data-fila-costo="adulto"'), html.indexOf('data-fila-total'))

  it('la tabla mide su propio ancho: es un contenedor', () => {
    expect(html).toMatch(/role="table" class="[^"]*@container/)
  })

  it('apilada, cada fila trae los cuatro pares de etiqueta y valor con su cifra', () => {
    const pares = [...filaAdulto.matchAll(/data-par="([^"]+)"[^>]*>(?:<[^>]+>)*([^<]+)<\/dt>(?:<[^>]+>)*([^<]+)</g)]
      .map(m => [m[2], m[3]])
    expect(pares).toEqual([
      ['Cant.', '2'],
      ['Costo c/u', '850.000'],
      ['Precio c/u', '1.000.000'],
      ['Precio total', '2.000.000'],
    ])
  })

  it('ninguna cifra se parte ni se encoge por debajo de su ancho', () => {
    // Las celdas de número de la vista en columnas: nunca en dos líneas.
    const celdas = [...filaAdulto.matchAll(/<span class="([^"]*)" data-celda="[^"]+">/g)].map(m => m[1])
    expect(celdas).toHaveLength(4)
    for (const c of celdas) expect(c).toContain('whitespace-nowrap')
    // Las columnas de números se dimensionan por su cifra (auto), no por fracciones que se
    // encogen hasta cero: la plantilla vieja de `minmax(0,1fr)` es la que montaba.
    expect(html).not.toContain('repeat(3,minmax(0,1fr))')
    expect(html).toContain('grid-cols-subgrid')
  })
})
