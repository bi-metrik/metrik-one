/**
 * Adicionales DENTRO de una variante: la maleta extra, la silla, el seguro.
 *
 * Parte 1 de `proyectos/trappvel/clarity/docs/diseno/adicionales-y-ficha-por-ranura.md`.
 *
 * > *«Un equipaje adicional de bodega no lo pondría como otro ítem, sino que lo agregaría
 * > dentro del vuelo como adicional para que el sistema en la cotización me lo muestre
 * > todo junto.»* — Mauricio, 2026-09-21.
 *
 * ## ⚠️⚠️ Cuelga de la VARIANTE, no de la ranura. Es LA decisión de este archivo.
 *
 * Una variante es un `items` (una fila): «Vuelo Avianca Basic» y «Vuelo LATAM» son dos
 * filas con el mismo `grupo`. La ranura es el `grupo`, o sea las dos a la vez.
 *
 * Una maleta de bodega extra en Avianca Basic cuesta una cosa; en LATAM puede venir
 * incluida o costar otra. Si el adicional colgara del **grupo**, cambiar de aerolínea
 * dejaría el adicional en pie con el precio de la otra: el total quedaría **bien sumado y
 * mal costeado**, que es el peor de los errores porque no falla en ninguna parte y no se
 * ve en pantalla.
 *
 * Colgando de la variante el adicional **viaja con ella**: la tarifa que elija esa
 * variante se lo lleva, la que elija otra no. Eso no lo sostiene una convención ni un
 * comentario: lo sostiene `adicionalesPorItem`, que empareja por `item_id` y por nada
 * más, y el hecho de que la cascada solo ve los ítems que el itinerario incluye.
 *
 * `adicionalesPorItem` es el sitio exacto donde esta decisión se puede romper, y por eso
 * vive en una función propia: emparejar por `grupo` compila, devuelve un mapa con la
 * misma forma, y **solo lo delata una prueba que mida la variante que NO debería subir**
 * (`adicionales.test.ts`). Medir «la de Avianca sube» pasa con las dos versiones.
 *
 * ## Suman, no compiten
 *
 * Dos adicionales sobre la misma variante suman los dos. No son variantes entre sí: no
 * hay nada que elegir. Por eso aquí no hay ranuras, ni candidatos, ni supuesto.
 *
 * ## La lista corta Y ADEMÁS texto libre (§1.3)
 *
 * Es el mismo patrón —y la misma razón— que el motivo de combinación
 * (`motivo-combinacion.ts`): *«un campo de texto libre no se puede estudiar; veinte
 * adicionales escritos a mano son veinte formas de escribir cinco cosas»*. Lo que caiga
 * en «otro» es la lista de candidatos a fijar, y sale **contado**, no recordado.
 *
 * ## R6 — nada de esto existe para una cotización sin adicionales
 *
 * Sin filas en `item_adicionales`, `totalesDeAdicionales` devuelve ceros y la cascada
 * suma exactamente lo que sumaba antes. Termotech, Arca y WMC no cambian un peso. El
 * corte es el dato, no un flag que alguien pueda encender.
 */

import { aPesos } from './tarifa-pasajero'
import { precioConMargen, type ConvencionMargen } from './precio-item'

// ── El catálogo (§1.3) ───────────────────────────────────────────────────────

export interface TipoAdicional {
  /** Lo que se guarda. Estable: renombrarlo rompería la serie ya acumulada. */
  codigo: string
  /** Lo que lee quien cotiza, y lo que se imprime si nadie escribió nada mejor. */
  etiqueta: string
}

/** El código de «otro»: el único que no aporta etiqueta propia. */
export const ADICIONAL_OTRO = 'otro'

/**
 * La lista de arranque, sacada de los itinerarios reales de Trappvel.
 *
 * *«La lista se corrige con lo que aparezca: no sale de esta hoja.»* Vive en código y no
 * en configuración por el mismo motivo que la de motivos: cambiarla es una decisión que
 * se revisa en un PR, no un dato que alguien edite sin que quede traza.
 */
