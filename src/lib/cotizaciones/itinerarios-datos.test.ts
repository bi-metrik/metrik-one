/**
 * La capa de datos de los itinerarios, contra un doble que ESCRIBE de verdad.
 *
 * Con un doble de solo lectura, «no se desmarcó» y «se desmarcó y no se ve» son
 * indistinguibles — y el desmarcado es justo la mitad del control de §2.6.5. Por eso
 * el doble persiste: las afirmaciones se hacen sobre las filas que quedaron.
 *
 * EL DOBLE ES CONSCIENTE DE LA TABLA Y DEL FILTRO. Si el código deja de filtrar por
 * `cotizacion_id`, entran los itinerarios de otra cotización y las cifras cambian.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  contextoDeCotizacion,
  desmarcarLosQueYaNoPueden,
  leerItinerarios,
  totalDelPrincipal,
  bloquesParaPDF,
} from './itinerarios-datos'

type Fila = Record<string, unknown>
let tablas: Record<string, Fila[]> = {}
/** Tablas que el doble finge que NO existen (migración sin aplicar). */
let ausentes = new Set<string>()
/** Cuántas lecturas hizo el doble, por tabla. Para probar que no se relee de más. */
let lecturas: Record<string, number> = {}

function clienteFalso() {
  return { from: (tabla: string) => constructor(tabla) }
}

function constructor(tabla: string) {
  const filtros: [string, unknown][] = []
  let operacion: 'select' | 'update' | 'delete' = 'select'
  let payload: Fila = {}
  let embebe: string[] = []

  const aplica = (f: Fila) => filtros.every(([col, val]) => f[col] === val)

  const proyectar = (f: Fila): Fila => {
    const salida: Fila = { ...f }
    if (embebe.includes('rubros')) {
      salida.rubros = (tablas.rubros ?? [])
        .filter(r => r.item_id === f.id)
        .map(r => ({ valor_total: r.valor_total }))
    }
    if (embebe.includes('itinerario_opciones')) {
      salida.itinerario_opciones = (tablas.itinerario_opciones ?? [])
        .filter(o => o.itinerario_id === f.id)
        .map(o => ({ item_id: o.item_id }))
    }
    if (embebe.includes('lineas_negocio')) {
      const linea = (tablas.lineas_negocio ?? []).find(l => l.id === f.linea_id)
      salida.lineas_negocio = linea ? { config_extra: linea.config_extra } : null
    }
    return salida
  }

  const ejecutar = () => {
    // Migración sin aplicar: PostgREST contesta 42P01 nombrando la tabla.
    if (ausentes.has(tabla)) {
      return {
        data: null,
        error: { code: '42P01', message: `relation "public.${tabla}" does not exist` },
      }
    }
    if (operacion === 'select') lecturas[tabla] = (lecturas[tabla] ?? 0) + 1
    const filas = (tablas[tabla] ?? []).filter(aplica)
    if (operacion === 'update') {
      for (const f of filas) Object.assign(f, payload)
      return { data: filas, error: null }
    }
    if (operacion === 'delete') {
      tablas[tabla] = (tablas[tabla] ?? []).filter(f => !aplica(f))
      return { data: null, error: null }
    }
    return { data: filas.map(proyectar), error: null }
  }

  const api = {
    select(cols?: string) {
      operacion = 'select'
      embebe = ['rubros', 'itinerario_opciones', 'lineas_negocio'].filter(
        t => typeof cols === 'string' && cols.includes(`${t}(`),
      )
      return api
    },
    update(p: Fila) { operacion = 'update'; payload = p; return api },
    delete() { operacion = 'delete'; return api },
    eq(col: string, val: unknown) { filtros.push([col, val]); return api },
    neq(col: string, val: unknown) {
      filtros.push([col, { __neq: val }] as unknown as [string, unknown])
      return api
    },
    order() { return api },
    single() {
      const r = ejecutar()
      return Promise.resolve({ data: (r.data as Fila[])?.[0] ?? null, error: r.error })
    },
    maybeSingle() {
      const r = ejecutar()
      return Promise.resolve({ data: (r.data as Fila[])?.[0] ?? null, error: r.error })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(ejecutar()).then(resolve, reject)
    },
  }
  return api
}

