/**
 * El DÍA parte el documento, y el total no se mueve. Medido sobre el PDF renderizado.
 *
 * Los cinco criterios de verificación del encargo se comprueban aquí, y ninguno se
 * recalcula: las cifras se LEEN del binario y los textos se buscan en lo que el
 * documento imprime. Recalcularlos desde los ítems heredaría el supuesto del código
 * que se quiere probar — la regla puede estar bien y el PDF imprimir otra cosa, que es
 * exactamente lo que pasó con el Subtotal en el #709.
 *
 * Corre contra las DOS funciones reales:
 *   1. `recalcularTotales`     → escribe `cotizaciones.valor_total` (el total en pantalla).
 *   2. `generateCotizacionPDF` → devuelve el PDF, y de ahí se lee el texto impreso.
 *
 * El arnés (doble de Supabase consciente de tabla y filtro, extractor de texto en HEX)
 * es el mismo de `cotizacion-alternativas-e2e.test.ts`. Está copiado y no importado
 * porque ahí vive dentro del archivo de pruebas; sacarlo a un módulo compartido es una
 * limpieza que no entra en este encargo.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { inflateSync } from 'node:zlib'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
/** Tablas que la base NO tiene. Devuelven el error de PostgREST, como en vivo. */
let ausentes = new Set<string>()

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(),
    workspaceId: 'ws-1',
    staffId: null,
    error: null,
  }),
}))

// Sin env vars del servicio externo, `generateCotizacionPDF` toma PATH B (@react-pdf),
// que es el que usa trappvel (`cotizacion_template_slug = 'metrik'`, medido en prod).
vi.mock('@/lib/pdf/pdf-render-client', () => ({
  isPdfRenderConfigured: () => false,
  renderViaService: async () => {
    throw new Error('no debería llamarse')
  },
}))

function clienteFalso() {
  return { from: (tabla: string) => constructor(tabla) }
}

function constructor(tabla: string) {
  const filtros: [string, unknown][] = []
  let operacion: 'select' | 'update' | 'delete' = 'select'
  let payload: Fila = {}
  let embebeRubros = false
  let embebeEmpresas = false
  let embebeOportunidades = false
  let embebeOpciones = false

  const aplica = (f: Fila) => filtros.every(([col, val]) => f[col] === val)

  const proyectar = (f: Fila) => {
    const salida: Fila = { ...f }
    if (embebeRubros) {
      // Se proyecta la fila ENTERA, como `rubros(*)`: si el codigo dejara de pedir
      // `sugerido`, el doble no lo taparia y la prueba de abajo caeria.
      salida.rubros = (tablas.rubros ?? []).filter(r => r.item_id === f.id).map(r => ({ ...r }))
    }
    if (embebeEmpresas) {
      salida.empresas = (tablas.empresas ?? []).find(e => e.id === f.empresa_id) ?? null
    }
    if (embebeOportunidades) salida.oportunidades = null
    if (embebeOpciones) {
      salida.itinerario_opciones = (tablas.itinerario_opciones ?? [])
        .filter(o => o.itinerario_id === f.id)
        .map(o => ({ item_id: o.item_id }))
    }
    return salida
  }

  const ejecutar = () => {
    if (ausentes.has(tabla)) {
      return {
        data: null,
        error: { code: '42P01', message: `relation "public.${tabla}" does not exist` },
      }
    }
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
      const c = typeof cols === 'string' ? cols : ''
      embebeRubros = c.includes('rubros(')
      embebeEmpresas = c.includes('empresas(')
      embebeOportunidades = c.includes('oportunidades(')
      embebeOpciones = c.includes('itinerario_opciones(')
      return api
    },
    update(p: Fila) {
      operacion = 'update'
      payload = p
      return api
    },
    delete() {
      operacion = 'delete'
      return api
    },
    eq(col: string, val: unknown) {
      filtros.push([col, val])
      return api
    },
    in(col: string, vals: unknown[]) {
      filtros.push([col, vals[0]])
      return api
    },
    // El doble NO ordena: ordenar aquí escondería que el código depende del orden que
    // le da la base. Existe porque la cadena lo pide.
    order() {
      return api
    },
    single() {
      const { data, error } = ejecutar()
      return Promise.resolve({ data: (data as Fila[] | null)?.[0] ?? null, error })
    },
    maybeSingle() {
      const { data, error } = ejecutar()
      return Promise.resolve({ data: (data as Fila[] | null)?.[0] ?? null, error })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(ejecutar()).then(resolve, reject)
    },
  }
  return api
}

