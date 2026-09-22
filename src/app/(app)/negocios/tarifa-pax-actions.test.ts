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
/** Quiénes viajan (etapa 1). `null` = el negocio no lo declaró. */
let composicionDelViaje: { adultos: number; ninos: number; infantes: number } | null = null

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
    viaje: { composicion: composicionDelViaje, fechas: { inicio: '2026-12-12', fin: '2026-12-16' } },
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

const {
  actualizarComposicionDeItem,
  confirmarTarifaPorPasajero,
  corregirCampoDeFicha,
  elegirMonedaDeTarifa,
  leerCasillaDeItem,
  quitarCasillaDeItem,
} = await import('./tarifa-pax-actions')
const { hotelesDeItems, vuelosDeItems } = await import('@/lib/cotizaciones/detalle-viaje')
const {
  capturasDesactualizadas,
  confirmacionDesactualizada,
  leerTarifaPax,
  monedaDeTarifa,
  tarifaMasReciente,
} = await import('@/lib/cotizaciones/tarifa-pasajero')
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
  composicionDelViaje = null
})

/**
 * El bloqueo que abrió el frente del 2026-09-21: la línea no tiene composición y el negocio
 * tampoco, así que hasta ese día no había dónde pegar y la acción rechazaba con
 * `SIN_COMPOSICION`. Ahora la casilla 1 se puede pegar siempre y la ocupación sale de ella.
 */
describe('§2.1 y §2.4 · se pega primero y la ocupación sale de la captura', () => {
  const sinComposicion = (): Fila => ({
    id: 'item-hotel',
    cotizacion_id: 'cot-1',
    grupo: 'hotel',
    nombre: 'Hotel',
    descripcion: null,
  })

  it('sin composición en la línea NI en el viaje, la lectura entra y fija a quién cubre', async () => {
    tablas.items.push(sinComposicion())
    const r = await leerCasillaDeItem('item-hotel', 'grupo_completo', 'data:image/png;base64,AAAA', 'COP')
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const enBase = leerTarifaPax(itemEnBase('item-hotel').tarifa_pax)
    expect(enBase.casillas?.grupo_completo?.total).toBe(2029118)
    // Nadie escribió esto: sale de `ocupacion_adultos`, `ocupacion_ninos` y `ocupacion_infantes`.
    expect(enBase.composicion).toEqual({ adultos: 2, ninos: 0, infantes: 1 })
  })

  it('el NOMBRE nace lleno desde la lectura, sin esperar a confirmar', async () => {
    tablas.items.push(sinComposicion())
    await leerCasillaDeItem('item-hotel', 'grupo_completo', 'data:image/png;base64,AAAA', 'COP')
    expect(itemEnBase('item-hotel').nombre).toBe('DECAMERON CARTAGENA · CARTAGENA')
  })

  it('un nombre que escribió una persona NO lo pisa la lectura', async () => {
    tablas.items.push({ ...sinComposicion(), nombre: 'PRUEBA Decameron' })
    await leerCasillaDeItem('item-hotel', 'grupo_completo', 'data:image/png;base64,AAAA', 'COP')
    expect(itemEnBase('item-hotel').nombre).toBe('PRUEBA Decameron')
  })

  /**
   * El viaje lleva 6 adultos, 1 niño y 1 infante y la captura cubre a 3. Hasta hoy TP3
   * rechazaba la captura; ahora la ocupación de la línea es la de la captura y lo que falta
   * se reporta en pantalla (`faltanPorAcomodar`), que es lo que el diseño pide: la
   * partición manda.
   */
  it('la captura manda sobre la composición del VIAJE mientras nadie la haya ajustado', async () => {
    composicionDelViaje = { adultos: 6, ninos: 1, infantes: 1 }
    tablas.items.push(sinComposicion())
    const r = await leerCasillaDeItem('item-hotel', 'grupo_completo', 'data:image/png;base64,AAAA', 'COP')
    expect(r.ok).toBe(true)
    expect(leerTarifaPax(itemEnBase('item-hotel').tarifa_pax).composicion).toEqual({ adultos: 2, ninos: 0, infantes: 1 })
  })

  /**
   * El reverso: si alguien AJUSTÓ la ocupación en la línea, esa decisión no se borra sola.
   * La captura tiene que coincidir con ella (TP3) o se rechaza.
   */
  it('una composición ajustada a mano NO la pisa la captura siguiente', async () => {
    tablas.items.push({
      ...sinComposicion(),
      tarifa_pax: { composicion: { adultos: 2, ninos: 1, infantes: 0 } },
    })
    const r = await leerCasillaDeItem('item-hotel', 'grupo_completo', 'data:image/png;base64,AAAA', 'COP')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe('TP3')
    expect(leerTarifaPax(itemEnBase('item-hotel').tarifa_pax).composicion).toEqual({ adultos: 2, ninos: 1, infantes: 0 })
  })

  /**
   * La captura no dice a cuántos cubre: la lectura QUEDA GUARDADA, la pregunta sale después
   * y responderla no borra el pantallazo. Sin esto habría que pegar la misma imagen dos
   * veces, que es justo lo que el frente vino a quitar.
   */
  it('sin ocupación legible se guarda igual, se pregunta después, y responder no borra la lectura', async () => {
    lecturaDelModelo = {
      ...decameronResultado(),
      campos: {
        ...decameronResultado().campos,
        ocupacion: v(null, 0),
        ocupacion_adultos: v(null, 0),
        ocupacion_ninos: v(null, 0),
        ocupacion_infantes: v(null, 0),
      },
    }
    tablas.items.push(sinComposicion())

    const r = await leerCasillaDeItem('item-hotel', 'grupo_completo', 'data:image/png;base64,AAAA', 'COP')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.mensaje).toContain('no dice a cuántos pasajeros cubre')
    expect(leerTarifaPax(itemEnBase('item-hotel').tarifa_pax).casillas?.grupo_completo?.total).toBe(2029118)

    const guardada = await actualizarComposicionDeItem('item-hotel', { adultos: 2, ninos: 0, infantes: 1 })
    expect(guardada.success).toBe(true)
    const enBase = leerTarifaPax(itemEnBase('item-hotel').tarifa_pax)
    expect(enBase.composicion).toEqual({ adultos: 2, ninos: 0, infantes: 1 })
    expect(enBase.casillas?.grupo_completo?.total).toBe(2029118)
  })

  it('las casillas complementarias siguen necesitando saber a quién cubre la línea', async () => {
    tablas.items.push(sinComposicion())
    const r = await leerCasillaDeItem('item-hotel', 'solo_adultos', 'data:image/png;base64,AAAA', 'COP')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe('SIN_COMPOSICION')
  })
})

