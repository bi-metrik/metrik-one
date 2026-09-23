/**
 * El piso de margen, aplicado a la SALIDA de la cotización.
 *
 * ## Por qué existe
 *
 * Decisión del 2026-09-22 (Trappvel): *«Nada sale al cliente bajo el margen mínimo sin
 * la firma de Edgar.»* Hasta ese día el piso solo actuaba al marcar una tarifa para la
 * propuesta, y una cotización sin tarifas marcadas salía con cualquier margen: ni el
 * PDF, ni los dos «Enviar», ni «Aprobar» lo miraban.
 *
 * Esta es la ÚNICA regla que responde «¿esta cotización está bajo el piso?». La llaman
 * el PDF, los dos «Enviar», «Aprobar» y el gate `margen_sobre_piso` del avance de
 * etapa. Cinco lugares con cinco reglas eran cinco maneras de que una cotización pase
 * por el hueco que dejó la otra.
 *
 * ## La regla
 *
 *  · Con tarifas marcadas para la propuesta, **cada una** tiene que llegar al piso. Es
 *    lo que el cliente ve: tres bloques de precio, y basta que uno esté bajo el piso.
 *  · Sin tarifas marcadas se mide la cascada VIGENTE (`cascadaVigente`), la misma que
 *    produce `valor_total` y la que el editor muestra al pie.
 *  · **Un margen que no se puede medir cuenta como bajo el piso**: es `motivoDeRechazo`,
 *    la regla que ya aplicaba el candado de las tarifas, con el margen de
 *    `margenMedible` —sin precio O sin costo no hay margen—. Una cotización sin costo
 *    cargado se ve idéntica a una regalada.
 *  · El piso es el que la cotización congeló al nacer; si no congeló nada, el de la
 *    línea (`umbralesDeCotizacion`, ya resuelto en el contexto).
 *
 * ⚠️ «No se puede medir» es del AGREGADO (la tarifa o la cotización), no de cada línea.
 * Una línea con precio escrito a mano y sin costo, dentro de una cotización que sí
 * tiene costo, no la vuelve inmedible: es exactamente la forma del recargo fijo
 * (`recargo-actions.ts`), que entra sin costo a propósito. Medirlo por línea frenaría
 * toda cotización que lleve el recargo.
 *
 * ## La huella de la excepción
 *
 * El dueño puede autorizar una cotización bajo el piso. La autorización queda atada al
 * estado EXACTO que vio: si después cambia cualquier precio, costo o margen, se pierde
 * sola. Esa atadura es la huella: la versión canónica de lo que se autorizó —el piso,
 * los parámetros de la cascada, el total y el margen de cada tarifa (o de la
 * cotización) y las cifras de cada línea—. Los NOMBRES quedan fuera a propósito:
 * renombrar una tarifa no mueve un peso.
 *
 * Módulo puro: sin base y sin `node:crypto`. El hash lo calcula
 * `piso-salida-datos.ts`, que solo corre en el servidor.
 */

import { cascadaDeItinerario, margenMedible, motivoDeRechazo, nombreDeItinerario, ranurasSinResolver } from './itinerarios'
import { etiquetaDeRanura } from './ranuras-pantallazo'
import { cascadaVigente, type ContextoCotizacion, type FilaItinerario } from './itinerarios-datos'

/** Lo que se mide: una tarifa marcada para la propuesta, o la cotización entera. */
export interface SujetoDeSalida {
  tipo: 'tarifa' | 'cotizacion'
  /** El id del itinerario. `null` para la cotización. */
  id: string | null
  /** Cómo se le dice a una persona: «Económica», «Opción 2». `null` para la cotización. */
  nombre: string | null
  /** Precio al cliente, al peso. */
  total: number
  /** `null` = no se puede medir (sin costo o sin precio). */
  margenRealPct: number | null
  /** Ranuras sin elegir. Solo una tarifa puede tenerlas. */
  ranurasFaltantes: string[]
  bajoPiso: boolean
}

/** Una línea tal como quedó autorizada: solo lo que mueve plata. */
export interface LineaAutorizada {
  id: string
  nombre: string | null
  /** Las cifras de la línea, en orden fijo. Ver `cifrasDeLinea`. */
  cifras: (number | boolean | string | null)[]
}

