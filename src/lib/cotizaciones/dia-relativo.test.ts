import { describe, it, expect } from 'vitest'
import {
  diaDeItem,
  puedeLlevarDia,
  puedeSerSugerido,
  hayDiasAsignados,
  diasDelItinerario,
  itemsSugeridos,
  sugeridosVisibles,
  itemsSinSeccionPropia,
  avisoSugeridosQueCobran,
  etiquetaDeDia,
  type ItemConPrecio,
} from './dia-relativo'

/** Un viaje típico de Trappvel: vuelo, hotel, traslado y dos tours. */
function viaje(): ItemConPrecio[] {
  return [
    { id: 'avianca', grupo: 'vuelo', orden: 1, precio_venta: 2_000_000, cantidad: 1 },
    { id: 'hotel', grupo: 'hotel', orden: 2, precio_venta: 1_350_000, cantidad: 1 },
    { id: 'traslado', grupo: 'traslado', orden: 3, precio_venta: 200_000, cantidad: 1 },
    { id: 'saona', grupo: 'tour', orden: 4, precio_venta: 540_000, cantidad: 1 },
    { id: 'catalina', grupo: 'tour', orden: 5, precio_venta: 480_000, cantidad: 1 },
  ]
}

describe('el día es un entero relativo, no una fecha', () => {
  it('lee el día cuando es un entero positivo', () => {
    expect(diaDeItem({ id: 'a', dia_relativo: 3 })).toBe(3)
  })

  it('ausente y null significan lo mismo: sin día', () => {
    expect(diaDeItem({ id: 'a' })).toBeNull()
    expect(diaDeItem({ id: 'a', dia_relativo: null })).toBeNull()
  })

  it('cero, negativo y decimal NO son días del viaje', () => {
    expect(diaDeItem({ id: 'a', dia_relativo: 0 })).toBeNull()
    expect(diaDeItem({ id: 'a', dia_relativo: -2 })).toBeNull()
    expect(diaDeItem({ id: 'a', dia_relativo: 1.5 })).toBeNull()
  })
})

describe('regla 2 · vuelos y hoteles no llevan día ni caen a sugeridos', () => {
  it('un vuelo no puede llevar día', () => {
    expect(puedeLlevarDia({ id: 'a', grupo: 'vuelo' })).toBe(false)
    // Y los sinónimos del catálogo, que es la razón de reusar RANURAS_COMBINABLES.
    expect(puedeLlevarDia({ id: 'a', grupo: 'tiquetes' })).toBe(false)
    expect(puedeLlevarDia({ id: 'a', grupo: 'Aéreo' })).toBe(false)
  })

  it('un hotel tampoco, ni por sus sinónimos', () => {
    expect(puedeLlevarDia({ id: 'a', grupo: 'hotel' })).toBe(false)
    expect(puedeLlevarDia({ id: 'a', grupo: 'alojamiento' })).toBe(false)
  })

  it('un tour y un traslado sí', () => {
    expect(puedeLlevarDia({ id: 'a', grupo: 'tour' })).toBe(true)
    expect(puedeLlevarDia({ id: 'a', grupo: 'traslado' })).toBe(true)
  })

  it('el ítem de cuadre queda fuera de todo', () => {
    expect(puedeLlevarDia({ id: 'a', es_ajuste: true })).toBe(false)
    expect(puedeSerSugerido({ id: 'a', grupo: 'tour', es_ajuste: true })).toBe(false)
  })
})

describe('regla 3 · una línea SIN grupo puede llevar día pero nunca cae a sugerida', () => {
  it('sin grupo puede llevar día: se la mete al itinerario a propósito', () => {
    expect(puedeLlevarDia({ id: 'seguro' })).toBe(true)
    expect(puedeLlevarDia({ id: 'seguro', grupo: null })).toBe(true)
    expect(puedeLlevarDia({ id: 'seguro', grupo: '  ' })).toBe(true)
  })

  it('sin grupo NO puede ser sugerida: nadie la saca del precio por omisión', () => {
    expect(puedeSerSugerido({ id: 'seguro' })).toBe(false)
    expect(puedeSerSugerido({ id: 'seguro', grupo: null })).toBe(false)
    expect(puedeSerSugerido({ id: 'seguro', grupo: '   ' })).toBe(false)
  })

  it('un grupo propio que no es ranura del catálogo SÍ puede ser sugerido', () => {
    // «planes y demás»: el grupo es la declaración, no hace falta que esté en el registro.
    expect(puedeSerSugerido({ id: 'x', grupo: 'plan' })).toBe(true)
    expect(puedeSerSugerido({ id: 'x', grupo: 'excursiones especiales' })).toBe(true)
  })
})