/**
 * El hueco del brief del 2026-09-22 (parte 1, punto 2): la línea no tiene composición
 * propia, hereda la del VIAJE, y alguien cambia los pasajeros del viaje DESPUÉS de pegar.
 *
 * Hasta hoy la captura vieja se seguía usando sin aviso: `resolverTarifa`, caso «solo
 * adultos», dividía el precio buscado para 2 adultos entre 3, y la confirmación escribía
 * ese costo en los rubros. La cotización salía con el precio mal y nada lo decía.
 */
describe('el hueco · los pasajeros del VIAJE cambian y la línea que los hereda', () => {
  const PNG = 'data:image/png;base64,AAAA'
  const dosAdultos = (): LecturaCruda => ({
    ...decameronResultado(),
    campos: {
      ...decameronResultado().campos,
      ocupacion: v('2 adultos'),
      ocupacion_adultos: v('2'),
      ocupacion_ninos: v('0'),
      ocupacion_infantes: v('0'),
      moneda: v('COP'),
      precio_total: v('2000000'),
    },
  })
  const heredaDelViaje = (): Fila => ({
    id: 'item-hotel',
    cotizacion_id: 'cot-1',
    grupo: 'hotel',
    nombre: 'Hotel',
    descripcion: null,
  })

  it('la captura buscada para 2 adultos NO se reparte entre 3 al confirmar', async () => {
    composicionDelViaje = { adultos: 2, ninos: 0, infantes: 0 }
    lecturaDelModelo = dosAdultos()
    tablas.items.push(heredaDelViaje())

    const leida = await leerCasillaDeItem('item-hotel', 'grupo_completo', PNG)
    expect(leida.ok).toBe(true)
    // La captura coincidía con el viaje: la línea sigue HEREDANDO, no fija nada propio.
    expect(leerTarifaPax(itemEnBase('item-hotel').tarifa_pax).composicion).toBeNull()

    composicionDelViaje = { adultos: 3, ninos: 0, infantes: 0 }
    const r = await confirmarTarifaPorPasajero('item-hotel', null)

    expect(r.success).toBe(false)
    expect(r.error).toContain('Este pantallazo es para 2 adultos y la línea ahora cubre 3 adultos')
    // Y nada entró al costo: el precio de 2 no se dividió entre 3.
    expect(tablas.rubros).toEqual([])
  })

  it('la captura NO se borra, se marca; pegar la nueva quita la alerta y deja confirmar', async () => {
    composicionDelViaje = { adultos: 2, ninos: 0, infantes: 0 }
    lecturaDelModelo = dosAdultos()
    tablas.items.push(heredaDelViaje())
    await leerCasillaDeItem('item-hotel', 'grupo_completo', PNG)
    // Se anota para quiénes se buscó: es lo que permite decir después que quedó vieja.
    expect(leerTarifaPax(itemEnBase('item-hotel').tarifa_pax).casillas?.grupo_completo?.paraComposicion)
      .toEqual({ adultos: 2, ninos: 0, infantes: 0 })

    composicionDelViaje = { adultos: 3, ninos: 0, infantes: 0 }
    const vieja = leerTarifaPax(itemEnBase('item-hotel').tarifa_pax)
    expect(vieja.casillas?.grupo_completo?.total).toBe(2000000)
    expect(capturasDesactualizadas({ adultos: 3, ninos: 0, infantes: 0 }, vieja.casillas ?? {}, 'hotel_detalle'))
      .toHaveLength(1)

    // La captura nueva, buscada para 3.
    const tres = dosAdultos()
    tres.campos.ocupacion = v('3 adultos')
    tres.campos.ocupacion_adultos = v('3')
    tres.campos.precio_total = v('2700000')
    lecturaDelModelo = tres
    const r = await leerCasillaDeItem('item-hotel', 'grupo_completo', PNG)
    expect(r.ok).toBe(true)
    const nueva = leerTarifaPax(itemEnBase('item-hotel').tarifa_pax)
    expect(capturasDesactualizadas({ adultos: 3, ninos: 0, infantes: 0 }, nueva.casillas ?? {}, 'hotel_detalle'))
      .toEqual([])

    const conf = await confirmarTarifaPorPasajero('item-hotel', null)
    expect(conf.success).toBe(true)
    expect(tablas.rubros.map(x => [x.descripcion, x.cantidad, x.valor_unitario])).toEqual([['Adulto', 3, 900000]])
  })

  it('cambiar los pasajeros DE LA LÍNEA tampoco borra: la lectura queda y la confirmación se niega', async () => {
    composicionDelViaje = { adultos: 2, ninos: 0, infantes: 0 }
    lecturaDelModelo = dosAdultos()
    tablas.items.push(heredaDelViaje())
    await leerCasillaDeItem('item-hotel', 'grupo_completo', PNG)

    const cambio = await actualizarComposicionDeItem('item-hotel', { adultos: 3, ninos: 0, infantes: 0 })
    expect(cambio.success).toBe(true)
    expect(cambio.desactualizadas).toBe(1)
    expect(leerTarifaPax(itemEnBase('item-hotel').tarifa_pax).casillas?.grupo_completo?.total).toBe(2000000)

    const r = await confirmarTarifaPorPasajero('item-hotel', null)
    expect(r.success).toBe(false)
    expect(r.error).toContain('Este pantallazo es para 2 adultos y la línea ahora cubre 3 adultos')
  })

  it('con el costo ya confirmado, cambiar el viaje marca la confirmación y no toca los rubros', async () => {
    composicionDelViaje = { adultos: 2, ninos: 0, infantes: 0 }
    lecturaDelModelo = dosAdultos()
    tablas.items.push(heredaDelViaje())
    await leerCasillaDeItem('item-hotel', 'grupo_completo', PNG)
    expect((await confirmarTarifaPorPasajero('item-hotel', null)).success).toBe(true)
    const rubrosAntes = structuredClone(tablas.rubros)

    const t = leerTarifaPax(itemEnBase('item-hotel').tarifa_pax)
    expect(confirmacionDesactualizada(t, { adultos: 2, ninos: 0, infantes: 0 })).toBeNull()
    expect(confirmacionDesactualizada(t, { adultos: 3, ninos: 0, infantes: 0 })?.mensaje)
      .toContain('El costo cargado es para 2 adultos y la línea ahora cubre 3 adultos')
    // Lo aprobado sigue siendo el costo de la línea hasta que alguien confirme otro.
    expect(tablas.rubros).toEqual(rubrosAntes)
  })

  it('responder a cuántos cubre una captura sin ocupación la ANOTA: un cambio posterior sí se detecta', async () => {
    lecturaDelModelo = {
      ...dosAdultos(),
      campos: {
        ...dosAdultos().campos,
        ocupacion: v(null, 0),
        ocupacion_adultos: v(null, 0),
        ocupacion_ninos: v(null, 0),
        ocupacion_infantes: v(null, 0),
      },
    }
    tablas.items.push(heredaDelViaje())
    await leerCasillaDeItem('item-hotel', 'grupo_completo', PNG)
    expect(leerTarifaPax(itemEnBase('item-hotel').tarifa_pax).casillas?.grupo_completo?.paraComposicion).toBeUndefined()

    await actualizarComposicionDeItem('item-hotel', { adultos: 2, ninos: 0, infantes: 0 })
    expect(leerTarifaPax(itemEnBase('item-hotel').tarifa_pax).casillas?.grupo_completo?.paraComposicion)
      .toEqual({ adultos: 2, ninos: 0, infantes: 0 })

    await actualizarComposicionDeItem('item-hotel', { adultos: 4, ninos: 0, infantes: 0 })
    const r = await confirmarTarifaPorPasajero('item-hotel', null)
    expect(r.success).toBe(false)
    expect(r.error).toContain('Este pantallazo es para 2 adultos y la línea ahora cubre 4 adultos')
  })
})

