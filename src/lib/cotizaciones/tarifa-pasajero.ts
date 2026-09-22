/**
 * Tarifa por tipo de pasajero: cuánto cuesta cada adulto, cada niño y cada infante de
 * una línea de la cotización, leído de uno a tres pantallazos del proveedor.
 *
 * Diseño: `proyectos/trappvel/clarity/docs/diseno/tarifa-por-pasajero.md`. Las reglas
 * TP1-TP4 (lectura), CC1-CC5 (capturas complementarias) y P1-P7 (pantalla) viven aquí o
 * se apoyan en lo que aquí se decide.
 *
 * ## Por qué es un módulo puro
 *
 * Todo lo que decide qué número entra a un costo se prueba sin red y sin base: qué
 * casillas pide cada composición, si un pantallazo cuadra con su casilla, si dos
 * capturas son del mismo hotel, y cómo se reparte el total entre tipos de pasajero. La
 * server action solo lee, llama al modelo y persiste.
 *
 * ## Lo que el modelo NO hace
 *
 * TP1: el modelo lee `cantidad` y `subtotal` por fila, tal cual. **El unitario lo
 * calcula el servidor** dividiendo aquí. En LATAM la fila trae `Tasa de Embarque` por
 * pasajero y `Fee` total de fila en columnas vecinas: un modelo que multiplica columna
 * por columna duplica o parte mal el fee, y el error se ve igual que un acierto.
 *
 * ## La edad no existe aquí
 *
 * Solo importa cuántos hay de cada tipo, y ese corte lo pone cada proveedor. Quien cotiza
 * clasifica al menor según el proveedor (CC4b); el sistema compara cantidades (TP3).
 */

import type { MargenProveedor } from './margen-proveedor'
import { leerCorrecciones, type Correcciones } from './correcciones'

// ── Tipos de pasajero y composición ──────────────────────────────────────────

export type TipoPasajero = 'adulto' | 'nino' | 'infante'

/** Orden canónico: el de la pantalla, el PDF y los rubros. */
export const TIPOS_PASAJERO: readonly TipoPasajero[] = ['adulto', 'nino', 'infante']

export interface Composicion {
  adultos: number
  ninos: number
  infantes: number
}

/** Nombre del tipo en una línea de costo o de precio. Nunca siglas (P3). */
export const NOMBRE_TIPO: Record<TipoPasajero, string> = {
  adulto: 'Adulto',
  nino: 'Niño',
  infante: 'Infante',
}

const PALABRA: Record<TipoPasajero, [string, string]> = {
  adulto: ['adulto', 'adultos'],
  nino: ['niño', 'niños'],
  infante: ['infante', 'infantes'],
}

function enteroNoNegativo(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null
  return n
}

/**
 * La composición que se puede usar para cotizar, o `null` si no hay una.
 *
 * ⚠️ Sin al menos un adulto no hay composición: el diseño lo exige (`adultos >= 1`), y
 * sin adultos no existe la casilla «solo adultos» contra la cual restar. Niños e
 * infantes ausentes o vacíos valen cero: es el default declarado de la etapa 1.
 *
 * ⚠️ Un valor que no es entero no se redondea. «2,5 adultos» es un dato mal escrito, y
 * redondearlo decidiría por alguien cuántos viajan.
 */
export function normalizarComposicion(raw: unknown): Composicion | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const adultos = enteroNoNegativo(r.adultos)
  if (adultos === null || adultos < 1) return null
  const ninos = r.ninos === undefined || r.ninos === null || r.ninos === '' ? 0 : enteroNoNegativo(r.ninos)
  const infantes = r.infantes === undefined || r.infantes === null || r.infantes === '' ? 0 : enteroNoNegativo(r.infantes)
  if (ninos === null || infantes === null) return null
  return { adultos, ninos, infantes }
}

export function cantidadDeTipo(c: Composicion, tipo: TipoPasajero): number {
  if (tipo === 'adulto') return c.adultos
  if (tipo === 'nino') return c.ninos
  return c.infantes
}

export function tiposPresentes(c: Composicion): TipoPasajero[] {
  return TIPOS_PASAJERO.filter(t => cantidadDeTipo(c, t) > 0)
}

export function totalPasajeros(c: Composicion): number {
  return c.adultos + c.ninos + c.infantes
}

export function mismaComposicion(a: Composicion, b: Composicion): boolean {
  return a.adultos === b.adultos && a.ninos === b.ninos && a.infantes === b.infantes
}

/**
 * La ocupación dicha con números y palabras (P3).
 *
 * `coma`: «2 adultos, 1 niño, 1 infante» — la búsqueda literal de una casilla.
 * `y`:    «2 adultos, 1 niño y 1 infante» — dentro de una frase.
 */