/** Lo que el dueño vio al autorizar. Se guarda entero y de ahí sale la causa de la pérdida. */
export interface DetalleDeSalida {
  v: 1
  pisoPct: number
  params: (number | string | null)[]
  sujetos: SujetoDeSalida[]
  lineas: LineaAutorizada[]
}

/**
 * Cuántas líneas se miden y a cuántas les falta con qué medir (P1 del ensayo del
 * 2026-09-23). NO entra en la huella: dice por qué se ve lo que se ve, no mueve un peso.
 */
export interface ConteoDeLineas {
  /** Líneas medidas (sin el ítem de cuadre). Cero = la cotización está vacía. */
  lineas: number
  /**
   * Líneas sin costo NI precio: todavía no hay con qué calcular su margen. Una línea con
   * precio escrito y sin costo (el recargo fijo) NO cuenta: entra así a propósito.
   */
  sinCosto: number
  /**
   * Esas mismas líneas, con su nombre y su ranura: entran al total que sale y su precio es
   * cero, así que el cliente recibiría un precio sin ese servicio (`falta-costo.ts`).
   */
  faltantes: { id: string; nombre: string | null; grupo: string | null }[]
}

export interface MedicionDeSalida {
  pisoPct: number
  sujetos: SujetoDeSalida[]
  /** Ver `ConteoDeLineas`. Sobre la unión de las líneas de todo lo que se mide. */
  conteo: ConteoDeLineas
  /** Los sujetos que frenan. Vacío = en el piso o encima. */
  bajoPiso: SujetoDeSalida[]
  detalle: DetalleDeSalida
  /** El texto canónico que se hashea para la huella. Sin nombres. */
  firma: string
}

/**
 * ¿Esta cotización está bajo el piso? La regla única, sobre lo ya leído de la base.
 *
 * @param filas Las tarifas de la cotización (`leerItinerarios`). `null` o vacío: se
 *   mide la cotización entera, que es lo que el PDF imprime en ese caso.
 */
export function medirSalida(ctx: ContextoCotizacion, filas: FilaItinerario[] | null): MedicionDeSalida {
  const pisoPct = ctx.umbrales.pisoPct
  const marcadas = (filas ?? []).filter(f => f.vaEnPropuesta)

  const sujetos: SujetoDeSalida[] =
    marcadas.length > 0
      ? [...marcadas]
          .sort((a, b) => a.orden - b.orden)
          .map((fila, i) => {
            const cascada = cascadaDeItinerario(ctx.items, fila.seleccion, ctx.params)
            const faltantes = ranurasSinResolver(ctx.items, fila.seleccion)
            const margen = margenMedible(cascada)
            return {
              tipo: 'tarifa' as const,
              id: fila.id,
              nombre: nombreDeItinerario(fila.nombre, i + 1),
              total: Math.round(cascada.precioVenta),
              margenRealPct: margen,
              ranurasFaltantes: faltantes,
              bajoPiso: motivoDeRechazo({ ranurasFaltantes: faltantes, margenRealPct: margen, pisoPct }) !== null,
            }
          })
      : [(() => {
          const cascada = cascadaVigente(ctx, filas)
          const margen = margenMedible(cascada)
          return {
            tipo: 'cotizacion' as const,
            id: null,
            nombre: null,
            total: Math.round(cascada.precioVenta),
            margenRealPct: margen,
            ranurasFaltantes: [],
            bajoPiso: motivoDeRechazo({ ranurasFaltantes: [], margenRealPct: margen, pisoPct }) !== null,
          }
        })()]

  const detalle: DetalleDeSalida = {
    v: 1,
    pisoPct,
    params: [
      ctx.params.administrativosPct,
      ctx.params.margenPct,
      ctx.params.descuentoComercialPct,
      ctx.params.convencionMargen,
    ].map(v => (v === undefined ? null : v)),
    sujetos,
    lineas: [...ctx.items]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(item => ({ id: item.id, nombre: item.nombre, cifras: cifrasDeLinea(item) })),
  }

  return {
    pisoPct,
    sujetos,
    conteo: conteoDeLineas(ctx, marcadas.length > 0 ? marcadas : null, filas),
    bajoPiso: sujetos.filter(s => s.bajoPiso),
    detalle,
    firma: firmaDe(detalle),
  }
}

/**
 * Las líneas que se miden, contadas: la unión de las de cada tarifa marcada, o las de la
 * cascada vigente. Sale de la MISMA cascada que mide el margen, así que no puede decir
 * «falta el costo» de una línea que el margen sí está contando.
 */
