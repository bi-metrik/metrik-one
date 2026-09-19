/**
 * Las server actions de la tarifa por pasajero contra los tres hallazgos de la prueba en
 * producción del #763 (Trappvel, COT-2026-0002, 2026-09-16).
 *
 * Corre las acciones REALES con un doble de Supabase que persiste: lo que se afirma es lo
 * que quedó escrito, no lo que la función dice haber hecho. Lo único doblado es lo que sale
 * del proceso (sesión, módulo, Gemini, viaje del negocio, recálculo de totales). La lectura
 * del pantallazo pasa por el `evaluarLectura` real, así que el rechazo por moneda (RX3) y
 * la moneda indicada a mano son los de producción.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LecturaCruda } from '@/lib/cotizaciones/lectura-pantallazo'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
let lecturaDelModelo: LecturaCruda
/** La de la cotización que embebe el doble. Decide qué número va a `margen_porcentaje`. */
let convencionDeLaCotizacion: 'markup' | 'sobre_venta' = 'sobre_venta'

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: clienteFalso(), workspaceId: 'ws-1', error: null }),
}))
vi.mock('@/lib/modulos/exigir-modulo', () => ({
  exigirModulo: async () => ({ ok: true }),
  MENSAJE_MODULO_NO_ACTIVO: 'sin módulo',
  REQUISITO: { clarity: 'clarity' },
}))
vi.mock('@/lib/server-keys', () => ({ getServerKey: () => 'llave-de-prueba' }))
vi.mock('@/lib/ai/extraer-ranura', () => ({
  extraerRanuraDesdeImagen: async () => ({ data: lecturaDelModelo }),
}))
vi.mock('@/lib/cotizaciones/viaje-negocio', () => ({
  leerViajeDelNegocio: async () => ({
    viaje: { composicion: null, fechas: { inicio: '2026-12-12', fin: '2026-12-16' } },
    error: null,
  }),
}))
vi.mock('@/app/(app)/negocios/cotizacion-actions', () => ({ recalcularTotales: async () => {} }))

function clienteFalso() {
  return { from: (tabla: string) => consulta(tabla) }
}

function consulta(tabla: string) {
  const filtros: [string, unknown][] = []
  let operacion: 'select' | 'update' | 'delete' | 'insert' = 'select'
  let payload: Fila | Fila[] = {}
  let embebeCotizacion = false
  const aplica = (f: Fila) => filtros.every(([c, v]) => f[c] === v)

  const ejecutar = () => {
    const filas = (tablas[tabla] ?? []).filter(aplica)
    if (operacion === 'update') {
      for (const f of filas) Object.assign(f, structuredClone(payload as Fila))
      return { data: filas, error: null }
    }
    if (operacion === 'delete') {
      tablas[tabla] = (tablas[tabla] ?? []).filter(f => !aplica(f))
      return { data: null, error: null }
    }
    if (operacion === 'insert') {
      const nuevas = (Array.isArray(payload) ? payload : [payload]).map(p => structuredClone(p))
      tablas[tabla] = [...(tablas[tabla] ?? []), ...nuevas]
      return { data: nuevas, error: null }
    }
    return {
      data: filas.map(f => {
        const salida = structuredClone(f)
        if (embebeCotizacion) {
          salida.cotizaciones = {
            estado: 'borrador',
            negocio_id: 'neg-1',
            convencion_margen: convencionDeLaCotizacion,
          }
        }
        return salida
      }),
      error: null,
    }
  }

  const api = {
    select(cols?: string) {
      embebeCotizacion = typeof cols === 'string' && cols.includes('cotizaciones(')
      return api
    },
    update(p: Fila) { operacion = 'update'; payload = p; return api },
    delete() { operacion = 'delete'; return api },
    insert(p: Fila | Fila[]) { operacion = 'insert'; payload = p; return api },
    eq(c: string, v: unknown) { filtros.push([c, v]); return api },
    async maybeSingle() {
      const r = ejecutar()
      return { data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error }
    },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(ejecutar()).then(res, rej)
    },
  }
  return api
}

