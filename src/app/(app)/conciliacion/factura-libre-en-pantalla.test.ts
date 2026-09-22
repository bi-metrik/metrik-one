/**
 * Qué ofrece la tarjeta de un caso de la cola ahora que la factura NO espera el recaudo.
 *
 * Decisión de Mauricio (2026-09-22). Del 2026-09-08 al 22 el honorario recaudado era
 * condición para facturar: los casos que debían plata iban a una sección de «retenidos»,
 * sin botón de facturar. Desde el 22 la factura sale a crédito en cualquier momento, y
 * los pagos se le abonan. Lo que este archivo fija es la mitad de PANTALLA de esa
 * decisión: la tarjeta ofrece facturar por lo mismo de siempre (RUT, honorario, datos de
 * la factura) y por nada más. La mitad del servidor la fija
 * `src/lib/siigo/facturas-sin-gate-de-recaudo.test.ts`.
 *
 * ⚠️ Estas pruebas fijan la DECISIÓN, no el pintado: las condiciones viven en funciones
 * puras EXPORTADAS del componente (`ofreceEmitirFactura`, `ofreceAdoptarFactura`) y el
 * JSX las llama. Que el JSX de verdad las consulta lo fija
 * `tarjeta-factura-libre-render.test.ts`.
 *
 * V0224 es el caso del enunciado del 2026-09-08: le faltaba recaudar $425.000 de
 * $850.000 y por eso no se podía facturar. Hoy es un caso como cualquier otro.
 */
import { describe, it, expect } from 'vitest'
import { filtrarCasos, ofreceEmitirFactura, ofreceAdoptarFactura } from './conciliacion-client'
import { casoFalso } from '../../../../test/cola-facturacion-doble'

/** V0224: datos completos. Que deba o no deba plata ya no viaja en el caso. */
const V0224 = casoFalso({
  negocio_id: 'neg-v0224', codigo: 'V0224', cliente: 'CLIENTE DE PRUEBA', honorario: 850_000,
})

describe('la tarjeta ofrece facturar sin mirar el recaudo', () => {
  it('un caso con datos completos ofrece emitir', () => {
    expect(ofreceEmitirFactura(V0224, true)).toBe(true)
  })

  it('la cola ya no trae NINGÚN campo de recaudo: no hay con qué retener', () => {
    // Si alguien vuelve a meter el saldo en el caso, esta prueba lo delata antes de que
    // la tarjeta empiece a esconder el botón otra vez.
    const campos = Object.keys(V0224)
    expect(campos).not.toContain('falta_saldo')
    expect(campos).not.toContain('estado_recaudo')
    expect(campos).not.toContain('retenido_por_recaudo')
    expect(campos).not.toContain('banda_materialidad')
  })

  it('sin Siigo configurado no se ofrece emitir', () => {
    expect(ofreceEmitirFactura(V0224, false)).toBe(false)
  })

  it('un dato faltante sí lo saca, por su propia razón', () => {
    expect(ofreceEmitirFactura(casoFalso({ faltan_cliente: ['email'] }), true)).toBe(false)
    expect(ofreceEmitirFactura(casoFalso({ faltan_factura: ['honorario aprobado'] }), true)).toBe(false)
  })

  it('un caso ya facturado o descartado no ofrece emitir', () => {
    expect(ofreceEmitirFactura({ ...V0224, ya_facturado: true }, true)).toBe(false)
    expect(ofreceEmitirFactura(
      { ...V0224, descartado: { at: '2026-09-01T00:00:00.000Z', por: 'Diana', motivo: null } }, true,
    )).toBe(false)
  })
})

describe('la adopción sigue igual', () => {
  it('se ofrece a un caso pendiente', () => {
    expect(ofreceAdoptarFactura(V0224, true)).toBe(true)
  })

  it('un YA FACTURADO solo la ofrece para reponer el PDF', () => {
    expect(ofreceAdoptarFactura({ ...V0224, ya_facturado: true, factura_sin_pdf: false }, true)).toBe(false)
    expect(ofreceAdoptarFactura({ ...V0224, ya_facturado: true, factura_sin_pdf: true }, true)).toBe(true)
  })

  it('un descartado no la ofrece, y sin Siigo tampoco', () => {
    const descartado = { ...V0224, descartado: { at: '2026-09-01T00:00:00.000Z', por: 'Diana', motivo: null } }
    expect(ofreceAdoptarFactura(descartado, true)).toBe(false)
    expect(ofreceAdoptarFactura(V0224, false)).toBe(false)
  })
})

describe('la búsqueda encuentra el caso', () => {
  const CASOS = [casoFalso({ negocio_id: 'neg-v0345', codigo: 'V0345', cliente: 'OTRO CLIENTE' }), V0224]

  it('por código', () => {
    expect(filtrarCasos(CASOS, 'v0224').map(c => c.negocio_id)).toEqual(['neg-v0224'])
  })

  it('por nombre del cliente', () => {
    expect(filtrarCasos(CASOS, 'cliente de prueba').map(c => c.codigo)).toEqual(['V0224'])
  })
})
