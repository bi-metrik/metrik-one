/**
 * Las TRES cifras del mismo dinero, medidas sobre el documento renderizado.
 *
 * El encargo pide comprobar que **subtotal del PDF, total del PDF y total en
 * pantalla** dan lo mismo en tres escenarios. Una prueba de la regla pura no puede
 * hacerlo: la regla puede estar bien y el PDF imprimir otra cosa, que es justo lo que
 * pasaba (el Subtotal sumaba AVIANCA y WINGO contra un TOTAL que salía de
 * `valor_total`, y el cliente sí suma la columna).
 *
 * Por eso esto corre contra las DOS funciones reales, no contra sus reglas:
 *
 *   1. `recalcularTotales`  → escribe `cotizaciones.valor_total` (el total en pantalla:
 *                             la pantalla lo deriva con el mismo helper y la misma
 *                             cascada, ver `cotizacion-editor.tsx`).
 *   2. `generateCotizacionPDF` → devuelve el PDF, y de ahí se LEE el texto impreso.
 *
 * Las cifras no se recalculan aquí: se extraen del binario. Recalcularlas sería
 * heredar el supuesto del código que se quiere probar.
 *
 * EL DOBLE ES CONSCIENTE DE LA TABLA Y DEL FILTRO: si el código deja de filtrar por
 * `cotizacion_id`, entra el ítem de otra cotización y las cifras cambian.
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

/** Lo que suma la COLUMNA que el cliente ve, sacado del propio documento. */
function sumaDeLaColumnaImpresa(texto: string): number {
  // Cada fila de la tabla imprime `N Concepto $ 1.234.567`. Se toma el importe de
  // cada una y se suman, que es literalmente lo que hace el cliente con una
  // calculadora. Recalcularlo desde los ítems heredaría el supuesto del código.
  const detalle = texto.slice(texto.indexOf('SUBTOTAL'), texto.indexOf(' Subtotal '))
  const importes = [...detalle.matchAll(/\$\s*([\d.]{4,})/g)]
  return importes.reduce((s, m) => s + Number(m[1].replace(/\./g, '')), 0)
}

// ── Escenario ────────────────────────────────────────────────────────────────

const COT = 'cot-1'

/**
 * El caso medido de Trappvel: mismo hotel, mismas fechas, dos aerolíneas.
 * AVIANCA 2.000.000 de costo, WINGO 1.825.000, hotel 1.350.000, traslado 200.000.
 */
function sembrar(opciones: { conAlternativa: boolean }) {
  ausentes = new Set(['cotizacion_itinerarios', 'itinerario_opciones'])
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
        consecutivo: 'COT-2026-0003',
        codigo: 'COT-2026-0003',
        modo: 'detallada',
        descripcion: 'Viaje a medida',
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
      {
        id: 'avianca', cotizacion_id: COT, nombre: 'Vuelos - Avianca', descripcion: null,
        grupo: 'vuelo', opcion_de: null, orden: 1, es_ajuste: false, cantidad: 1,
        subtotal: 2_000_000, descuento_porcentaje: 0, margen_porcentaje: null,
        precio_venta: 0, precio_manual: false, unidad: null,
      },
      ...(opciones.conAlternativa
        ? [{
            id: 'wingo', cotizacion_id: COT, nombre: 'Vuelos - Wingo', descripcion: null,
            grupo: 'vuelo', opcion_de: 'avianca', orden: 2, es_ajuste: false, cantidad: 1,
            subtotal: 1_825_000, descuento_porcentaje: 0, margen_porcentaje: null,
            precio_venta: 0, precio_manual: false, unidad: null,
          }]
        : []),
      {
        id: 'hotel', cotizacion_id: COT, nombre: 'Hotel Occidental', descripcion: null,
        grupo: 'hotel', opcion_de: null, orden: 3, es_ajuste: false, cantidad: 1,
        subtotal: 1_350_000, descuento_porcentaje: 0, margen_porcentaje: null,
        precio_venta: 0, precio_manual: false, unidad: null,
      },
      {
        id: 'traslado', cotizacion_id: COT, nombre: 'Traslado privado', descripcion: null,
        grupo: null, opcion_de: null, orden: 4, es_ajuste: false, cantidad: 1,
        subtotal: 200_000, descuento_porcentaje: 0, margen_porcentaje: null,
        precio_venta: 0, precio_manual: false, unidad: null,
      },
    ],
    rubros: [],
    negocios: [{ id: 'neg-1', nombre: 'Viaje Cartagena', carpeta_url: null, empresa_id: null }],
    empresas: [],
    workspaces: [{ id: 'ws-1', name: 'Trappvel', logo_url: null, color_primario: null, cotizacion_template_slug: 'metrik' }],
    fiscal_profiles: [],
    staff: [],
  }
}