const { leerCasillaDeItem, confirmarTarifaPorPasajero, quitarCasillaDeItem } = await import('./tarifa-pax-actions')
const { leerTarifaPax, tarifaMasReciente } = await import('@/lib/cotizaciones/tarifa-pasajero')
const { precioConMargen } = await import('@/lib/cotizaciones/precio-item')
const { nivelDeMargen, POLITICA_MARGEN_POR_DEFECTO } = await import('@/lib/cotizaciones/convencion-margen')

const v = (valor: string | null, confianza = 0.95) => ({ value: valor, confidence: confianza })

/** El «resultado» de Decameron: un solo total para el grupo y sin moneda visible. */
function decameronResultado(): LecturaCruda {
  return {
    veredicto: 'detalle_unico',
    observacion: 'Resultado de la búsqueda, un solo total',
    campos: {
      hotel: v('Decameron Cartagena'),
      ciudad: v('Cartagena'),
      tipo_habitacion: v('Estándar'),
      regimen: v('Todo incluido'),
      check_in: v('2026-12-12'),
      check_out: v('2026-12-16'),
      noches: v(null, 0),
      ocupacion: v('2 adultos, 1 infante'),
      ocupacion_adultos: v('2'),
      ocupacion_ninos: v('0'),
      ocupacion_infantes: v('1'),
      politica_cancelacion: v('No reembolsable'),
      impuestos_incluidos: v('true'),
      moneda: v(null, 0),
      precio_total: v('2029118'),
      base_precio: v('total'),
    },
    desglose: [],
  }
}

function itemHotel(nombre: string): Fila {
  return {
    id: 'item-hotel',
    cotizacion_id: 'cot-1',
    grupo: 'hotel',
    nombre,
    descripcion: null,
    tarifa_pax: { composicion: { adultos: 2, ninos: 0, infantes: 1 } },
  }
}

/** La lectura de LATAM ya guardada en la casilla 1: 5 adultos y 1 niño, con desglose. */
function itemVueloConLectura(nombre: string): Fila {
  return {
    id: 'item-vuelo',
    cotizacion_id: 'cot-1',
    grupo: 'vuelo',
    nombre,
    descripcion: null,
    tarifa_pax: {
      composicion: { adultos: 5, ninos: 1, infantes: 0 },
      casillas: {
        grupo_completo: {
          moneda: 'COP',
          total: 11306378,
          aPagarAgencia: null,
          porTipo: [
            { tipo: 'adulto', cantidad: 5, subtotal: 9535315 },
            { tipo: 'nino', cantidad: 1, subtotal: 1771063 },
          ],
          ocupacion: { adultos: 5, ninos: 1, infantes: 0, total: 6 },
          ocupacionDelItem: false,
          identidad: {},
          notasCliente: [],
          alertas: [],
          campos: [],
          nombre: 'LATAM Bogotá BOG–Orlando MCO',
          descripcion: 'Vuelo: 4406 · Directo',
          leidaEn: '2026-09-16T14:19:59.007Z',
        },
      },
    },
  }
}

const itemEnBase = (id: string) => (tablas.items ?? []).find(f => f.id === id) as Fila

/**
 * La LIQUIDACIÓN de Decameron ya guardada en la casilla 1, con los números de la captura
 * real (`capturas-proveedor/2026-09-16/3.57.39_PM.jpeg`): desglose por tipo que suma el
 * valor al pasajero (2.029.118) y «total a pagar agencia» aparte (1.818.919).
 */
function itemHotelLiquidacion(over: Fila = {}): Fila {
  return {
    id: 'item-liquidacion',
    cotizacion_id: 'cot-1',
    grupo: 'hotel',
    nombre: 'DECAMERON',
    descripcion: null,
    tarifa_pax: {
      composicion: { adultos: 2, ninos: 0, infantes: 1 },
      casillas: {
        grupo_completo: {
          moneda: 'COP',
          total: 2029118,
          aPagarAgencia: 1818919,
          porTipo: [
            { tipo: 'adulto', cantidad: 2, subtotal: 2019412 },
            { tipo: 'infante', cantidad: 1, subtotal: 9706 },
          ],
          ocupacion: { adultos: 2, ninos: 0, infantes: 1, total: 3 },
          ocupacionDelItem: false,
          identidad: {},
          notasCliente: [],
          alertas: [],
          campos: [],
          nombre: 'Decameron',
          descripcion: 'Todo incluido',
          leidaEn: '2026-09-17T14:19:59.007Z',
        },
      },
    },
    ...over,
  }
}