export function describirOcupacion(c: Composicion, conector: 'coma' | 'y' = 'coma'): string {
  const partes = tiposPresentes(c).map(t => {
    const n = cantidadDeTipo(c, t)
    return `${n} ${PALABRA[t][n === 1 ? 0 : 1]}`
  })
  if (partes.length === 0) return 'sin pasajeros'
  if (conector === 'coma' || partes.length === 1) return partes.join(', ')
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

/** «el niño», «los niños», «el infante»... para las frases de la pantalla. */
function articuloTipo(tipo: TipoPasajero, cantidad: number): string {
  return cantidad === 1 ? `el ${PALABRA[tipo][0]}` : `los ${PALABRA[tipo][1]}`
}

// ── Casillas ─────────────────────────────────────────────────────────────────

export type ClaveCasilla = 'grupo_completo' | 'sin_infantes' | 'solo_adultos'

export interface CasillaDef {
  clave: ClaveCasilla
  /** 1, 2 o 3, consecutivo: con una casilla que no aplica no queda un hueco. */
  numero: number
  titulo: string
  /** La ocupación exacta que se busca en la plataforma para esta casilla. */
  ocupacion: Composicion
  /** La instrucción literal, con la ocupación en palabras (P3). */
  busqueda: string
  /** `false` solo en la casilla 1: las demás dependen de lo que traiga la primera (P1). */
  condicional: boolean
  /** Por qué está en gris mientras no haga falta (P1). */
  razonCondicional: string | null
}

/** Qué se repite en la segunda búsqueda, dicho con las palabras de cada ranura. */
function mismoProducto(ranuraSlug: string): string {
  if (ranuraSlug === 'vuelo_detalle') return 'el mismo vuelo y tarifa'
  if (ranuraSlug === 'actividad_detalle') return 'la misma actividad y fecha'
  if (ranuraSlug === 'traslado_detalle') return 'el mismo trayecto y vehículo'
  return 'el mismo hotel, habitación y fechas'
}

/**
 * Las casillas que la composición PUEDE necesitar, todas de una vez (6.1).
 *
 * Orden CC4a: se empieza por el grupo completo y se quita un tipo a la vez. Es la
 * búsqueda que el equipo hace de todas formas, y en vuelos resuelve todo con una sola.
 *
 * P2: lo que no aplica no aparece. Sin infantes no hay «sin el infante»; con solo
 * adultos hay una sola casilla. Con infantes y sin niños, «sin el infante» y «solo
 * adultos» son la MISMA búsqueda: queda una, y se llama «Solo adultos».
 */
export function casillasDe(c: Composicion, ranuraSlug: string): CasillaDef[] {
  const repetir = mismoProducto(ranuraSlug)
  const hayMenores = c.ninos + c.infantes > 0
  const separa = c.ninos > 0 && c.infantes > 0
    ? 'adultos, niños e infantes'
    : c.ninos > 0 ? 'adultos y niños' : 'adultos e infantes'
  const razon = `Solo si el pantallazo 1 no separa ${separa}`

  const casillas: CasillaDef[] = [{
    clave: 'grupo_completo',
    numero: 1,
    titulo: hayMenores ? 'Grupo completo' : 'Pantallazo',
    ocupacion: c,
    busqueda: `Busca en la plataforma: ${describirOcupacion(c)}`,
    condicional: false,
    razonCondicional: null,
  }]
  if (!hayMenores) return casillas

  if (c.ninos > 0 && c.infantes > 0) {
    const sinInfantes = { adultos: c.adultos, ninos: c.ninos, infantes: 0 }
    casillas.push({
      clave: 'sin_infantes',
      numero: 2,
      titulo: c.infantes === 1 ? 'Sin el infante' : 'Sin los infantes',
      ocupacion: sinInfantes,
      busqueda: `Busca otra vez ${repetir} con: ${describirOcupacion(sinInfantes)}`,
      condicional: true,
      razonCondicional: razon,
    })
  }

  const soloAdultos = { adultos: c.adultos, ninos: 0, infantes: 0 }
  casillas.push({
    clave: 'solo_adultos',
    numero: casillas.length + 1,
    titulo: 'Solo adultos',
    ocupacion: soloAdultos,
    busqueda: `Busca otra vez ${repetir} con: ${describirOcupacion(soloAdultos)}`,
    condicional: true,
    razonCondicional: razon,
  })
  return casillas
}

// ── Lo que se guarda de cada pantallazo ──────────────────────────────────────

export interface FilaTipo {
  tipo: TipoPasajero
  cantidad: number
  /** Valor de TODA la fila (todos los pasajeros de ese tipo), en la moneda de la captura. */
  subtotal: number
}

export interface OcupacionLeida {
  adultos: number | null
  ninos: number | null
  infantes: number | null
  /** Total de personas cuando la pantalla no las separa («3 huéspedes»). */
  total: number | null
}

/**
 * Lo que queda de un pantallazo aceptado en una casilla (CC5).
 *
 * La IMAGEN no se guarda, igual que en el cargue de siempre: lo que se guarda es lo que
 * se leyó de ella, que es lo que responde «de dónde salió cada número».
 */
export interface LecturaCasilla {
  moneda: string
  /** Precio de la ocupación de la captura, ya resuelto el `base_precio`. */
  total: number
  /**
   * Lo que paga la agencia cuando la captura lo muestra aparte (liquidación con
   * comisión descontada). Es el COSTO.
   *
   * Lo resuelve `costo-agencia.ts`: el neto escrito manda (leído y nunca recalculado,
   * hallazgo 7.1) y la comisión solo rellena el hueco cuando el neto no está.
   */
  aPagarAgencia: number | null
  /**
   * Si ese número estaba escrito o se derivó de la comisión. Ausente en las lecturas
   * anteriores al 2026-09-19, que solo sabían leerlo escrito.
   */
  costoAgenciaOrigen?: 'neto_leido' | 'derivado_comision' | null
  /** Desglose por tipo tal como se leyó. Vacío = la pantalla trae un solo total. */
  porTipo: FilaTipo[]
  ocupacion: OcupacionLeida
  /** La ocupación no está en la imagen y se tomó del ítem (regla aprobada 7.4). */
  ocupacionDelItem: boolean
  /**
   * Lo que identifica el producto, para comparar dos capturas (CC1). Un valor que se
   * tomó del ítem y no de la imagen NO va aquí: no es evidencia de nada.
   */
  identidad: Record<string, string | null>
  /** Lo que se le dice al cliente y no es costo (impuestos en destino, 7.3). */
  notasCliente: string[]
  /** Lo que alguien tiene que revisar antes de confirmar. */
  alertas: string[]
  /** Lo leído, para mostrarlo a un clic. */
  campos: { label: string; valor: string }[]
  nombre: string
  descripcion: string
  leidaEn: string
  /** CC2: la resta con la casilla de más personas dio cero y alguien confirmó que el menor no paga. */
  menorNoPagaConfirmado?: boolean
}

export type CasillasLeidas = Partial<Record<ClaveCasilla, LecturaCasilla>>

/** El monto con el que se costea una captura: lo que paga la agencia si está, si no el total. */
export function montoDeCosto(l: LecturaCasilla): number {
  return l.aPagarAgencia !== null && l.aPagarAgencia > 0 ? l.aPagarAgencia : l.total
}

/**
 * La composición que la propia captura ACREDITA, o `null` si la imagen no la dice.
 *
 * Es lo que convierte la composición de una PREGUNTA en un RESULTADO (§2.4 del diseño del
 * 2026-09-21): la lectura ya devuelve `ocupacion_adultos`, `ocupacion_ninos` y
 * `ocupacion_infantes` — medido, la captura de Amadeus devuelve 2 adultos y 1 infante sin
 * que nadie los escriba. Quien cotiza pega primero y corrige después, en vez de declarar a
 * quién cubre la línea antes de tener nada delante.
 *
 * Devuelve `null`, y entonces hay que preguntar:
 *  · la imagen no muestra ocupación (`ocupacionDelItem`);
 *  · solo dice un total de personas («3 huéspedes»), que no se puede partir por tipo;
 *  · lo que muestra no tiene un adulto (una tarjeta que solo lista un menor).
 *
 * Un `null` NO se rellena con ceros: eso convertiría un desconocimiento en una afirmación
 * sobre cuántos viajan, que es el dato con el que se costea.
 */
export function composicionDeLectura(l: LecturaCasilla): Composicion | null {
  if (l.ocupacionDelItem) return null
  const o = ocupacionObservada(l)
  if (o.adultos === null && o.ninos === null && o.infantes === null) return null
  return normalizarComposicion({
    adultos: o.adultos ?? 0,
    ninos: o.ninos ?? 0,
    infantes: o.infantes ?? 0,
  })
}

/**
 * Quiénes del viaje se quedan sin acomodar con lo que esta línea cubre, o `null` si no
 * falta nadie (§2.4).
 *
 * ⚠️ Solo cuenta lo que FALTA. Una línea que cubre de más no se reporta: el sistema compara
 * para avisar de un hueco, no para discutir una decisión de quien cotiza.
 */
export function faltanPorAcomodar(linea: Composicion, viaje: Composicion | null): Composicion | null {
  if (!viaje) return null
  const falta: Composicion = {
    adultos: Math.max(0, viaje.adultos - linea.adultos),
    ninos: Math.max(0, viaje.ninos - linea.ninos),
    infantes: Math.max(0, viaje.infantes - linea.infantes),
  }
  return totalPasajeros(falta) > 0 ? falta : null
}

/** La ocupación que ACREDITA la captura: la de las filas si hay desglose, la leída si no. */
export function ocupacionObservada(l: LecturaCasilla): OcupacionLeida {
  if (l.porTipo.length > 0) {
    const suma = (t: TipoPasajero) => l.porTipo.filter(f => f.tipo === t).reduce((a, f) => a + f.cantidad, 0)
    const adultos = suma('adulto')
    const ninos = suma('nino')
    const infantes = suma('infante')
    return { adultos, ninos, infantes, total: adultos + ninos + infantes }
  }
  return l.ocupacion
}

// ── Formato ──────────────────────────────────────────────────────────────────

export function formatoMonto(valor: number, moneda: string): string {
  const m = (moneda || 'COP').toUpperCase()
  if (m === 'COP') {
    return `$${Math.round(valor).toLocaleString('es-CO')}`
  }
  return `${valor.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${m}`
}

// ── Validación de un pantallazo contra su casilla ────────────────────────────

export type CodigoCasilla = 'CASILLA' | 'NO_HACE_FALTA' | 'TP2' | 'TP3' | 'CC1' | 'CC2'

export type ValidacionCasilla =
  | { ok: true; alertas: string[] }
  | { ok: false; codigo: CodigoCasilla; mensaje: string }

/**
 * TP2 · la suma de las filas por tipo tiene que dar el total general.
 *
 * Tolerancia de redondeo: 1 peso por fila (diseño §5). Más que eso no es redondeo: es una
 * fila mal leída, y dividir sobre ella produciría un precio por pasajero falso.
 */
export function desgloseCuadra(l: LecturaCasilla): boolean {
  if (l.porTipo.length === 0) return true
  const suma = l.porTipo.reduce((a, f) => a + f.subtotal, 0)
  return Math.abs(suma - l.total) <= l.porTipo.length
}

/** ¿La captura trae el precio de TODOS los tipos que viajan en su ocupación? */
export function traeDesgloseCompleto(l: LecturaCasilla, ocupacion: Composicion): boolean {
  if (l.porTipo.length === 0) return false
  return tiposPresentes(ocupacion).every(t => l.porTipo.some(f => f.tipo === t && f.cantidad > 0))
}

function describirObservada(o: OcupacionLeida): string {
  if (o.adultos !== null || o.ninos !== null || o.infantes !== null) {
    const c = { adultos: o.adultos ?? 0, ninos: o.ninos ?? 0, infantes: o.infantes ?? 0 }
    return describirOcupacion(c, 'y')
  }
  return `${o.total} ${o.total === 1 ? 'persona' : 'personas'}`
}

/**
 * TP3 · ¿la ocupación de la captura es la de la casilla?
 *
 * Devuelve `null` cuando coincide o cuando no hay con qué comparar (esa decisión la toma
 * quien llama: la captura sin ocupación se acepta con la del ítem y una alerta, 7.4).
 */
function ocupacionNoCoincide(observada: OcupacionLeida, esperada: Composicion): boolean {
  const porTipoVisible = observada.adultos !== null || observada.ninos !== null || observada.infantes !== null
  if (porTipoVisible) {
    return (observada.adultos ?? 0) !== esperada.adultos
      || (observada.ninos ?? 0) !== esperada.ninos
      || (observada.infantes ?? 0) !== esperada.infantes
  }
  if (observada.total !== null) return observada.total !== totalPasajeros(esperada)
  return false
}

function sinOcupacionVisible(o: OcupacionLeida): boolean {
  return o.adultos === null && o.ninos === null && o.infantes === null && o.total === null
}

/** Qué se compara entre dos capturas, por ranura, y cómo se nombra cada cosa. */
const IDENTIDAD_POR_RANURA: Record<string, { campo: string; nombre: string; otro: string; mismo: string; queSeVe?: string }[]> = {
  hotel_detalle: [
    { campo: 'hotel', nombre: 'hotel', otro: 'otro hotel', mismo: 'el mismo hotel', queSeVe: 'el nombre del hotel' },
    { campo: 'tipo_habitacion', nombre: 'habitación', otro: 'otra habitación', mismo: 'la misma habitación' },
    { campo: 'regimen', nombre: 'régimen', otro: 'otro régimen', mismo: 'el mismo régimen' },
    { campo: 'check_in', nombre: 'fechas', otro: 'otras fechas', mismo: 'las mismas fechas' },
    { campo: 'check_out', nombre: 'fechas', otro: 'otras fechas', mismo: 'las mismas fechas' },
  ],
  vuelo_detalle: [
    { campo: 'aerolinea', nombre: 'aerolínea', otro: 'otra aerolínea', mismo: 'la misma aerolínea', queSeVe: 'la aerolínea' },
    { campo: 'origen', nombre: 'ruta', otro: 'otra ruta', mismo: 'la misma ruta' },
    { campo: 'destino', nombre: 'ruta', otro: 'otra ruta', mismo: 'la misma ruta' },
    { campo: 'fecha_salida', nombre: 'fechas', otro: 'otras fechas', mismo: 'las mismas fechas' },
    { campo: 'fecha_regreso', nombre: 'fechas', otro: 'otras fechas', mismo: 'las mismas fechas' },
  ],
  actividad_detalle: [
    { campo: 'nombre', nombre: 'actividad', otro: 'otra actividad', mismo: 'la misma actividad', queSeVe: 'el nombre de la actividad' },
    { campo: 'fecha', nombre: 'fecha', otro: 'otra fecha', mismo: 'la misma fecha' },
  ],
  traslado_detalle: [
    { campo: 'trayecto', nombre: 'trayecto', otro: 'otro trayecto', mismo: 'el mismo trayecto', queSeVe: 'el trayecto' },
    { campo: 'fecha_hora', nombre: 'fecha', otro: 'otra fecha', mismo: 'la misma fecha' },
  ],
}

/** Campos de identidad que una ranura declara. Los usa quien arma la lectura. */
export function camposDeIdentidad(ranuraSlug: string): string[] {
  return (IDENTIDAD_POR_RANURA[ranuraSlug] ?? []).map(i => i.campo)
}

/** Normaliza un texto para compararlo: sin tildes, sin mayúsculas ni signos. */
function claveTexto(v: string): string {
  return v
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/…|\.\.\./g, ' … ')
    .replace(/[^a-z0-9…]+/g, ' ')
    .trim()
}