const COT = 'cot-1'

/**
 * El caso real medido (Aldemar Rosales, ago-2025): mismo hotel, mismas fechas, dos
 * aerolíneas.
 *
 *   AVIANCA + OCCIDENTAL → venta 3.850.000, costo 3.350.000, margen 13,0%
 *   WINGO   + OCCIDENTAL → venta 3.275.000, costo 3.175.000, margen  3,1%
 *
 * ⚠️ Los precios son MANUALES, y eso no es un detalle del fixture: con el margen
 * derivado de la cotización las dos combinaciones marginarían exactamente lo mismo
 * —el 13% de la cabecera— y la prueba pasaría por la razón equivocada. La diferencia
 * de diez puntos que este frente existe para hacer visible solo aparece cuando el
 * precio lo pone una persona, que es como cotiza una agencia de viajes.
 */
function sembrarViaje(opciones: { pisoPct?: number } = {}) {
  ausentes = new Set()
  lecturas = {}
  tablas = {
    cotizaciones: [{
      id: COT,
      negocio_id: 'neg-1',
      oportunidad_id: null,
      valor_total: 0,
      margen_porcentaje: 13,
      convencion_margen: 'sobre_venta',
      aiu_admin_pct: 0,
      aiu_imprevistos_pct: 0,
      descuento_porcentaje: 0,
      piso_margen_pct: opciones.pisoPct ?? 5,
      aviso_margen_pct: 10,
    }],
    items: [
      { id: 'avianca', cotizacion_id: COT, nombre: 'AVIANCA', grupo: 'vuelo', opcion_de: null, orden: 1, cantidad: 1, subtotal: 2_000_000, es_ajuste: false, precio_venta: 2_500_000, precio_manual: true, margen_porcentaje: null, descuento_porcentaje: 0 },
      { id: 'wingo', cotizacion_id: COT, nombre: 'WINGO', grupo: 'vuelo', opcion_de: 'avianca', orden: 2, cantidad: 1, subtotal: 1_825_000, es_ajuste: false, precio_venta: 1_925_000, precio_manual: true, margen_porcentaje: null, descuento_porcentaje: 0 },
      { id: 'hotel', cotizacion_id: COT, nombre: 'OCCIDENTAL', grupo: 'hotel', opcion_de: null, orden: 3, cantidad: 1, subtotal: 1_350_000, es_ajuste: false, precio_venta: 1_350_000, precio_manual: true, margen_porcentaje: null, descuento_porcentaje: 0 },
      { id: 'traslado', cotizacion_id: COT, nombre: 'Traslado', grupo: 'traslado', opcion_de: null, orden: 4, cantidad: 1, subtotal: 0, es_ajuste: false, precio_venta: 0, precio_manual: false, margen_porcentaje: null, descuento_porcentaje: 0 },
    ],
    rubros: [],
    cotizacion_itinerarios: [
      { id: 'it-cara', cotizacion_id: COT, nombre: 'Recomendada', orden: 1, va_en_propuesta: true, es_principal: true },
      { id: 'it-barata', cotizacion_id: COT, nombre: 'Económica', orden: 2, va_en_propuesta: true, es_principal: false },
    ],
    itinerario_opciones: [
      { itinerario_id: 'it-cara', item_id: 'avianca' },
      { itinerario_id: 'it-cara', item_id: 'hotel' },
      { itinerario_id: 'it-barata', item_id: 'wingo' },
      { itinerario_id: 'it-barata', item_id: 'hotel' },
    ],
  }
}

const itinerario = (id: string) =>
  (tablas.cotizacion_itinerarios ?? []).find(i => i.id === id) as Fila