function conteoDeLineas(
  ctx: ContextoCotizacion,
  marcadas: FilaItinerario[] | null,
  filas: FilaItinerario[] | null,
): ConteoDeLineas {
  const ajuste = new Set(ctx.items.filter(i => i.es_ajuste === true).map(i => i.id))
  const cascadas = marcadas
    ? marcadas.map(f => cascadaDeItinerario(ctx.items, f.seleccion, ctx.params))
    : [cascadaVigente(ctx, filas)]
  const vistas = new Map<string, boolean>()
  for (const cascada of cascadas) {
    for (const l of cascada.lineas) {
      if (!l.id || ajuste.has(l.id)) continue
      const sinCosto = !(l.costoLinea > 0) && !(l.precioLinea > 0)
      vistas.set(l.id, (vistas.get(l.id) ?? false) || sinCosto)
    }
  }
  const porId = new Map(ctx.items.map(i => [i.id, i]))
  const faltantes = [...vistas.entries()]
    .filter(([, sinCosto]) => sinCosto)
    .map(([id]) => {
      const item = porId.get(id)
      return { id, nombre: item?.nombre ?? null, grupo: (item?.grupo ?? null) as string | null }
    })
  return { lineas: vistas.size, sinCosto: faltantes.length, faltantes }
}

/**
 * Lo que mueve plata en una línea: exactamente lo que entra a la cascada.
 *
 * El margen de la línea, el precio escrito a mano, el costo (escrito o de rubros
 * confirmados), la cantidad, el descuento de compra, si entra al precio y sus
 * adicionales. El nombre, el grupo y el orden no están: no cambian un peso.
 */
function cifrasDeLinea(item: ContextoCotizacion['items'][number]): (number | boolean | string | null)[] {
  const adicionales = [...(item.adicionales ?? [])]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(a => `${a.id}:${a.cantidad}:${a.costo}:${a.precio}:${a.moneda}:${a.tasaCop ?? ''}`)
  return [
    num(item.cantidad),
    num(item.subtotal),
    num(item.numeroDeRubros),
    num(item.costoDeRubros),
    num(item.descuento_porcentaje),
    num(item.margen_porcentaje),
    num(item.precio_venta),
    item.precio_manual === true,
    item.entra_al_precio ?? null,
    item.es_ajuste === true,
    adicionales.join('|'),
  ]
}