/**
 * ¿Dos textos nombran lo mismo?
 *
 * Una tarjeta de hotel trunca el nombre de la habitación («Double Or Twin St…»): un texto
 * cortado coincide con otro si es su comienzo. Sin esto, dos capturas del mismo hotel se
 * rechazarían por un recorte de la pantalla.
 */
export function mismoTexto(a: string, b: string): boolean {
  const ka = claveTexto(a)
  const kb = claveTexto(b)
  if (ka === kb) return true
  const cortado = (k: string) => k.includes('…')
  const base = (k: string) => k.split('…')[0].trim()
  if (cortado(ka) && base(ka).length >= 3 && kb.startsWith(base(ka))) return true
  if (cortado(kb) && base(kb).length >= 3 && ka.startsWith(base(kb))) return true
  return false
}

/** Pares de casillas donde la de MÁS personas no puede costar menos que la de menos. */
function paresDeResta(c: Composicion): [ClaveCasilla, ClaveCasilla][] {
  if (c.ninos > 0 && c.infantes > 0) {
    return [['grupo_completo', 'sin_infantes'], ['sin_infantes', 'solo_adultos'], ['grupo_completo', 'solo_adultos']]
  }
  if (c.ninos + c.infantes > 0) return [['grupo_completo', 'solo_adultos']]
  return []
}

