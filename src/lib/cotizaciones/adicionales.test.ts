/**
 * El adicional cuelga de la VARIANTE, no de la ranura.
 *
 * ## La mutación que estas pruebas tienen que tumbar
 *
 * En `adicionalesPorItem`, emparejar por el `grupo` del ítem en vez de por su `item_id`:
 *
 * ```ts
 * // mutación: el adicional cuelga de la RANURA
 * const lista = mapa.get(ad.grupoDelItem) ?? []
 * ```
 *
 * Compila, devuelve un mapa de la misma forma, y deja el total **bien sumado y mal
 * costeado**: la maleta de Avianca Basic se le cobra también a la tarifa que eligió LATAM.
 *
 * ⚠️ **Medir «la tarifa de Avianca sube» NO sirve: pasa con las dos versiones.** Lo único
 * que separa el modelo bueno del malo es medir **la que NO debe subir**. Es la misma
 * trampa que ya costó una prueba verde con la resolución de ranura mutada («los dos vuelos
 * suman EN PLATA» pasaba igual). Por eso cada caso de abajo afirma las dos direcciones.
 */

import { describe, it, expect } from 'vitest'

import {
  ADICIONAL_OTRO,
  adicionalesPorItem,
  adjuntarAdicionales,
  etiquetaDeAdicional,
  faltaLaTablaDeAdicionales,
  margenDeAdicional,
  normalizarAdicional,
  totalesDeAdicionales,
  TIPOS_ADICIONAL,
} from './adicionales'
import { calcularCascada, type ItemParaCascada } from './totales'
import { cascadaDeItinerario, itemsDelItinerario } from './itinerarios'

// ── El escenario del brief: Vuelo 1 con Avianca y LATAM ──────────────────────

const MALETA = {
  codigo: 'equipaje_bodega',
  nombre: null,
  cantidad: 1,
  costo: 90_000,
  precio: 120_000,
  moneda: 'COP',
  tasaCop: null,
}

/**
 * Dos variantes del MISMO vuelo, con costo idéntico. Lo único que las separa es la maleta.
 *
 * Costos iguales a propósito: si fueran distintos, una diferencia de precio entre las dos
 * tarifas podría venir del costo y no del adicional, y la prueba no probaría nada.
 */
function itemsBase(
  conAdicionalEn: 'avianca' | 'latam' | null = 'avianca',
): (ItemParaCascada & { id: string })[] {
  const adicionales = [MALETA]
  return [
    {
      id: 'avianca',
      numeroDeRubros: 0,
      subtotal: 1_000_000,
      cantidad: 1,
      margen_porcentaje: 20,
      adicionales: conAdicionalEn === 'avianca' ? adicionales : [],
    },
    {
      id: 'latam',
      numeroDeRubros: 0,
      subtotal: 1_000_000,
      cantidad: 1,
      margen_porcentaje: 20,
      adicionales: conAdicionalEn === 'latam' ? adicionales : [],
    },
  ]
}

/** Los mismos ítems, con el grupo puesto: son dos variantes de la ranura «vuelo». */
function itemsConRanura(conAdicionalEn: 'avianca' | 'latam' | null = 'avianca') {
  return itemsBase(conAdicionalEn).map((i, orden) => ({ ...i, grupo: 'vuelo', orden }))
}

const PARAMS = { administrativosPct: 0, margenPct: 0, descuentoComercialPct: 0, convencionMargen: 'sobre_venta' as const }

