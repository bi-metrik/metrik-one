/**
 * Un descuento sobre el total a UNA sola tarifa (2026-10-29, Trappvel: «un 5 % solo a la Premium
 * para que el cliente suba de tarifa»). Datos ficticios (`test/caso-reglas-margen.ts`).
 *
 *  · «Todas» (o sin el campo, como todo lo guardado antes) da exactamente lo de hoy.
 *  · El de una tarifa baja solo esa tarifa; las otras no se mueven.
 *  · Si la tarifa se borra, su descuento no le cae a ninguna otra.
 *  · La autorización nombra la tarifa que el descuento dejó bajo el mínimo.
 */
import { describe, expect, it } from 'vitest'

import {
  descuentoAplicaA,
  leerReglasDeCotizacion,
  motivoReglasInvalidas,
  pctDescuentoTotal,
  POLITICA_REGLAS_POR_DEFECTO,
  reglasAJsonb,
} from './reglas-margen'
import { cascadaDelTotal, tarifasCalculadas } from './por-pasos-vista'
import { cascadaDeItinerario } from './itinerarios'
import { detalleDeCausas } from './causas-margen'
import { mensajeDeSalida, medirSalida } from './piso-salida'
import type { ContextoCotizacion, FilaItinerario } from './itinerarios-datos'
import { lineasDelCaso, paramsDelCaso, TARIFAS_DEL_CASO } from '../../../test/caso-reglas-margen'

const precios = (params: ReturnType<typeof paramsDelCaso>) =>
  Object.fromEntries(tarifasCalculadas(lineasDelCaso(3), params, TARIFAS_DEL_CASO).map(t => [t.nombre, t.precio]))
const margenes = (params: ReturnType<typeof paramsDelCaso>) =>
  Object.fromEntries(tarifasCalculadas(lineasDelCaso(3), params, TARIFAS_DEL_CASO).map(t => [t.nombre, t.margenReal]))

describe('lo guardado: sin el campo es «todas»', () => {
  it('un descuento guardado sin aplica_a se lee sin aplicaA y se vuelve a escribir igual', () => {
    const viejo = {
      v: 1,
      politica: reglasAJsonb({ politica: POLITICA_REGLAS_POR_DEFECTO, puntosExtra: 0, descuentos: [] }).politica,
      puntos_extra: 2,
      descuentos: [{ id: 'd1', descripcion: 'Cliente recurrente', pct: 4 }],
    }
    const leidas = leerReglasDeCotizacion(viejo)!
    expect(leidas.descuentos).toEqual([{ id: 'd1', descripcion: 'Cliente recurrente', pct: 4 }])
    expect(descuentoAplicaA(leidas.descuentos[0], 'tf-pre')).toBe(true)
    expect(descuentoAplicaA(leidas.descuentos[0], undefined)).toBe(true)
    // La misma huella que antes: el jsonb no gana llaves.
    expect(reglasAJsonb(leidas)).toEqual(viejo)
  })

  it('el de una tarifa se guarda con aplica_a y se lee de vuelta', () => {
    const r = leerReglasDeCotizacion(reglasAJsonb({
      politica: POLITICA_REGLAS_POR_DEFECTO, puntosExtra: 0,
      descuentos: [{ id: 'd1', descripcion: 'Suba a Premium', pct: 5, aplicaA: 'tf-pre' }],
    }))!
    expect(r.descuentos[0].aplicaA).toBe('tf-pre')
    expect(descuentoAplicaA(r.descuentos[0], 'tf-pre')).toBe(true)
    expect(descuentoAplicaA(r.descuentos[0], 'tf-rec')).toBe(false)
    expect(descuentoAplicaA(r.descuentos[0], null)).toBe(false)
  })
})