function tituloEnFrase(def: CasillaDef): string {
  return `la casilla ${def.numero}`
}

/**
 * TP2 · la captura tiene que cuadrar consigo misma. Es lo único que se puede juzgar sin
 * saber a cuántos cubre la línea, por eso vive aparte: la primera lectura lo usa solo.
 */
function errorTP2(lectura: LecturaCasilla): ValidacionCasilla | null {
  if (desgloseCuadra(lectura)) return null
  const suma = lectura.porTipo.reduce((a, f) => a + f.subtotal, 0)
  return {
    ok: false,
    codigo: 'TP2',
    mensaje:
      `Los valores por tipo de pasajero suman ${formatoMonto(suma, lectura.moneda)} y el total del pantallazo ` +
      `dice ${formatoMonto(lectura.total, lectura.moneda)}. No cuadran: sube la pantalla del detalle de la tarifa ` +
      'donde se vean las filas y el total general.',
  }
}

/**
 * Juzga un pantallazo YA aceptado por su ranura contra la casilla donde se pegó (6.1, P5).
 *
 * El orden importa: primero si la captura es coherente consigo misma (TP2), después si es
 * la búsqueda que pide la casilla (TP3), y solo entonces se compara con las otras
 * casillas (CC1, CC2). Al revés, un pantallazo de otra ocupación se rechazaría como «otro
 * hotel» y el mensaje mandaría a buscar algo equivocado.
 */