export const TIPOS_ADICIONAL: readonly TipoAdicional[] = [
  { codigo: 'equipaje_bodega', etiqueta: 'Equipaje de bodega adicional' },
  { codigo: 'seleccion_silla', etiqueta: 'Selección de silla' },
  { codigo: 'seguro_viaje', etiqueta: 'Seguro de viaje' },
  { codigo: 'cambio_fecha', etiqueta: 'Cambio de fecha o flexibilidad' },
  { codigo: ADICIONAL_OTRO, etiqueta: 'Otro' },
] as const

/** ¿Este código es uno de los de la lista? */
export function esTipoConocido(codigo: string | null | undefined): boolean {
  if (!codigo) return false
  return TIPOS_ADICIONAL.some(t => t.codigo === codigo)
}

// ── La forma de un adicional ─────────────────────────────────────────────────

/** De dónde salió el adicional. Ver `origen` en la nota de abajo. */
export type OrigenAdicional = 'manual' | 'pantallazo'

export interface Adicional {
  id: string
  /** La variante a la que pertenece. NUNCA la ranura: ver la cabecera. */
  itemId: string
  /** Uno de `TIPOS_ADICIONAL`, o `null` cuando nadie eligió de la lista. */
  codigo: string | null
  /** Lo que una persona escribió. `null` cuando solo se eligió de la lista. */
  nombre: string | null
  /**
   * Cuántos. Nace en 1.
   *
   * Resuelve sin preguntar el caso de las seis maletas de un grupo de seis adultos: quien
   * cotiza pone 6. **No hay que decidir de antemano si un adicional es por pasajero o por
   * reserva**, que es la pregunta que no tiene una respuesta buena para todos los casos.
   */
  cantidad: number
  /** Costo UNITARIO, en `moneda`. */
  costo: number
  /** Precio UNITARIO al cliente, en `moneda`. */
  precio: number
  moneda: string
  /** Tasa a pesos. `null` cuando `moneda === 'COP'` — ahí no hay nada que convertir. */
  tasaCop: number | null
  /**
   * Escrito a mano, o leído de un pantallazo.
   *
   * ⚠️ Hoy SIEMPRE vale `'manual'`, y la acción que lo crea **no acepta un parámetro para
   * cambiarlo**. Es la misma regla que ya obliga `armarFilasDeRegistro` con la propuesta
   * del motor: un valor que se puede pasar por parámetro se pasa, y el día que se mida
   * cuántos adicionales llegaron leídos, la cifra estaría midiendo a quien llamó, no al
   * lector. El día que la lectura del pantallazo aprenda a extraerlos, será ella la que
   * escriba `'pantallazo'` directamente.
   */
  origen: OrigenAdicional
  orden: number
  /**
   * El precio lo escribió una persona. `false` = sale del margen global de la cotización
   * y se recalcula cuando ese margen cambia (P4 del ensayo del 2026-09-23, decisión de
   * Mauricio). Sin la columna en la base (migración pendiente) vale `true`: el precio
   * guardado manda, que es exactamente lo de antes.
   */
  precioManual: boolean
}

/** El margen global de la cotización: de él sale el precio de un adicional sin precio a mano. */
export interface MargenDeCotizacion {
  margenPct: number | null
  convencion: ConvencionMargen | null
}

/** Lo que se puede escribir de un adicional: todo menos su identidad y su origen. */
export interface EntradaAdicional {
  codigo?: string | null
  nombre?: string | null
  cantidad?: number | null
  costo?: number | null
  /**
   * `null`/ausente = el precio sale del margen global (P4). Un número = escrito a mano.
   * Hasta el 2026-09-23 un precio vacío se guardaba en 0: el costo entraba al viaje y al
   * cliente no se le cobraba nada.
   */
  precio?: number | null
  moneda?: string | null
  tasaCop?: number | null
  /**
   * La persona ya vio el aviso de un precio a mano en 0 o por debajo del costo y lo quiere
   * así. Sin esto, ese precio se rechaza con `requiereConfirmacion`.
   */
  confirmarPrecioBajo?: boolean
}

