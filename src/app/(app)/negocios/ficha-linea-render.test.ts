/**
 * La ficha de la línea: cada campo leído por la IA se puede corregir donde se ve, y una
 * corrección se ve junto con lo que dijo la lectura (brief del 2026-09-22, punto 3).
 *
 * ⚠️ Por qué RENDER: el requisito es de pantalla. `fichaDeLinea` puede armar bien la lista y
 * la pantalla no ofrecer el lápiz, o esconder la lectura original de un campo corregido, que
 * es lo que haría pasar un dato corregido por uno leído. Solo el render lo mide.
 *
 * Se queda en `.ts`: el `include` de vitest es `src/**\/*.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import FichaDeLinea from './ficha-linea-item'
import { ranuraPorSlug } from '@/lib/cotizaciones/ranuras-pantallazo'

const HOTEL = ranuraPorSlug('hotel_detalle')!
const CAMPOS = [
  { label: 'Hotel', valor: 'DECAMERON PANACA' },
  { label: 'Ciudad', valor: 'Quimbaya' },
  { label: 'Régimen', valor: 'Todo incluido' },
  { label: 'Moneda', valor: 'COP' },
  { label: 'Precio', valor: '2029118' },
]

const pintar = (correcciones?: Parameters<typeof FichaDeLinea>[0]['correcciones']) => renderToStaticMarkup(
  React.createElement(FichaDeLinea, {
    ranura: HOTEL,
    campos: CAMPOS,
    correcciones,
    deshabilitado: false,
    onGuardar: async () => true,
  }),
)

describe('la ficha de la línea', () => {
  it('ofrece corregir cada campo descriptivo, leído o no', () => {
    const html = pintar()
    expect(html).toContain('aria-label="Corregir Régimen"')
    expect(html).toContain('aria-label="Corregir Estrellas"')
    expect(html).toContain('aria-label="Corregir Cancelación"')
  })

  it('lo que entra al costo se ve, sin lápiz, diciendo dónde se corrige', () => {
    const html = pintar()
    expect(html).not.toContain('aria-label="Corregir Precio"')
    expect(html).not.toContain('aria-label="Corregir Moneda"')
    expect(html).toContain('se corrige en los rubros, los pasajeros o el margen de la línea')
    expect(html).toContain('2029118')
  })

  it('una corrección se ve con quién la hizo, lo que decía la lectura y cómo volver', () => {
    const html = pintar({ regimen: { valor: 'Solo alojamiento', por: 'Daniela Gómez', porId: 'p', en: '2026-09-22T20:00:00Z' } })
    expect(html).toContain('Solo alojamiento')
    expect(html).toContain('Corregido por Daniela Gómez')
    expect(html).toContain('la lectura decía Todo incluido')
    expect(html).toContain('Volver a lo leído')
  })

  it('sin estrellas en la captura lo dice, y ofrece buscarlas sin inventarlas', () => {
    const html = pintar()
    expect(html).toContain('El pantallazo no la mostraba')
    expect(html).toContain('https://www.google.com/search?q=DECAMERON%20PANACA%20Quimbaya')
  })

  it('con estrellas leídas dice de dónde salen', () => {
    const html = renderToStaticMarkup(React.createElement(FichaDeLinea, {
      ranura: HOTEL,
      campos: [...CAMPOS, { label: 'Estrellas', valor: '4' }],
      correcciones: undefined,
      deshabilitado: false,
      onGuardar: async () => true,
    }))
    expect(html).toContain('4 estrellas')
    expect(html).toContain('Leído del pantallazo')
  })
})