export function validarLecturaEnCasilla(args: {
  clave: ClaveCasilla
  lectura: LecturaCasilla
  /**
   * `null` = la línea todavía no sabe a cuántos cubre, porque nadie lo declaró y el viaje
   * tampoco. Es el primer pantallazo (§2.1): se juzga solo si la captura es coherente
   * consigo misma (TP2), porque no hay casilla contra la cual comparar. La ocupación sale
   * de esta misma lectura (`composicionDeLectura`).
   */
  composicion: Composicion | null
  casillas: CasillasLeidas
  ranuraSlug: string
}): ValidacionCasilla {
  const { clave, lectura, composicion, casillas, ranuraSlug } = args
  if (!composicion) {
    if (clave !== 'grupo_completo') {
      return {
        ok: false,
        codigo: 'CASILLA',
        mensaje: 'Pega primero el pantallazo del proveedor: de ahí sale a cuántos pasajeros cubre la línea.',
      }
    }
    return errorTP2(lectura) ?? { ok: true, alertas: [] }
  }
  const defs = casillasDe(composicion, ranuraSlug)
  const def = defs.find(d => d.clave === clave)
  if (!def) {
    return {
      ok: false,
      codigo: 'CASILLA',
      mensaje: `Esta línea no usa esa casilla con ${describirOcupacion(composicion, 'y')}. Recarga la cotización.`,
    }
  }

  // La casilla 1 ya resolvió por desglose: las demás no hacen falta (P1, P4).
  const primera = casillas.grupo_completo
  if (clave !== 'grupo_completo' && primera && traeDesgloseCompleto(primera, composicion)) {
    return {
      ok: false,
      codigo: 'NO_HACE_FALTA',
      mensaje: 'El pantallazo 1 ya trae el precio de cada tipo de pasajero. Esta casilla no hace falta.',
    }
  }

  const alertas: string[] = []

  // TP2
  const tp2 = errorTP2(lectura)
  if (tp2) return tp2

  // TP3
  const observada = ocupacionObservada(lectura)
  if (sinOcupacionVisible(observada)) {
    // 7.4 · la tarjeta no la muestra: se toma la del ítem y alguien la confirma.
    alertas.push(
      `El pantallazo no muestra la ocupación: se toma la de la casilla (${describirOcupacion(def.ocupacion, 'y')}). ` +
      'Confirma que esa fue la búsqueda.',
    )
  } else if (ocupacionNoCoincide(observada, def.ocupacion)) {
    return {
      ok: false,
      codigo: 'TP3',
      mensaje:
        `Este pantallazo es para ${describirObservada(observada)}. En ${tituloEnFrase(def)} va la búsqueda con ` +
        `${describirOcupacion(def.ocupacion, 'y')}.`,
    }
  } else if (observada.adultos === null && observada.ninos === null && observada.infantes === null) {
    alertas.push(
      `El pantallazo dice ${describirObservada(observada)} sin separar adultos y menores: se toma ` +
      `${describirOcupacion(def.ocupacion, 'y')}. Confírmalo.`,
    )
  }

  // CC1 · mismo producto que las otras casillas.
  const otras = defs.filter(d => d.clave !== clave && casillas[d.clave])

  // Para RESTAR hace falta poder decir que es el mismo producto. Sin el nombre (del hotel,
  // de la aerolínea...) en las dos capturas, la resta podría salir de dos productos
  // distintos y daría un precio de menor que nadie cotizó. Solo se exige en las casillas
  // que restan: la casilla 1 sola no compara nada.
  const principal = IDENTIDAD_POR_RANURA[ranuraSlug]?.[0]
  if (principal && clave !== 'grupo_completo') {
    for (const otra of otras) {
      const previa = casillas[otra.clave] as LecturaCasilla
      if (!lectura.identidad[principal.campo] || !previa.identidad[principal.campo]) {
        return {
          ok: false,
          codigo: 'CC1',
          mensaje:
            `No se puede comprobar que este pantallazo sea de ${principal.mismo} de ${tituloEnFrase(otra)}: ` +
            `uno de los dos no lo muestra. Sube capturas donde se vea ${principal.queSeVe}.`,
        }
      }
    }
  }
  for (const otra of otras) {
    const previa = casillas[otra.clave] as LecturaCasilla
    if (previa.moneda.toUpperCase() !== lectura.moneda.toUpperCase()) {
      return {
        ok: false,
        codigo: 'CC1',
        mensaje:
          `Este pantallazo está en ${lectura.moneda.toUpperCase()} y el de ${tituloEnFrase(otra)} en ` +
          `${previa.moneda.toUpperCase()}. Busca con la misma moneda.`,
      }
    }
    for (const id of IDENTIDAD_POR_RANURA[ranuraSlug] ?? []) {
      const a = lectura.identidad[id.campo]
      const b = previa.identidad[id.campo]
      if (!a || !b) continue
      if (!mismoTexto(a, b)) {
        return {
          ok: false,
          codigo: 'CC1',
          mensaje:
            `Este pantallazo es de ${id.otro} (${a} vs. ${b}). Busca ${id.mismo} de ${tituloEnFrase(otra)}.`,
        }
      }
    }
  }
  const sinComparar = (IDENTIDAD_POR_RANURA[ranuraSlug] ?? [])
    .filter(id => otras.length > 0 && !lectura.identidad[id.campo])
    .map(id => id.nombre)
  if (sinComparar.length > 0) {
    alertas.push(
      `No se pudo comprobar que sea el mismo producto en: ${[...new Set(sinComparar)].join(', ')}. ` +
      'El pantallazo no lo muestra: revísalo antes de confirmar.',
    )
  }

  // CC2 · la de más personas no puede costar menos que la de menos.
  for (const [mas, menos] of paresDeResta(composicion)) {
    if (mas !== clave && menos !== clave) continue
    const lMas = mas === clave ? lectura : casillas[mas]
    const lMenos = menos === clave ? lectura : casillas[menos]
    if (!lMas || !lMenos) continue
    const diferencia = montoDeCosto(lMas) - montoDeCosto(lMenos)
    if (diferencia < 0) {
      const defMas = defs.find(d => d.clave === mas) as CasillaDef
      const defMenos = defs.find(d => d.clave === menos) as CasillaDef
      return {
        ok: false,
        codigo: 'CC2',
        mensaje:
          `El pantallazo con ${describirOcupacion(defMenos.ocupacion, 'y')} cuesta más que el de ` +
          `${describirOcupacion(defMas.ocupacion, 'y')} (${formatoMonto(montoDeCosto(lMenos), lectura.moneda)} contra ` +
          `${formatoMonto(montoDeCosto(lMas), lectura.moneda)}). La tarifa cambió entre búsquedas o hay otra promoción ` +
          'aplicada: vuelve a buscar las dos con la misma tarifa.',
      }
    }
  }

  return { ok: true, alertas }
}

// ── Resolución: el costo de cada tipo de pasajero ────────────────────────────

export interface CostoPorTipo {
  tipo: TipoPasajero
  cantidad: number
  /** Costo de TODOS los pasajeros de este tipo, en la moneda de las capturas. */
  total: number
  /** `total / cantidad`, a dos decimales. Lo divide el servidor (TP1). */
  unitario: number
  /** De dónde salió, en una línea (CC5). */
  deDonde: string
}

export type EstadoTarifa =
  | { estado: 'vacia'; siguiente: CasillaDef; mensaje: string }
  | { estado: 'falta'; siguiente: CasillaDef; faltan: CasillaDef[]; mensaje: string }
  | { estado: 'confirmar_menor_no_paga'; casilla: CasillaDef; tipo: TipoPasajero; mensaje: string }
  | { estado: 'inconsistente'; mensaje: string }
  | {
      estado: 'resuelta'
      costos: CostoPorTipo[]
      moneda: string
      costoTotal: number
      origen: 'desglose' | 'resta' | 'solo_adultos'
      mensaje: string
    }

const dosDecimales = (v: number) => Math.round(v * 100) / 100

/**
 * Reparte un costo entre filas en proporción a sus pesos, en CENTAVOS y por el método del
 * mayor residuo: la suma de lo repartido es exactamente el costo.
 *
 * Existe por Decameron: el costo es «total a pagar agencia» (1.818.919), leído y nunca
 * recalculado, mientras las filas por tipo suman el valor al pasajero (2.029.118). Repartir
 * con redondeo por fila dejaría la línea un peso arriba o abajo de lo que la pantalla dice.
 */
