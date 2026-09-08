/**
 * Lo que la TARJETA de un caso retenido pinta de verdad.
 *
 * Es una prueba de render, no de lógica pura, y por eso vale la pena: lo que la enmienda
 * del 2026-09-08 pide es exactamente un hecho de pantalla — que el retenido *se vea*, que
 * diga por qué con plata y porcentaje, que NO ofrezca facturar y que SÍ ofrezca adoptar.
 * Las funciones puras (`ofreceEmitirFactura`, `ofreceAdoptarFactura`) fijan la decisión;
 * esto fija que el JSX las está mirando. Un botón que dejara de consultarlas pasaría las
 * pruebas puras y rompería la pantalla.
 *
 * `renderToStaticMarkup` corre en el entorno `node` de vitest, sin DOM: alcanza para el
 * primer render, que es donde vive todo lo que se afirma acá. Mismo patrón que
 * `negocios/[id]/recaudo-cambiado-banner.test.ts`, el primero del repo.
 *
 * ⚠️ Mutaciones corridas el 2026-09-08 (`_qa/mutar2.py`, borrado antes de commitear);
 * ninguna quedó huérfana, y cada una tumba UNA prueba porque cada una fija un hecho
 * distinto de la misma tarjeta:
 *
 *   la tarjeta no pinta la razón de retención .......... 1 prueba
 *   el botón de facturar ignora `ofreceEmitirFactura` .. 1
 *   la adopción se gatea por saldo ..................... 1
 *   `razonDeRetencion` deja de decir el porcentaje ..... 1
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { casoFalso } from '../../../../test/cola-facturacion-doble'

// La tarjeta importa server actions; acá solo se mide el primer render, no el envío.
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, warning: () => {} } }))

import { FilaPorFacturar } from './conciliacion-client'

/** V0224 tal como sale hoy del servidor: retenido, debe la mitad, con datos completos. */
const V0224 = casoFalso({
  negocio_id: 'neg-v0224', codigo: 'V0224', nombre: 'CASO DE PRUEBA',
  cliente: 'CLIENTE DE PRUEBA', identificacion: '9771470',
  honorario: 850_000, falta_saldo: 425_000,
  estado_recaudo: 'retenido', banda_materialidad: 8_500,
  retenido_por_recaudo: true,
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

describe('la tarjeta de un retenido', () => {
  it('dice POR QUÉ está retenida, con la plata y el porcentaje', () => {
    const html = pintar()
    expect(html).toContain('Retenido')
    expect(html).toContain('425.000')
    expect(html).toContain('850.000')
    expect(html).toContain('50%')
  })

  it('NO ofrece facturar', () => {
    // El servidor bloquea la emisión por encima de la banda sin apelación: ofrecer el
    // botón sería prometer algo que va a ser rechazado.
    expect(pintar()).not.toContain('Revisar y facturar')
  })

  it('SÍ ofrece adoptar la factura que Siigo ya tenga', () => {
    // La capacidad que #578 se llevó por delante. Adoptar no emite nada.
    expect(pintar()).toContain('Esta factura ya existe')
  })

  it('un caso cuadrado sí ofrece facturar: el contraste es la prueba', () => {
    // Sin este caso, "no aparece el botón" podría deberse a que la tarjeta no lo pinta
    // nunca (por un mock, un error silencioso o un guard de más).
    const listo = casoFalso({
      negocio_id: 'neg-v0345', codigo: 'V0345', cliente: 'OTRO CLIENTE',
      honorario: 637_500, falta_saldo: 0,
    })
    const html = pintar(listo)
    expect(html).toContain('Revisar y facturar')
    expect(html).not.toContain('Retenido')
  })
})