/** Un adicional limpio, o por qué no se puede guardar. */
export type Normalizacion =
  | { ok: true; valor: Omit<Adicional, 'id' | 'itemId' | 'origen' | 'orden'> }
  | { ok: false; motivo: string; requiereConfirmacion?: boolean }

/**
 * El precio UNITARIO de un adicional sin precio a mano: su costo con el margen global, con
 * la MISMA aritmética de la línea (`precioConMargen`: `costo / (1 − margen)` sobre venta).
 * Al peso en pesos; a dos decimales en otra moneda, que es la unidad en que se guarda.
 */
export function precioDerivadoDeAdicional(
  costoUnitario: number,
  moneda: string,
  margen: MargenDeCotizacion,
): number {
  const bruto = precioConMargen(Number(costoUnitario) || 0, margen.margenPct ?? 0, margen.convencion ?? undefined)
  return moneda.toUpperCase() === 'COP' ? Math.round(bruto) : Math.round(bruto * 100) / 100
}

/**
 * El adicional, limpio, tal como se guarda.
 *
 * Las reglas, y ninguna es de forma:
 *
 *  · **Un código que no está en la lista se descarta**, no se guarda crudo. Llega de un
 *    `select` del navegador, o sea de un endpoint alcanzable: una categoría inventada
 *    ensuciaría la serie que §1.3 existe para poder contar. El TEXTO sobrevive igual —es
 *    el dato caro— así que descartar el código no borra lo que alguien escribió.
 *  · **Vacío y espacios en blanco valen `null`.** `''` y `null` tienen que significar lo
 *    mismo, o «nadie escribió» y «alguien escribió y borró» se cuentan distinto.
 *  · **Sin código y sin nombre no hay adicional.** Una línea que suma dinero al viaje sin
 *    decir qué es aparece en el documento del cliente como un cargo anónimo.
 *  · ⚠️ **En otra moneda SIN tasa se RECHAZA, no se guarda en cero.** Es la asimetría de
 *    R-P5 aplicada donde sí se puede: un adicional guardado que no se puede convertir
 *    aportaría cero al total mientras se imprime como incluido — plata que se regala sin
 *    que nada falle. Rechazar al escribir es la única forma de que esa fila no exista.
 */
export function normalizarAdicional(entrada: EntradaAdicional, margen: MargenDeCotizacion | null = null): Normalizacion {
  const codigo = esTipoConocido(entrada.codigo) ? (entrada.codigo as string) : null
  const nombre = limpiar(entrada.nombre)
  if (codigo === null && nombre === null) {
    return { ok: false, motivo: 'Elige de la lista o escribe de qué es el adicional.' }
  }

  const cantidad = Number(entrada.cantidad ?? 1)
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    return { ok: false, motivo: 'La cantidad tiene que ser un número entero desde 1.' }
  }

  const costo = Number(entrada.costo ?? 0)
  const precioEscrito = entrada.precio === null || entrada.precio === undefined ? null : Number(entrada.precio)
  if (!Number.isFinite(costo) || costo < 0 || (precioEscrito !== null && (!Number.isFinite(precioEscrito) || precioEscrito < 0))) {
    return { ok: false, motivo: 'El costo y el precio no pueden ser negativos.' }
  }

  const moneda = (limpiar(entrada.moneda) ?? 'COP').toUpperCase()

  // P4 · sin precio escrito, el precio sale del margen global. Nunca un cero silencioso.
  if (precioEscrito === null && margen === null) {
    return { ok: false, motivo: 'Escribe el precio del adicional: no se pudo leer el margen de la cotización.' }
  }
  const precioManual = precioEscrito !== null
  const precio = precioEscrito ?? precioDerivadoDeAdicional(costo, moneda, margen as MargenDeCotizacion)
  // Un precio a mano en 0 o por debajo del costo es plata que se regala: se pregunta antes.
  if (precioManual && (precio === 0 || precio < costo) && entrada.confirmarPrecioBajo !== true) {
    return {
      ok: false,
      requiereConfirmacion: true,
      motivo: precio === 0
        ? 'El precio al cliente es 0: el costo entra al viaje y no se cobra. ¿Lo guardas así?'
        : 'El precio al cliente está por debajo del costo: se vende a pérdida. ¿Lo guardas así?',
    }
  }
  const tasaBruta = Number(entrada.tasaCop)
  const tasaCop = Number.isFinite(tasaBruta) && tasaBruta > 0 ? tasaBruta : null
  if (moneda !== 'COP' && tasaCop === null) {
    return {
      ok: false,
      motivo:
        `El adicional está en ${moneda} y falta la tasa de cambio a pesos. ` +
        'Escríbela para poder guardarlo.',
    }
  }

  return {
    ok: true,
    valor: { codigo, nombre, cantidad, costo, precio, moneda, tasaCop: moneda === 'COP' ? null : tasaCop, precioManual },
  }
}