describe('el precio de cada tarifa', () => {
  it('«todas» explícito da lo mismo que sin el campo (cotización vieja)', () => {
    const viejo = paramsDelCaso({ descuentos: [{ id: 'd1', descripcion: 'Cliente recurrente', pct: 2 }] })
    const todas = paramsDelCaso({ descuentos: [{ id: 'd1', descripcion: 'Cliente recurrente', pct: 2, aplicaA: null }] })
    expect(precios(todas)).toEqual(precios(viejo))
    expect(cascadaDelTotal(lineasDelCaso(3), todas, TARIFAS_DEL_CASO).precioVenta)
      .toBe(cascadaDelTotal(lineasDelCaso(3), viejo, TARIFAS_DEL_CASO).precioVenta)
  })

  it('un 5 % solo a la Premium baja solo la Premium, en exactamente el 5 % de su subtotal', () => {
    const sin = paramsDelCaso({ descuentos: [] })
    const con = paramsDelCaso({ descuentos: [{ id: 'dp', descripcion: 'Suba a Premium', pct: 5, aplicaA: 'tf-pre' }] })
    const antes = precios(sin)
    const despues = precios(con)
    expect(despues['Económica']).toBe(antes['Económica'])
    expect(despues['Recomendada']).toBe(antes['Recomendada'])
    expect(despues['Premium']).toBe(antes['Premium'] - Math.round(antes['Premium'] * 0.05))
    // El total de la cotización (la Recomendada) no se mueve.
    expect(cascadaDelTotal(lineasDelCaso(3), con, TARIFAS_DEL_CASO).precioVenta)
      .toBe(cascadaDelTotal(lineasDelCaso(3), sin, TARIFAS_DEL_CASO).precioVenta)
    // Y su margen global baja; el de las otras no.
    const m0 = margenes(sin)
    const m1 = margenes(con)
    expect(m1['Económica']).toBe(m0['Económica'])
    expect(m1['Recomendada']).toBe(m0['Recomendada'])
    expect(m1['Premium']!).toBeLessThan(m0['Premium']!)
  })

  it('«todas» y uno de la Premium se suman solo en la Premium; el desglose lleva cada uno', () => {
    const params = paramsDelCaso({
      descuentos: [
        { id: 'dt', descripcion: 'Cliente recurrente', pct: 2 },
        { id: 'dp', descripcion: 'Suba a Premium', pct: 5, aplicaA: 'tf-pre' },
      ],
    })
    const t = tarifasCalculadas(lineasDelCaso(3), params, TARIFAS_DEL_CASO)
    const de = (n: string) => t.find(x => x.nombre === n)!.cascada.reglas!.descuentos.map(d => d.descripcion)
    expect(de('Económica')).toEqual(['Cliente recurrente'])
    expect(de('Recomendada')).toEqual(['Cliente recurrente'])
    expect(de('Premium')).toEqual(['Cliente recurrente', 'Suba a Premium'])
    // El IVA resta lo mismo que la cascada de cada tarifa.
    expect(pctDescuentoTotal({ ...params, tarifaId: 'tf-pre' })).toBe(7)
    expect(pctDescuentoTotal({ ...params, tarifaId: 'tf-eco' })).toBe(2)
    expect(pctDescuentoTotal(params)).toBe(2)
  })

  it('una cascada sin tarifa (la cotización sin principal) solo lleva los de «todas»', () => {
    const params = paramsDelCaso({ descuentos: [{ id: 'dp', descripcion: 'Suba a Premium', pct: 5, aplicaA: 'tf-pre' }] })
    const total = cascadaDelTotal(lineasDelCaso(3), params, [])
    expect(total.reglas!.descuentos).toEqual([])
  })

  it('si la tarifa se borra, su descuento no le cae a ninguna otra', () => {
    const sin = paramsDelCaso({ descuentos: [] })
    const huerfano = paramsDelCaso({ descuentos: [{ id: 'dp', descripcion: 'Suba a Premium', pct: 5, aplicaA: 'tf-borrada' }] })
    expect(precios(huerfano)).toEqual(precios(sin))
  })

  it('cascadaDeItinerario sin id de tarifa es la de siempre (solo «todas»)', () => {
    const params = paramsDelCaso({ descuentos: [{ id: 'dp', descripcion: 'Suba a Premium', pct: 5, aplicaA: 'tf-pre' }] })
    expect(cascadaDeItinerario(lineasDelCaso(3), ['h-pre'], params).reglas!.descuentos).toEqual([])
    expect(cascadaDeItinerario(lineasDelCaso(3), ['h-pre'], params, 'tf-pre').reglas!.descuentos.map(d => d.pct)).toEqual([5])
  })
})

describe('lo que se puede guardar', () => {
  it('la suma que se juzga es la de una tarifa: todas + la suya', () => {
    const p = POLITICA_REGLAS_POR_DEFECTO
    expect(motivoReglasInvalidas(p, { descuentos: [
      { descripcion: 'a', pct: 60, aplicaA: 'tf-pre' },
      { descripcion: 'b', pct: 60, aplicaA: 'tf-eco' },
    ] })).toBeNull()
    expect(motivoReglasInvalidas(p, { descuentos: [
      { descripcion: 'a', pct: 50 },
      { descripcion: 'b', pct: 50, aplicaA: 'tf-pre' },
    ] })).toMatch(/100 %/)
  })
})

describe('la autorización nombra la tarifa', () => {
  /** El contexto que leería el servidor, con las líneas del caso. */
  function contexto(params: ReturnType<typeof paramsDelCaso>): ContextoCotizacion {
    return {
      items: lineasDelCaso(3) as unknown as ContextoCotizacion['items'],
      params: { administrativosPct: 0, margenPct: 15, descuentoComercialPct: 0, convencionMargen: 'sobre_venta', reglas: params.reglas },
      umbrales: { pisoPct: 12, avisoPct: 12 } as ContextoCotizacion['umbrales'],
      negocioId: null,
      oportunidadId: null,
      pisoEnLaSalida: true,
      configLinea: null,
    } as ContextoCotizacion
  }
  const filas: FilaItinerario[] = TARIFAS_DEL_CASO.map(t => ({
    id: t.id, cotizacionId: 'cot', nombre: t.nombre, orden: t.orden, vaEnPropuesta: true,
    esPrincipal: t.nombre === 'Recomendada', seleccion: t.seleccion, motivoCodigo: null, motivoTexto: null,
  } as FilaItinerario))

  it('sin descuento propio ninguna tarifa queda bajo el 12 %', () => {
    const m = medirSalida(contexto(paramsDelCaso({ descuentos: [] })), filas)
    expect(m.bajoPiso).toEqual([])
  })

  it('un descuento solo a la Premium que la deja bajo el 12 % frena SOLO la Premium y la nombra', () => {
    // Con 5 puntos extra la Premium pasa del 12 %; un 8 % solo suyo la deja por debajo.
    const m = medirSalida(contexto(paramsDelCaso({ descuentos: [{ id: 'dp', descripcion: 'Suba a Premium', pct: 8, aplicaA: 'tf-pre' }] })), filas)
    expect(m.bajoPiso.map(s => s.nombre)).toEqual(['Premium'])
    expect(m.bajoPiso[0].margenRealPct!).toBeLessThan(12)
    // El texto del pedido de autorización (actividad y notificación al dueño).
    expect(detalleDeCausas(m.bajoPiso, m.pisoPct)).toMatch(/^tarifa Premium al \d+(,\d)? %$/)
    expect(mensajeDeSalida(m.bajoPiso, m.pisoPct, 'Gerente')).toMatch(/^La tarifa Premium deja un margen de/)
  })
})