export function repartirProporcional(costo: number, pesos: number[]): number[] {
  const totalCentavos = Math.round(costo * 100)
  const sumaPesos = pesos.reduce((a, p) => a + p, 0)
  if (sumaPesos <= 0) return pesos.map(() => 0)
  const exactos = pesos.map(p => (totalCentavos * p) / sumaPesos)
  const bases = exactos.map(e => Math.floor(e))
  let resto = totalCentavos - bases.reduce((a, b) => a + b, 0)
  const orden = exactos
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((x, y) => y.frac - x.frac)
  for (const { i } of orden) {
    if (resto <= 0) break
    bases[i] += 1
    resto -= 1
  }
  return bases.map(b => b / 100)
}

function listaTipos(tipos: TipoPasajero[]): string {
  const nombres = tipos.map(t => PALABRA[t][1])
  if (nombres.length <= 1) return nombres.join('')
  const ultimo = nombres[nombres.length - 1]
  // «adultos e infantes», no «adultos y infantes»: la conjunción cambia ante «i».
  const conector = ultimo.startsWith('i') ? ' e ' : ' y '
  return `${nombres.slice(0, -1).join(', ')}${conector}${ultimo}`
}

/**
 * El estado de la tarifa de una línea con lo que haya en sus casillas (CC4, CC4a).
 *
 * ⚠️ No impone un número fijo de capturas: después de cada una calcula qué tipos quedan sin
 * precio y pide solo lo que falta. Una captura con desglose resuelve sola; un solo total
 * con menores pide la siguiente, hasta tres.
 *
 * ⚠️ Nunca se agrupa un valor «menores» (D3): cada tipo sale de su propia resta.
 */
export function resolverTarifa(c: Composicion, casillas: CasillasLeidas, ranuraSlug: string): EstadoTarifa {
  const defs = casillasDe(c, ranuraSlug)
  const def1 = defs[0]
  const l1 = casillas.grupo_completo
  if (!l1) {
    return { estado: 'vacia', siguiente: def1, mensaje: `Pega el pantallazo 1: ${def1.busqueda.charAt(0).toLowerCase()}${def1.busqueda.slice(1)}.` }
  }
  const moneda = l1.moneda.toUpperCase()
  const presentes = tiposPresentes(c)

  // 1 · el pantallazo 1 ya trae el precio de cada tipo (aerolíneas, liquidación Decameron).
  if (traeDesgloseCompleto(l1, c)) {
    const filas = presentes.map(t => {
      const delTipo = l1.porTipo.filter(f => f.tipo === t)
      return {
        tipo: t,
        cantidad: cantidadDeTipo(c, t),
        subtotal: delTipo.reduce((a, f) => a + f.subtotal, 0),
      }
    })
    const costo = montoDeCosto(l1)
    const conAgencia = l1.aPagarAgencia !== null && l1.aPagarAgencia > 0
      && Math.abs(l1.aPagarAgencia - l1.total) > filas.length
    const totales = conAgencia ? repartirProporcional(costo, filas.map(f => f.subtotal)) : filas.map(f => f.subtotal)
    const costos: CostoPorTipo[] = filas.map((f, i) => ({
      tipo: f.tipo,
      cantidad: f.cantidad,
      total: totales[i],
      unitario: dosDecimales(totales[i] / f.cantidad),
      deDonde: conAgencia
        ? `Pantallazo 1: ${formatoMonto(f.subtotal, moneda)} por ${describirOcupacion(soloTipo(f.tipo, f.cantidad))}, ` +
          `ajustado en proporción al total a pagar agencia ${formatoMonto(costo, moneda)}`
        : `Pantallazo 1: ${formatoMonto(f.subtotal, moneda)} por ${describirOcupacion(soloTipo(f.tipo, f.cantidad))}`,
    }))
    const que = presentes.length === 1 ? PALABRA[presentes[0]][1] : listaTipos(presentes)
    return {
      estado: 'resuelta',
      costos,
      moneda,
      costoTotal: costo,
      origen: 'desglose',
      mensaje: `Este pantallazo ya trae el precio de ${que}. No hace falta nada más.`,
    }
  }

  // 2 · solo adultos: el total se divide entre los adultos (TP4 no aplica).
  if (presentes.length === 1 && presentes[0] === 'adulto') {
    const costo = montoDeCosto(l1)
    return {
      estado: 'resuelta',
      costos: [{
        tipo: 'adulto',
        cantidad: c.adultos,
        total: costo,
        unitario: dosDecimales(costo / c.adultos),
        deDonde: `Pantallazo 1: ${formatoMonto(costo, moneda)} por ${describirOcupacion(c)}` +
          (c.adultos > 1 ? `, dividido entre ${c.adultos}` : ''),
      }],
      moneda,
      costoTotal: costo,
      origen: 'solo_adultos',
      mensaje: c.adultos === 1
        ? 'Este pantallazo trae el precio del adulto. No hace falta nada más.'
        : `Este pantallazo trae el precio de los ${c.adultos} adultos. No hace falta nada más.`,
    }
  }

  // 3 · un solo total con menores: TP4, falta desglose.
  const necesarias = defs.slice(1)
  const faltan = necesarias.filter(d => !casillas[d.clave])
  if (faltan.length > 0) {
    const siguiente = faltan[0]
    const prefijo = faltan.length === necesarias.length
      ? 'Este pantallazo tiene un solo total para el grupo. '
      : ''
    return {
      estado: 'falta',
      siguiente,
      faltan,
      mensaje: `${prefijo}Falta el ${siguiente.numero}: busca con ${describirOcupacion(siguiente.ocupacion, 'y')}.`,
    }
  }

  const a = montoDeCosto(l1)
  const lB = casillas.sin_infantes
  const lC = casillas.solo_adultos as LecturaCasilla
  const cMonto = montoDeCosto(lC)
  const restas: { tipo: TipoPasajero; total: number; deDonde: string; casilla: CasillaDef }[] = []
  const defDe = (k: ClaveCasilla) => defs.find(d => d.clave === k) as CasillaDef

  if (c.ninos > 0 && c.infantes > 0 && lB) {
    const b = montoDeCosto(lB)
    restas.push({
      tipo: 'infante',
      total: dosDecimales(a - b),
      casilla: defDe('sin_infantes'),
      deDonde: `Pantallazo 1 (${formatoMonto(a, moneda)}) menos pantallazo 2 (${formatoMonto(b, moneda)})`,
    })
    restas.push({
      tipo: 'nino',
      total: dosDecimales(b - cMonto),
      casilla: defDe('solo_adultos'),
      deDonde: `Pantallazo 2 (${formatoMonto(b, moneda)}) menos pantallazo 3 (${formatoMonto(cMonto, moneda)})`,
    })
  } else {
    const tipo: TipoPasajero = c.ninos > 0 ? 'nino' : 'infante'
    restas.push({
      tipo,
      total: dosDecimales(a - cMonto),
      casilla: defDe('solo_adultos'),
      deDonde: `Pantallazo 1 (${formatoMonto(a, moneda)}) menos pantallazo 2 (${formatoMonto(cMonto, moneda)})`,
    })
  }

  for (const r of restas) {
    if (r.total < 0) {
      return {
        estado: 'inconsistente',
        mensaje:
          `La resta para ${articuloTipo(r.tipo, cantidadDeTipo(c, r.tipo))} da negativa. La tarifa cambió entre ` +
          'búsquedas o hay otra promoción aplicada: vuelve a buscar con la misma tarifa.',
      }
    }
    const lectura = casillas[r.casilla.clave] as LecturaCasilla
    if (r.total === 0 && !lectura.menorNoPagaConfirmado) {
      const n = cantidadDeTipo(c, r.tipo)
      return {
        estado: 'confirmar_menor_no_paga',
        casilla: r.casilla,
        tipo: r.tipo,
        mensaje:
          `Los dos pantallazos cuestan lo mismo: ${articuloTipo(r.tipo, n)} no ${n === 1 ? 'paga' : 'pagan'} en este ` +
          'proveedor. Confírmalo antes de seguir: hay proveedores que no cobran menores y otros que muestran mal la ocupación.',
      }
    }
  }

  const costos: CostoPorTipo[] = [{
    tipo: 'adulto',
    cantidad: c.adultos,
    total: cMonto,
    unitario: dosDecimales(cMonto / c.adultos),
    deDonde: `Pantallazo ${defDe('solo_adultos').numero} (${formatoMonto(cMonto, moneda)})` +
      (c.adultos > 1 ? `, dividido entre ${c.adultos} adultos` : ''),
  }]
  for (const t of ['nino', 'infante'] as const) {
    const r = restas.find(x => x.tipo === t)
    if (!r) continue
    const n = cantidadDeTipo(c, t)
    costos.push({
      tipo: t,
      cantidad: n,
      total: r.total,
      // CC3 · varios menores del mismo tipo: la diferencia en partes iguales.
      unitario: dosDecimales(r.total / n),
      deDonde: r.deDonde + (n > 1 ? `, dividido entre ${n}` : ''),
    })
  }

  return {
    estado: 'resuelta',
    costos,
    moneda,
    costoTotal: a,
    origen: 'resta',
    mensaje: 'Ya está el precio de cada tipo de pasajero.',
  }
}