/**
 * Brief del 2026-09-22, parte 2: la moneda de la tarifa se puede elegir, por defecto COP, y
 * una captura sin moneda ya no se rechaza (RX3) sino que queda con COP SUPUESTA hasta que una
 * persona la acepte o la cambie. Tres casos que pide el brief —COP, USD con tasa, moneda
 * cambiada tras confirmar— y los frenos alrededor.
 */
describe('la moneda de la tarifa · editable, COP por defecto, y nunca callada', () => {
  const PNG = 'data:image/png;base64,AAAA'
  const dosAdultos = (moneda: string | null, precio = '2000000'): LecturaCruda => ({
    ...decameronResultado(),
    campos: {
      ...decameronResultado().campos,
      ocupacion: v('2 adultos'),
      ocupacion_adultos: v('2'),
      ocupacion_ninos: v('0'),
      ocupacion_infantes: v('0'),
      moneda: moneda === null ? v(null, 0) : v(moneda),
      precio_total: v(precio),
    },
  })
  const linea = (): Fila => ({
    id: 'item-hotel',
    cotizacion_id: 'cot-1',
    grupo: 'hotel',
    nombre: 'Hotel',
    descripcion: null,
    tarifa_pax: { composicion: { adultos: 2, ninos: 0, infantes: 0 } },
  })
  const unitarios = () => tablas.rubros.map(x => [x.descripcion, x.cantidad, x.valor_unitario])

  it('COP: la captura la muestra y el costo entra en pesos, sin tasa', async () => {
    lecturaDelModelo = dosAdultos('COP')
    tablas.items.push(linea())
    await leerCasillaDeItem('item-hotel', 'grupo_completo', PNG)
    const r = await confirmarTarifaPorPasajero('item-hotel', null)
    expect(r.success).toBe(true)
    expect(unitarios()).toEqual([['Adulto', 2, 1000000]])
    expect(leerTarifaPax(r.tarifa).confirmada).toMatchObject({ moneda: 'COP', tasa: null })
  })

  it('USD con tasa: sin tasa no se confirma; con tasa el costo entra convertido', async () => {
    lecturaDelModelo = dosAdultos('USD', '1000')
    tablas.items.push(linea())
    await leerCasillaDeItem('item-hotel', 'grupo_completo', PNG)

    const sinTasa = await confirmarTarifaPorPasajero('item-hotel', null)
    expect(sinTasa.success).toBe(false)
    expect(sinTasa.error).toContain('falta la tasa de cambio')
    expect(tablas.rubros).toEqual([])

    const r = await confirmarTarifaPorPasajero('item-hotel', 4000)
    expect(r.success).toBe(true)
    expect(unitarios()).toEqual([['Adulto', 2, 2000000]])
    expect(leerTarifaPax(r.tarifa).confirmada).toMatchObject({ moneda: 'USD', tasa: 4000 })
  })

  it('sin moneda en la captura: se guarda con COP SUPUESTA y no se confirma hasta aceptarla', async () => {
    lecturaDelModelo = dosAdultos(null)
    tablas.items.push(linea())
    const leida = await leerCasillaDeItem('item-hotel', 'grupo_completo', PNG)
    expect(leida.ok).toBe(true)
    const t = leerTarifaPax(itemEnBase('item-hotel').tarifa_pax)
    expect(t.casillas?.grupo_completo).toMatchObject({ moneda: 'COP', monedaAsumida: true })
    expect(monedaDeTarifa(t)).toMatchObject({ moneda: 'COP', asumida: true })

    const bloqueada = await confirmarTarifaPorPasajero('item-hotel', null)
    expect(bloqueada.success).toBe(false)
    expect(bloqueada.error).toContain('se asumió COP')
    expect(tablas.rubros).toEqual([])

    // Un clic: «es COP».
    const aceptada = await elegirMonedaDeTarifa('item-hotel', 'COP')
    expect(aceptada.success).toBe(true)
    const tras = leerTarifaPax(itemEnBase('item-hotel').tarifa_pax)
    expect(tras.moneda).toMatchObject({ valor: 'COP' })
    expect(tras.moneda?.en).toBeTruthy()
    // Lo que dijo la IA (nada) sigue anotado en la casilla.
    expect(tras.casillas?.grupo_completo?.monedaAsumida).toBe(true)

    const r = await confirmarTarifaPorPasajero('item-hotel', null)
    expect(r.success).toBe(true)
    expect(unitarios()).toEqual([['Adulto', 2, 1000000]])
  })

  it('«$» que en realidad era USD: la persona la cambia y el costo pide tasa', async () => {
    lecturaDelModelo = dosAdultos(null, '1000')
    tablas.items.push(linea())
    await leerCasillaDeItem('item-hotel', 'grupo_completo', PNG)
    await elegirMonedaDeTarifa('item-hotel', 'usd')

    expect((await confirmarTarifaPorPasajero('item-hotel', null)).success).toBe(false)
    const r = await confirmarTarifaPorPasajero('item-hotel', 4100)
    expect(r.success).toBe(true)
    expect(unitarios()).toEqual([['Adulto', 2, 2050000]])
  })

  it('moneda cambiada DESPUÉS de confirmar: la confirmación queda desactualizada y hay que volver a confirmar con tasa', async () => {
    lecturaDelModelo = dosAdultos('COP', '1000')
    tablas.items.push(linea())
    await leerCasillaDeItem('item-hotel', 'grupo_completo', PNG)
    expect((await confirmarTarifaPorPasajero('item-hotel', null)).success).toBe(true)
    expect(unitarios()).toEqual([['Adulto', 2, 500]])

    const cambio = await elegirMonedaDeTarifa('item-hotel', 'USD')
    expect(cambio.success).toBe(true)
    expect(cambio.confirmacionDesactualizada).toBe(true)
    const t = leerTarifaPax(itemEnBase('item-hotel').tarifa_pax)
    expect(confirmacionDesactualizada(t, { adultos: 2, ninos: 0, infantes: 0 })?.mensaje)
      .toContain('El costo se cargó en COP y la tarifa ahora está en USD')
    // Lo que dijo la IA sigue siendo COP en la casilla; los rubros no se tocaron.
    expect(t.casillas?.grupo_completo?.moneda).toBe('COP')
    expect(unitarios()).toEqual([['Adulto', 2, 500]])

    expect((await confirmarTarifaPorPasajero('item-hotel', null)).success).toBe(false)
    const r = await confirmarTarifaPorPasajero('item-hotel', 4000)
    expect(r.success).toBe(true)
    expect(unitarios()).toEqual([['Adulto', 2, 2000000]])
    expect(confirmacionDesactualizada(leerTarifaPax(r.tarifa), { adultos: 2, ninos: 0, infantes: 0 })).toBeNull()
  })

  it('un pantallazo 1 nuevo retira la moneda elegida: es otra búsqueda', async () => {
    lecturaDelModelo = dosAdultos(null)
    tablas.items.push(linea())
    await leerCasillaDeItem('item-hotel', 'grupo_completo', PNG)
    await elegirMonedaDeTarifa('item-hotel', 'USD')
    expect(leerTarifaPax(itemEnBase('item-hotel').tarifa_pax).moneda?.valor).toBe('USD')

    await leerCasillaDeItem('item-hotel', 'grupo_completo', PNG)
    const t = leerTarifaPax(itemEnBase('item-hotel').tarifa_pax)
    expect(t.moneda).toBeUndefined()
    expect(monedaDeTarifa(t)).toMatchObject({ moneda: 'COP', asumida: true })
  })

  it('un código que no es moneda no se guarda', async () => {
    lecturaDelModelo = dosAdultos(null)
    tablas.items.push(linea())
    await leerCasillaDeItem('item-hotel', 'grupo_completo', PNG)
    const r = await elegirMonedaDeTarifa('item-hotel', 'pesos')
    expect(r.success).toBe(false)
    expect(leerTarifaPax(itemEnBase('item-hotel').tarifa_pax).moneda).toBeUndefined()
  })
})