describe('el adicional viaja con SU variante', () => {
  it('sube el precio de la variante que lo tiene y NO el de la otra (verificación 1)', () => {
    const cascada = calcularCascada(itemsBase('avianca'), PARAMS)
    const avianca = cascada.lineas.find(l => l.id === 'avianca')!
    const latam = cascada.lineas.find(l => l.id === 'latam')!

    // Las dos cuestan lo mismo, así que su precio BASE es el mismo.
    expect(avianca.precioLinea).toBe(latam.precioLinea)

    // ⚠️ La afirmación que mata la mutación: LATAM no se entera de la maleta.
    expect(latam.precioConAdicionales).toBe(latam.precioLinea)
    expect(latam.precioAdicionales).toBe(0)
    expect(latam.costoAdicionales).toBe(0)

    expect(avianca.precioAdicionales).toBe(120_000)
    expect(avianca.costoAdicionales).toBe(90_000)
    expect(avianca.precioConAdicionales).toBe(avianca.precioLinea + 120_000)
  })

  it('la tarifa que elige Avianca suma la maleta; la que elige LATAM no (verificación 2)', () => {
    const items = itemsConRanura('avianca')

    const conAvianca = cascadaDeItinerario(items, ['avianca'], PARAMS)
    const conLatam = cascadaDeItinerario(items, ['latam'], PARAMS)

    // El total de cada tarifa cuadra con sus propias líneas.
    expect(conAvianca.precioVenta).toBe(conLatam.precioVenta + 120_000)
    expect(conAvianca.costoDeVenta).toBe(conLatam.costoDeVenta + 90_000)

    // ⚠️ Y esta es la que cae con el adicional colgado de la ranura: con el modelo malo,
    // `conLatam` traería la maleta de Avianca y las dos darían lo mismo.
    expect(conLatam.precioVenta).toBe(1_250_000)
  })

  it('cambiar la variante elegida NO deja el adicional de la que salió (verificación 4)', () => {
    const items = itemsConRanura('avianca')

    const antes = cascadaDeItinerario(items, ['avianca'], PARAMS)
    const despues = cascadaDeItinerario(items, ['latam'], PARAMS)

    // El adicional se fue con Avianca. Nadie lo sacó: la cascada solo ve los ítems que
    // el itinerario incluye, y el adicional cuelga del ítem.
    expect(itemsDelItinerario(items, ['latam'])).toEqual(['latam'])
    expect(despues.precioVenta).toBe(antes.precioVenta - 120_000)
  })

  it('adicionalesPorItem empareja por item_id, no por el grupo de la línea', () => {
    const mapa = adicionalesPorItem([
      { id: 'a1', item_id: 'avianca', codigo: 'equipaje_bodega', cantidad: 1, costo: 90_000, precio: 120_000 },
    ])
    expect(mapa.get('avianca')?.length).toBe(1)
    // La otra variante de la MISMA ranura no hereda nada.
    expect(mapa.get('latam')).toBeUndefined()
  })

  /**
   * ⚠️⚠️ ESTE es el caso que cae con la mutación de `adjuntarAdicionales`.
   *
   * Los dos anteriores construyen los ítems con sus adicionales ya puestos: prueban que la
   * CASCADA se comporta, dado un emparejamiento correcto. Éste arranca de la fila cruda
   * —que es lo que devuelve la base— y pasa por el emparejamiento real, que es la pieza
   * que se puede escribir mal.
   */
  function desdeFilaCruda() {
    return adjuntarAdicionales(
      [
        { id: 'avianca', grupo: 'vuelo', orden: 0, numeroDeRubros: 0, subtotal: 1_000_000, cantidad: 1, margen_porcentaje: 20 },
        { id: 'latam', grupo: 'vuelo', orden: 1, numeroDeRubros: 0, subtotal: 1_000_000, cantidad: 1, margen_porcentaje: 20 },
      ],
      [{ id: 'a1', item_id: 'avianca', codigo: 'equipaje_bodega', cantidad: 1, costo: 90_000, precio: 120_000 }],
    )
  }

  it('de la fila CRUDA al total: LA PLATA de la tarifa que eligió LATAM no se mueve', () => {
    // ⚠️ La consecuencia, no la forma. Con el adicional colgado de la ranura, esta tarifa
    // sale a 1.370.000 y **no falla nada**: bien sumada y mal costeada.
    const items = desdeFilaCruda()
    const conLatam = cascadaDeItinerario(items, ['latam'], PARAMS)
    expect(conLatam.precioVenta).toBe(1_250_000)
    expect(conLatam.costoDeVenta).toBe(1_000_000)

    // Y la que SÍ lo tiene lo lleva: sin esto, la prueba pasaría con el adicional apagado.
    const conAvianca = cascadaDeItinerario(items, ['avianca'], PARAMS)
    expect(conAvianca.precioVenta).toBe(1_370_000)
  })

  it('de la fila CRUDA: la variante que no lo tiene no lo hereda', () => {
    expect(desdeFilaCruda().find(i => i.id === 'latam')!.adicionales).toEqual([])
    expect(desdeFilaCruda().find(i => i.id === 'avianca')!.adicionales).toHaveLength(1)
  })

  it('ordena los adicionales de una variante de forma estable', () => {
    const mapa = adicionalesPorItem([
      { id: 'b', item_id: 'avianca', codigo: 'seguro_viaje', orden: 2 },
      { id: 'a', item_id: 'avianca', codigo: 'equipaje_bodega', orden: 1 },
      { id: 'c', item_id: 'avianca', codigo: 'seleccion_silla', orden: 1 },
    ])
    expect(mapa.get('avianca')?.map(a => a.id)).toEqual(['a', 'c', 'b'])
  })
})