/**
 * Cómo se llama el adicional de cara a una persona, y en el documento del cliente.
 *
 * Lo escrito manda sobre la etiqueta del catálogo: quien puso «Maleta 23 kg Bogotá–San
 * Andrés» dijo algo más preciso que «Equipaje de bodega adicional». Sin texto, la
 * etiqueta; y si el código ya no está en la lista, el código crudo antes que un hueco.
 */
export function etiquetaDeAdicional(ad: Pick<Adicional, 'codigo' | 'nombre'>): string {
  const propio = limpiar(ad.nombre)
  if (propio !== null) return propio
  const tipo = TIPOS_ADICIONAL.find(t => t.codigo === ad.codigo)
  if (tipo && tipo.codigo !== ADICIONAL_OTRO) return tipo.etiqueta
  return ad.codigo ?? 'Adicional'
}

/**
 * El adicional como lo dice la ficha del documento, sin cifra: «Maleta 23 kg ×2». Lo usan el
 * PDF y «Así lo ve el cliente», para que la vista previa y el documento digan lo mismo.
 */
export function adicionalEnLaFicha(ad: Pick<Adicional, 'codigo' | 'nombre' | 'cantidad'>): string {
  return ad.cantidad > 1 ? `${etiquetaDeAdicional(ad)} ×${ad.cantidad}` : etiquetaDeAdicional(ad)
}

// ── El dinero ────────────────────────────────────────────────────────────────

/** Lo mínimo para sumar un adicional. `Adicional` lo cumple por forma. */
export interface AdicionalParaSuma {
  codigo?: string | null
  nombre?: string | null
  cantidad?: number | null
  costo?: number | null
  precio?: number | null
  moneda?: string | null
  tasaCop?: number | null
}

export interface TotalesAdicionales {
  /** Costo de TODOS los adicionales de la línea, en pesos, al peso. */
  costo: number
  /** Precio de TODOS los adicionales de la línea, en pesos, al peso. */
  precio: number
  /**
   * Los que NO se pudieron convertir a pesos y por eso aportan CERO.
   *
   * Nombrados, no contados: «hay uno sin tasa» no se puede corregir. En condiciones
   * normales sale vacío —`normalizarAdicional` rechaza esa fila al escribirla— y solo se
   * llena con datos escritos por otra vía (SQL, un cargue). Un cero silencioso ahí es
   * plata que se regala.
   */
  sinConvertir: string[]
}

/**
 * Lo que los adicionales le suman a la línea, en pesos.
 *
 * Se redondea al peso POR ADICIONAL y después se suma, no al revés: el documento imprime
 * cada adicional con su cifra y el cliente sí suma la columna. Es el mismo criterio que
 * ya aplica la cascada con el precio unitario de cada línea.
 */
