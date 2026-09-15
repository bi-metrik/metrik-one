/**
 * El segundo interruptor: ¿la sugerencia entra al precio?
 *
 * El caso que lo pidió, textual: la agencia carga «Tour Isla Catalina, $551.724» como
 * sugerencia y quiere que el cliente VEA el precio y que NO esté en el total. Con el
 * día como único interruptor no se podía.
 *
 * Estas pruebas fijan la REGLA y sus consumidores puros: quién aporta al total
 * (`itemsQueAportanAlTotal`, que alimenta pantalla, `recalcularTotales` y PDF), la
 * cascada vigente del gate del piso, el aviso rojo y el presupuesto de Ejecución. El
 * documento renderizado lo fija `cotizacion-entra-al-precio-e2e.test.ts`.
 */

import { describe, it, expect } from 'vitest'

import {
  avisoSugeridosQueCobran,
  fueraDelPrecio,
  itemsSugeridos,
  sugeridosVisibles,
  type ItemConPrecio,
} from './dia-relativo'
import { itemsFijos, itemsQueAportanAlTotal, ranurasConAlternativas } from './itinerarios'
import { cascadaVigente, type ContextoCotizacion } from './itinerarios-datos'
import { calcularPresupuestoPorRubro } from '@/lib/negocios/presupuesto-ejecucion'

describe('la regla: fuera del precio exige las tres condiciones a la vez', () => {
  const tour = { id: 'catalina', grupo: 'tour', dia_relativo: null }

  it('sugerencia (grupo no combinable, sin día) con `false` explícito: fuera', () => {
    expect(fueraDelPrecio({ ...tour, entra_al_precio: false })).toBe(true)
  })

  it('ausente, null y true entran al precio: es lo que llega antes de la columna', () => {
    expect(fueraDelPrecio({ ...tour })).toBe(false)
    expect(fueraDelPrecio({ ...tour, entra_al_precio: null })).toBe(false)
    expect(fueraDelPrecio({ ...tour, entra_al_precio: true })).toBe(false)
  })

  it('⚠️ con día NO está fuera: con día está en el itinerario, o sea incluida', () => {
    expect(fueraDelPrecio({ ...tour, dia_relativo: 2, entra_al_precio: false })).toBe(false)
  })

  it('⚠️ un vuelo o un hotel marcados fuera se IGNORAN: nunca se imprimen como no incluidos', () => {
    expect(fueraDelPrecio({ id: 'v', grupo: 'vuelo', entra_al_precio: false })).toBe(false)
    expect(fueraDelPrecio({ id: 'h', grupo: 'alojamiento', entra_al_precio: false })).toBe(false)
  })

  it('⚠️ una línea SIN grupo marcada fuera se ignora: desaparecería del documento sin sumar', () => {
    expect(fueraDelPrecio({ id: 'seguro', grupo: null, entra_al_precio: false })).toBe(false)
    expect(fueraDelPrecio({ id: 'seguro', grupo: '  ', entra_al_precio: false })).toBe(false)
  })

  it('el ítem de cuadre nunca está fuera del precio', () => {
    expect(fueraDelPrecio({ ...tour, es_ajuste: true, entra_al_precio: false })).toBe(false)
  })
})

/** Viaje de Trappvel: vuelo, hotel, traslado y dos tours. Costos del e2e. */
function viaje(extra: Record<string, Record<string, unknown>> = {}): ItemConPrecio[] {
  const base: ItemConPrecio[] = [
    { id: 'avianca', grupo: 'vuelo', orden: 1, precio_venta: 2_298_851, cantidad: 1 },
    { id: 'hotel', grupo: 'hotel', orden: 2, precio_venta: 1_551_724, cantidad: 1 },
    { id: 'traslado', grupo: 'traslado', orden: 3, precio_venta: 229_885, cantidad: 1 },
    { id: 'saona', grupo: 'tour', orden: 4, precio_venta: 620_690, cantidad: 1 },
    { id: 'catalina', grupo: 'excursion', orden: 5, precio_venta: 551_724, cantidad: 1 },
  ]
  return base.map(i => ({ ...i, ...(extra[i.id] ?? {}) }))
}

