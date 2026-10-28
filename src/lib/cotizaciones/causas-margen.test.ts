/**
 * Falla 2 del brief del 2026-10-28: el aviso de aprobación dice la causa real. Se prueba el camino
 * del servidor entero sobre el viaje ficticio de las reglas de margen (`test/caso-reglas-margen.ts`):
 * `medirSalida` → lo que la vista le pasa a la nota (`bajoMinimoParaNota`) → `notaDeMargen` (la nota
 * del editor y el renglón de «Revisar y enviar») y `detalleDeCausas` (el pedido al dueño, su
 * notificación y el registro de la autorización).
 */
import { describe, expect, it } from 'vitest'

import { bajoMinimoParaNota, causasBajoMinimo, detalleDeCausas } from './causas-margen'
import { notaDeMargen } from './nota-margen'
import { listaUnica } from './lista-unica'
import { medirSalida } from './piso-salida'
import type { ContextoCotizacion, FilaItinerario, ItemDeCotizacion } from './itinerarios-datos'
import type { ParametrosCascada } from './totales'
import { lineasDelCaso, paramsDelCaso, TARIFAS_DEL_CASO } from '../../../test/caso-reglas-margen'

function ctx(descuento: 3 | 7, params: ParametrosCascada, items?: ItemDeCotizacion[]): ContextoCotizacion {
  const p = params as ContextoCotizacion['params']
  return {
    items: items ?? (lineasDelCaso(descuento) as unknown as ItemDeCotizacion[]),
    params: p,
    umbrales: { pisoPct: 12, avisoPct: 12 },
    negocioId: 'neg', oportunidadId: null, pisoEnLaSalida: true,
  }
}

const FILAS: FilaItinerario[] = TARIFAS_DEL_CASO.map(t => ({
  id: t.id, cotizacionId: 'cot', nombre: t.nombre, orden: t.orden, vaEnPropuesta: t.vaEnPropuesta, esPrincipal: false,
  seleccion: t.seleccion, motivoCodigo: null, motivoTexto: null, traeColumnasDeMotivo: true,
}))

/** Lo que ven el equipo (la nota) y el dueño (el pedido) para un caso. */
function avisos(descuento: 3 | 7, params: ParametrosCascada, filas: FilaItinerario[] | null = FILAS, items?: ItemDeCotizacion[]) {
  const m = medirSalida(ctx(descuento, params, items), filas)
  const nota = notaDeMargen({ aplica: true, bloquea: m.bajoPiso.length > 0, pisoPct: m.pisoPct, excepcion: null, lineas: m.conteo.lineas, lineasSinCosto: 0, bajoMinimo: bajoMinimoParaNota(m.bajoPiso) })
  return { nota, pedido: detalleDeCausas(m.bajoPiso, m.pisoPct), bajoPiso: m.bajoPiso }
}

describe('causasBajoMinimo', () => {
  it('el ejemplo del brief: hotel con su opción en minúscula, frente al 10 %', () => {
    expect(causasBajoMinimo({ nombre: 'Recomendada', margenPct: 12.4, hoteles: [{ nombre: 'Hotel Ficticio', margenPct: 8 }], pisoHotelPct: 10 }, 12))
      .toEqual(['Hotel Ficticio (recomendada) queda en 8 %, mínimo 10 %'])
  })

  it('global: como hoy', () => {
    expect(causasBajoMinimo({ nombre: null, margenPct: 11.9, pisoHotelPct: 10 }, 12)).toEqual(['Margen 11,9 %, mínimo 12 %'])
  })

  it('varios hoteles y el global: todos, hoteles primero', () => {
    expect(causasBajoMinimo({ nombre: 'Premium', margenPct: 11, hoteles: [{ nombre: 'Hotel A', margenPct: 8 }, { nombre: 'Hotel B', margenPct: 9.96 }], pisoHotelPct: 10 }, 12))
      .toEqual(['Hotel A (premium) queda en 8 %, mínimo 10 %', 'Hotel B (premium) queda en 9,9 %, mínimo 10 %', 'Premium: margen 11 %, mínimo 12 %'])
  })

  it('en el mínimo o encima, sin hoteles bajos: nada', () => {
    expect(causasBajoMinimo({ nombre: 'Recomendada', margenPct: 13, hoteles: [], pisoHotelPct: 10 }, 12)).toEqual([])
  })
})

