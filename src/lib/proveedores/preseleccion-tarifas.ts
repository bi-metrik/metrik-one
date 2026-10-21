/**
 * Elegir una tarifa en un toque (brief del 2026-10-21, punto 3). PURO.
 *
 *   · `cupoDeFila`: el «puesto» que ocupa una fila en la elección. Por persona, el tipo de pasajero
 *     al que va; por habitación, vehículo o grupo, uno solo. Si el viaje cruza temporadas, cada
 *     temporada es su propio puesto. Marcar una fila REEMPLAZA la que ocupaba su puesto: nunca
 *     quedan dos marcadas para lo mismo (el «Viajan 2 adultos y eligiste tarifa para 4» de #1227).
 *   · `preseleccion`: lo que ONE deja marcado al abrir. Por puesto: si queda una sola fila tras el
 *     filtro, esa (con `propuestaDeFila`); con varias, la de menor total. La persona la cambia con
 *     un toque. Nada se guarda sin «Usar».
 *   · `totalDeFila`: «2 × 105.000 = 210.000» para la tarjeta de cada tarifa.
 *   · `gruposDeTarifas`: las filas agrupadas por habitación (categoría) y plan.
 */
import { formatoMonto, type Composicion } from '@/lib/cotizaciones/tarifa-pasajero'
import { propuestaDeFila, type CalendarioDelViaje, type FilaElegida, type OpcionTarifa } from './oferta-tarifas'

/** El puesto de la fila en la elección (ver arriba). */
export function cupoDeFila(o: Pick<OpcionTarifa, 'unidad' | 'tipo' | 'temporada'>, cal: Pick<CalendarioDelViaje, 'cruza'> | null): string {
  const quien = o.unidad === 'persona' ? `persona:${o.tipo ?? 'adulto'}` : 'total'
  const temporada = cal && cal.cruza.length >= 2 && o.temporada ? `@${o.temporada.id}` : ''
  return `${quien}${temporada}`
}

/** Lo que cuesta la fila con lo que propone ONE (cantidad × noches × precio). */
export function totalDeFila(o: OpcionTarifa, c: Composicion | null, cal: CalendarioDelViaje | null, elegida?: Pick<FilaElegida, 'cantidad' | 'noches'> | null): { subtotal: number; texto: string } | null {
  if (!o.base || !o.unidad) return null
  const p = cal ? propuestaDeFila(o, c, cal) : { cantidad: 1, noches: null }
  const cantidad = elegida?.cantidad ?? p.cantidad
  const noches = o.porNoche ? elegida?.noches ?? p.noches : null
  if (o.porNoche && !noches) return null
  const subtotal = Math.round(o.precio * cantidad * (noches ?? 1) * 100) / 100
  const factores = [o.unidad === 'grupo' ? null : `${cantidad}`, noches ? `${noches} ${noches === 1 ? 'noche' : 'noches'}` : null].filter(Boolean)
  const precio = formatoMonto(o.precio, o.moneda)
  const texto = factores.length === 0 ? formatoMonto(subtotal, o.moneda) : `${factores.join(' × ')} × ${precio} = ${formatoMonto(subtotal, o.moneda)}`
  return { subtotal, texto }
}

export interface Preseleccion {
  marcadas: Record<number, FilaElegida>
  /** `unica`: una fila por puesto, marcada sola. `mas_barata`: había varias y ganó la de menor total. `null`: nada marcado. */
  como: 'unica' | 'mas_barata' | null
}

/**
 * Lo que queda marcado al abrir. Solo filas que pasan el filtro y tienen base de precio. Si hay
 * filas por persona para adulto, la elección va por persona (y las filas de grupo quedan para quien
 * las quiera); si no, por el total (habitación, vehículo o grupo).
 */