describe('dos adicionales sobre la misma variante SUMAN los dos', () => {
  it('no compiten entre sí: no son variantes', () => {
    const cascada = calcularCascada(
      [
        {
          id: 'avianca',
          numeroDeRubros: 0,
          subtotal: 1_000_000,
          cantidad: 1,
          margen_porcentaje: 20,
          adicionales: [MALETA, { ...MALETA, codigo: 'seleccion_silla', costo: 20_000, precio: 30_000 }],
        },
      ],
      PARAMS,
    )
    const linea = cascada.lineas[0]
    expect(linea.precioAdicionales).toBe(150_000)
    expect(linea.costoAdicionales).toBe(110_000)
  })
})

describe('cantidad: multiplica, y el margen del adicional sale bien (verificación 3)', () => {
  it('seis maletas para seis adultos son cantidad 6', () => {
    const seis = { ...MALETA, cantidad: 6 }
    const { costo, precio } = totalesDeAdicionales([seis])
    expect(costo).toBe(540_000)
    expect(precio).toBe(720_000)
  })

  it('el margen del adicional es el suyo y NO depende de la cantidad', () => {
    // (120.000 − 90.000) / 120.000 = 25%
    expect(margenDeAdicional(MALETA)).toBeCloseTo(25, 6)
    expect(margenDeAdicional({ ...MALETA, cantidad: 6 })).toBeCloseTo(25, 6)
  })

  it('una maleta revendida a costo tiene margen 0, no null', () => {
    expect(margenDeAdicional({ ...MALETA, costo: 120_000 })).toBe(0)
  })

  it('sin precio no hay margen que reportar: null, nunca 0', () => {
    expect(margenDeAdicional({ ...MALETA, precio: 0 })).toBeNull()
  })
})

describe('R6 · una cotización SIN adicionales da exactamente lo de antes', () => {
  it('la cascada no se mueve un peso', () => {
    const sinCampo = itemsBase(null).map(({ adicionales: _adicionales, ...resto }) => resto)
    const conCampoVacio = itemsBase(null)

    const a = calcularCascada(sinCampo, PARAMS)
    const b = calcularCascada(conCampoVacio, PARAMS)

    expect(a.precioVenta).toBe(b.precioVenta)
    expect(a.costoDeVenta).toBe(b.costoDeVenta)
    expect(a.costoDirecto).toBe(b.costoDirecto)
    // Y `precioConAdicionales` es el precio de siempre cuando no hay ninguno.
    for (const l of a.lineas) expect(l.precioConAdicionales).toBe(l.precioLinea)
  })

  it('con AIU la invariante de la cascada sigue cerrando', () => {
    // Σ costoDeVentaLinea + Σ costoAdicionales === costoDeVenta. Es la propiedad que
    // permite que una línea margine distinto sin romper la suma, y el adicional no la
    // puede romper: no lleva administrativos.
    const cascada = calcularCascada(itemsBase('avianca'), { ...PARAMS, administrativosPct: 12 })
    const suma = cascada.lineas.reduce((s, l) => s + l.costoDeVentaLinea + l.costoAdicionales, 0)
    expect(suma).toBe(cascada.costoDeVenta)
  })

  it('el precio BASE de la línea no se contamina: es lo que se guarda en items.precio_venta', () => {
    // El defecto que se compone solo: `recalcularTotales` escribe
    // `precio_venta = precioLinea / cantidad`. Con la maleta adentro, el recálculo
    // siguiente la sumaría otra vez encima.
    const cascada = calcularCascada(itemsBase('avianca'), PARAMS)
    const avianca = cascada.lineas.find(l => l.id === 'avianca')!
    expect(avianca.precioLinea).toBe(1_250_000)
  })
})