function soloTipo(tipo: TipoPasajero, cantidad: number): Composicion {
  return {
    adultos: tipo === 'adulto' ? cantidad : 0,
    ninos: tipo === 'nino' ? cantidad : 0,
    infantes: tipo === 'infante' ? cantidad : 0,
  }
}

/** «Adulto $1.907.063 · Niño $1.771.063» (P6). */
export function lineaPorPasajero(filas: { tipo: TipoPasajero; unitario: number }[], moneda: string): string {
  return filas.map(f => `${NOMBRE_TIPO[f.tipo]} ${formatoMonto(f.unitario, moneda)}`).join(' · ')
}

// ── Lo que se guarda en `items.tarifa_pax` ───────────────────────────────────

/** El costo por pasajero ya confirmado, en pesos. Es lo que alimenta el PDF. */
export interface TarifaConfirmada {
  composicion: Composicion
  costos: { tipo: TipoPasajero; cantidad: number; unitarioCOP: number; totalCOP: number }[]
  costoTotalCOP: number
  moneda: string
  tasa: number | null
  confirmadaEn: string
  /**
   * El margen que fijó la propia captura, cuando traía los dos precios
   * (`margen-proveedor.ts`). Queda guardado por dos razones: la pantalla tiene que poder
   * decir de dónde salió el porcentaje de la línea, y al volver a confirmar con una
   * captura que YA NO trae los dos precios hay que saber que el margen escrito lo puso
   * una captura y no una persona — si no, quedaría un margen viejo gobernando un costo
   * nuevo.
   */
  margenProveedor?: MargenProveedor | null
}

export interface TarifaPax {
  /** La composición propia del ítem (CC4b). Ausente = la del viaje. */
  composicion?: Composicion | null
  casillas?: CasillasLeidas
  confirmada?: TarifaConfirmada | null
  /**
   * Lo que una persona corrigió de lo leído, campo por campo (`correcciones.ts`). Vive FUERA
   * de las casillas a propósito: releer un pantallazo reemplaza su casilla y no puede
   * llevarse lo que alguien corrigió.
   */
  correcciones?: Correcciones
  /**
   * La descripción que el SISTEMA escribió por última vez en `items.descripcion`, ya en
   * mayúscula (`descripcionReescribible`, `ficha-linea.ts`).
   *
   * Es lo que permite no pisar lo que escribió una persona (regla 4 del brief del
   * 2026-09-22): al volver a confirmar, o al corregir un campo de la ficha, la descripción
   * se reescribe solo si sigue siendo esta. Mismo criterio que el margen: se compara el
   * valor. Vive fuera de `confirmada` porque cambiar los pasajeros borra la confirmación y
   * no puede borrar con ella la prueba de quién escribió la descripción. Ausente en las
   * líneas confirmadas antes de esta marca.
   */
  descripcionDelSistema?: string | null
  /**
   * Cuándo la escribió el servidor por última vez (reloj del servidor, ISO). Es lo que
   * decide, en pantalla, entre lo que llegó con la página y lo que el servidor acaba de
   * devolver al guardar (ver `tarifaMasReciente`). Ausente en las escritas antes de él.
   */
  actualizadaEn?: string | null
}