describe('quién aporta al total: la sugerencia fuera del precio no', () => {
  it('(a) sale del juego que alimenta pantalla, recalcularTotales y PDF', () => {
    const items = viaje({ catalina: { entra_al_precio: false } })
    expect(itemsQueAportanAlTotal(items)).toEqual(['avianca', 'hotel', 'traslado', 'saona'])
  })

  it('(b) la misma, marcada que SÍ entra: aporta', () => {
    const items = viaje({ catalina: { entra_al_precio: true } })
    expect(itemsQueAportanAlTotal(items)).toContain('catalina')
  })

  it('⚠️ un vuelo marcado fuera sigue aportando: la marca se ignora', () => {
    const items = viaje({ avianca: { entra_al_precio: false } })
    expect(itemsQueAportanAlTotal(items)).toContain('avianca')
  })

  it('⚠️ con día aporta aunque la marca diga false (dato por SQL): el documento sigue sumando', () => {
    const items = viaje({ catalina: { entra_al_precio: false, dia_relativo: 3 } })
    expect(itemsQueAportanAlTotal(items)).toContain('catalina')
  })

  it('tampoco es componente fijo del itinerario', () => {
    const items = viaje({ catalina: { entra_al_precio: false } })
    expect(itemsFijos(items)).not.toContain('catalina')
  })

  it('⚠️⚠️ NO compite por la ranura: dos tours del mismo grupo, el primero fuera del precio', () => {
    // Si la ofrecida entrara como candidata, la ranura «tour» tendría dos, el supuesto
    // tomaría la primera por orden (la ofrecida), la sacaría por estar fuera, y el
    // total se quedaría SIN ninguno de los dos tours. Aquí el cobrado entra solo.
    const items: ItemConPrecio[] = [
      { id: 'ofrecido', grupo: 'tour', orden: 1, precio_venta: 551_724, entra_al_precio: false },
      { id: 'cobrado', grupo: 'tour', orden: 2, precio_venta: 620_690 },
    ]
    expect(ranurasConAlternativas(items)).toEqual([])
    expect(itemsQueAportanAlTotal(items)).toEqual(['cobrado'])
  })
})

describe('las sugerencias: fuera del precio siempre se ofrece', () => {
  it('con la cotización por días, está entre las sugeridas como cualquier otra', () => {
    const items = viaje({ saona: { dia_relativo: 1 }, catalina: { entra_al_precio: false } })
    expect(itemsSugeridos(items)).toEqual(['traslado', 'catalina'])
  })

  it('⚠️ SIN un solo día asignado, la fuera del precio se ofrece igual (y solo ella)', () => {
    // Sin esto desaparecería del documento: no suma (no está en la lista plana) y
    // tampoco se ofrecería. Los demás tours siguen siendo la lista plana de siempre.
    const items = viaje({ catalina: { entra_al_precio: false } })
    expect(itemsSugeridos(items)).toEqual(['catalina'])
  })

  it('CONTROL · sin días y sin ninguna fuera del precio: cero sugerencias, como antes', () => {
    expect(itemsSugeridos(viaje())).toEqual([])
  })

  it('oculta y fuera del precio: ni se imprime ni se cobra', () => {
    const items = viaje({ catalina: { entra_al_precio: false, mostrar_en_sugeridos: false } })
    expect(sugeridosVisibles(items)).toEqual([])
    expect(itemsQueAportanAlTotal(items)).not.toContain('catalina')
  })
})