describe('regla 1 · sin un solo día, la cotización no se agrupa', () => {
  it('una cotización sin días no tiene ni itinerario ni sugeridos', () => {
    const items = viaje()
    expect(hayDiasAsignados(items)).toBe(false)
    expect(diasDelItinerario(items)).toEqual([])
    expect(itemsSugeridos(items)).toEqual([])
    // Todas imprimen donde imprimen hoy: la lista plana de siempre.
    expect(itemsSinSeccionPropia(items)).toEqual(['avianca', 'hotel', 'traslado', 'saona', 'catalina'])
  })

  it('una cotización de obra (sin grupos, sin días) tampoco cambia', () => {
    const termotech: ItemConPrecio[] = [
      { id: 'bomba', orden: 1 },
      { id: 'instalacion', orden: 2 },
      { id: 'cuadre', orden: 3, es_ajuste: true },
    ]
    expect(hayDiasAsignados(termotech)).toBe(false)
    expect(itemsSugeridos(termotech)).toEqual([])
    expect(itemsSinSeccionPropia(termotech)).toEqual(['bomba', 'instalacion', 'cuadre'])
  })

  it('diez tours cargados y ningún día: NINGUNO es sugerencia', () => {
    // El caso que separa «cotización sin itinerario» de «cotización con extras».
    const soloTours: ItemConPrecio[] = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      grupo: 'tour',
      orden: i,
    }))
    expect(itemsSugeridos(soloTours)).toEqual([])
  })
})

describe('el día parte el documento en tres', () => {
  it('dos tours con día, uno sin día: itinerario con dos, el tercero a sugeridos', () => {
    const items = viaje().map(i =>
      i.id === 'saona' ? { ...i, dia_relativo: 2 } : i.id === 'catalina' ? { ...i, dia_relativo: 3 } : i,
    )
    expect(hayDiasAsignados(items)).toBe(true)
    expect(diasDelItinerario(items)).toEqual([
      { dia: 2, itemIds: ['saona'] },
      { dia: 3, itemIds: ['catalina'] },
    ])
    // El traslado (grupo no combinable, sin día) cae a sugeridos.
    expect(itemsSugeridos(items)).toEqual(['traslado'])
    // El vuelo y el hotel NO: imprimen donde imprimen hoy.
    expect(itemsSinSeccionPropia(items)).toEqual(['avianca', 'hotel'])
  })

  it('⚠️ un vuelo sin día no cae NUNCA a sugeridos, ni con el resto del viaje en días', () => {
    const items = viaje().map(i =>
      i.id === 'saona' || i.id === 'catalina' || i.id === 'traslado' ? { ...i, dia_relativo: 1 } : i,
    )
    expect(itemsSugeridos(items)).toEqual([])
    expect(itemsSinSeccionPropia(items)).toEqual(['avianca', 'hotel'])
  })

  it('varias líneas en el mismo día salen en el orden de la cotización', () => {
    const items: ItemConPrecio[] = [
      { id: 'tarde', grupo: 'tour', orden: 9, dia_relativo: 1 },
      { id: 'manana', grupo: 'tour', orden: 2, dia_relativo: 1 },
    ]
    expect(diasDelItinerario(items)).toEqual([{ dia: 1, itemIds: ['manana', 'tarde'] }])
  })

  it('un hueco en la numeración se respeta: no se rellena ni se renumera', () => {
    const items: ItemConPrecio[] = [
      { id: 'a', grupo: 'tour', orden: 1, dia_relativo: 1 },
      { id: 'c', grupo: 'tour', orden: 2, dia_relativo: 3 },
    ]
    expect(diasDelItinerario(items).map(d => d.dia)).toEqual([1, 3])
  })

  it('una línea sin grupo con día entra al itinerario', () => {
    const items: ItemConPrecio[] = [
      { id: 'seguro', orden: 1, dia_relativo: 1 },
      { id: 'tour', grupo: 'tour', orden: 2 },
    ]
    expect(diasDelItinerario(items)).toEqual([{ dia: 1, itemIds: ['seguro'] }])
    expect(itemsSugeridos(items)).toEqual(['tour'])
  })

  it('⚠️⚠️ el seguro sin grupo y sin día NO cae a «no incluidas» aunque el viaje use días', () => {
    // El caso que hunde a Termotech y a cualquier viaje con un fee suelto: si el
    // criterio de sugerido fuera solo `!grupoCombinable`, `null` pasaría y la línea
    // saldría como no incluida mientras el cliente la paga.
    const items: ItemConPrecio[] = [
      { id: 'saona', grupo: 'tour', orden: 1, dia_relativo: 2 },
      { id: 'seguro', orden: 2, precio_venta: 90_000, cantidad: 1 },
      { id: 'fee', grupo: null, orden: 3, precio_venta: 150_000, cantidad: 1 },
      { id: 'cuadre', orden: 4, es_ajuste: true },
    ]
    expect(itemsSugeridos(items)).toEqual([])
    expect(itemsSinSeccionPropia(items)).toEqual(['seguro', 'fee', 'cuadre'])
    // Y por lo mismo no disparan el aviso de dinero: nunca fueron sugerencias.
    expect(avisoSugeridosQueCobran(items, items.map(i => i.id))).toEqual([])
  })
})