export function preseleccion(opciones: readonly OpcionTarifa[], c: Composicion | null, cal: CalendarioDelViaje | null): Preseleccion {
  if (!cal) return { marcadas: {}, como: null }
  const sirven = opciones.filter((o) => o.fueraPor.length === 0 && !!o.base && !!o.unidad)
  const porPersona = sirven.filter((o) => o.unidad === 'persona')
  const conAdulto = porPersona.some((o) => (o.tipo ?? 'adulto') === 'adulto')
  const candidatas = conAdulto ? porPersona : sirven.filter((o) => o.unidad !== 'persona')
  const puestos = new Map<string, OpcionTarifa[]>()
  for (const o of candidatas) puestos.set(cupoDeFila(o, cal), [...(puestos.get(cupoDeFila(o, cal)) ?? []), o])
  if (puestos.size === 0) return { marcadas: {}, como: null }
  let varias = false
  const marcadas: Record<number, FilaElegida> = {}
  // Una sola moneda, y los precios de monedas distintas no se comparan: si hay tarifas en pesos,
  // la línea va en pesos (una en USD sin tasa no «gana» por ser un número más chico).
  let moneda: string | null = candidatas.some((o) => o.moneda === 'COP') ? 'COP' : null
  for (const filas of puestos.values()) {
    const mismas: OpcionTarifa[] = moneda ? filas.filter((o) => o.moneda === moneda) : filas
    if (mismas.length === 0) continue
    if (mismas.length > 1) varias = true
    const gana: OpcionTarifa = [...mismas].sort((a, b) => (totalDeFila(a, c, cal)?.subtotal ?? a.precio) - (totalDeFila(b, c, cal)?.subtotal ?? b.precio) || a.indice - b.indice)[0]
    moneda = moneda ?? gana.moneda
    marcadas[gana.indice] = { indice: gana.indice, ...propuestaDeFila(gana, c, cal) }
  }
  return { marcadas, como: Object.keys(marcadas).length === 0 ? null : varias ? 'mas_barata' : 'unica' }
}

/** Marca `o` (o la desmarca si ya estaba): quita la que ocupaba su mismo puesto. */
export function alternarFila(marcadas: Record<number, FilaElegida>, o: OpcionTarifa, opciones: readonly OpcionTarifa[], c: Composicion | null, cal: CalendarioDelViaje | null): Record<number, FilaElegida> {
  if (marcadas[o.indice]) {
    const n = { ...marcadas }
    delete n[o.indice]
    return n
  }
  const cupo = cupoDeFila(o, cal)
  const porIndice = new Map(opciones.map((x) => [x.indice, x]))
  const n: Record<number, FilaElegida> = {}
  for (const [k, v] of Object.entries(marcadas)) {
    const otra = porIndice.get(Number(k))
    // Una fila del mismo puesto se va; una de otra moneda también (la línea es de una sola).
    if (otra && (cupoDeFila(otra, cal) === cupo || otra.moneda !== o.moneda)) continue
    // Pasar de «por persona» a «por el total» (o al revés) deja solo la nueva: no se suman.
    if (otra && (otra.unidad === 'persona') !== (o.unidad === 'persona')) continue
    n[Number(k)] = v
  }
  n[o.indice] = { indice: o.indice, ...(cal ? propuestaDeFila(o, c, cal) : {}) }
  return n
}

export interface GrupoDeTarifas {
  /** «Doble Estándar · Desayuno». */
  titulo: string
  opciones: OpcionTarifa[]
}

/** Las filas agrupadas por habitación (categoría) y plan, en el orden del tarifario. */
export function gruposDeTarifas(opciones: readonly OpcionTarifa[]): GrupoDeTarifas[] {
  const grupos = new Map<string, GrupoDeTarifas>()
  for (const o of opciones) {
    const titulo = [o.categoria, o.plan].filter(Boolean).join(' · ') || 'Tarifas'
    const g = grupos.get(titulo) ?? { titulo, opciones: [] }
    g.opciones.push(o)
    grupos.set(titulo, g)
  }
  return [...grupos.values()]
}