describe('⚠️⚠️ el aviso rojo, alimentado por el MISMO juego de ids', () => {
  it('(a) la sugerencia fuera del precio con precio NO avisa: ya no es contradicción', () => {
    const items = viaje({ saona: { dia_relativo: 1 }, traslado: { dia_relativo: 1 }, catalina: { entra_al_precio: false } })
    expect(avisoSugeridosQueCobran(items, itemsQueAportanAlTotal(items))).toEqual([])
  })

  it('(b) la misma marcada que SÍ entra: avisa con su plata', () => {
    const items = viaje({ saona: { dia_relativo: 1 }, traslado: { dia_relativo: 1 } })
    expect(avisoSugeridosQueCobran(items, itemsQueAportanAlTotal(items))).toEqual([
      { id: 'catalina', precioLinea: 551_724, oculta: false },
    ])
  })

  it('las dos a la vez: solo avisa la que cobra', () => {
    const items = viaje({ saona: { dia_relativo: 1 }, catalina: { entra_al_precio: false } })
    expect(avisoSugeridosQueCobran(items, itemsQueAportanAlTotal(items)).map(a => a.id)).toEqual(['traslado'])
  })
})

describe('la cascada vigente (gate del piso) no mide con la sugerencia adentro', () => {
  const linea = (id: string, grupo: string | null, costo: number, extra: Record<string, unknown> = {}) => ({
    id,
    nombre: id,
    grupo,
    opcion_de: null,
    es_ajuste: false,
    orden: 0,
    cantidad: 1,
    subtotal: costo,
    numeroDeRubros: 0,
    costoDeRubros: 0,
    descuento_porcentaje: 0,
    margen_porcentaje: null,
    precio_venta: 0,
    precio_manual: false,
    ...extra,
  })
  const ctx = (catalinaFuera: boolean): ContextoCotizacion => ({
    items: [
      linea('avianca', 'vuelo', 2_000_000),
      linea('hotel', 'hotel', 1_350_000),
      linea('catalina', 'excursion', 480_000, catalinaFuera ? { entra_al_precio: false } : {}),
    ],
    params: { administrativosPct: 0, margenPct: 13, descuentoComercialPct: 0, convencionMargen: 'sobre_venta' },
    umbrales: { pisoPct: 5, avisoPct: 10 },
    negocioId: null,
    oportunidadId: null,
  })

  it('fuera del precio: ni su costo ni su precio entran al total del gate', () => {
    const dentro = cascadaVigente(ctx(false), null)
    const fuera = cascadaVigente(ctx(true), null)
    expect(dentro.costoDirecto).toBe(3_830_000)
    expect(fuera.costoDirecto).toBe(3_350_000)
    expect(dentro.precioVenta - fuera.precioVenta).toBe(551_724)
  })
})

describe('el presupuesto de Ejecución no cuenta la sugerencia fuera del precio', () => {
  const rubro = (tipo: string, valor: number) => ({ tipo, valor_total: valor, sugerido: false })

  it('sus rubros no son costo comprometido: el cliente no la compró', () => {
    const items = [
      { cantidad: 1, subtotal: 0, es_ajuste: false, grupo: 'vuelo', rubros: [rubro('tarifa', 2_000_000)] },
      { cantidad: 1, subtotal: 0, es_ajuste: false, grupo: 'excursion', entra_al_precio: false, rubros: [rubro('servicios_prof', 480_000)] },
    ]
    expect(calcularPresupuestoPorRubro(items)).toEqual([{ tipo: 'tarifa', nombre: 'tarifa', total: 2_000_000 }])
  })

  it('CONTROL · la misma línea entrando al precio sí presupuesta', () => {
    const items = [
      { cantidad: 1, subtotal: 0, es_ajuste: false, grupo: 'excursion', entra_al_precio: true, rubros: [rubro('servicios_prof', 480_000)] },
    ]
    expect(calcularPresupuestoPorRubro(items)).toEqual([{ tipo: 'servicios_prof', nombre: 'servicios_prof', total: 480_000 }])
  })

  it('⚠️ sin grupo la marca se ignora y presupuesta, igual que en el total', () => {
    const items = [
      { cantidad: 1, subtotal: 0, es_ajuste: false, grupo: null, entra_al_precio: false, rubros: [rubro('materiales', 100_000)] },
    ]
    expect(calcularPresupuestoPorRubro(items)).toEqual([{ tipo: 'materiales', nombre: 'materiales', total: 100_000 }])
  })
})
