/**
 * Criterio 5 · «el total de la cotización en la columna derecha» muestra el número nuevo sin
 * recargar. La columna (`panel-viaje.tsx`) lee `cotizaciones.valor_total` de la carga de la
 * página; el editor le publica el total de su lectura propia (`total-vivo.tsx`).
 *
 * Se queda en `.ts` por el `include` de vitest.
 */
import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import PanelViaje from './[id]/panel-viaje'
import { TotalVivoContexto, totalParaLaLista } from './total-vivo'
import type { MarcoDelNegocio } from '@/lib/cotizaciones/marco-negocio'

const viaje: MarcoDelNegocio = {
  negocioId: 'neg-1',
  viaje: { destino: 'San Andrés', fechas: { inicio: '2026-11-09', fin: '2026-11-13' }, composicion: { adultos: 2, ninos: 0, infantes: 1 } },
  iataDestino: null,
  solicitud: { destino: 'San Andrés', alcance: null, fechas: null, tipoDeFechas: null, pasajeros: null, requisitos: null } as MarcoDelNegocio['solicitud'],
  perfil: null,
  cotizaciones: [
    { id: 'cot-19', codigo: 'COT-2026-0019', estado: 'borrador', valorTotal: 4_588_235, editadaEl: null },
    { id: 'cot-18', codigo: 'COT-2026-0018', estado: 'borrador', valorTotal: 12_000_000, editadaEl: null },
  ],
  puedeCrearCotizacion: true,
}

const totalDe = (html: string, id: string) =>
  html.match(new RegExp(`data-total-cotizacion="${id}"[^>]*>([^<]+)<`))?.[1]?.replace(/\s/g, ' ').trim() ?? null

describe('la columna de la derecha', () => {
  it('sin total vivo (la página del negocio): el de la página, como siempre', () => {
    const html = renderToStaticMarkup(React.createElement(PanelViaje, { viaje, cotActualId: 'cot-19' }))
    expect(totalDe(html, 'cot-19')).toMatch(/4\.588\.235/)
    expect(totalDe(html, 'cot-18')).toMatch(/12\.000\.000/)
  })

  it('con el total que acaba de leer el editor: el nuevo, solo para ESA cotización', () => {
    const html = renderToStaticMarkup(React.createElement(
      TotalVivoContexto.Provider,
      { value: { total: { cotizacionId: 'cot-19', valorTotal: 941_176 }, publicar: () => {} } },
      React.createElement(PanelViaje, { viaje, cotActualId: 'cot-19' }),
    ))
    expect(totalDe(html, 'cot-19')).toMatch(/941\.176/)
    expect(totalDe(html, 'cot-18')).toMatch(/12\.000\.000/)
  })

  it('totalParaLaLista', () => {
    expect(totalParaLaLista('cot-19', 4_588_235, null)).toBe(4_588_235)
    expect(totalParaLaLista('cot-19', 4_588_235, { cotizacionId: 'cot-19', valorTotal: 941_176 })).toBe(941_176)
    expect(totalParaLaLista('cot-18', 12_000_000, { cotizacionId: 'cot-19', valorTotal: 941_176 })).toBe(12_000_000)
  })
})
