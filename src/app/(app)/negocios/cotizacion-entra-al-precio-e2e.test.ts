/**
 * El segundo interruptor, medido sobre el PDF renderizado: una sugerencia con precio
 * que NO entra al precio se ve en «actividades adicionales no incluidas» y no suma.
 *
 * Los tres criterios de verificación del encargo del 2026-09-15 se comprueban aquí y
 * ninguno se recalcula: las cifras se LEEN del binario y los textos se buscan en lo que
 * el documento imprime.
 *
 * Corre contra las funciones reales:
 *   1. `recalcularTotales`     -> escribe `cotizaciones.valor_total` y `costo_total`.
 *   2. `generateCotizacionPDF` -> devuelve el PDF, y de ahí se lee el texto impreso.
 *   3. `actualizarDiaDeItem` y `actualizarRanuraDeItem` -> los guards del interruptor.
 *
 * El arnés (doble de Supabase consciente de tabla y filtro, extractor de texto en HEX)
 * está copiado de `cotizacion-dia-e2e.test.ts`, igual que ese lo copió de
 * `cotizacion-alternativas-e2e.test.ts`: vive dentro del archivo de pruebas y sacarlo a
 * un módulo compartido es una limpieza que no entra en este encargo.
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
import { actualizarDiaDeItem, actualizarRanuraDeItem } from './itinerario-actions'
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
 * Un viaje de Trappvel: vuelo, hotel, traslado y dos tours. Mismas cifras que
 * `cotizacion-dia-e2e.test.ts`, para que los números se puedan cruzar entre los dos.
 *
 * `extra` pisa columnas por línea. `sinColumna` quita `entra_al_precio` de TODAS las
 * filas: es exactamente lo que devuelve `select('*')` antes de aplicar la migración.
 */
