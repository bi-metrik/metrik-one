/**
 * Lo que la TARJETA de un caso de la cola pinta de verdad, ahora que la factura no espera
 * el recaudo (decisión de Mauricio, 2026-09-22).
 *
 * Es una prueba de render, no de lógica pura: `factura-libre-en-pantalla.test.ts` fija la
 * decisión (`ofreceEmitirFactura`); esto fija que el JSX la está mirando y que ya no pinta
 * nada de la sección de retenidos. Un botón que dejara de consultar la función pasaría la
 * prueba pura y rompería la pantalla.
 *
 * `renderToStaticMarkup` corre en el entorno `node` de vitest, sin DOM: alcanza para el
 * primer render, que es donde vive todo lo que se afirma acá.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { casoFalso } from '../../../../test/cola-facturacion-doble'

// La tarjeta importa server actions; acá solo se mide el primer render, no el envío.
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, warning: () => {} } }))

import { FilaPorFacturar } from './conciliacion-client'

/** V0224, el caso que el 2026-09-08 quedaba retenido por deber la mitad del honorario. */
const V0224 = casoFalso({
  negocio_id: 'neg-v0224', codigo: 'V0224', nombre: 'CASO DE PRUEBA',
  cliente: 'CLIENTE DE PRUEBA', identificacion: '9771470', honorario: 850_000,
})

const pintar = (caso = V0224) =>
  renderToStaticMarkup(
    React.createElement(FilaPorFacturar, {
      caso,
      descarteAbierto: false,
      siigoConfigurado: true,
      productos: [],
      onCambio: () => {},
    }),
  )

describe('la tarjeta de un caso con datos completos', () => {
  it('ofrece facturar', () => {
    expect(pintar()).toContain('Revisar y facturar')
  })

  it('ya no habla de retención ni de recaudo', () => {
    const html = pintar()
    expect(html).not.toContain('Retenido')
    expect(html).not.toContain('Falta recaudar')
  })

  it('sigue ofreciendo adoptar la factura que Siigo ya tenga', () => {
    expect(pintar()).toContain('Esta factura ya existe')
  })

  it('sin RUT NO ofrece facturar: el contraste es la prueba', () => {
    // Sin este caso, "aparece el botón" podría deberse a que la tarjeta lo pinta siempre.
    const sinRut = casoFalso({
      negocio_id: 'neg-v0400', codigo: 'V0400', sin_rut: true,
      faltan_cliente: ['identificación', 'nombre'],
    })
    const html = pintar(sinRut)
    expect(html).not.toContain('Revisar y facturar')
    expect(html).toContain('RUT sin cargar')
  })
})