import { recalcularTotales } from './cotizacion-actions'
import { generateCotizacionPDF } from './cotizacion-pdf-actions'

// ── Leer lo que el PDF de verdad imprime ─────────────────────────────────────

/**
 * El texto de un PDF de @react-pdf, sacado de sus flujos de contenido.
 *
 * pdfkit comprime los flujos con Flate, así que hay que inflarlos y leer los
 * operadores de texto. Es la única forma de medir lo que el cliente ve sin volver a
 * calcularlo: recalcularlo heredaría el supuesto del código que se está probando.
 */
function textoDelPDF(base64: string): string {
  const buf = Buffer.from(base64, 'base64')
  const trozos: string[] = []
  let desde = 0
  for (;;) {
    const ini = buf.indexOf('stream', desde)
    if (ini === -1) break
    let inicio = ini + 'stream'.length
    if (buf[inicio] === 0x0d) inicio++
    if (buf[inicio] === 0x0a) inicio++
    const fin = buf.indexOf('endstream', inicio)
    if (fin === -1) break
    try {
      trozos.push(inflateSync(buf.subarray(inicio, fin)).toString('latin1'))
    } catch {
      // Un flujo que no infla es una fuente embebida o una imagen: no lleva texto.
    }
    desde = fin + 1
  }
  const contenido = trozos.join('\n')

  // ⚠️ @react-pdf escribe el texto en HEX, no como cadena literal: una línea sale como
  // `[<53> 0 <7562746f74616c> 0] TJ`. Buscar solo `(...)` devolvía CERO piezas y la
  // prueba se leía como «el PDF no imprime Subtotal», que es un falso negativo.
  // Las fuentes de esta plantilla son Helvetica y Helvetica-Bold (las estándar de PDF,
  // sin empotrar), así que el código hexadecimal ES el código del carácter.
  const piezas: string[] = []
  const reOperador = /(\[[^\]]*\]\s*TJ|(?:<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\))\s*Tj)/g
  let op: RegExpExecArray | null
  while ((op = reOperador.exec(contenido)) !== null) {
    let linea = ''
    const reTrozo = /<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^\\)])*)\)/g
    let t: RegExpExecArray | null
    while ((t = reTrozo.exec(op[0])) !== null) {
      if (t[1] !== undefined) {
        const hex = t[1].replace(/\s+/g, '')
        for (let i = 0; i + 1 < hex.length; i += 2) {
          linea += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
        }
      } else {
        linea += (t[2] ?? '').replace(/\\([()\\])/g, '$1')
      }
    }
    piezas.push(linea)
  }
  return piezas.join(' ')
}

/**
 * El número que sigue a una etiqueta impresa, en formato colombiano (1.234.567).
 *
 * ⚠️ La etiqueta tiene que ser una PALABRA, no una subcadena. `TOTAL` aparece dentro
 * de `SUBTOTAL`, que es el encabezado de la columna de ítems: buscando por subcadena,
 * «el TOTAL del PDF» devolvía el precio del primer ítem y la prueba fallaba por el
 * instrumento, no por el documento.
 */
function cifraJuntoA(texto: string, etiqueta: string): number | null {
  const re = new RegExp(`(?:^|[^A-Za-zÁÉÍÓÚÑ])${etiqueta}\\s*\\$?\\s*([\\d.]{4,})`)
  const m = texto.match(re)
  return m ? Number(m[1].replace(/\./g, '')) : null
}

// ── Escenario ────────────────────────────────────────────────────────────────

const COT = 'cot-1'

/**
 * Un viaje de Trappvel: vuelo, hotel, traslado y dos tours.
 *
 * `dias` dice qué día lleva cada línea. `{}` = ninguna, que es el caso de las 20
 * cotizaciones que hoy existen en producción (medido el 2026-09-14).
 */