beforeEach(() => {
  tablas = { items: [], rubros: [] }
  lecturaDelModelo = decameronResultado()
  convencionDeLaCotizacion = 'sobre_venta'
})

describe('hallazgo 1 · elegir la moneda deja la casilla igual que pegar directo', () => {
  it('sin moneda pide la moneda y no guarda nada; con COP guarda y DEVUELVE lo guardado', async () => {
    tablas.items.push(itemHotel('PRUEBA Hotel Decameron'))

    const sinMoneda = await leerCasillaDeItem('item-hotel', 'grupo_completo', 'data:image/png;base64,AAAA')
    expect(sinMoneda.ok).toBe(false)
    if (sinMoneda.ok) return
    expect(sinMoneda.pideMoneda).toBe(true)
    expect(leerTarifaPax(itemEnBase('item-hotel').tarifa_pax).casillas).toEqual({})

    const conCOP = await leerCasillaDeItem('item-hotel', 'grupo_completo', 'data:image/png;base64,AAAA', 'COP')
    expect(conCOP.ok).toBe(true)
    if (!conCOP.ok) return

    const enBase = leerTarifaPax(itemEnBase('item-hotel').tarifa_pax)
    expect(enBase.casillas?.grupo_completo?.total).toBe(2029118)
    expect(enBase.casillas?.grupo_completo?.moneda).toBe('COP')
    expect(enBase.actualizadaEn).toBeTruthy()
    // Lo devuelto es exactamente lo que quedó: la casilla pinta con esto sin esperar la página.
    expect(leerTarifaPax(conCOP.tarifa)).toEqual(enBase)
    expect(conCOP.mensaje).toContain('Falta el 2')
  })

  it('la página vieja (sin la lectura) no le gana a lo guardado', async () => {
    tablas.items.push(itemHotel('PRUEBA Hotel Decameron'))
    const paginaVieja = leerTarifaPax(structuredClone(itemEnBase('item-hotel').tarifa_pax))

    const r = await leerCasillaDeItem('item-hotel', 'grupo_completo', 'data:image/png;base64,AAAA', 'COP')
    if (!r.ok) throw new Error(r.mensaje)

    const pintada = tarifaMasReciente(paginaVieja, r.tarifa)
    expect(pintada.casillas?.grupo_completo?.total).toBe(2029118)
  })

  it('quitar la casilla también devuelve lo que quedó, más nuevo que la lectura', async () => {
    tablas.items.push(itemHotel('PRUEBA Hotel Decameron'))
    const leida = await leerCasillaDeItem('item-hotel', 'grupo_completo', 'data:image/png;base64,AAAA', 'COP')
    if (!leida.ok) throw new Error(leida.mensaje)
    await new Promise(r => setTimeout(r, 5))

    const quitada = await quitarCasillaDeItem('item-hotel', 'grupo_completo')
    expect(quitada.success).toBe(true)
    expect(quitada.tarifa?.casillas).toEqual({})
    // Con la lectura como «lo guardado» y la página ya refrescada sin ella, gana la página.
    expect(tarifaMasReciente(leerTarifaPax(itemEnBase('item-hotel').tarifa_pax), leida.tarifa).casillas).toEqual({})
  })
})

describe('hallazgo 2 · confirmar no pisa el nombre que escribió la persona', () => {
  it('«PRUEBA Vuelo LATAM» se queda así (antes quedaba «LATAM Bogotá BOG–Orlando MCO»)', async () => {
    tablas.items.push(itemVueloConLectura('PRUEBA Vuelo LATAM'))
    const r = await confirmarTarifaPorPasajero('item-vuelo', null)
    expect(r).toMatchObject({ success: true })
    expect(itemEnBase('item-vuelo').nombre).toBe('PRUEBA Vuelo LATAM')
  })

  // ⚠️ Desde el 2026-09-17 el nombre leído se guarda en MAYÚSCULA (`mayusculas.ts`): sale
  // impreso al lado de lo que alguien escribió a mano y la lista tiene que leerse pareja.
  // Las tildes se conservan — «Bogotá» → «BOGOTÁ», no «BOGOTA».
  it('una línea sin nombre sí toma el leído, en mayúscula y con tildes', async () => {
    tablas.items.push(itemVueloConLectura(''))
    await confirmarTarifaPorPasajero('item-vuelo', null)
    expect(itemEnBase('item-vuelo').nombre).toBe('LATAM BOGOTÁ BOG–ORLANDO MCO')
  })

  it('una alternativa con el relleno del sistema también', async () => {
    tablas.items.push(itemVueloConLectura('PRUEBA Vuelo LATAM (alternativa)'))
    await confirmarTarifaPorPasajero('item-vuelo', null)
    expect(itemEnBase('item-vuelo').nombre).toBe('LATAM BOGOTÁ BOG–ORLANDO MCO')
  })
})

