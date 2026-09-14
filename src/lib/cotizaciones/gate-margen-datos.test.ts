/**
 * El gate `margen_sobre_piso` ejercitado contra un doble de la base.
 *
 * Las pruebas de `gate-margen.test.ts` fijan el CRITERIO; estas fijan que el gate lo
 * aplique sobre lo que hay en la base — un criterio perfecto que nadie llama se ve
 * igual que un gate que funciona.
 *
 * EL DOBLE ES CONSCIENTE DE LA TABLA Y DEL FILTRO: si el código deja de filtrar por
 * `negocio_id`, entran las cotizaciones de otro negocio y el veredicto cambia.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { evaluarGateMargen } from './gate-margen-datos'

type Fila = Record<string, unknown>
let tablas: Record<string, Fila[]> = {}
/** Tablas que el doble hace fallar, para probar el camino de «no se pudo leer». */
let rompe = new Set<string>()

function clienteFalso() {
  return { from: (tabla: string) => constructor(tabla) }
}

function constructor(tabla: string) {
  const filtros: [string, unknown][] = []
  let embebe: string[] = []

  const aplica = (f: Fila) => filtros.every(([col, val]) => f[col] === val)

  const proyectar = (f: Fila): Fila => {
    const salida: Fila = { ...f }
    if (embebe.includes('rubros')) {
      salida.rubros = (tablas.rubros ?? [])
        .filter(r => r.item_id === f.id)
        .map(r => ({ valor_total: r.valor_total, sugerido: r.sugerido ?? false }))
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
    if (rompe.has(tabla)) {
      return { data: null, error: { code: '42501', message: `permission denied for ${tabla}` } }
    }
    return { data: (tablas[tabla] ?? []).filter(aplica).map(proyectar), error: null }
  }

  const api = {
    select(cols?: string) {
      embebe = ['rubros', 'itinerario_opciones', 'lineas_negocio'].filter(
        t => typeof cols === 'string' && cols.includes(`${t}(`),
      )
      return api
    },
    eq(col: string, val: unknown) { filtros.push([col, val]); return api },
    order() { return api },
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

const NEG = 'neg-1'

/**
 * Un viaje con UNA línea de costo y precio manual, para poder fijar el margen exacto
 * que se quiere probar sin depender de la convención de la cotización.
 */
function cotizacion(id: string, estado: string, costo: number, precio: number, extra: Fila = {}): Fila {
  return {
    id,
    codigo: `COT-${id}`,
    estado,
    negocio_id: NEG,
    oportunidad_id: null,
    margen_porcentaje: 0,
    convencion_margen: 'sobre_venta',
    aiu_admin_pct: 0,
    aiu_imprevistos_pct: 0,
    descuento_porcentaje: 0,
    piso_margen_pct: 5,
    aviso_margen_pct: 10,
    __costo: costo,
    __precio: precio,
    ...extra,
  }
}

function itemsDe(cots: Fila[]): Fila[] {
  return cots.map((c, i) => ({
    id: `item-${c.id}`,
    cotizacion_id: c.id,
    nombre: 'Paquete',
    grupo: null,
    opcion_de: null,
    orden: i,
    cantidad: 1,
    subtotal: c.__costo,
    es_ajuste: false,
    precio_venta: c.__precio,
    precio_manual: true,
    margen_porcentaje: null,
    descuento_porcentaje: 0,
  }))
}

function sembrar(cots: Fila[], extra: Partial<Record<string, Fila[]>> = {}) {
  rompe = new Set()
  tablas = {
    cotizaciones: cots,
    items: itemsDe(cots),
    rubros: [],
    negocios: [{ id: NEG, linea_id: null }],
    lineas_negocio: [],
    cotizacion_itinerarios: [],
    itinerario_opciones: [],
    ...extra,
  }
}

beforeEach(() => sembrar([cotizacion('a', 'enviada', 3_175_000, 3_275_000)]))

describe('el gate frena de verdad', () => {
  it('una cotización al 3,1% NO deja avanzar, y lo dice con sus cifras', async () => {
    const v = await evaluarGateMargen(clienteFalso(), NEG)
    expect(v.bloquea).toBe(true)
    expect(v.mensaje).toContain('COT-a')
    expect(v.mensaje).toContain('3,1%')
    expect(v.mensaje).toContain('5,0%')
  })

  it('CONTROL · la misma cotización al 13,0% deja avanzar', async () => {
    // Sin este control, un gate que bloqueara SIEMPRE pasaría la prueba de arriba.
    sembrar([cotizacion('a', 'enviada', 3_350_000, 3_850_000)])
    const v = await evaluarGateMargen(clienteFalso(), NEG)
    expect(v.bloquea).toBe(false)
    expect(v.mensaje).toBe('')
  })

  it('entre el piso y el aviso deja avanzar: el ámbar no bloquea', async () => {
    // 7,0%: bajo el aviso de 10, por encima del piso de 5.
    sembrar([cotizacion('a', 'enviada', 930_000, 1_000_000)])
    const v = await evaluarGateMargen(clienteFalso(), NEG)
    expect(v.bloquea).toBe(false)
  })

  it('una cotización sin costo NO frena: no es bajo el piso, es sin medir', async () => {
    sembrar([cotizacion('a', 'borrador', 0, 1_000_000)])
    const v = await evaluarGateMargen(clienteFalso(), NEG)
    expect(v.bloquea).toBe(false)
  })

  it('una rechazada al 3% no frena a nadie', async () => {
    sembrar([cotizacion('a', 'rechazada', 3_175_000, 3_275_000)])
    const v = await evaluarGateMargen(clienteFalso(), NEG)
    expect(v.bloquea).toBe(false)
  })

  it('un negocio sin cotizaciones avanza', async () => {
    sembrar([])
    const v = await evaluarGateMargen(clienteFalso(), NEG)
    expect(v.bloquea).toBe(false)
  })

  it('si las cotizaciones no se pueden LEER, frena y lo dice', async () => {
    rompe = new Set(['cotizaciones'])
    const v = await evaluarGateMargen(clienteFalso(), NEG)
    expect(v.bloquea).toBe(true)
    expect(v.mensaje).toContain('No se pudieron leer')
  })

  it('no mira las cotizaciones de OTRO negocio', async () => {
    const mia = cotizacion('mia', 'enviada', 3_350_000, 3_850_000)
    const ajena = { ...cotizacion('ajena', 'enviada', 3_175_000, 3_275_000), negocio_id: 'neg-2' }
    sembrar([mia, ajena])
    const v = await evaluarGateMargen(clienteFalso(), NEG)
    expect(v.bloquea).toBe(false)
  })
})

describe('con itinerarios manda el PRINCIPAL, no la suma de las alternativas', () => {
  // La aerolínea cara deja 13,0% y la barata 3,1%. Cuál frena depende de cuál es la
  // principal — y esa es exactamente la cifra que el editor enseña abajo.
  const COT = 'con-itin'

  function sembrarViaje(principal: 'cara' | 'barata') {
    rompe = new Set()
    tablas = {
      cotizaciones: [{
        id: COT, codigo: 'COT-VIAJE', estado: 'enviada', negocio_id: NEG, oportunidad_id: null,
        margen_porcentaje: 0, convencion_margen: 'sobre_venta',
        aiu_admin_pct: 0, aiu_imprevistos_pct: 0, descuento_porcentaje: 0,
        piso_margen_pct: 5, aviso_margen_pct: 10,
      }],
      items: [
        { id: 'avianca', cotizacion_id: COT, nombre: 'AVIANCA', grupo: 'vuelo', opcion_de: null, orden: 1, cantidad: 1, subtotal: 2_000_000, es_ajuste: false, precio_venta: 2_500_000, precio_manual: true, margen_porcentaje: null, descuento_porcentaje: 0 },
        { id: 'wingo', cotizacion_id: COT, nombre: 'WINGO', grupo: 'vuelo', opcion_de: 'avianca', orden: 2, cantidad: 1, subtotal: 1_825_000, es_ajuste: false, precio_venta: 1_925_000, precio_manual: true, margen_porcentaje: null, descuento_porcentaje: 0 },
        { id: 'hotel', cotizacion_id: COT, nombre: 'OCCIDENTAL', grupo: 'hotel', opcion_de: null, orden: 3, cantidad: 1, subtotal: 1_350_000, es_ajuste: false, precio_venta: 1_350_000, precio_manual: true, margen_porcentaje: null, descuento_porcentaje: 0 },
      ],
      rubros: [],
      negocios: [{ id: NEG, linea_id: null }],
      lineas_negocio: [],
      cotizacion_itinerarios: [
        { id: 'it', cotizacion_id: COT, nombre: null, orden: 1, va_en_propuesta: true, es_principal: true },
      ],
      itinerario_opciones: [
        { itinerario_id: 'it', item_id: principal === 'cara' ? 'avianca' : 'wingo' },
        { itinerario_id: 'it', item_id: 'hotel' },
      ],
    }
  }

  it('con la CARA como principal, avanza', async () => {
    sembrarViaje('cara')
    expect((await evaluarGateMargen(clienteFalso(), NEG)).bloquea).toBe(false)
  })

  it('con la BARATA como principal, frena al 3,1%', async () => {
    sembrarViaje('barata')
    const v = await evaluarGateMargen(clienteFalso(), NEG)
    expect(v.bloquea).toBe(true)
    expect(v.mensaje).toContain('3,1%')
  })
})