function sembrar(dias: Record<string, number> = {}, ocultos: string[] = []) {
  ausentes = new Set(['cotizacion_itinerarios', 'itinerario_opciones'])
  const item = (
    id: string,
    nombre: string,
    grupo: string | null,
    orden: number,
    costo: number,
  ): Fila => ({
    id,
    cotizacion_id: COT,
    nombre,
    descripcion: null,
    grupo,
    opcion_de: null,
    orden,
    es_ajuste: false,
    cantidad: 1,
    subtotal: costo,
    descuento_porcentaje: 0,
    margen_porcentaje: null,
    precio_venta: 0,
    precio_manual: false,
    unidad: null,
    dia_relativo: dias[id] ?? null,
    mostrar_en_sugeridos: !ocultos.includes(id),
  })

  tablas = {
    cotizaciones: [
      {
        id: COT,
        valor_total: 0,
        costo_total: 0,
        negocio_id: 'neg-1',
        oportunidad_id: null,
        margen_porcentaje: 13,
        margen_default_pct: 13,
        convencion_margen: 'sobre_venta',
        descuento_porcentaje: 0,
        aiu_admin_pct: 0,
        aiu_imprevistos_pct: 0,
        consecutivo: 'COT-2026-0007',
        codigo: 'COT-2026-0007',
        modo: 'detallada',
        descripcion: 'Punta Cana, 5 dias',
        fecha_envio: null,
        fecha_validez: null,
        condiciones_pago: null,
        notas: null,
        descuento_valor: 0,
        piso_margen_pct: 5,
        aviso_margen_pct: 10,
      },
    ],
    items: [
      item('avianca', 'Vuelos - Avianca', 'vuelo', 1, 2_000_000),
      item('hotel', 'Hotel Occidental', 'hotel', 2, 1_350_000),
      item('traslado', 'Traslado aeropuerto', 'traslado', 3, 200_000),
      item('saona', 'Tour Isla Saona', 'tour', 4, 540_000),
      item('catalina', 'Tour Isla Catalina', 'excursion', 5, 480_000),
    ],
    rubros: [],
    negocios: [{ id: 'neg-1', nombre: 'Punta Cana', carpeta_url: null, empresa_id: null }],
    empresas: [],
    workspaces: [{ id: 'ws-1', name: 'Trappvel', logo_url: null, color_primario: null, cotizacion_template_slug: 'metrik' }],
    fiscal_profiles: [],
    staff: [],
  }
}

async function medir() {
  await recalcularTotales(COT)
  const totalEnPantalla = Number((tablas.cotizaciones[0] as Fila).valor_total)

  const res = await generateCotizacionPDF(COT)
  expect(res.success).toBe(true)
  const texto = textoDelPDF((res as { pdf: string }).pdf)

  return {
    totalEnPantalla,
    subtotalPDF: cifraJuntoA(texto, 'Subtotal'),
    ivaPDF: cifraJuntoA(texto, 'IVA \\(19%\\)'),
    totalPDF: cifraJuntoA(texto, 'TOTAL'),
    texto,
  }
}

beforeEach(() => {
  tablas = {}
  ausentes = new Set()
})

describe('criterio 1 · sin un solo dia, el PDF sale IGUAL que hoy', () => {
  it('ni seccion de itinerario ni seccion de sugeridos', async () => {
    sembrar()
    const { totalEnPantalla, subtotalPDF, ivaPDF, totalPDF, texto } = await medir()

    // El control del frente entero: es la cotizacion de siempre.
    expect(totalEnPantalla).toBe(5_252_874)
    expect(subtotalPDF).toBe(5_252_874)
    expect(totalPDF).toBe((subtotalPDF ?? 0) + (ivaPDF ?? 0))

    // El encabezado de la tabla plana esta; los dos nuevos NO.
    expect(texto).toContain('DETALLE')
    expect(texto).not.toContain('ITINERARIO')
    expect(texto.toLowerCase()).not.toContain('actividades adicionales')
    expect(texto).not.toContain('DÍA 1')

    // Y las cinco lineas se imprimen, ninguna se fue a «no incluidas».
    for (const n of ['Vuelos - Avianca', 'Hotel Occidental', 'Traslado aeropuerto', 'Tour Isla Saona', 'Tour Isla Catalina']) {
      expect(texto).toContain(n)
    }
  }, 30_000)
})