beforeEach(() => sembrarViaje())

describe('contextoDeCotizacion', () => {
  it('resuelve los umbrales congelados de la cotización', async () => {
    const ctx = await contextoDeCotizacion(clienteFalso(), COT)
    expect(ctx?.umbrales).toEqual({ pisoPct: 5, avisoPct: 10 })
  })

  it('cae a la política de la LÍNEA cuando la cotización no congeló nada', async () => {
    // Es el caso de las cotizaciones anteriores a la columna: congelarlas hacia atrás
    // obligaría a inventar qué umbral regía el día en que se crearon.
    tablas.cotizaciones[0].piso_margen_pct = null
    tablas.cotizaciones[0].aviso_margen_pct = null
    tablas.negocios = [{ id: 'neg-1', linea_id: 'lin-1' }]
    tablas.lineas_negocio = [{ id: 'lin-1', config_extra: { margen: { piso_pct: 12, aviso_pct: 18 } } }]

    const ctx = await contextoDeCotizacion(clienteFalso(), COT)
    expect(ctx?.umbrales).toEqual({ pisoPct: 12, avisoPct: 18 })
  })
})

describe('R5 · totalDelPrincipal', () => {
  it('devuelve el total del itinerario PRINCIPAL, no la suma de todo', async () => {
    const ctx = await contextoDeCotizacion(clienteFalso(), COT)
    const principal = await totalDelPrincipal(clienteFalso(), COT, ctx!)

    // AVIANCA + hotel, sin WINGO.
    expect(principal?.costoDirecto).toBe(3_350_000)
    expect(principal?.itinerarioId).toBe('it-cara')
    // La suma de TODOS los ítems incluiría los dos vuelos: 5.175.000.
    expect(principal!.costoDirecto).toBeLessThan(5_175_000)
  })

  it('R6 · sin NINGÚN itinerario devuelve null y el llamador suma todo', async () => {
    tablas.cotizacion_itinerarios = []
    const ctx = await contextoDeCotizacion(clienteFalso(), COT)
    expect(await totalDelPrincipal(clienteFalso(), COT, ctx!)).toBeNull()
  })

  it('con itinerarios pero sin principal devuelve null, no «el primero»', async () => {
    // Elegir el primero le cambiaría el precio a la cotización sin que nadie lo haya
    // decidido.
    itinerario('it-cara').es_principal = false
    const ctx = await contextoDeCotizacion(clienteFalso(), COT)
    expect(await totalDelPrincipal(clienteFalso(), COT, ctx!)).toBeNull()
  })
})