describe('hallazgo 1 · elegir la moneda deja la casilla igual que pegar directo', () => {
  // ⚠️ Hasta el 2026-09-22 una captura sin moneda se RECHAZABA (RX3) y no guardaba nada. El
  // brief de ese día la vuelve un «se guarda con COP supuesta»: ver el bloque de la moneda.
  it('sin moneda ya no se rechaza; con COP indicada guarda y DEVUELVE lo guardado', async () => {
    tablas.items.push(itemHotel('PRUEBA Hotel Decameron'))

    const sinMoneda = await leerCasillaDeItem('item-hotel', 'grupo_completo', 'data:image/png;base64,AAAA')
    expect(sinMoneda.ok).toBe(true)
    expect(leerTarifaPax(itemEnBase('item-hotel').tarifa_pax).casillas?.grupo_completo?.monedaAsumida).toBe(true)

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

/**
 * Brief del 2026-09-22, punto 3 y verificación 4: editar las estrellas, una hora de vuelo y el
 * equipaje; el documento muestra lo editado, lo que dijo la IA sigue guardado, y releer la
 * captura no lo pisa. Se afirma lo que quedó ESCRITO en `items`, leído como lo lee el
 * documento (`hotelesDeItems`, `vuelosDeItems`).
 */
describe('corregir la ficha · lo que dijo la IA no se pierde y releer no lo pisa', () => {
  const lecturaHotel = (): LecturaCruda => {
    const l = decameronResultado()
    l.campos.moneda = v('COP')
    l.campos.estrellas = v('3', 0.9)
    return l
  }
  const docHotel = () => hotelesDeItems([{ nombre: 'x', grupo: 'hotel', tarifa_pax: itemEnBase('item-hotel').tarifa_pax }])[0]

  it('corregir las estrellas: el documento imprime la corrección y la lectura queda intacta', async () => {
    tablas.items.push(itemHotel('Hotel'))
    lecturaDelModelo = lecturaHotel()
    await leerCasillaDeItem('item-hotel', 'grupo_completo', 'data:image/png;base64,AAAA')
    expect(docHotel().estrellas).toBe(3)

    const r = await corregirCampoDeFicha('item-hotel', 'estrellas', '4')
    expect(r.success).toBe(true)
    const t = leerTarifaPax(itemEnBase('item-hotel').tarifa_pax)
    expect(t.correcciones?.estrellas?.valor).toBe('4')
    expect(t.casillas?.grupo_completo?.campos.find(c => c.label === 'Estrellas')?.valor).toBe('3')
    expect(docHotel().estrellas).toBe(4)
  })

  it('releer el pantallazo reemplaza la lectura pero NO la corrección', async () => {
    tablas.items.push(itemHotel('Hotel'))
    lecturaDelModelo = lecturaHotel()
    await leerCasillaDeItem('item-hotel', 'grupo_completo', 'data:image/png;base64,AAAA')
    await corregirCampoDeFicha('item-hotel', 'estrellas', '4')
    await corregirCampoDeFicha('item-hotel', 'regimen', 'Solo alojamiento')

    // La captura nueva dice otra cosa de los dos campos.
    const nueva = lecturaHotel()
    nueva.campos.estrellas = v('5', 0.9)
    nueva.campos.regimen = v('Desayuno')
    lecturaDelModelo = nueva
    const r = await leerCasillaDeItem('item-hotel', 'grupo_completo', 'data:image/png;base64,BBBB')
    expect(r.ok).toBe(true)

    const t = leerTarifaPax(itemEnBase('item-hotel').tarifa_pax)
    // La lectura es la nueva…
    expect(t.casillas?.grupo_completo?.campos.find(c => c.label === 'Estrellas')?.valor).toBe('5')
    expect(t.casillas?.grupo_completo?.campos.find(c => c.label === 'Régimen')?.valor).toBe('Desayuno')
    // …y lo que corrigió la persona sigue mandando.
    expect(t.correcciones?.estrellas?.valor).toBe('4')
    expect(docHotel()).toMatchObject({ estrellas: 4, regimen: 'Solo alojamiento' })
  })

  it('«volver a lo leído» quita la corrección y el documento vuelve a la lectura', async () => {
    tablas.items.push(itemHotel('Hotel'))
    lecturaDelModelo = lecturaHotel()
    await leerCasillaDeItem('item-hotel', 'grupo_completo', 'data:image/png;base64,AAAA')
    await corregirCampoDeFicha('item-hotel', 'estrellas', '4')
    await corregirCampoDeFicha('item-hotel', 'estrellas', null)
    expect(leerTarifaPax(itemEnBase('item-hotel').tarifa_pax).correcciones).toBeUndefined()
    expect(docHotel().estrellas).toBe(3)
  })

  it('lo que entra al costo no se corrige en la ficha, y un valor inválido no se guarda', async () => {
    tablas.items.push(itemHotel('Hotel'))
    const antes = structuredClone(itemEnBase('item-hotel').tarifa_pax)
    expect((await corregirCampoDeFicha('item-hotel', 'precio_total', '1')).success).toBe(false)
    expect((await corregirCampoDeFicha('item-hotel', 'estrellas', '4,5')).success).toBe(false)
    expect((await corregirCampoDeFicha('item-hotel', 'no_existe', 'x')).success).toBe(false)
    expect(itemEnBase('item-hotel').tarifa_pax).toEqual(antes)
  })

  // ── Vuelo: la hora y el equipaje, y la descripción que no se pisa ──────────

  function itemVueloConFicha(descripcion: string | null = null): Fila {
    const f = itemVueloConLectura('')
    const tp = f.tarifa_pax as { casillas: { grupo_completo: { campos: unknown; descripcion: string } } }
    tp.casillas.grupo_completo.campos = [
      { label: 'Aerolínea', valor: 'LATAM' },
      { label: 'Salida', valor: '2026-10-01' },
      { label: 'Hora de salida (ida)', valor: '05:50' },
      { label: 'Escalas', valor: '0' },
      { label: 'Artículo personal', valor: 'true' },
      { label: 'Equipaje de mano', valor: 'false' },
      { label: 'Equipaje de bodega', valor: 'false' },
    ]
    tp.casillas.grupo_completo.descripcion =
      'Salida: 2026-10-01 05:50 · Directo · Solo artículo personal (sin equipaje de mano ni de bodega)'
    return { ...f, descripcion }
  }
  const docVuelo = () => vuelosDeItems([{ nombre: 'x', grupo: 'vuelo', tarifa_pax: itemEnBase('item-vuelo').tarifa_pax }])[0]

  it('corregir la hora y el equipaje: el documento los muestra y la descripción del sistema se rearma', async () => {
    tablas.items.push(itemVueloConFicha())
    await confirmarTarifaPorPasajero('item-vuelo', null)
    expect(itemEnBase('item-vuelo').descripcion).toContain('05:50')

    await corregirCampoDeFicha('item-vuelo', 'hora_salida', '7:45 am')
    await corregirCampoDeFicha('item-vuelo', 'equipaje_mano', 'true')
    expect(docVuelo()).toMatchObject({ horaSalida: '07:45', equipaje: 'artículo personal + equipaje de mano' })
    // La descripción la había escrito el sistema: se rearma con lo corregido.
    expect(itemEnBase('item-vuelo').descripcion).toContain('07:45')
    expect(itemEnBase('item-vuelo').descripcion).not.toContain('05:50')
    // La lectura sigue diciendo lo que dijo.
    const t = leerTarifaPax(itemEnBase('item-vuelo').tarifa_pax)
    expect(t.casillas?.grupo_completo?.campos.find(c => c.label === 'Hora de salida (ida)')?.valor).toBe('05:50')
  })

  it('una descripción que escribió una persona NO la pisa ni corregir un campo ni volver a confirmar', async () => {
    tablas.items.push(itemVueloConFicha())
    await confirmarTarifaPorPasajero('item-vuelo', null)
    itemEnBase('item-vuelo').descripcion = 'VUELO NOCTURNO, PEDIR SILLA DE VENTANA'

    await corregirCampoDeFicha('item-vuelo', 'hora_salida', '07:45')
    expect(itemEnBase('item-vuelo').descripcion).toBe('VUELO NOCTURNO, PEDIR SILLA DE VENTANA')

    // Hasta el 2026-09-22 volver a confirmar la reescribía siempre.
    const f = itemEnBase('item-vuelo')
    const tp = f.tarifa_pax as { casillas: { grupo_completo: { leidaEn: string } } }
    tp.casillas.grupo_completo.leidaEn = new Date().toISOString()
    await confirmarTarifaPorPasajero('item-vuelo', null)
    expect(itemEnBase('item-vuelo').descripcion).toBe('VUELO NOCTURNO, PEDIR SILLA DE VENTANA')
  })

  // ⚠️ Hasta el 2026-09-22 cambiar los pasajeros BORRABA la confirmación. Ahora se conserva
  // marcada como desactualizada (brief de ese día, parte 1); la marca de la descripción, igual.
  it('cambiar los pasajeros NO borra la confirmación ni la marca: la confirmación queda desactualizada', async () => {
    tablas.items.push(itemVueloConFicha())
    await confirmarTarifaPorPasajero('item-vuelo', null)
    const escrita = itemEnBase('item-vuelo').descripcion
    const r = await actualizarComposicionDeItem('item-vuelo', { adultos: 4, ninos: 1, infantes: 0 })
    expect(r.confirmacionDesactualizada).toBe(true)
    const t = leerTarifaPax(itemEnBase('item-vuelo').tarifa_pax)
    expect(t.confirmada?.composicion).toEqual({ adultos: 5, ninos: 1, infantes: 0 })
    expect(t.casillas?.grupo_completo?.total).toBe(11306378)
    expect(t.descripcionDelSistema).toBe(escrita)
  })

  it('una línea sin confirmar con una descripción escrita a mano: confirmar no la pisa', async () => {
    tablas.items.push(itemVueloConFicha('INCLUYE TRASLADO AL HOTEL'))
    await confirmarTarifaPorPasajero('item-vuelo', null)
    expect(itemEnBase('item-vuelo').descripcion).toBe('INCLUYE TRASLADO AL HOTEL')
  })
})