describe('criterio 2 · dos tours con dia y uno sin dia', () => {
  it('el dia por dia imprime los dos, y el tercero sale al final como adicional', async () => {
    sembrar({ saona: 2, catalina: 3 })
    const { texto } = await medir()

    expect(texto).toContain('ITINERARIO')
    expect(texto).toContain('DÍA 2')  // en mayúscula y CON tilde: se leyó del documento
    expect(texto).toContain('DÍA 3')
    expect(texto).toContain('Tour Isla Saona')
    expect(texto).toContain('Tour Isla Catalina')

    // El traslado (grupo no combinable, sin dia) cae al paquete de sugeridos.
    expect(texto.toLowerCase()).toContain('actividades adicionales no incluidas')
    const seccion = texto.slice(texto.toLowerCase().indexOf('actividades adicionales'))
    expect(seccion).toContain('Traslado aeropuerto')
  }, 30_000)

  it('⚠️⚠️ una sugerencia se imprime UNA vez, no dos', async () => {
    // El defecto que cazó el documento renderizado y que ninguna prueba pura veía: sin
    // filtrar las sugerencias de `itemsSinDia`, el traslado salía en «Incluye también»
    // Y en «actividades adicionales no incluidas» — el mismo documento diciendo que
    // una línea está incluida y que no lo está.
    sembrar({ saona: 2, catalina: 3 })
    const { texto } = await medir()
    const apariciones = texto.split('Traslado aeropuerto').length - 1
    expect(apariciones).toBe(1)
  }, 30_000)

  it('el orden manda: el tour del dia 2 se imprime antes que el del dia 3', async () => {
    sembrar({ saona: 3, catalina: 2 })
    const { texto } = await medir()
    // Catalina lleva el dia 2, asi que va primero aunque su `orden` sea mayor.
    expect(texto.indexOf('Tour Isla Catalina')).toBeLessThan(texto.indexOf('Tour Isla Saona'))
  }, 30_000)
})

describe('criterio 4 · el dia es presentacion, NO precio', () => {
  it('el total NO cambia por asignar ni por quitar dias', async () => {
    sembrar()
    const sinDias = await medir()

    sembrar({ saona: 2, catalina: 3, traslado: 1 })
    const conDias = await medir()

    sembrar({ saona: 1 })
    const conUnDia = await medir()

    // Las tres cifras, identicas en los tres escenarios.
    expect(conDias.totalEnPantalla).toBe(sinDias.totalEnPantalla)
    expect(conUnDia.totalEnPantalla).toBe(sinDias.totalEnPantalla)
    expect(conDias.subtotalPDF).toBe(sinDias.subtotalPDF)
    expect(conUnDia.subtotalPDF).toBe(sinDias.subtotalPDF)
    expect(conDias.totalPDF).toBe(sinDias.totalPDF)
    expect(conUnDia.totalPDF).toBe(sinDias.totalPDF)
    expect(sinDias.totalEnPantalla).toBe(5_252_874)
  }, 60_000)

  it('el Subtotal impreso sigue cuadrando con el total en pantalla al repartir por dias', async () => {
    // La particion no puede perder una linea por el camino: `dias` + `itemsSinDia`
    // tienen que sumar exactamente lo que suma `items`.
    sembrar({ saona: 2, catalina: 3, traslado: 1 })
    const { totalEnPantalla, subtotalPDF, ivaPDF, totalPDF } = await medir()
    expect(subtotalPDF).toBe(totalEnPantalla)
    expect(totalPDF).toBe((subtotalPDF ?? 0) + (ivaPDF ?? 0))
  }, 30_000)
})

/** Lo que suma la columna impresa cuando el documento se organiza por dias. */
function sumaDeLaColumnaPorDias(texto: string): number {
  const tramo = texto.slice(texto.indexOf('ITINERARIO'), texto.indexOf(' Subtotal '))
  const importes = [...tramo.matchAll(/\$\s*([\d.]{4,})/g)]
  return importes.reduce((s, m) => s + Number(m[1].replace(/\./g, '')), 0)
}