function sembrar(
  extra: Record<string, Record<string, unknown>> = {},
  opciones: { sinColumna?: boolean } = {},
) {
  ausentes = new Set(['cotizacion_itinerarios', 'itinerario_opciones'])
  const item = (id: string, nombre: string, grupo: string | null, orden: number, costo: number): Fila => {
    const fila: Fila = {
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
      dia_relativo: null,
      mostrar_en_sugeridos: true,
      entra_al_precio: true,
      ...(extra[id] ?? {}),
    }
    if (opciones.sinColumna) delete fila.entra_al_precio
    return fila
  }

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

/** Genera el PDF (y, si se pide, recalcula antes) y lee lo que el documento imprime. */
async function medir(opciones: { recalcular?: boolean } = {}) {
  if (opciones.recalcular !== false) await recalcularTotales(COT)
  const cot = tablas.cotizaciones[0] as Fila
  const totalEnPantalla = Number(cot.valor_total)
  const costoTotal = Number(cot.costo_total)

  const res = await generateCotizacionPDF(COT)
  expect(res.success).toBe(true)
  const texto = textoDelPDF((res as { pdf: string }).pdf)

  return {
    totalEnPantalla,
    costoTotal,
    subtotalPDF: cifraJuntoA(texto, 'Subtotal'),
    ivaPDF: cifraJuntoA(texto, 'IVA \\(19%\\)'),
    totalPDF: cifraJuntoA(texto, 'TOTAL'),
    texto,
  }
}

/** El tramo del documento que va desde «actividades adicionales» hasta el final. */
function seccionSugeridos(texto: string): string {
  const i = texto.toLowerCase().indexOf('actividades adicionales')
  return i === -1 ? '' : texto.slice(i)
}

/** Lo que suma la columna impresa cuando el documento se organiza por días. */
function sumaDeLaColumnaPorDias(texto: string): number {
  const tramo = texto.slice(texto.indexOf('ITINERARIO'), texto.indexOf(' Subtotal '))
  const importes = [...tramo.matchAll(/\$\s*([\d.]{4,})/g)]
  return importes.reduce((s, m) => s + Number(m[1].replace(/\./g, '')), 0)
}

beforeEach(() => {
  tablas = {}
  ausentes = new Set()
})

// Precios que salen de la cascada (costo con 13% de margen sobre venta):
//   avianca 2.298.851 · hotel 1.551.724 · traslado 229.885 · saona 620.690 · catalina 551.724
// Total con las cinco: 5.252.874. Sin Catalina: 4.701.150.
const TOTAL_CON_TODAS = 5_252_874
const PRECIO_CATALINA = 551_724
const TOTAL_SIN_CATALINA = TOTAL_CON_TODAS - PRECIO_CATALINA

describe('(a) sugerencia con precio que NO entra al precio', () => {
  it('su precio se ve, y ni el subtotal ni el total la incluyen', async () => {
    sembrar({ saona: { dia_relativo: 1 }, traslado: { dia_relativo: 1 }, catalina: { entra_al_precio: false } })
    const { totalEnPantalla, costoTotal, subtotalPDF, ivaPDF, totalPDF, texto } = await medir()

    expect(totalEnPantalla).toBe(TOTAL_SIN_CATALINA)
    expect(subtotalPDF).toBe(TOTAL_SIN_CATALINA)
    expect(totalPDF).toBe((subtotalPDF ?? 0) + (ivaPDF ?? 0))
    // Ni el costo: 2.000.000 + 1.350.000 + 200.000 + 540.000, sin los 480.000 del tour.
    expect(costoTotal).toBe(4_090_000)

    // Se imprime en «no incluidas», con su precio a la vista.
    const seccion = seccionSugeridos(texto)
    expect(seccion).toContain('Tour Isla Catalina')
    expect(seccion).toContain('551.724')
    // Y una sola vez: no se cuela también en el itinerario.
    expect(texto.split('Tour Isla Catalina').length - 1).toBe(1)
  }, 30_000)

  it('⚠️ el documento CUADRA: la columna impresa suma exactamente el Subtotal', async () => {
    // Es la diferencia con (b): allí la columna queda corta por la sugerencia que cobra.
    sembrar({ saona: { dia_relativo: 1 }, traslado: { dia_relativo: 1 }, catalina: { entra_al_precio: false } })
    const { subtotalPDF, texto } = await medir()
    expect(sumaDeLaColumnaPorDias(texto)).toBe(subtotalPDF)
  }, 30_000)
})

describe('(b) la misma sugerencia marcada que SÍ entra al precio', () => {
  it('suma al total, y se sigue imprimiendo como «no incluida»: la contradicción que avisa el editor', async () => {
    sembrar({ saona: { dia_relativo: 1 }, traslado: { dia_relativo: 1 } })
    const { totalEnPantalla, subtotalPDF, texto } = await medir()

    expect(totalEnPantalla).toBe(TOTAL_CON_TODAS)
    expect(subtotalPDF).toBe(TOTAL_CON_TODAS)
    expect(seccionSugeridos(texto)).toContain('Tour Isla Catalina')
    // La columna impresa queda corta exactamente en lo que cobra la sugerencia.
    expect((subtotalPDF ?? 0) - sumaDeLaColumnaPorDias(texto)).toBe(PRECIO_CATALINA)
  }, 30_000)
})

describe('(c) una cotización existente, sin tocar, no cambia al aplicar la migración', () => {
  it('filas SIN la columna (antes) y con la columna en su default (después): mismo total y mismo documento', async () => {
    sembrar({}, { sinColumna: true })
    const antes = await medir()

    sembrar()
    const despues = await medir()

    expect(antes.totalEnPantalla).toBe(TOTAL_CON_TODAS)
    expect(despues.totalEnPantalla).toBe(antes.totalEnPantalla)
    expect(despues.costoTotal).toBe(antes.costoTotal)
    expect(despues.subtotalPDF).toBe(antes.subtotalPDF)
    expect(despues.totalPDF).toBe(antes.totalPDF)
    // El texto completo del documento, no solo las cifras.
    expect(despues.texto).toBe(antes.texto)
  }, 60_000)

  it('lo mismo con la cotización organizada por días', async () => {
    sembrar({ saona: { dia_relativo: 2 }, catalina: { dia_relativo: 3 } }, { sinColumna: true })
    const antes = await medir()
    sembrar({ saona: { dia_relativo: 2 }, catalina: { dia_relativo: 3 } })
    const despues = await medir()
    expect(despues.totalEnPantalla).toBe(antes.totalEnPantalla)
    expect(despues.texto).toBe(antes.texto)
  }, 60_000)
})

describe('sin un solo día asignado, la sugerencia fuera del precio no desaparece', () => {
  it('sale del detalle plano y se ofrece al final con su precio', async () => {
    sembrar({ catalina: { entra_al_precio: false } })
    const { totalEnPantalla, subtotalPDF, texto } = await medir()

    expect(totalEnPantalla).toBe(TOTAL_SIN_CATALINA)
    expect(subtotalPDF).toBe(TOTAL_SIN_CATALINA)
    // El documento sigue siendo la lista plana de siempre para lo demás.
    expect(texto).toContain('DETALLE')
    expect(texto).not.toContain('ITINERARIO')
    const detalle = texto.slice(texto.indexOf('DETALLE'), texto.indexOf(' Subtotal '))
    expect(detalle).toContain('Tour Isla Saona')
    expect(detalle).not.toContain('Tour Isla Catalina')
    const seccion = seccionSugeridos(texto)
    expect(seccion).toContain('Tour Isla Catalina')
    expect(seccion).toContain('551.724')
  }, 30_000)
})

describe('con itinerarios en la propuesta, la sugerencia fuera del precio tampoco desaparece', () => {
  it('no entra al bloque del principal y se ofrece al final', async () => {
    sembrar({ catalina: { entra_al_precio: false } })
    ausentes = new Set()
    tablas.cotizacion_itinerarios = [
      { id: 'it-1', cotizacion_id: COT, nombre: 'Recomendada', orden: 1, va_en_propuesta: true, es_principal: true },
    ]
    tablas.itinerario_opciones = [
      { itinerario_id: 'it-1', item_id: 'avianca' },
      { itinerario_id: 'it-1', item_id: 'hotel' },
    ]
    const { totalEnPantalla, subtotalPDF, texto } = await medir()

    // El principal lleva los fijos (traslado, saona) y su selección, sin Catalina.
    expect(totalEnPantalla).toBe(TOTAL_SIN_CATALINA)
    expect(subtotalPDF).toBe(TOTAL_SIN_CATALINA)
    const seccion = seccionSugeridos(texto)
    expect(seccion).toContain('Tour Isla Catalina')
    expect(texto.split('Tour Isla Catalina').length - 1).toBe(1)
  }, 30_000)

  it('CONTROL · una que SÍ entra al precio no se ofrece aparte: va dentro del bloque', async () => {
    sembrar()
    ausentes = new Set()
    tablas.cotizacion_itinerarios = [
      { id: 'it-1', cotizacion_id: COT, nombre: 'Recomendada', orden: 1, va_en_propuesta: true, es_principal: true },
    ]
    tablas.itinerario_opciones = [
      { itinerario_id: 'it-1', item_id: 'avianca' },
      { itinerario_id: 'it-1', item_id: 'hotel' },
    ]
    const { totalEnPantalla, texto } = await medir()
    expect(totalEnPantalla).toBe(TOTAL_CON_TODAS)
    expect(seccionSugeridos(texto)).toBe('')
  }, 30_000)
})

describe('el interruptor desde la server action: guarda, protege y recalcula', () => {
  it('sacarla del precio recalcula el total en el servidor, sin que la pantalla lo pida', async () => {
    sembrar({ saona: { dia_relativo: 1 } })
    await recalcularTotales(COT)
    expect(Number((tablas.cotizaciones[0] as Fila).valor_total)).toBe(TOTAL_CON_TODAS)

    const res = await actualizarDiaDeItem('catalina', { entra_al_precio: false })
    expect(res).toEqual({ success: true })
    expect((tablas.items.find(i => i.id === 'catalina') as Fila).entra_al_precio).toBe(false)
    expect(Number((tablas.cotizaciones[0] as Fila).valor_total)).toBe(TOTAL_SIN_CATALINA)

    // Y devolverla al precio lo vuelve a subir.
    const vuelta = await actualizarDiaDeItem('catalina', { entra_al_precio: true })
    expect(vuelta).toEqual({ success: true })
    expect(Number((tablas.cotizaciones[0] as Fila).valor_total)).toBe(TOTAL_CON_TODAS)
  }, 30_000)

  it('⚠️ un vuelo no puede salir del precio: desaparecería del documento sin sumar', async () => {
    sembrar()
    const res = await actualizarDiaDeItem('avianca', { entra_al_precio: false })
    expect(res.success).toBe(false)
    expect((tablas.items.find(i => i.id === 'avianca') as Fila).entra_al_precio).toBe(true)
  })

  it('⚠️ una línea sin grupo tampoco', async () => {
    sembrar({ catalina: { grupo: null } })
    const res = await actualizarDiaDeItem('catalina', { entra_al_precio: false })
    expect(res.success).toBe(false)
  })

  it('⚠️ una línea con día tampoco: con día está incluida', async () => {
    sembrar({ catalina: { dia_relativo: 3 } })
    const res = await actualizarDiaDeItem('catalina', { entra_al_precio: false })
    expect(res.success).toBe(false)
    expect((tablas.items.find(i => i.id === 'catalina') as Fila).entra_al_precio).toBe(true)
  })

  it('⚠️ a una línea fuera del precio no se le asigna día', async () => {
    sembrar({ catalina: { entra_al_precio: false } })
    const res = await actualizarDiaDeItem('catalina', { dia_relativo: 2 })
    expect(res.success).toBe(false)
    expect((tablas.items.find(i => i.id === 'catalina') as Fila).dia_relativo).toBe(null)
  })

  it('CONTROL · ocultarla o mostrarla sigue funcionando estando fuera del precio', async () => {
    sembrar({ catalina: { entra_al_precio: false } })
    const res = await actualizarDiaDeItem('catalina', { mostrar_en_sugeridos: false })
    expect(res).toEqual({ success: true })
  })

  it('⚠️ cambiarle el grupo a vuelo estando fuera del precio se rechaza', async () => {
    sembrar({ catalina: { entra_al_precio: false } })
    const res = await actualizarRanuraDeItem('catalina', { grupo: 'vuelo' })
    expect(res.success).toBe(false)
    expect((tablas.items.find(i => i.id === 'catalina') as Fila).grupo).toBe('excursion')
  })

  it('CONTROL · cambiarle el grupo a otro que tampoco se combina sí pasa', async () => {
    sembrar({ catalina: { entra_al_precio: false } })
    const res = await actualizarRanuraDeItem('catalina', { grupo: 'tour' })
    expect(res).toEqual({ success: true })
  })
})