describe('el check de mostrar u ocultar una sugerencia', () => {
  const conDias = (): ItemConPrecio[] => [
    { id: 'tour1', grupo: 'tour', orden: 1, dia_relativo: 1 },
    { id: 'saona', grupo: 'tour', orden: 2 },
    { id: 'catalina', grupo: 'tour', orden: 3, mostrar_en_sugeridos: false },
  ]

  it('ausente cuenta como SÍ se muestra', () => {
    expect(sugeridosVisibles(conDias())).toEqual(['saona'])
  })

  it('el helper de sugeridos incluye las ocultas; solo el PDF las filtra', () => {
    // Importa para el aviso de dinero: una oculta que cobra es PEOR, no mejor.
    expect(itemsSugeridos(conDias())).toEqual(['saona', 'catalina'])
  })

  it('true explícito se muestra igual que ausente', () => {
    const items = conDias().map(i => (i.id === 'catalina' ? { ...i, mostrar_en_sugeridos: true } : i))
    expect(sugeridosVisibles(items)).toEqual(['saona', 'catalina'])
  })
})

describe('⚠️⚠️ el aviso obligatorio: una sugerencia que está sumando al total', () => {
  it('nombra la línea con su plata', () => {
    const items = viaje().map(i => (i.id === 'saona' ? { ...i, dia_relativo: 1 } : i))
    // `traslado` y `catalina` quedan sin día, con grupo no combinable y con precio.
    const aviso = avisoSugeridosQueCobran(items, items.map(i => i.id))
    expect(aviso).toEqual([
      { id: 'traslado', precioLinea: 200_000, oculta: false },
      { id: 'catalina', precioLinea: 480_000, oculta: false },
    ])
  })

  it('multiplica por la cantidad: el aviso dice lo que la línea cobra, no el unitario', () => {
    const items: ItemConPrecio[] = [
      { id: 'dia', grupo: 'tour', orden: 1, dia_relativo: 1 },
      { id: 'saona', grupo: 'tour', orden: 2, precio_venta: 180_000, cantidad: 3 },
    ]
    expect(avisoSugeridosQueCobran(items, ['dia', 'saona'])).toEqual([
      { id: 'saona', precioLinea: 540_000, oculta: false },
    ])
  })

  it('una sugerencia SIN precio no es contradicción: es una oferta, y no avisa', () => {
    const items: ItemConPrecio[] = [
      { id: 'dia', grupo: 'tour', orden: 1, dia_relativo: 1 },
      { id: 'saona', grupo: 'tour', orden: 2, precio_venta: 0, cantidad: 1 },
    ]
    expect(avisoSugeridosQueCobran(items, ['dia', 'saona'])).toEqual([])
  })

  it('una línea que NO aporta al total (alternativa descartada) no avisa', () => {
    // El aviso depende de `itemsQueAportanAlTotal`, no de tener precio: una alternativa
    // de tour que la ranura descartó ya no la está pagando nadie.
    const items: ItemConPrecio[] = [
      { id: 'dia', grupo: 'tour', orden: 1, dia_relativo: 1 },
      { id: 'saona', grupo: 'excursion', orden: 2, precio_venta: 540_000, cantidad: 1 },
      { id: 'alterna', grupo: 'excursion', orden: 3, precio_venta: 600_000, cantidad: 1 },
    ]
    // Solo `saona` aporta (la ranura toma una sola).
    expect(avisoSugeridosQueCobran(items, ['dia', 'saona'])).toEqual([
      { id: 'saona', precioLinea: 540_000, oculta: false },
    ])
  })

  it('⚠️ una sugerencia OCULTA que cobra también avisa, y se marca como oculta', () => {
    // El cliente ni la ve y la paga: es el caso peor, no el mejor.
    const items: ItemConPrecio[] = [
      { id: 'dia', grupo: 'tour', orden: 1, dia_relativo: 1 },
      { id: 'saona', grupo: 'tour', orden: 2, precio_venta: 540_000, cantidad: 1, mostrar_en_sugeridos: false },
    ]
    expect(avisoSugeridosQueCobran(items, ['dia', 'saona'])).toEqual([
      { id: 'saona', precioLinea: 540_000, oculta: true },
    ])
  })

  it('sin días asignados no hay sugerencias, así que no hay aviso', () => {
    const items = viaje()
    expect(avisoSugeridosQueCobran(items, items.map(i => i.id))).toEqual([])
  })

  it('un vuelo sin día que cobra NO dispara el aviso: nunca fue sugerencia', () => {
    const items = viaje().map(i => (i.id === 'saona' ? { ...i, dia_relativo: 1 } : i))
    const aviso = avisoSugeridosQueCobran(items, items.map(i => i.id))
    expect(aviso.map(a => a.id)).not.toContain('avianca')
    expect(aviso.map(a => a.id)).not.toContain('hotel')
  })
})

describe('el rótulo del día', () => {
  it('dice «Día N», no una fecha', () => {
    expect(etiquetaDeDia(1)).toBe('Día 1')
    expect(etiquetaDeDia(12)).toBe('Día 12')
  })
})