describe('⚠️⚠️ la contradiccion que el aviso existe para evitar, medida', () => {
  it('con la sugerencia EN CERO, la columna impresa suma exactamente el Subtotal', () => {
    // El estado SANO: una sugerencia sin precio es una oferta, no una contradiccion.
    // Aqui el documento cuadra consigo mismo, que es el caso normal.
    return (async () => {
      sembrar({ saona: 1 })
      // Catalina y traslado quedan sin dia; se les quita el precio, que es una de las
      // dos salidas que el aviso del editor ofrece.
      for (const f of tablas.items) {
        if (f.id === 'catalina' || f.id === 'traslado') f.subtotal = 0
      }
      const { subtotalPDF, texto } = await medir()
      expect(sumaDeLaColumnaPorDias(texto)).toBe(subtotalPDF)
    })()
  }, 30_000)

  it('con la sugerencia CON PRECIO, la columna NO suma el Subtotal — y la diferencia ES la sugerencia', () => {
    // El estado CONTRADICTORIO. Se fija aqui con su numero para que nadie lo descubra
    // en un documento del cliente: mientras «asignar dia es incluirlo» sea el unico
    // interruptor, una sugerencia con precio sigue aportando al total y el documento
    // la declara no incluida. Lo unico que lo frena es el aviso rojo del editor.
    //
    // Las dos alternativas se descartaron a proposito: imprimirla TAMBIEN en el detalle
    // seria el mismo documento diciendo que esta y que no esta incluida; descontarla
    // del total seria arreglarlo solo, que es lo que el encargo prohibe.
    return (async () => {
      sembrar({ saona: 1 })
      const { subtotalPDF, texto } = await medir()
      const columna = sumaDeLaColumnaPorDias(texto)
      // traslado 229.885 + catalina 551.724 = 781.609 de sugerencias con precio.
      expect((subtotalPDF ?? 0) - columna).toBe(781_609)
    })()
  }, 30_000)
})

describe('criterio 5 · un vuelo sin dia NO cae nunca a sugeridos', () => {
  it('el vuelo y el hotel imprimen con el viaje, no como «no incluidos»', async () => {
    sembrar({ saona: 1, catalina: 2, traslado: 1 })
    const { texto } = await medir()

    const iSug = texto.toLowerCase().indexOf('actividades adicionales')
    // Sin sugerencias en este escenario: las tres lineas no combinables llevan dia.
    expect(iSug).toBe(-1)

    // Y el vuelo y el hotel siguen impresos, bajo su propio bloque.
    expect(texto).toContain('Vuelos - Avianca')
    expect(texto).toContain('Hotel Occidental')
    expect(texto.toLowerCase()).toContain('incluye también')
  }, 30_000)

  it('⚠️ con sugerencias presentes, el vuelo NO esta entre ellas', async () => {
    sembrar({ saona: 1 })
    const { texto } = await medir()

    const seccion = texto.slice(texto.toLowerCase().indexOf('actividades adicionales'))
    expect(seccion).toContain('Traslado aeropuerto')
    expect(seccion).toContain('Tour Isla Catalina')
    expect(seccion).not.toContain('Vuelos - Avianca')
    expect(seccion).not.toContain('Hotel Occidental')
  }, 30_000)
})

describe('el check de mostrar u ocultar una sugerencia', () => {
  it('la oculta NO se imprime, y la visible si', async () => {
    sembrar({ saona: 1 }, ['catalina'])
    const { texto } = await medir()

    const seccion = texto.slice(texto.toLowerCase().indexOf('actividades adicionales'))
    expect(seccion).toContain('Traslado aeropuerto')
    expect(seccion).not.toContain('Tour Isla Catalina')
  }, 30_000)

  it('⚠️⚠️ ocultarla NO la saca del total: el documento cobra lo mismo', async () => {
    // Esto es el caso PEOR y por eso se fija: el cliente no la ve y la paga. El aviso
    // del editor es lo unico que lo delata, y por eso no puede faltar.
    sembrar({ saona: 1 }, ['catalina'])
    const conOculta = await medir()
    sembrar({ saona: 1 })
    const conVisible = await medir()

    expect(conOculta.totalEnPantalla).toBe(conVisible.totalEnPantalla)
    expect(conOculta.subtotalPDF).toBe(conVisible.subtotalPDF)
  }, 60_000)
})