export function totalesDeAdicionales(
  adicionales: readonly AdicionalParaSuma[] | null | undefined,
): TotalesAdicionales {
  let costo = 0
  let precio = 0
  const sinConvertir: string[] = []

  for (const ad of adicionales ?? []) {
    const cantidad = Math.max(0, Math.trunc(Number(ad.cantidad ?? 1) || 0))
    const moneda = (ad.moneda ?? 'COP').toUpperCase()
    const tasa = ad.tasaCop ?? null
    const costoCOP = aPesos(Number(ad.costo) || 0, moneda, tasa)
    const precioCOP = aPesos(Number(ad.precio) || 0, moneda, tasa)
    if (costoCOP === null || precioCOP === null) {
      sinConvertir.push(etiquetaDeAdicional({ codigo: ad.codigo ?? null, nombre: ad.nombre ?? null }))
      continue
    }
    costo += Math.round(costoCOP * cantidad)
    precio += Math.round(precioCOP * cantidad)
  }

  return { costo, precio, sinConvertir }
}

/**
 * Margen REAL del adicional: lo que queda dentro de SU precio.
 *
 * El adicional trae costo y precio, así que su margen ya está tomado y no se deriva de
 * ninguna convención: es `(precio − costo) / precio`. *«Una agencia puede revender una
 * maleta a costo o con margen, y el sistema no tiene por qué suponer cuál.»*
 *
 * `null` sin precio o sin conversión: un 0 se leería como «revendida a costo», que es una
 * afirmación distinta de «todavía no hay con qué medirlo».
 */
export function margenDeAdicional(ad: AdicionalParaSuma): number | null {
  const moneda = (ad.moneda ?? 'COP').toUpperCase()
  const tasa = ad.tasaCop ?? null
  const costo = aPesos(Number(ad.costo) || 0, moneda, tasa)
  const precio = aPesos(Number(ad.precio) || 0, moneda, tasa)
  if (costo === null || precio === null) return null
  if (precio <= 0) return null
  return ((precio - costo) / precio) * 100
}

// ── El emparejamiento: aquí se rompe la decisión de la cabecera ──────────────

/** Lo mínimo de una fila cruda de `item_adicionales`. */
export interface FilaAdicional {
  id?: string | null
  item_id?: string | null
  codigo?: string | null
  nombre?: string | null
  cantidad?: number | null
  costo?: number | null
  precio?: number | null
  moneda?: string | null
  tasa_cop?: number | null
  origen?: string | null
  orden?: number | null
  /** Ausente mientras la migración de `precio_manual` no esté aplicada: vale `true`. */
  precio_manual?: boolean | null
}

/** Una fila cruda, con la forma que usa el resto del código. */
export function aAdicional(fila: FilaAdicional): Adicional {
  return {
    id: (fila.id ?? '') as string,
    itemId: (fila.item_id ?? '') as string,
    codigo: esTipoConocido(fila.codigo) ? (fila.codigo as string) : null,
    nombre: limpiar(fila.nombre),
    cantidad: Math.max(1, Math.trunc(Number(fila.cantidad ?? 1) || 1)),
    costo: Number(fila.costo) || 0,
    precio: Number(fila.precio) || 0,
    moneda: ((fila.moneda ?? 'COP') as string).toUpperCase(),
    tasaCop: Number.isFinite(Number(fila.tasa_cop)) && Number(fila.tasa_cop) > 0 ? Number(fila.tasa_cop) : null,
    origen: fila.origen === 'pantallazo' ? 'pantallazo' : 'manual',
    orden: Number(fila.orden) || 0,
    precioManual: fila.precio_manual !== false,
  }
}

/**
 * Los adicionales sin precio a mano cuyo precio guardado ya no corresponde al margen global
 * (P4): cambió el margen, o el costo. Devuelve lo que hay que reescribir; los de precio a
 * mano NUNCA salen aquí.
 *
 * Se reescribe el precio guardado en vez de derivarlo en cada lectura para que el PDF, la
 * pantalla, la cascada y la huella de la autorización lean la MISMA cifra sin tener que
 * saber del margen: el precio se decide en un solo sitio, al recalcular.
 */