describe('el aviso por el camino del servidor (viaje ficticio, mínimo 12 %, hotel 10 %)', () => {
  it('por hotel: hotel en 8 % y global ≥ 12 % nombra el hotel, no el global', () => {
    const a = avisos(7, paramsDelCaso({ descuentos: [] }))
    expect(a.bajoPiso.map(s => [s.nombre, Math.round((s.margenRealPct ?? 0) * 10) / 10])).toEqual([['Recomendada', 13]])
    expect(a.nota).toMatchObject({ tipo: 'bajo_minimo', titulo: 'Hotel Ficticio Coral (recomendada) queda en 8 %, mínimo 10 %.' })
    expect(a.pedido).toBe('Hotel Ficticio Coral (recomendada) queda en 8 %, mínimo 10 %')
    expect(a.pedido).not.toMatch(/al 13/)
  })

  it('por global: global bajo 12 % y hoteles ≥ 10 % habla del global, como hoy', () => {
    const a = avisos(3, paramsDelCaso({ puntosExtra: 3 }))
    expect(a.nota).toMatchObject({ tipo: 'bajo_minimo' })
    const titulo = (a.nota as { titulo: string }).titulo
    expect(titulo).toContain('Recomendada: margen 11,7 %, mínimo 12 %')
    expect(titulo).not.toContain('queda en')
    expect(a.pedido).toContain('tarifa Recomendada al 11,7 %')
    expect(a.pedido).not.toContain('queda en')
  })

  it('combinado: las dos causas, en la nota y en el pedido', () => {
    const a = avisos(7, paramsDelCaso())
    const titulo = (a.nota as { titulo: string }).titulo
    expect(titulo).toBe('Hotel Ficticio Coral (recomendada) queda en 8 %, mínimo 10 % · Recomendada: margen 11,2 %, mínimo 12 %.')
    expect(a.pedido).toBe('Hotel Ficticio Coral (recomendada) queda en 8 %, mínimo 10 %; tarifa Recomendada al 11,2 %')
  })

  it('sin aviso: hotel en 12 % y global en 13 % no frena', () => {
    const a = avisos(3, paramsDelCaso())
    expect(a.bajoPiso).toEqual([])
    expect(a.nota).toEqual({ tipo: 'nada' })
  })

  it('sin tarifas (la cotización entera): el hotel sin opción entre paréntesis', () => {
    const items = lineasDelCaso(3).map(l => (l.id === 'h-eco' ? { ...l, tarifa_pax: { descuentoCliente: { motivo: 'x', tipo: 'pct', valor: 7 } } } : l)) as unknown as ItemDeCotizacion[]
    const a = avisos(3, paramsDelCaso({ descuentos: [] }), null, items)
    expect(a.nota).toMatchObject({ titulo: 'Hotel Ficticio Arena queda en 8 %, mínimo 10 %.' })
  })

  it('paquete de bloqueo (#1319, se margina como hotel): bajo el 10 % se nombra igual que un hotel', () => {
    const paquete = {
      ...lineasDelCaso(3).find(l => l.id === 'a-lancha')!,
      id: 'pq', nombre: 'Paquete ficticio de bloqueo', grupo: 'paquete de bloqueo: Paquete de bloqueo', subtotal: 2_000_000, orden: 8,
      tarifa_pax: { descuentoCliente: { motivo: 'Cierre de mes', tipo: 'pct', valor: 7 } },
    }
    const items = [...lineasDelCaso(3), paquete] as unknown as ItemDeCotizacion[]
    const a = avisos(3, paramsDelCaso({ descuentos: [] }), null, items)
    expect((a.nota as { titulo: string }).titulo).toContain('Paquete ficticio de bloqueo queda en 8 %, mínimo 10 %')
    expect(a.pedido).toContain('Paquete ficticio de bloqueo queda en 8 %, mínimo 10 %')
  })

  it('«Revisar y enviar» lleva la misma causa en el renglón que impide enviar', () => {
    const a = avisos(7, paramsDelCaso({ descuentos: [] }))
    const m = medirSalida(ctx(7, paramsDelCaso({ descuentos: [] })), FILAS)
    const lista = listaUnica({
      autorizacionDatos: null, sinPrecio: [], capturas: null, tarifas: [], texto: 'ok', noVan: [], faltaDia: null,
      margenBajoAviso: null, recargo: null, viaje: null, ivaSinCalcular: null, pantallazosPorAceptar: 0,
      salida: { aplica: true, bloquea: true, pisoPct: 12, excepcion: null, lineas: m.conteo.lineas, lineasSinCosto: 0, bajoMinimo: bajoMinimoParaNota(m.bajoPiso) },
    } as unknown as Parameters<typeof listaUnica>[0])
    expect(lista.impide.find(r => r.clave === 'margen')?.texto).toBe(`${(a.nota as { titulo: string }).titulo} Necesita la autorización del dueño.`)
  })
})