function num(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * El texto que se hashea. Todo en arreglos de orden fijo: `JSON.stringify` de un objeto
 * depende del orden de inserción de sus claves, y una huella que cambia porque alguien
 * reordenó un literal invalidaría una autorización sin que nadie tocara un precio.
 */
function firmaDe(d: DetalleDeSalida): string {
  return JSON.stringify([
    d.v,
    d.pisoPct,
    d.params,
    d.sujetos.map(s => [s.tipo, s.id, s.total, s.margenRealPct === null ? null : redondear(s.margenRealPct)]),
    d.lineas.map(l => [l.id, l.cifras]),
  ])
}

function redondear(pct: number): number {
  return Math.round(pct * 10000) / 10000
}

// ── Lo que se le dice a una persona ──────────────────────────────────────────

/**
 * Por qué no sale, en lenguaje de operadora.
 *
 * Nombra la tarifa, su margen y el mínimo, y dice qué hacer: *«La tarifa Económica deja
 * un margen de 3 %, por debajo del mínimo de 5 %. Pídele a Edgar que la autorice o
 * ajusta el precio.»* Un «no se puede» sin las tres cosas deja a quien lo lee sin saber
 * a cuál tarifa mirar ni cuánto le falta.
 *
 * @param dueno El nombre de pila de quien puede autorizar. `null` si el workspace no
 *   tiene exactamente un dueño: ahí se dice «el dueño del workspace».
 */
export function mensajeDeSalida(bajoPiso: SujetoDeSalida[], pisoPct: number, dueno: string | null): string {
  if (bajoPiso.length === 0) return ''
  const minimo = pctTexto(pisoPct)
  const frases = bajoPiso.map(s => {
    const quien = s.tipo === 'tarifa' ? `La tarifa ${s.nombre}` : 'La cotización'
    if (s.ranurasFaltantes.length > 0) {
      const faltan = s.ranurasFaltantes.map(etiquetaDeRanura).join(', ')
      return `${quien} está incompleta (falta elegir ${faltan}), así que su margen no se puede medir.`
    }
    if (s.margenRealPct === null) {
      return `${quien} no tiene un margen que se pueda medir (le falta el costo o el precio), y el mínimo es ${minimo}.`
    }
    return `${quien} deja un margen de ${pctTexto(s.margenRealPct, pisoPct)}, por debajo del mínimo de ${minimo}.`
  })
  const quienAutoriza = dueno ? `Pídele a ${dueno}` : 'Pídele al dueño del workspace'
  const cierre = bajoPiso.length === 1
    ? `${quienAutoriza} que la autorice o ajusta el precio.`
    : `${quienAutoriza} que las autorice o ajusta los precios.`
  return `${frases.join(' ')} ${cierre}`
}

/**
 * Un porcentaje como se escribe en español: «3 %», «4,9 %».
 *
 * ⚠️ Con `techo` (el piso), un margen por debajo se TRUNCA en vez de redondearse:
 * 4,96 redondeado da «5,0 %» y la frase quedaría «deja 5,0 %, por debajo del mínimo
 * de 5 %», que se lee como un error del sistema.
 */
export function pctTexto(pct: number, techo?: number): string {
  let valor = Math.round(pct * 10) / 10
  if (techo !== undefined && pct < techo && valor >= techo) valor = Math.floor(pct * 10) / 10
  const texto = Number.isInteger(valor) ? String(valor) : valor.toFixed(1).replace('.', ',')
  return `${texto} %`
}

/**
 * Qué cambió entre lo autorizado y lo de hoy. Es la «causa» que queda en el registro
 * cuando la excepción se pierde, y la que ve el dueño en el editor.
 *
 * Dice lo PRIMERO que encuentra, en orden de cuánto le importa a quien lo lee: una
 * tarifa que cambió de precio antes que una línea que cambió de costo.
 */
export function causaDePerdida(autorizado: DetalleDeSalida, hoy: DetalleDeSalida): string {
  if (autorizado.pisoPct !== hoy.pisoPct) {
    return `Cambió el margen mínimo de la cotización (de ${pctTexto(autorizado.pisoPct)} a ${pctTexto(hoy.pisoPct)}).`
  }

  for (const antes of autorizado.sujetos) {
    const ahora = hoy.sujetos.find(s => s.tipo === antes.tipo && s.id === antes.id)
    const quien = antes.tipo === 'tarifa' ? `La tarifa ${antes.nombre}` : 'La cotización'
    if (!ahora) return `${quien} ya no está en la propuesta.`
    const mismoMargen = (antes.margenRealPct === null && ahora.margenRealPct === null)
      || (antes.margenRealPct !== null && ahora.margenRealPct !== null
        && redondear(antes.margenRealPct) === redondear(ahora.margenRealPct))
    if (antes.total !== ahora.total || !mismoMargen) {
      return `${quien} pasó de ${cifra(antes)} a ${cifra(ahora)}.`
    }
  }
  for (const ahora of hoy.sujetos) {
    if (!autorizado.sujetos.some(s => s.tipo === ahora.tipo && s.id === ahora.id)) {
      return ahora.tipo === 'tarifa'
        ? `Se agregó la tarifa ${ahora.nombre} a la propuesta.`
        : 'Se quitaron las tarifas de la propuesta.'
    }
  }

  if (JSON.stringify(autorizado.params) !== JSON.stringify(hoy.params)) {
    return 'Cambió el margen, el descuento o los administrativos de la cotización.'
  }

  for (const antes of autorizado.lineas) {
    const ahora = hoy.lineas.find(l => l.id === antes.id)
    const nombre = antes.nombre?.trim() || 'sin nombre'
    if (!ahora) return `Se quitó la línea «${nombre}».`
    if (JSON.stringify(antes.cifras) !== JSON.stringify(ahora.cifras)) {
      return `Cambió el precio, el costo o el margen de la línea «${nombre}».`
    }
  }
  for (const ahora of hoy.lineas) {
    if (!autorizado.lineas.some(l => l.id === ahora.id)) {
      return `Se agregó la línea «${ahora.nombre?.trim() || 'sin nombre'}».`
    }
  }

  return 'Cambió un precio, un costo o un margen de la cotización.'
}

function cifra(s: SujetoDeSalida): string {
  const margen = s.margenRealPct === null ? 'margen sin medir' : pctTexto(s.margenRealPct)
  return `${margen} ($${s.total.toLocaleString('es-CO')})`
}