export function preciosPorResincronizar(
  filas: readonly FilaAdicional[],
  margen: MargenDeCotizacion,
): { id: string; precio: number }[] {
  const out: { id: string; precio: number }[] = []
  for (const fila of filas) {
    if (fila.precio_manual !== false || !fila.id) continue
    const ad = aAdicional(fila)
    const precio = precioDerivadoDeAdicional(ad.costo, ad.moneda, margen)
    if (precio !== ad.precio) out.push({ id: fila.id, precio })
  }
  return out
}

/**
 * ⚠️⚠️ Los adicionales de cada VARIANTE, por `item_id`. La decisión de la cabecera, en
 * una línea de código.
 *
 * Emparejar por el `grupo` del ítem en lugar de por su id compila, devuelve un mapa de la
 * misma forma y **deja el total bien sumado y mal costeado**: la maleta de Avianca se le
 * cobraría también a la tarifa que eligió LATAM. Por eso esto no está en línea dentro de
 * `contextoDeCotizacion`: es la mutación que las pruebas tienen que poder tumbar.
 *
 * El orden dentro de cada variante es el de `orden` y, a igualdad, el del id: sin orden
 * estable, el documento del cliente lista los adicionales distinto en cada render.
 */
export function adicionalesPorItem(filas: readonly FilaAdicional[]): Map<string, Adicional[]> {
  const mapa = new Map<string, Adicional[]>()
  for (const fila of filas) {
    const ad = aAdicional(fila)
    if (ad.itemId === '') continue
    const lista = mapa.get(ad.itemId) ?? []
    lista.push(ad)
    mapa.set(ad.itemId, lista)
  }
  for (const lista of mapa.values()) {
    lista.sort((a, b) => (a.orden !== b.orden ? a.orden - b.orden : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }
  return mapa
}

/**
 * ⚠️⚠️ Le cuelga a cada línea SUS adicionales. **La decisión del frente, ejecutable.**
 *
 * Es el único sitio de todo el código donde «cuelga de la variante» se puede convertir en
 * «cuelga de la ranura», y por eso existe como función en vez de estar en línea dentro de
 * `contextoDeCotizacion`: una prueba tiene que poder mutarlo y verlo caer.
 *
 * La mutación concreta, que compila y no falla en ninguna parte:
 *
 * ```ts
 * // mal: el adicional cuelga de la RANURA
 * const delGrupo = filas.filter(f => grupoDe(f.item_id) === item.grupo)
 * ```
 *
 * Con ella, la maleta de Avianca Basic se le cobra también a la tarifa que eligió LATAM:
 * el total queda bien sumado y mal costeado, y eso no se ve en pantalla.
 */
export function adjuntarAdicionales<T extends { id: string }>(
  items: readonly T[],
  filas: readonly FilaAdicional[],
): (T & { adicionales: Adicional[] })[] {
  const porItem = adicionalesPorItem(filas)
  return items.map(item => ({ ...item, adicionales: porItem.get(item.id) ?? [] }))
}

// ── Tolerancia de despliegue ─────────────────────────────────────────────────

/** La tabla que crea la migración de este frente. */
export const TABLA_ADICIONALES = 'item_adicionales'

/**
 * ¿La consulta falló porque la tabla todavía no existe?
 *
 * Mismo criterio y mismo motivo que `faltanLasTablasDeItinerarios`: el deploy va ANTES
 * que el SQL, y sin tolerar esto el editor de cotización **dejaría de abrir**, que es una
 * regresión mucho peor que no tener adicionales.
 *
 * ⚠️ Se exige que el mensaje NOMBRE la tabla. Sin eso, un `42P01` de otra tabla se leería
 * como «todavía no hay adicionales» y el defecto real quedaría invisible.
 *
 * **Esta pieza se borra el día que la migración esté aplicada en todos los entornos.**
 */
export function faltaLaTablaDeAdicionales(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false
  const codigo = error.code ?? ''
  if (codigo !== '42P01' && codigo !== 'PGRST205' && codigo !== 'PGRST204') return false
  return (error.message ?? '').toLowerCase().includes(TABLA_ADICIONALES)
}

function limpiar(texto: string | null | undefined): string | null {
  const t = (texto ?? '').trim()
  return t === '' ? null : t
}