/**
 * Las cifras del mismo dinero, cada una leída de donde de verdad vive.
 *
 * ⚠️ El `TOTAL` del PDF trae el IVA y el `Subtotal` no: no son comparables entre sí, y
 * exigir que fueran iguales era una expectativa mal escrita, no un defecto. La
 * igualdad que sí tiene que cumplirse es **`Subtotal` == total en pantalla**, y de ahí
 * `TOTAL` == `Subtotal` + IVA.
 */
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
    sumaColumna: sumaDeLaColumnaImpresa(texto),
    texto,
  }
}

beforeEach(() => {
  tablas = {}
  ausentes = new Set()
})

describe('R-A1 · las tres cifras cuadran, con y sin alternativas', () => {
  it('SIN alternativas: el PDF cuadra con la pantalla (el control)', async () => {
    // El control, y es la mitad de la prueba: es la cotización de siempre (Termotech,
    // Arca, WMC). Si estas cifras cambian, el arreglo le movió el precio a quien no
    // tiene ranuras, que es lo que R6 prohíbe.
    sembrar({ conAlternativa: false })
    const { totalEnPantalla, subtotalPDF, ivaPDF, totalPDF, sumaColumna, texto } = await medir()

    expect(totalEnPantalla).toBe(4_080_460)
    expect(subtotalPDF).toBe(4_080_460)
    expect(sumaColumna).toBe(4_080_460)
    expect(ivaPDF).toBe(775_287)
    expect(totalPDF).toBe(4_855_747)
    expect(totalPDF).toBe((subtotalPDF ?? 0) + (ivaPDF ?? 0))
    expect(texto).toContain('Vuelos - Avianca')
  }, 30_000)

  it('CON alternativa y sin principal: aporta una sola vez y el PDF sigue cuadrando', async () => {
    // El defecto que llegó vivo a producción. ANTES de este arreglo, con la misma
    // siembra: el Subtotal imprimía 6.178.160 (los DOS vuelos) contra un total de
    // 4.080.460 — dos cifras del mismo dinero en el documento que ve el cliente, y el
    // cliente sí suma la columna.
    sembrar({ conAlternativa: true })
    const { totalEnPantalla, subtotalPDF, ivaPDF, totalPDF, sumaColumna, texto } = await medir()

    // Las MISMAS cifras que sin alternativa: agregar una opción no encarece el viaje.
    expect(totalEnPantalla).toBe(4_080_460)
    expect(subtotalPDF).toBe(4_080_460)
    expect(sumaColumna).toBe(4_080_460)
    expect(totalPDF).toBe(4_855_747)
    expect(totalPDF).toBe((subtotalPDF ?? 0) + (ivaPDF ?? 0))

    // Y el documento imprime UN vuelo, no dos: el supuesto es visible en la línea.
    expect(texto).toContain('Vuelos - Avianca')
    expect(texto).not.toContain('Vuelos - Wingo')
  }, 30_000)

  it('CON alternativa y principal marcada: manda el principal, no el supuesto', async () => {
    // El tercer escenario. Aquí la decisión SÍ está tomada, y tiene que ganarle al
    // supuesto: el principal elige WINGO, que es la opción que el supuesto habría
    // descartado. Si el arreglo hubiera dejado el supuesto por encima, esta prueba
    // saldría con las cifras de AVIANCA y nadie lo notaría — las dos son plausibles.
    sembrar({ conAlternativa: true })
    ausentes = new Set()
    tablas.cotizacion_itinerarios = [
      {
        id: 'it-1', cotizacion_id: COT, nombre: 'Económica', orden: 1,
        va_en_propuesta: true, es_principal: true,
      },
    ]
    tablas.itinerario_opciones = [
      { itinerario_id: 'it-1', item_id: 'wingo' },
      { itinerario_id: 'it-1', item_id: 'hotel' },
    ]

    const { totalEnPantalla, subtotalPDF, ivaPDF, totalPDF, sumaColumna, texto } = await medir()

    // WINGO cuesta 1.825.000 contra 2.000.000 de AVIANCA: el total tiene que BAJAR.
    expect(totalEnPantalla).toBe(3_879_310)
    expect(subtotalPDF).toBe(3_879_310)
    expect(sumaColumna).toBe(3_879_310)
    expect(totalPDF).toBe((subtotalPDF ?? 0) + (ivaPDF ?? 0))

    // Y el documento imprime WINGO, no AVIANCA.
    expect(texto).toContain('Vuelos - Wingo')
    expect(texto).not.toContain('Vuelos - Avianca')
    // Con UN solo itinerario en la propuesta el documento imprime la tabla plana, sin
    // titular el bloque: a un cliente con una sola opción no se le presenta como una
    // elección entre varias. Es deliberado (`bloques.length > 1` en la plantilla).
    expect(texto).not.toContain('Económica ·')
  }, 30_000)

  it('DOS itinerarios en la propuesta: el título del principal no repite «recomendada»', async () => {
    // El defecto #1 del encargo, comprobado sobre el documento renderizado y no sobre
    // el helper. Quien cotiza llama «Recomendada» a la que recomienda —es el ejemplo
    // del propio diseño— y pegarle el sufijo imprimía «Recomendada · recomendada» al
    // cliente. Este es el único camino donde el título se pinta: con un solo bloque la
    // plantilla cae a la tabla plana y el sufijo nunca se vería.
    sembrar({ conAlternativa: true })
    ausentes = new Set()
    tablas.cotizacion_itinerarios = [
      { id: 'it-1', cotizacion_id: COT, nombre: 'Recomendada', orden: 1, va_en_propuesta: true, es_principal: true },
      { id: 'it-2', cotizacion_id: COT, nombre: 'Económica', orden: 2, va_en_propuesta: true, es_principal: false },
    ]
    tablas.itinerario_opciones = [
      { itinerario_id: 'it-1', item_id: 'avianca' },
      { itinerario_id: 'it-1', item_id: 'hotel' },
      { itinerario_id: 'it-2', item_id: 'wingo' },
      { itinerario_id: 'it-2', item_id: 'hotel' },
    ]

    const { totalEnPantalla, subtotalPDF, texto } = await medir()

    // El principal es AVIANCA: el total de la cotización es el suyo.
    expect(totalEnPantalla).toBe(4_080_460)
    // Y el resumen fiscal sale del principal, no de la suma de los dos bloques.
    expect(subtotalPDF).toBe(4_080_460)

    // ⚠️ La plantilla titula el bloque en MAYUSCULA, así que la comprobación va sobre
    // el texto en minúsculas. Compararlo tal cual daba un falso negativo del
    // instrumento: el documento decía «RECOMENDADA» y la prueba buscaba «Recomendada».
    const enMinuscula = texto.toLowerCase()

    // Los dos bloques se imprimen, cada uno con su precio.
    expect(enMinuscula).toContain('recomendada')
    expect(enMinuscula).toContain('econ')
    // Y el del principal NO dice «recomendada» dos veces (defecto #1 del encargo).
    expect(enMinuscula).not.toContain('recomendada \u00b7 recomendada')

    // El control que hace válida la comprobación de arriba: un nombre que NO la dice
    // sí recibe el sufijo. Sin esto, un título que nunca agregara el sufijo pasaría
    // igual y la prueba no estaría midiendo nada.
    tablas.cotizacion_itinerarios[0].nombre = 'Premium'
    const conSufijo = (await medir()).texto.toLowerCase()
    expect(conSufijo).toContain('premium \u00b7 recomendada')
  }, 30_000)

  it('la alternativa descartada CONSERVA su precio de línea', async () => {
    // No aportar al total no es quedarse sin precio: es el número con el que alguien
    // compara una opción contra la otra. Si el recálculo dejara a WINGO en cero, la
    // tabla de combinaciones no podría decidir nada.
    sembrar({ conAlternativa: true })
    await recalcularTotales(COT)

    const wingo = (tablas.items as Fila[]).find(i => i.id === 'wingo') as Fila
    const avianca = (tablas.items as Fila[]).find(i => i.id === 'avianca') as Fila
    expect(Number(wingo.precio_venta)).toBeGreaterThan(0)
    expect(Number(wingo.subtotal)).toBe(1_825_000)
    // Y la más barata cuesta menos, que es el dato que sostiene la comparación.
    expect(Number(wingo.precio_venta)).toBeLessThan(Number(avianca.precio_venta))
  }, 30_000)

  it('R-P1 · una propuesta GUARDADA no mueve el costo ni el margen', async () => {
    // La comprobación que autoriza `rubros.sugerido`. Misma cotización, medida dos
    // veces contra la server action real: sin la propuesta y con la propuesta encima.
    sembrar({ conAlternativa: false })
    // AVIANCA deja de costar por `subtotal` y pasa a costear por un rubro confirmado,
    // para que la propuesta caiga sobre un ítem que YA se desglosa (el caso real:
    // se relee la captura de una línea que ya tenía costo).
    const avianca = (tablas.items as Fila[]).find(i => i.id === 'avianca') as Fila
    avianca.subtotal = 0
    tablas.rubros = [
      { id: 'r1', item_id: 'avianca', valor_total: 2_000_000, sugerido: false },
    ]

    await recalcularTotales(COT)
    const antes = { ...(tablas.cotizaciones[0] as Fila) }

    // Llega la propuesta de un pantallazo: se guarda, y no la confirma nadie.
    tablas.rubros.push({ id: 'r2', item_id: 'avianca', valor_total: 1_825_000, sugerido: true })
    await recalcularTotales(COT)
    const despues = tablas.cotizaciones[0] as Fila

    expect(Number(despues.costo_total)).toBe(Number(antes.costo_total))
    expect(Number(despues.valor_total)).toBe(Number(antes.valor_total))

    // Y el PDF tampoco se movió.
    const res = await generateCotizacionPDF(COT)
    expect(cifraJuntoA(textoDelPDF((res as { pdf: string }).pdf), 'Subtotal')).toBe(
      Number(antes.valor_total),
    )

    // El control: confirmarla SÍ mueve el costo. Sin esto, una cascada que ignorara el
    // segundo rubro por cualquier otra razón pasaría igual.
    ;(tablas.rubros[1] as Fila).sugerido = false
    await recalcularTotales(COT)
    expect(Number((tablas.cotizaciones[0] as Fila).costo_total)).toBeGreaterThan(
      Number(antes.costo_total),
    )
  }, 30_000)

  it('el costo guardado tampoco cuenta el vuelo dos veces', async () => {
    sembrar({ conAlternativa: true })
    await recalcularTotales(COT)
    const cot = tablas.cotizaciones[0] as Fila
    expect(Number(cot.costo_total)).toBe(2_000_000 + 1_350_000 + 200_000)
  }, 30_000)
})