describe('hallazgo 3 · los rubros por pasajero son tarifa del proveedor', () => {
  it('Adulto y Niño nacen con tipo `tarifa`, no `servicios_prof`', async () => {
    tablas.items.push(itemVueloConLectura('PRUEBA Vuelo LATAM'))
    const r = await confirmarTarifaPorPasajero('item-vuelo', null)
    expect(r.success).toBe(true)
    expect(tablas.rubros.map(x => [x.tipo, x.descripcion, x.cantidad, x.valor_unitario])).toEqual([
      ['tarifa', 'Adulto', 5, 1907063],
      ['tarifa', 'Niño', 1, 1771063],
    ])
    expect(leerTarifaPax(r.tarifa).confirmada?.costoTotalCOP).toBe(11306378)
  })
})

/**
 * El pantallazo con los DOS precios (§4.4 de `propuesta-visual.md`, reunión del 16-sep).
 *
 * Lo que se afirma es lo que quedó ESCRITO en `items`: el reparto del costo, el margen de
 * la línea, y que el precio que sale de ese margen es exactamente el que la captura dice
 * que paga el cliente. El precio lo calcula `recalcularTotales` con `precioConMargen`, así
 * que aquí se reproduce con la misma función pura y no con una fórmula copiada.
 */
describe('Decameron · el margen lo pone el pantallazo, no una persona', () => {
  it('el costo es «a pagar agencia» y el margen deja el precio en lo que paga el cliente', async () => {
    tablas.items.push(itemHotelLiquidacion())
    const r = await confirmarTarifaPorPasajero('item-liquidacion', null)
    expect(r).toMatchObject({ success: true })

    // El costo repartido suma exactamente el «total a pagar agencia» leído (hallazgo 7.1).
    const costo = tablas.rubros.reduce((a, x) => a + Number(x.cantidad) * Number(x.valor_unitario), 0)
    expect(costo).toBe(1818919)

    const item = itemEnBase('item-liquidacion')
    expect(Number(item.margen_porcentaje)).toBeCloseTo(10.359, 3)
    expect(Math.round(precioConMargen(costo, Number(item.margen_porcentaje), 'sobre_venta'))).toBe(2029118)

    // 10,36% está por encima del piso de 5%: el gate de margen no tiene nada que frenar.
    expect(nivelDeMargen(Number(item.margen_porcentaje), POLITICA_MARGEN_POR_DEFECTO)).toBe('ok')

    // Queda registrado de dónde salió, para que la pantalla lo pueda decir.
    expect(leerTarifaPax(r.tarifa).confirmada?.margenProveedor).toMatchObject({
      precioCliente: 2029118,
      costoAgencia: 1818919,
    })
  })

  it('en una cotización «markup» se escribe el OTRO número, y el precio sigue siendo el mismo', async () => {
    convencionDeLaCotizacion = 'markup'
    tablas.items.push(itemHotelLiquidacion())
    await confirmarTarifaPorPasajero('item-liquidacion', null)

    const item = itemEnBase('item-liquidacion')
    expect(Number(item.margen_porcentaje)).toBeCloseTo(11.556, 3)
    expect(Math.round(precioConMargen(1818919, Number(item.margen_porcentaje), 'markup'))).toBe(2029118)
  })

  it('un pantallazo con UN solo precio no escribe margen: la línea hereda el de la cotización', async () => {
    tablas.items.push(itemVueloConLectura('PRUEBA Vuelo LATAM'))
    await confirmarTarifaPorPasajero('item-vuelo', null)
    expect(itemEnBase('item-vuelo').margen_porcentaje).toBeUndefined()
  })

  // El precio escrito a mano manda sobre el margen (`margen-vista.ts`): tocar el campo no
  // movería el precio y dejaría en pantalla un porcentaje que no gobierna nada.
  it('con el precio escrito a mano no se toca el margen', async () => {
    tablas.items.push(itemHotelLiquidacion({ precio_manual: true, margen_porcentaje: 25 }))
    await confirmarTarifaPorPasajero('item-liquidacion', null)
    expect(Number(itemEnBase('item-liquidacion').margen_porcentaje)).toBe(25)
  })

  /**
   * El caso que obliga a guardar `margenProveedor`: volver a leer la MISMA línea con una
   * captura que ya no trae los dos precios. Sin esto quedaría un margen viejo gobernando
   * un costo nuevo, y nadie podría saber que no lo puso una persona.
   */
  it('re-leer con una captura de un solo precio RETIRA el margen que había puesto la anterior', async () => {
    tablas.items.push(itemHotelLiquidacion())
    await confirmarTarifaPorPasajero('item-liquidacion', null)
    expect(Number(itemEnBase('item-liquidacion').margen_porcentaje)).toBeCloseTo(10.359, 3)

    // Misma línea, otra captura: mismo total, sin «total a pagar agencia».
    const item = itemEnBase('item-liquidacion')
    const tarifa = structuredClone(item.tarifa_pax) as {
      casillas: { grupo_completo: { aPagarAgencia: number | null; leidaEn: string } }
    }
    tarifa.casillas.grupo_completo.aPagarAgencia = null
    tarifa.casillas.grupo_completo.leidaEn = '2026-09-17T15:00:00.000Z'
    item.tarifa_pax = tarifa

    await confirmarTarifaPorPasajero('item-liquidacion', null)
    expect(itemEnBase('item-liquidacion').margen_porcentaje).toBeNull()
  })

  /**
   * La condición dura del brief del 2026-09-19: lo que dijo la captura NO se pierde
   * nunca, ni siquiera cuando no se aplica.
   *
   * Antes se descartaba en cuanto la línea tenía precio escrito a mano, y con eso
   * desaparecía el único número que permite responder «cuánto me moví de lo que el
   * proveedor me daba» — no está guardado en ninguna otra parte.
   */
  it('con precio a mano el margen NO se aplica, pero el número de la captura queda anotado', async () => {
    tablas.items.push(itemHotelLiquidacion({ precio_manual: true, margen_porcentaje: 25 }))
    const r = await confirmarTarifaPorPasajero('item-liquidacion', null)
    expect(Number(itemEnBase('item-liquidacion').margen_porcentaje)).toBe(25)
    expect(leerTarifaPax(r.tarifa).confirmada?.margenProveedor).toMatchObject({
      precioCliente: 2029118,
      costoAgencia: 1818919,
    })
  })

  /**
   * El reverso de «re-leer retira el margen»: si entre las dos capturas una PERSONA movió
   * el margen, esa decisión no se borra. Retirarlo lo decide el número, no la existencia
   * de una captura anterior — desde que `margenProveedor` se guarda siempre, esa marca ya
   * no distingue quién puso lo que hay escrito.
   */
  it('un margen que MOVIÓ una persona NO lo retira la captura siguiente', async () => {
    tablas.items.push(itemHotelLiquidacion())
    await confirmarTarifaPorPasajero('item-liquidacion', null)

    // Alguien lo sube al 18% y después se vuelve a leer con una captura de un solo precio.
    const item = itemEnBase('item-liquidacion')
    item.margen_porcentaje = 18
    const tarifa = structuredClone(item.tarifa_pax) as {
      casillas: { grupo_completo: { aPagarAgencia: number | null; leidaEn: string } }
    }
    tarifa.casillas.grupo_completo.aPagarAgencia = null
    tarifa.casillas.grupo_completo.leidaEn = '2026-09-19T15:00:00.000Z'
    item.tarifa_pax = tarifa

    await confirmarTarifaPorPasajero('item-liquidacion', null)
    expect(Number(itemEnBase('item-liquidacion').margen_porcentaje)).toBe(18)
  })
})
