/**
 * Los tres tipos de rubro de viaje (`tarifa`, `impuestos`, `fee_proveedor`) contra la
 * barra de Ejecución.
 *
 * El CHECK de `rubros.tipo` los admite desde el 2026-09-14 y ninguna categoría de gasto
 * apunta a ellos (leído del CHECK de `gastos.categoria` en producción el 2026-09-15:
 * ninguna de las once corresponde). Sin arreglo, un rubro `tarifa` pintaba 0%
 * ejecutado mientras el gasto real caía en «Sin presupuesto»: una barra holgada sobre
 * plata gastada. Estas pruebas fijan que la barra ya no se pinta así y que, el día que
 * una categoría apunte a esos tipos, el rubro pasa a medirse solo.
 */
import { afterEach, describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  CATEGORIA_GASTO_A_TIPOS_RUBRO,
  TIPO_RUBRO_SIN_DETALLE,
  asignarEjecutadoPorRubro,
  tipoRubroMedible,
} from './presupuesto-ejecucion'
import { TIPOS_RUBRO } from '@/lib/catalogos/constants'
import PresupuestoVsEjecutado from '@/app/(app)/negocios/[id]/bloques/financiero/PresupuestoVsEjecutado'

const TIPOS_VIAJE = ['tarifa', 'impuestos', 'fee_proveedor']

describe('qué rubros se pueden medir', () => {
  it('los seis tipos del catálogo y el rubro sin desglose se miden, como antes', () => {
    for (const t of TIPOS_RUBRO) expect(tipoRubroMedible(t.value), t.value).toBe(true)
    expect(tipoRubroMedible(TIPO_RUBRO_SIN_DETALLE)).toBe(true)
  })

  it('⚠️ los tres de viaje NO: ninguna categoría de gasto cuenta contra ellos', () => {
    for (const t of TIPOS_VIAJE) expect(tipoRubroMedible(t), t).toBe(false)
  })

  describe('el día que una categoría apunte a un tipo de viaje', () => {
    const antes = CATEGORIA_GASTO_A_TIPOS_RUBRO.transporte
    afterEach(() => {
      CATEGORIA_GASTO_A_TIPOS_RUBRO.transporte = antes
    })

    it('el rubro pasa a medirse solo, sin tocar la función', () => {
      CATEGORIA_GASTO_A_TIPOS_RUBRO.transporte = ['viaticos', 'tarifa']
      expect(tipoRubroMedible('tarifa')).toBe(true)
    })
  })
})

describe('un gasto real contra una cotización con rubro `tarifa`', () => {
  // Una cotización de viaje aprobada: el vuelo presupuestado como tarifa del proveedor.
  const presupuesto = [{ tipo: 'tarifa', nombre: 'tarifa', total: 2_000_000 }]
  // El tiquete que se pagó, registrado con la categoría que existe: transporte.
  const gastos = [{ categoria: 'transporte', total: 1_850_000 }]

  it('no cuenta contra `tarifa` (no hay categoría) y sale nombrado en «Sin presupuesto»', () => {
    const reparto = asignarEjecutadoPorRubro({ presupuesto, gastosPorCategoria: gastos, costoHoras: 0 })
    expect(reparto.rubros).toEqual([{ tipo: 'tarifa', nombre: 'tarifa', total: 2_000_000, ejecutado: 0 }])
    expect(reparto.sinPresupuesto).toEqual({
      total: 1_850_000,
      conceptos: [{ concepto: 'transporte', total: 1_850_000 }],
    })
    // La invariante de la sección sigue en pie: cada peso en exactamente un lado.
    const suma = reparto.rubros.reduce((s, r) => s + r.ejecutado, 0) + reparto.sinPresupuesto.total
    expect(suma).toBe(1_850_000)
  })

  const pintar = (rubros: Array<{ tipo: string; nombre: string; total: number; ejecutado: number }>) =>
    renderToStaticMarkup(
      React.createElement(PresupuestoVsEjecutado, {
        data: {
          presupuestoPorRubro: rubros,
          presupuestoCosto: rubros.reduce((s, r) => s + r.total, 0),
          precioAprobado: 2_300_000,
          sinPresupuesto: { total: 1_850_000, conceptos: [{ concepto: 'transporte', total: 1_850_000 }] },
          lineaBase: { estado: 'sin_cotizacion' },
        },
        costoTotal: 1_850_000,
        hayDatos: true,
      }),
    )

  it('⚠️⚠️ la pantalla ya NO pinta 0% sobre el rubro: dice por qué no se mide', () => {
    const html = pintar([{ tipo: 'tarifa', nombre: 'tarifa', total: 2_000_000, ejecutado: 0 }])
    expect(html).toContain('Tarifa del proveedor')
    expect(html).toContain('Ningún tipo de gasto cuenta contra este rubro todavía')
    // El 0% era la mentira: no aparece sobre este rubro.
    expect(html).not.toMatch(/Tarifa del proveedor<\/span><span[^>]*>0%/)
    // Y el gasto sigue a la vista, abajo, donde de verdad cayó.
    expect(html).toContain('Sin presupuesto')
  })

  it('CONTROL · un rubro medible sigue con su barra y su porcentaje', () => {
    const html = pintar([{ tipo: 'materiales', nombre: 'materiales', total: 2_000_000, ejecutado: 1_000_000 }])
    expect(html).toContain('50%')
    expect(html).not.toContain('Ningún tipo de gasto cuenta contra este rubro todavía')
  })
})