describe('el catálogo y la limpieza', () => {
  it('la lista corta arranca con los cinco de §1.3 y termina en «otro»', () => {
    expect(TIPOS_ADICIONAL.map(t => t.codigo)).toEqual([
      'equipaje_bodega',
      'seleccion_silla',
      'seguro_viaje',
      'cambio_fecha',
      ADICIONAL_OTRO,
    ])
  })

  it('un código inventado se descarta, pero el texto sobrevive', () => {
    const r = normalizarAdicional({ codigo: 'upgrade_a_primera', nombre: 'Upgrade a primera', precio: 1 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.codigo).toBeNull()
    expect(r.valor.nombre).toBe('Upgrade a primera')
  })

  it('sin código y sin nombre no hay adicional: un cargo anónimo en el documento del cliente', () => {
    const r = normalizarAdicional({ codigo: null, nombre: '   ', precio: 50_000 })
    expect(r.ok).toBe(false)
  })

  it('cantidad 0 o fraccionaria se rechaza', () => {
    expect(normalizarAdicional({ codigo: 'seguro_viaje', cantidad: 0 }).ok).toBe(false)
    expect(normalizarAdicional({ codigo: 'seguro_viaje', cantidad: 1.5 }).ok).toBe(false)
  })

  it('en otra moneda SIN tasa se RECHAZA: guardarlo aportaría cero al total', () => {
    const r = normalizarAdicional({ codigo: 'equipaje_bodega', moneda: 'usd', precio: 40, costo: 30 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.motivo).toContain('USD')
    expect(r.motivo).toContain('tasa')
  })

  it('en otra moneda CON tasa se guarda en su moneda, con la tasa al lado', () => {
    const r = normalizarAdicional({ codigo: 'equipaje_bodega', moneda: 'usd', precio: 40, costo: 30, tasaCop: 4_000 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.moneda).toBe('USD')
    expect(r.valor.tasaCop).toBe(4_000)
    // Y a la cascada llega convertido.
    expect(totalesDeAdicionales([r.valor]).precio).toBe(160_000)
  })

  it('en COP la tasa se descarta: no hay nada que convertir', () => {
    const r = normalizarAdicional({ codigo: 'seguro_viaje', precio: 50_000, tasaCop: 4_000 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.tasaCop).toBeNull()
  })

  it('lo que no se puede convertir aporta CERO y se DECLARA con nombre', () => {
    // Solo llega aquí por una vía que no pasó por `normalizarAdicional` (SQL, un cargue).
    // Un cero silencioso ahí es plata que se regala.
    const t = totalesDeAdicionales([{ codigo: 'equipaje_bodega', moneda: 'USD', tasaCop: null, precio: 40, costo: 30, cantidad: 1 }])
    expect(t.precio).toBe(0)
    expect(t.sinConvertir).toEqual(['Equipaje de bodega adicional'])
  })

  it('lo escrito manda sobre la etiqueta del catálogo', () => {
    expect(etiquetaDeAdicional({ codigo: 'equipaje_bodega', nombre: 'Maleta 23 kg BOG–ADZ' })).toBe('Maleta 23 kg BOG–ADZ')
    expect(etiquetaDeAdicional({ codigo: 'equipaje_bodega', nombre: null })).toBe('Equipaje de bodega adicional')
    // «Otro» sin texto no se imprime como «Otro»: no dice nada del cargo.
    expect(etiquetaDeAdicional({ codigo: ADICIONAL_OTRO, nombre: null })).toBe('otro')
  })
})

describe('tolerancia de despliegue', () => {
  it('reconoce la tabla ausente por los dos códigos de PostgREST', () => {
    expect(faltaLaTablaDeAdicionales({ code: '42P01', message: 'relation "public.item_adicionales" does not exist' })).toBe(true)
    expect(faltaLaTablaDeAdicionales({ code: 'PGRST205', message: "Could not find the table 'public.item_adicionales'" })).toBe(true)
  })

  it('⚠️ un 42P01 de OTRA tabla NO cuenta: sería un defecto invisible', () => {
    expect(faltaLaTablaDeAdicionales({ code: '42P01', message: 'relation "public.rubros" does not exist' })).toBe(false)
  })

  it('un error de permisos no se confunde con la tabla ausente', () => {
    expect(faltaLaTablaDeAdicionales({ code: '42501', message: 'permission denied for table item_adicionales' })).toBe(false)
  })
})
