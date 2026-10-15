/**
 * H8 (verificación D de Vera, 2026-10-14) · los menores de la forma por pasos, en pantalla:
 *  · «Lo que suma» se lee: cada otra opción en su línea, con la tarifa adelante;
 *  · N12 · una tarifa que no es de las tres lo dice en su pestaña.
 *
 * Se queda en `.ts` por el `include` de vitest.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {} }) }))

const { LoQueSuma } = await import('./por-pasos/lo-que-suma')
const { TarifasPorPasos } = await import('./por-pasos/tarifas-por-pasos')

const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

describe('H8 · «Lo que suma» se lee', () => {
  it('la opción elegida y, debajo, cada otra con su tarifa adelante (sin pegarlas con «·»)', () => {
    const nombres: Record<string, string> = {
      'h-posada': 'POSADA ENILDA · PROVIDENCIA', 'h-agua-dulce': 'CABAÑAS AGUA DULCE · PROVIDENCIA', 'a-privada': 'TOUR CAYO CANGREJO · LANCHA PRIVADA',
    }
    const html = renderToStaticMarkup(React.createElement(LoQueSuma, {
      datos: {
        renglones: [
          { grupo: 'hotel: Hotel en Providencia', nombre: 'Hotel en Providencia', tipo: 'hotel', opcionId: 'h-posada', precio: 1_446_000, noSuma: null, sinCosto: false, otras: [{ opcionId: 'h-agua-dulce', tarifas: ['Premium'] }] },
          { grupo: 'actividad: Cayo Cangrejo', nombre: 'Cayo Cangrejo', tipo: 'actividad', opcionId: 'a-compartida', precio: 847_000, noSuma: null, sinCosto: false, otras: [{ opcionId: 'a-privada', tarifas: [] }] },
        ] as never,
        nombreDeOpcion: id => nombres[id] ?? id,
        faltaPrecio: () => null,
        total: 1, costo: 1, margenPct: 15, otrasQueVan: [], pantallazosEnBandeja: 0, incompleto: false,
      },
    }))
    const t = texto(html)
    expect(t).toContain('POSADA ENILDA · PROVIDENCIA En Premium: CABAÑAS AGUA DULCE · PROVIDENCIA')
    expect(t).toContain('En ninguna tarifa: TOUR CAYO CANGREJO · LANCHA PRIVADA')
    expect(t).not.toContain('PROVIDENCIA · CABAÑAS')
    expect(t).not.toMatch(/no está en ninguna tarifa/)
    expect((html.match(/data-otra-opcion/g) ?? []).length).toBe(2)
  })
})

describe('H8 · N12 · «No es una de las tres tarifas»', () => {
  it('la pestaña de una tarifa extra lo dice; las tres de siempre no', () => {
    const tarifa = (id: string, nombre: string, canon: string | null) => ({
      id, nombre, canon, orden: 1, precio: 1_000_000, costo: 800_000, margenReal: 20, vaEnPropuesta: true, esPrincipal: canon === 'Recomendada',
      igualA: null, seleccion: [], opcionPorServicio: {}, firma: id,
    })
    const html = renderToStaticMarkup(React.createElement(TarifasPorPasos, {
      tarifas: [tarifa('tf-r', 'Recomendada', 'Recomendada'), tarifa('tf-p', 'Premium', 'Premium'), tarifa('tf-luna', 'Luna de miel', null)],
      servicios: [{ grupo: 'hotel: Hotel en Providencia', tipo: 'hotel', nombre: 'Hotel en Providencia', opciones: ['h-a', 'h-b'], estado: 'incluido', lugar: null, fecha: null, candidatas: ['h-a', 'h-b'] }],
      iguales: [], opcionales: [], noVan: [],
      nombreDeOpcion: (id: string) => id, detalleDeOpcion: () => null, precioDeOpcion: () => 0,
      margenPct: 15, umbrales: { pisoPct: 5, avisoPct: 10 }, editable: true, ocupado: false, autorizacion: null,
      verElCalculo: null, rastro: null,
      onElegir: () => {}, onMandar: () => {}, onMargen: () => {}, onRenombrar: () => {}, onMotivo: () => {}, onEliminarTarifa: () => {},
      onPedir: () => {}, onAutorizar: () => {}, onRetirar: () => {}, onSeguir: () => {}, onVolver: () => {},
    } as never))
    expect((html.match(/data-tarifa-extra/g) ?? []).length).toBe(1)
    expect(texto(html)).toContain('Luna de miel')
    expect(texto(html)).toContain('No es una de las tres tarifas')
  })
})