describe('§2.6.5 · desmarcar lo que ya no puede ir a la propuesta', () => {
  it('no toca nada cuando los dos cumplen el piso', async () => {
    // Con el piso en 3% las dos pasan: la Económica va al 3,05%.
    tablas.cotizaciones[0].piso_margen_pct = 3
    const desmarcados = await desmarcarLosQueYaNoPueden(clienteFalso(), COT)
    expect(desmarcados).toEqual([])
    expect(itinerario('it-cara').va_en_propuesta).toBe(true)
    expect(itinerario('it-barata').va_en_propuesta).toBe(true)
  })

  it('con el piso POR DEFECTO, la Económica del caso real ya no puede ir', async () => {
    // Es el hallazgo del frente, no un caso inventado: WINGO + OCCIDENTAL dejó 3,1%
    // en agosto de 2025 y el piso por defecto de una agencia de viajes es 5%. Con
    // este control, ese viaje no habría salido marcado para el cliente sin que
    // alguien lo decidiera a mano.
    //
    // Que una salga y la otra NO es lo que hace válida la prueba: si desmarcara las
    // dos, pasaría por la razón equivocada.
    const desmarcados = await desmarcarLosQueYaNoPueden(clienteFalso(), COT)

    expect(desmarcados.map(d => d.nombre)).toEqual(['Económica'])
    expect(desmarcados[0].motivo).toContain('piso')
    // La afirmación va sobre la FILA, no sobre lo que devolvió la función.
    expect(itinerario('it-barata').va_en_propuesta).toBe(false)
    expect(itinerario('it-cara').va_en_propuesta).toBe(true)
  })

  it('al desmarcar al principal le suelta también la corona', async () => {
    // Dejarlo principal apuntaría `valor_total` a un precio que el cliente no verá.
    tablas.cotizaciones[0].piso_margen_pct = 20
    await desmarcarLosQueYaNoPueden(clienteFalso(), COT)
    expect(itinerario('it-cara').es_principal).toBe(false)
    expect(itinerario('it-cara').va_en_propuesta).toBe(false)
  })

  it('un itinerario INCOMPLETO sale de la propuesta aunque su margen sea bueno', async () => {
    // Aparece un segundo hotel: «hotel» pasa a ser una ranura con alternativas y el
    // itinerario que tenía el suyo borrado se queda sin resolverla (R2). Es el caso
    // que abre agregar una opción a algo que antes era único: los itinerarios que ya
    // estaban dejan de estar completos, y eso es honesto — genuinamente se volvieron
    // ambiguos.
    tablas.cotizaciones[0].piso_margen_pct = 3
    tablas.items.push({
      id: 'hotel-2', cotizacion_id: COT, nombre: 'HARD ROCK', grupo: 'hotel',
      opcion_de: 'hotel', orden: 5, cantidad: 1, subtotal: 1_000_000, es_ajuste: false,
      precio_venta: 1_200_000, precio_manual: true, margen_porcentaje: null, descuento_porcentaje: 0,
    })
    // A la Recomendada le quitan la elección de hotel.
    tablas.itinerario_opciones = tablas.itinerario_opciones.filter(
      o => !(o.itinerario_id === 'it-cara' && o.item_id === 'hotel'),
    )

    const desmarcados = await desmarcarLosQueYaNoPueden(clienteFalso(), COT)

    expect(desmarcados.map(d => d.id)).toEqual(['it-cara'])
    expect(desmarcados[0].motivo).toContain('hotel')
    expect(itinerario('it-cara').va_en_propuesta).toBe(false)
    // La Económica sí tiene su hotel elegido: se queda.
    expect(itinerario('it-barata').va_en_propuesta).toBe(true)
  })

  it('el que NO está en la propuesta no se toca ni se reporta', async () => {
    // Sacar algo de la propuesta siempre se puede; volver a sacarlo no es un evento.
    itinerario('it-barata').va_en_propuesta = false
    tablas.cotizaciones[0].piso_margen_pct = 99
    const desmarcados = await desmarcarLosQueYaNoPueden(clienteFalso(), COT)
    expect(desmarcados.map(d => d.id)).toEqual(['it-cara'])
  })
})

describe('reutilizar lo ya leído', () => {
  it('con el contexto y las filas dados, NO vuelve a leer la base', async () => {
    // `recalcularTotales` corre en cada tecla del editor. Sin esto, desmarcar volvía
    // a pedir la cotización, sus ítems con rubros y sus itinerarios.
    const ctx = (await contextoDeCotizacion(clienteFalso(), COT))!
    const filas = await leerItinerarios(clienteFalso(), COT)
    lecturas = {}

    const desmarcados = await desmarcarLosQueYaNoPueden(clienteFalso(), COT, { ctx, filas })

    // El desenlace es el mismo que sin reutilizar: la Económica sale por el piso.
    expect(desmarcados.map(d => d.nombre)).toEqual(['Económica'])
    expect(itinerario('it-barata').va_en_propuesta).toBe(false)
    // Y no se leyó nada de nuevo.
    expect(lecturas.cotizaciones ?? 0).toBe(0)
    expect(lecturas.items ?? 0).toBe(0)
    expect(lecturas.cotizacion_itinerarios ?? 0).toBe(0)
  })

  it('sin darle nada, sí lee: el control de la prueba de arriba', async () => {
    lecturas = {}
    await desmarcarLosQueYaNoPueden(clienteFalso(), COT)
    expect(lecturas.cotizaciones).toBeGreaterThan(0)
    expect(lecturas.cotizacion_itinerarios).toBeGreaterThan(0)
  })

  it('totalDelPrincipal también acepta las filas ya leídas', async () => {
    const ctx = (await contextoDeCotizacion(clienteFalso(), COT))!
    const filas = await leerItinerarios(clienteFalso(), COT)
    lecturas = {}
    const principal = await totalDelPrincipal(clienteFalso(), COT, ctx, filas)
    expect(principal?.itinerarioId).toBe('it-cara')
    expect(lecturas.cotizacion_itinerarios ?? 0).toBe(0)
  })
})