/** Lee `items.tarifa_pax` sin confiar en su forma: un jsonb viejo o roto no rompe la pantalla. */
export function leerTarifaPax(raw: unknown): TarifaPax {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const casillas: CasillasLeidas = {}
  const crudas = (r.casillas && typeof r.casillas === 'object' ? r.casillas : {}) as Record<string, unknown>
  for (const clave of ['grupo_completo', 'sin_infantes', 'solo_adultos'] as ClaveCasilla[]) {
    const l = crudas[clave] as LecturaCasilla | undefined
    if (l && typeof l === 'object' && typeof l.total === 'number' && typeof l.moneda === 'string') {
      casillas[clave] = {
        ...l,
        porTipo: Array.isArray(l.porTipo) ? l.porTipo : [],
        alertas: Array.isArray(l.alertas) ? l.alertas : [],
        notasCliente: Array.isArray(l.notasCliente) ? l.notasCliente : [],
        campos: Array.isArray(l.campos) ? l.campos : [],
        identidad: l.identidad && typeof l.identidad === 'object' ? l.identidad : {},
        ocupacion: l.ocupacion ?? { adultos: null, ninos: null, infantes: null, total: null },
        aPagarAgencia: typeof l.aPagarAgencia === 'number' ? l.aPagarAgencia : null,
        costoAgenciaOrigen: l.costoAgenciaOrigen === 'neto_leido' || l.costoAgenciaOrigen === 'derivado_comision'
          ? l.costoAgenciaOrigen
          : null,
      }
    }
  }
  const conf = r.confirmada as TarifaConfirmada | null | undefined
  const confirmada = conf && typeof conf === 'object' && Array.isArray(conf.costos)
    && normalizarComposicion(conf.composicion) !== null
    ? conf
    : null
  // ⚠️ Toda llave que NO se lea aquí se pierde en la siguiente escritura: `guardarTarifa`
  // escribe lo que devuelve esta función. Por eso las correcciones se leen aunque esta
  // función no las use. Sin correcciones la llave no aparece: la tarifa de una línea que nadie
  // corrigió se lee exactamente igual que antes.
  const correcciones = leerCorrecciones(r.correcciones)
  return {
    composicion: normalizarComposicion(r.composicion),
    casillas,
    confirmada,
    ...(Object.keys(correcciones).length > 0 ? { correcciones } : {}),
    ...(typeof r.descripcionDelSistema === 'string' || r.descripcionDelSistema === null
      ? { descripcionDelSistema: r.descripcionDelSistema as string | null }
      : {}),
    actualizadaEn: typeof r.actualizadaEn === 'string' ? r.actualizadaEn : null,
  }
}

/**
 * La tarifa que se pinta: la de la página o la que el servidor acaba de devolver al
 * guardar, la que escribió el servidor DESPUÉS.
 *
 * ⚠️ Por qué existe (Trappvel, 2026-09-16): pegar un pantallazo sin moneda, elegir COP, y
 * la lectura quedaba guardada mientras la casilla seguía pintando la página vieja hasta
 * recargar. En los registros de Vercel el refresco SÍ salió después de guardar, y el mismo
 * camino no se pudo reproducir fuera de producción. La casilla no puede depender de ese
 * refresco para mostrar lo que el propio servidor le confirmó que guardó.
 *
 * Gana la página cuando es igual de nueva o más: en cuanto el refresco llega, manda ella.
 * Una guardada sin marca nunca gana (no se puede saber si es más nueva).
 */
export function tarifaMasReciente(deLaPagina: TarifaPax, guardada: TarifaPax | null): TarifaPax {
  if (!guardada?.actualizadaEn) return deLaPagina
  const pagina = deLaPagina.actualizadaEn ?? ''
  return guardada.actualizadaEn > pagina ? guardada : deLaPagina
}

/**
 * La composición con que se cotiza la línea: la propia del ítem, y si no tiene, la del
 * viaje (§4, CC4b). La del viaje es solo el punto de partida.
 */
export function composicionDeLinea(tarifa: TarifaPax, delViaje: Composicion | null): Composicion | null {
  return tarifa.composicion ?? delViaje
}

/** Convierte un valor de la captura a pesos con dos decimales (R-P5: sin tasa no hay conversión). */
export function aPesos(valor: number, moneda: string, tasa: number | null): number | null {
  if (moneda.toUpperCase() === 'COP') return dosDecimales(valor)
  if (tasa === null || !Number.isFinite(tasa) || tasa <= 0) return null
  return dosDecimales(valor * tasa)
}

// ── Precio por pasajero (PDF y editor) ───────────────────────────────────────

export interface PrecioPorPasajero {
  tipo: TipoPasajero
  cantidad: number
  /** Precio de venta de UN pasajero de este tipo, en pesos, redondeado al peso. */
  precioUnitario: number
}

/**
 * ¿El costo confirmado por pasajero sigue siendo el costo de la línea?
 *
 * Si alguien editó los rubros después de confirmar, el reparto guardado ya no describe esa
 * línea: imprimirlo le diría al cliente cuánto paga cada uno con números de otra versión.
 * Tolerancia: un peso por pasajero, que es lo que puede mover el redondeo de los unitarios.
 */
export function confirmadaVigente(confirmada: TarifaConfirmada, costoUnitarioLinea: number): boolean {
  const tolerancia = Math.max(1, totalPasajeros(confirmada.composicion))
  return Math.abs(Number(costoUnitarioLinea) - confirmada.costoTotalCOP) <= tolerancia
}

/**
 * Reparte el precio de la línea entre tipos de pasajero, en proporción a su costo.
 *
 * ⚠️ UN SOLO factor de margen para todos los tipos: el divisor por tipo (D5) está abierto y
 * lo decide Edgar. Repartir el precio en proporción al costo es lo único que no inventa esa
 * decisión, y garantiza que la suma de los precios por pasajero sea el precio de la línea.
 */
export function precioPorPasajero(confirmada: TarifaConfirmada, precioLinea: number): PrecioPorPasajero[] {
  const total = confirmada.costos.reduce((a, c) => a + c.totalCOP, 0)
  const filas = confirmada.costos.filter(c => c.cantidad > 0)
  if (total <= 0) {
    return filas.map(c => ({ tipo: c.tipo, cantidad: c.cantidad, precioUnitario: 0 }))
  }
  const repartido = repartirProporcional(Number(precioLinea) || 0, filas.map(c => c.totalCOP))
  return filas.map((c, i) => ({
    tipo: c.tipo,
    cantidad: c.cantidad,
    precioUnitario: Math.round(repartido[i] / c.cantidad),
  }))
}