describe('tolerancia · la migración sin aplicar', () => {
  it('leerItinerarios devuelve null, no revienta', async () => {
    ausentes = new Set(['cotizacion_itinerarios'])
    expect(await leerItinerarios(clienteFalso(), COT)).toBeNull()
  })

  it('totalDelPrincipal devuelve null: la cotización suma como siempre', async () => {
    ausentes = new Set(['cotizacion_itinerarios'])
    const ctx = await contextoDeCotizacion(clienteFalso(), COT)
    expect(ctx).not.toBeNull()
    expect(await totalDelPrincipal(clienteFalso(), COT, ctx!)).toBeNull()
  })

  it('el PDF imprime la lista plana', async () => {
    ausentes = new Set(['cotizacion_itinerarios'])
    expect(await bloquesParaPDF(clienteFalso(), COT)).toBeNull()
  })
})

describe('R7 · los bloques del PDF', () => {
  // El piso baja a 3% para que las DOS sigan en la propuesta: lo que se prueba aquí
  // es el armado de los bloques, no el candado del margen.
  beforeEach(() => { tablas.cotizaciones[0].piso_margen_pct = 3 })

  it('el PRINCIPAL va primero, aunque su orden sea mayor', async () => {
    itinerario('it-cara').orden = 9
    const bloques = await bloquesParaPDF(clienteFalso(), COT)
    expect(bloques?.map(b => b.nombre)).toEqual(['Recomendada', 'Económica'])
    expect(bloques?.[0].esPrincipal).toBe(true)
  })

  it('solo imprime los marcados «va en propuesta»', async () => {
    itinerario('it-barata').va_en_propuesta = false
    const bloques = await bloquesParaPDF(clienteFalso(), COT)
    expect(bloques?.map(b => b.nombre)).toEqual(['Recomendada'])
  })

  it('cada bloque trae SUS ítems: el traslado fijo en los dos, el vuelo en uno', async () => {
    const bloques = await bloquesParaPDF(clienteFalso(), COT)
    const cara = bloques!.find(b => b.nombre === 'Recomendada')!
    const barata = bloques!.find(b => b.nombre === 'Económica')!

    expect(cara.itemIds).toContain('avianca')
    expect(cara.itemIds).not.toContain('wingo')
    expect(barata.itemIds).toContain('wingo')
    expect(barata.itemIds).not.toContain('avianca')
    // R3 · el traslado entra en los dos sin que nadie lo teclee.
    expect(cara.itemIds).toContain('traslado')
    expect(barata.itemIds).toContain('traslado')
  })

  it('cada bloque trae su propio precio, y NO son el mismo', async () => {
    const bloques = await bloquesParaPDF(clienteFalso(), COT)
    const precios = bloques!.map(b => b.precio)
    expect(precios[0]).toBeGreaterThan(precios[1])
  })

  it('ninguno en la propuesta: el PDF imprime como siempre', async () => {
    for (const it of tablas.cotizacion_itinerarios) it.va_en_propuesta = false
    expect(await bloquesParaPDF(clienteFalso(), COT)).toBeNull()
  })
})
