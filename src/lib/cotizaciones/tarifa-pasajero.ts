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

import { esAvisoDeAnioViejo } from './anio-fecha'
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
  /**
   * A cuántos pasajeros cubría la LÍNEA cuando se buscó y se leyó esta captura: la
   * composición efectiva de ese momento (la propia, la del viaje, o la que fijó la propia
   * captura). Es lo que permite decir, después, que la captura quedó vieja.
   *
   * ⚠️ Es la ocupación de la línea, no la de la casilla: la búsqueda de «solo adultos» se
   * deriva de ella con `casillasDe`. Ausente en las lecturas anteriores al 2026-09-22, y
   * en la primera lectura de una línea que todavía no sabía a cuántos cubre (se completa
   * cuando alguien responde la pregunta).
   */
  paraComposicion?: Composicion | null
  /**
   * La captura NO mostraba la moneda (o solo «$») y se preseleccionó COP para poder
   * guardarla. No es un dato de la imagen: mientras nadie la acepte o la cambie, el costo
   * no se deja confirmar (`monedaDeTarifa`). Ausente = la moneda estaba en la captura.
   */
  monedaAsumida?: boolean
  /**
   * Huella del archivo que se leyó (`huellaDeImagen`): la bandeja la compara para no procesar
   * dos veces el mismo pantallazo (P10). La imagen sigue sin guardarse; solo su huella.
   * Ausente en las lecturas anteriores al 2026-09-23.
   */
  huellaImagen?: string
  /**
   * Dónde quedó guardado el pantallazo (`sbext://…`, en el almacenamiento propio del
   * workspace): se sube al ACEPTAR, nunca mientras la captura sigue en la bandeja
   * (`imagen-captura.ts`). Ausente en las lecturas anteriores al 2026-09-24 y en los
   * workspaces que no guardan fuera de Drive.
   */
  imagenRef?: string | null
}

/**
 * La moneda que eligió una PERSONA para la tarifa de la línea (brief del 2026-09-22, parte 2).
 *
 * Mismo patrón que las correcciones de la ficha (#821): lo que dijo la IA se queda en cada
 * casilla (`LecturaCasilla.moneda`), y lo que manda la persona vive aparte, con quién y
 * cuándo. Es de la LÍNEA y no de una casilla porque las casillas de una misma tarifa tienen
 * que estar en la misma moneda (CC1): elegirla en una y no en otra no significa nada.
 */
export interface DecisionMoneda {
  /** Código ISO de tres letras, en mayúscula. */
  valor: string
  /** Nombre de quien la eligió. */
  por: string | null
  /** `profiles.id` de quien la eligió. */
  porId: string | null
  /** Cuándo (ISO, reloj del servidor). */
  en: string
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
  /**
   * La moneda que eligió una persona para la línea (`DecisionMoneda`), si la hay. Una
   * captura complementaria que MUESTRA otra se rechaza: es otra búsqueda, o la elección
   * estaba mal, y cualquiera de las dos cosas la tiene que resolver una persona.
   */
  monedaDecidida?: string | null
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
  // La moneda se compara entre lo que las capturas MUESTRAN. Una supuesta (la captura solo
  // decía «$») no es evidencia de nada: sigue a la de la línea.
  const decidida = args.monedaDecidida ? args.monedaDecidida.toUpperCase() : null
  if (!lectura.monedaAsumida && decidida && clave !== 'grupo_completo' && lectura.moneda.toUpperCase() !== decidida) {
    return {
      ok: false,
      codigo: 'CC1',
      mensaje:
        `Este pantallazo está en ${lectura.moneda.toUpperCase()} y para esta línea se eligió ${decidida}. ` +
        'Si el precio de la línea está en otra moneda, cámbiala primero; si no, busca con la misma moneda.',
    }
  }
  for (const otra of otras) {
    const previa = casillas[otra.clave] as LecturaCasilla
    const lasDosMuestranMoneda = !lectura.monedaAsumida && !previa.monedaAsumida
    if (lasDosMuestranMoneda && previa.moneda.toUpperCase() !== lectura.moneda.toUpperCase()) {
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

// ── Capturas desactualizadas (brief del 2026-09-22, parte 1) ─────────────────

/**
 * Una captura que se buscó para otros pasajeros que los que la línea cubre hoy.
 *
 * ## El hueco que esto cierra
 *
 * Una línea sin composición propia HEREDA la del viaje. Si alguien cambia los pasajeros del
 * viaje después de pegar, la captura vieja se seguía usando: el caso «solo adultos» dividía
 * un precio buscado para 2 entre 3, y la cotización salía con el precio mal y sin aviso. Lo
 * mismo pasaba con el desglose por tipo (el subtotal de 2 adultos repartido entre 3).
 *
 * ## Qué se compara, y por qué casilla por casilla
 *
 * La ocupación que se BUSCÓ en esa casilla contra la que la casilla pide HOY. No la
 * composición de la línea entera: pasar de 2 adultos, 1 niño y 1 infante a 2 infantes deja
 * vigente la búsqueda de «solo adultos» (sigue siendo 2 adultos), y pedir que se repita
 * sería trabajo inventado.
 *
 * Lo buscado sale de `paraComposicion`, que se guarda al leer. Para las lecturas anteriores
 * se usa lo que la propia captura acredita (`composicionDeLectura`); si tampoco lo dice, NO
 * se marca: inventar una alerta enseña a ignorarlas.
 */
export interface CapturaDesactualizada {
  clave: ClaveCasilla
  /** El número de la casilla con la composición de HOY (el que ve la persona). */
  numero: number
  /** Para quiénes se buscó. */
  buscadaPara: Composicion
  /** Para quiénes hace falta hoy. */
  necesaria: Composicion
  /** En palabras de quien cotiza, y diciendo qué hacer. */
  mensaje: string
}

/** La ocupación que busca una casilla para una composición dada, o `null` si no la pide. */
function ocupacionDeCasilla(c: Composicion, clave: ClaveCasilla, ranuraSlug: string): Composicion | null {
  return casillasDe(c, ranuraSlug).find(d => d.clave === clave)?.ocupacion ?? null
}

/** Para quiénes se buscó la captura de una casilla, o `null` si no hay cómo saberlo. */
function ocupacionBuscada(l: LecturaCasilla, clave: ClaveCasilla, ranuraSlug: string): Composicion | null {
  if (l.paraComposicion) return ocupacionDeCasilla(l.paraComposicion, clave, ranuraSlug)
  return composicionDeLectura(l)
}

/** Todas las casillas desactualizadas, cuenten o no para el costo de hoy. */
function desactualizadasTodas(
  actual: Composicion,
  casillas: CasillasLeidas,
  ranuraSlug: string,
): CapturaDesactualizada[] {
  const out: CapturaDesactualizada[] = []
  for (const def of casillasDe(actual, ranuraSlug)) {
    const l = casillas[def.clave]
    if (!l) continue
    const buscada = ocupacionBuscada(l, def.clave, ranuraSlug)
    if (!buscada || mismaComposicion(buscada, def.ocupacion)) continue
    out.push({
      clave: def.clave,
      numero: def.numero,
      buscadaPara: buscada,
      necesaria: def.ocupacion,
      mensaje: def.clave === 'grupo_completo'
        ? `Este pantallazo es para ${describirOcupacion(buscada, 'y')} y la línea ahora cubre ` +
          `${describirOcupacion(actual, 'y')}: pega uno nuevo.`
        : `El pantallazo ${def.numero} (${def.titulo.toLowerCase()}) es para ${describirOcupacion(buscada, 'y')} ` +
          `y ahora hace falta con ${describirOcupacion(def.ocupacion, 'y')}: pega uno nuevo.`,
    })
  }
  return out
}

/**
 * Las capturas que ya no sirven para el costo de la línea con la composición de HOY.
 *
 * ⚠️ Una complementaria vieja NO cuenta cuando el pantallazo 1, vigente, ya trae el precio
 * de cada tipo: la línea no la usa para nada, y exigir reemplazarla frenaría una
 * confirmación por una captura que no entra al costo.
 */
export function capturasDesactualizadas(
  actual: Composicion | null,
  casillas: CasillasLeidas,
  ranuraSlug: string,
): CapturaDesactualizada[] {
  if (!actual) return []
  const todas = desactualizadasTodas(actual, casillas, ranuraSlug)
  const l1 = casillas.grupo_completo
  const unoVigente = !!l1 && !todas.some(d => d.clave === 'grupo_completo')
  if (unoVigente && traeDesgloseCompleto(l1 as LecturaCasilla, actual)) return []
  return todas
}

/**
 * Las casillas que siguen describiendo la composición de hoy. Es con estas —y no con las
 * viejas— que se compara una captura nueva (mismo producto, CC2): una captura vieja de otra
 * ocupación haría rechazar una buena por una resta que ya no existe.
 */
export function casillasVigentes(
  actual: Composicion | null,
  casillas: CasillasLeidas,
  ranuraSlug: string,
): CasillasLeidas {
  if (!actual) return casillas
  const viejas = new Set(desactualizadasTodas(actual, casillas, ranuraSlug).map(d => d.clave))
  const out: CasillasLeidas = {}
  for (const clave of ['grupo_completo', 'sin_infantes', 'solo_adultos'] as ClaveCasilla[]) {
    const l = casillas[clave]
    if (l && !viejas.has(clave)) out[clave] = l
  }
  return out
}

// ── La moneda de la tarifa (brief del 2026-09-22, parte 2) ───────────────────

export interface MonedaDeTarifa {
  /** La que manda para el costo. */
  moneda: string
  /**
   * `true` = ninguna captura la mostraba y nadie la eligió: se supone COP. El costo NO se
   * confirma así — «$» sin moneda es el error más caro del motor (un USD tomado por COP) y
   * el valor por defecto no puede pasar callado.
   */
  asumida: boolean
  origen: 'persona' | 'captura' | 'supuesta' | 'sin_lectura'
  /** La que leyó la IA, si alguna captura la mostraba. Se enseña al lado de la elegida. */
  leida: string | null
  decision: DecisionMoneda | null
}

/**
 * La moneda con la que se costea la línea: la que eligió una persona; si no, la que mostró
 * alguna captura; si ninguna la mostró, COP supuesta (sin confirmar).
 *
 * Las casillas de una tarifa comparten moneda (CC1 compara lo LEÍDO entre ellas), así que
 * la primera leída basta.
 */
export function monedaDeTarifa(tarifa: TarifaPax): MonedaDeTarifa {
  const lecturas = (['grupo_completo', 'sin_infantes', 'solo_adultos'] as ClaveCasilla[])
    .map(k => tarifa.casillas?.[k])
    .filter((l): l is LecturaCasilla => !!l)
  const leida = lecturas.find(l => !l.monedaAsumida)?.moneda.toUpperCase() ?? null
  const decision = tarifa.moneda ?? null
  if (decision) return { moneda: decision.valor, asumida: false, origen: 'persona', leida, decision }
  if (leida) return { moneda: leida, asumida: false, origen: 'captura', leida, decision: null }
  if (lecturas.length > 0) return { moneda: 'COP', asumida: true, origen: 'supuesta', leida: null, decision: null }
  return { moneda: 'COP', asumida: false, origen: 'sin_lectura', leida: null, decision: null }
}

/**
 * Las monedas que se ofrecen con un clic. Cualquier otro código ISO se escribe a mano: la
 * lista es comodidad, no el límite (Trappvel cotiza también en otras monedas locales).
 */
export const MONEDAS_FRECUENTES: readonly string[] = ['COP', 'USD', 'EUR', 'MXN']

/** Lo que se le dice a quien intenta confirmar con la moneda supuesta. */
export const MENSAJE_MONEDA_ASUMIDA =
  'La captura no muestra la moneda: se asumió COP. Acéptala o cámbiala antes de confirmar el costo.'

/** Un código de moneda escrito por una persona, limpio; o `null` si no es un código. */
export function codigoDeMoneda(texto: string | null | undefined): string | null {
  const t = (texto ?? '').trim().toUpperCase()
  return /^[A-Z]{3}$/.test(t) ? t : null
}

// ── La confirmación desactualizada ───────────────────────────────────────────

/**
 * R8 · la huella de las habitaciones de una opción: cuáles son, cuánto cuesta cada una y el
 * papel que una persona les fijó. Sale solo de lo guardado, para poder decir si la
 * confirmación sigue describiendo la opción.
 */
export function firmaDeHabitaciones(habitaciones: readonly Habitacion[]): string {
  // Una corrección de la habitación también deja vieja la confirmación. Sin corrección la
  // huella es la de siempre: las confirmaciones anteriores siguen vigentes.
  return habitaciones.map(h => {
    const base = `${h.id}:${h.rolManual?.valor ?? 'auto'}:${h.lectura.total}`
    const c = h.correccion
    if (!c) return base
    const o = c.ocupacion ? `${c.ocupacion.adultos}-${c.ocupacion.ninos}-${c.ocupacion.infantes}` : '-'
    return `${base}:c${c.total ?? '-'}/${o}`
  }).join('|')
}

export interface ConfirmacionDesactualizada {
  motivo: 'composicion' | 'moneda'
  mensaje: string
}

/**
 * ¿El costo confirmado sigue describiendo la línea de hoy?
 *
 * ## La decisión: el costo SE QUEDA y la confirmación queda MARCADA
 *
 * Hasta el 2026-09-22, cambiar los pasajeros de la línea borraba la confirmación y dejaba
 * los rubros; cambiar los del viaje no hacía nada. Lo mínimo que no deja un precio mal sin
 * aviso, sin tirar un costo que alguien aprobó:
 *
 *  · los rubros siguen (es el último costo aprobado; quitarlos dejaría la línea en cero, que
 *    también es un precio falso);
 *  · la confirmación se marca: la línea y la cotización lo dicen en pantalla, el reparto por
 *    pasajero deja de imprimirse (describiría otro grupo u otra moneda), y el costo no se
 *    vuelve a confirmar hasta que las capturas estén al día.
 *
 * Dos motivos: otra composición, u otra moneda (alguien cambió la moneda después de
 * confirmar: los rubros están en pesos convertidos desde la moneda vieja).
 */
export function confirmacionDesactualizada(
  tarifa: TarifaPax,
  actual: Composicion | null,
): ConfirmacionDesactualizada | null {
  const c = tarifa.confirmada
  if (!c) return null
  // R8 · con habitaciones, cualquier habitación nueva, quitada o cambiada de papel después de
  // confirmar cambia el costo: la confirmación queda vieja aunque la ocupación coincida.
  if (tarifa.habitaciones && tarifa.habitaciones.length > 0 && (c.firmaHabitaciones ?? null) !== firmaDeHabitaciones(tarifa.habitaciones)) {
    return {
      motivo: 'composicion',
      mensaje: 'Cambiaron las habitaciones después de confirmar el costo: vuelve a confirmarlo.',
    }
  }
  // Normalizada: un jsonb escrito a mano sin `ninos` o `infantes` no puede leerse como otra
  // composición solo por la forma.
  const cargada = normalizarComposicion(c.composicion)
  if (actual && cargada && !mismaComposicion(cargada, actual)) {
    return {
      motivo: 'composicion',
      mensaje:
        `El costo cargado es para ${describirOcupacion(cargada, 'y')} y la línea ahora cubre ` +
        `${describirOcupacion(actual, 'y')}: vuelve a confirmarlo con un pantallazo para ` +
        `${describirOcupacion(actual, 'y')}.`,
    }
  }
  const m = monedaDeTarifa(tarifa)
  const confirmadaEn = (c.moneda || 'COP').toUpperCase()
  if (m.origen !== 'sin_lectura' && !m.asumida && m.moneda !== confirmadaEn) {
    return {
      motivo: 'moneda',
      mensaje:
        `El costo se cargó en ${confirmadaEn} y la tarifa ahora está en ${m.moneda}: vuelve a confirmar` +
        (m.moneda !== 'COP' ? ' con la tasa de cambio.' : '.'),
    }
  }
  return null
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
  /** Hay capturas buscadas para otros pasajeros: no se calcula ningún costo con ellas. */
  | { estado: 'desactualizada'; capturas: CapturaDesactualizada[]; mensaje: string }
  | {
      estado: 'resuelta'
      costos: CostoPorTipo[]
      moneda: string
      costoTotal: number
      origen: 'desglose' | 'resta' | 'solo_adultos' | 'habitaciones'
      mensaje: string
      /**
       * Con habitaciones (R8) y sin un par del mismo tipo de habitación para cada menor, el
       * costo no se parte por pasajero: va por habitación y `costos` queda vacío.
       */
      porHabitacion?: CostoDeHabitacion[]
    }

/** El costo de una habitación que cuenta para el precio (R8). */
export interface CostoDeHabitacion {
  numero: number
  ocupacion: Composicion
  total: number
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
 *
 * ⚠️ Una captura buscada para OTROS pasajeros no entra a ninguna cuenta (brief del
 * 2026-09-22): el estado es `desactualizada` y no hay costo. Es aquí, y no en quien llama,
 * porque este es el único sitio donde un precio se divide entre pasajeros: la pantalla, el
 * mensaje de la lectura y la confirmación lo heredan sin poder saltárselo.
 *
 * `opciones.moneda` es la moneda con la que se costea la línea (`monedaDeTarifa`): la que
 * eligió una persona manda sobre la leída. Sin ella, la de la captura 1.
 */
export function resolverTarifa(
  c: Composicion,
  casillas: CasillasLeidas,
  ranuraSlug: string,
  opciones: { moneda?: string | null } = {},
): EstadoTarifa {
  const defs = casillasDe(c, ranuraSlug)
  const def1 = defs[0]
  const l1 = casillas.grupo_completo
  if (!l1) {
    return { estado: 'vacia', siguiente: def1, mensaje: `Pega el pantallazo 1: ${def1.busqueda.charAt(0).toLowerCase()}${def1.busqueda.slice(1)}.` }
  }
  const viejas = capturasDesactualizadas(c, casillas, ranuraSlug)
  if (viejas.length > 0) {
    return { estado: 'desactualizada', capturas: viejas, mensaje: viejas[0].mensaje }
  }
  const moneda = (opciones.moneda || l1.moneda).toUpperCase()
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
  /**
   * R8 · el costo por habitación, cuando no hay cómo partirlo por pasajero (`costos` vacío).
   * El PDF imprime entonces el precio de cada habitación en vez del de cada pasajero.
   */
  porHabitacion?: { numero: number; ocupacion: Composicion; totalCOP: number }[]
  /** R8 · qué habitaciones y con qué papel se confirmaron (`firmaDeHabitaciones`). */
  firmaHabitaciones?: string
}

/** R8 · qué hace una captura dentro de una opción de hotel. */
export type RolHabitacion = 'habitacion' | 'referencia'

/**
 * R8 · una captura dentro de una opción de hotel (hotel + entrada + salida). El papel
 * (habitación o solo para restar) se calcula al leer (`habitaciones.ts`); aquí solo se
 * guarda lo que una persona decidió con un toque.
 */
export interface Habitacion {
  id: string
  lectura: LecturaCasilla
  rolManual?: { valor: RolHabitacion; por: string | null; porId: string | null; en: string } | null
  /**
   * Lo que una persona corrigió de la habitación en la tarjeta («Corregir datos»): a cuántos
   * cubre y cuánto cuesta. Vive FUERA de la lectura, igual que las correcciones de la ficha:
   * lo que leyó la IA queda intacto y esto manda encima (`repartirHabitaciones`).
   */
  correccion?: CorreccionHabitacion | null
}

/** La corrección de una habitación. `null` en un campo = ese campo sigue siendo el leído. */
export interface CorreccionHabitacion {
  ocupacion: Composicion | null
  total: number | null
  por: string | null
  porId: string | null
  en: string
}

/**
 * El precio de UNA fila de la tarjeta escrito a mano («Ajustar», prototipo del 2026-09-24):
 * un tipo de pasajero (`adulto`, `nino`, `infante`) o una habitación (`hab:N`). El precio
 * unitario en pesos. Las filas sin precio a mano se reparten lo que queda del precio de la
 * línea, en proporción a su costo (`repartirConManuales`).
 */
export interface PrecioAMano {
  precio: number
  por: string | null
  porId: string | null
  en: string
}

export type PreciosAMano = Record<string, PrecioAMano>

/** La clave de una habitación en los precios a mano. */
export const claveDeHabitacion = (numero: number) => `hab:${numero}`

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
   * valor. Vive fuera de `confirmada` porque la confirmación se reemplaza entera al volver a
   * confirmar (y hasta el 2026-09-22 cambiar los pasajeros la borraba), y no puede llevarse
   * con ella la prueba de quién escribió la descripción. Ausente en las líneas confirmadas
   * antes de esta marca.
   */
  descripcionDelSistema?: string | null
  /**
   * Cuándo la escribió el servidor por última vez (reloj del servidor, ISO). Es lo que
   * decide, en pantalla, entre lo que llegó con la página y lo que el servidor acaba de
   * devolver al guardar (ver `tarifaMasReciente`). Ausente en las escritas antes de él.
   */
  actualizadaEn?: string | null
  /**
   * La moneda de la tarifa que eligió una persona (`DecisionMoneda`). Ausente = manda la
   * que leyó la IA, o COP supuesta si ninguna captura la mostró (`monedaDeTarifa`).
   *
   * Se retira al leer un pantallazo 1 nuevo: es otra búsqueda, quizá de otro proveedor, y
   * la elección que alguien hizo sobre la captura anterior no se hereda a ciegas.
   */
  moneda?: DecisionMoneda | null
  /**
   * El costo escrito A MANO en otra moneda (`costo-manual.ts`). `items.subtotal` guarda los
   * pesos, que es lo que suman el costo total y la cascada; esto guarda lo que la persona
   * escribió y con qué tasa, para poder decírselo después. Ausente = el costo se escribió en
   * pesos.
   */
  costoManual?: CostoManualEnMoneda | null
  /**
   * R8 · las habitaciones de una opción de hotel. Ausente = la opción es UNA habitación, la
   * del pantallazo 1 (todas las opciones anteriores al 2026-09-24).
   */
  habitaciones?: Habitacion[]
  /** Los precios de fila escritos a mano en la tarjeta. Ausente = todos salen del margen. */
  preciosAMano?: PreciosAMano
  /**
   * La foto del hotel que puso el asesor en «Así lo ve el cliente» (2026-09-24,
   * `foto-hotel.ts`). Sale en el documento en el lugar de la foto provisional de la ciudad.
   * Ausente = sin foto: el documento sale como antes.
   */
  fotoHotel?: FotoDelHotel
}

/** Una foto de hotel guardada en el almacenamiento propio del workspace. */
export interface FotoDelHotel {
  /** `sbext://…`: se abre por `/api/archivos/abrir`, que firma un enlace de 5 minutos. */
  ref: string
  /** Ancho entre alto del archivo, para encuadrar el recorte del documento. */
  proporcion: number | null
}

/** La foto del hotel de una tarifa guardada, o `null` si no hay una válida. */
export function leerFotoDelHotel(raw: unknown): FotoDelHotel | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.ref !== 'string' || !r.ref.startsWith('sbext://')) return null
  const p = typeof r.proporcion === 'number' && Number.isFinite(r.proporcion) && r.proporcion > 0 ? r.proporcion : null
  return { ref: r.ref, proporcion: p }
}

/** Un costo escrito a mano en otra moneda, con la tasa con que se pasó a pesos. */
export interface CostoManualEnMoneda {
  moneda: string
  /** El valor unitario tal como se escribió, en `moneda`. */
  valor: number
  /** Pesos por unidad de `moneda`. */
  tasa: number
  por: string | null
  porId: string | null
  en: string
}

function leerDecisionMoneda(raw: unknown): DecisionMoneda | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const valor = codigoDeMoneda(typeof d.valor === 'string' ? d.valor : null)
  if (!valor || typeof d.en !== 'string') return null
  return {
    valor,
    por: typeof d.por === 'string' ? d.por : null,
    porId: typeof d.porId === 'string' ? d.porId : null,
    en: d.en,
  }
}

function leerCostoManual(raw: unknown): CostoManualEnMoneda | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const moneda = codigoDeMoneda(typeof d.moneda === 'string' ? d.moneda : null)
  const valor = Number(d.valor)
  const tasa = Number(d.tasa)
  if (!moneda || !Number.isFinite(valor) || valor < 0 || !Number.isFinite(tasa) || tasa <= 0) return null
  if (typeof d.en !== 'string') return null
  return {
    moneda,
    valor,
    tasa,
    por: typeof d.por === 'string' ? d.por : null,
    porId: typeof d.porId === 'string' ? d.porId : null,
    en: d.en,
  }
}

/** Una lectura guardada, sin confiar en su forma. `null` si no es una lectura. */
function leerLectura(raw: unknown): LecturaCasilla | null {
  const l = raw as LecturaCasilla | undefined
  if (!l || typeof l !== 'object' || typeof l.total !== 'number' || typeof l.moneda !== 'string') return null
  const out: LecturaCasilla = {
    ...l,
    porTipo: Array.isArray(l.porTipo) ? l.porTipo : [],
    // El aviso de «año completado con el del viaje» de las lecturas anteriores al 2026-09-23
    // ya no se muestra: hoy el año se deduce sin preguntar (`anio-fecha.ts`).
    alertas: Array.isArray(l.alertas) ? l.alertas.filter(a => typeof a !== 'string' || !esAvisoDeAnioViejo(a)) : [],
    notasCliente: Array.isArray(l.notasCliente) ? l.notasCliente : [],
    campos: Array.isArray(l.campos) ? l.campos : [],
    identidad: l.identidad && typeof l.identidad === 'object' ? l.identidad : {},
    ocupacion: l.ocupacion ?? { adultos: null, ninos: null, infantes: null, total: null },
    aPagarAgencia: typeof l.aPagarAgencia === 'number' ? l.aPagarAgencia : null,
    costoAgenciaOrigen: l.costoAgenciaOrigen === 'neto_leido' || l.costoAgenciaOrigen === 'derivado_comision'
      ? l.costoAgenciaOrigen
      : null,
    paraComposicion: normalizarComposicion(l.paraComposicion),
    monedaAsumida: l.monedaAsumida === true,
  }
  // Sin la marca, las llaves no aparecen: una lectura anterior al 2026-09-22 se lee
  // exactamente como antes.
  if (!out.paraComposicion) delete out.paraComposicion
  if (!out.monedaAsumida) delete out.monedaAsumida
  return out
}

/** R8 · las habitaciones guardadas; las que no se pueden leer se descartan. */
function leerHabitaciones(raw: unknown): Habitacion[] | null {
  if (!Array.isArray(raw)) return null
  const out: Habitacion[] = []
  for (const h of raw) {
    if (!h || typeof h !== 'object') continue
    const r = h as Record<string, unknown>
    const lectura = leerLectura(r.lectura)
    if (typeof r.id !== 'string' || !lectura) continue
    const m = r.rolManual as Record<string, unknown> | null | undefined
    const rolManual = m && (m.valor === 'habitacion' || m.valor === 'referencia') && typeof m.en === 'string'
      ? { valor: m.valor as RolHabitacion, por: typeof m.por === 'string' ? m.por : null, porId: typeof m.porId === 'string' ? m.porId : null, en: m.en }
      : null
    const correccion = leerCorreccionHabitacion(r.correccion)
    out.push({ id: r.id, lectura, ...(rolManual ? { rolManual } : {}), ...(correccion ? { correccion } : {}) })
  }
  return out
}

function leerCorreccionHabitacion(raw: unknown): CorreccionHabitacion | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (typeof c.en !== 'string') return null
  const total = c.total === null || c.total === undefined ? null : Number(c.total)
  const ocupacion = c.ocupacion === null || c.ocupacion === undefined ? null : normalizarComposicion(c.ocupacion)
  if (total !== null && (!Number.isFinite(total) || total < 0)) return null
  if (total === null && ocupacion === null) return null
  return {
    ocupacion,
    total,
    por: typeof c.por === 'string' ? c.por : null,
    porId: typeof c.porId === 'string' ? c.porId : null,
    en: c.en,
  }
}

/** Lee los precios a mano sin confiar en su forma: lo que no se entiende se descarta. */
export function leerPreciosAMano(raw: unknown): PreciosAMano {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: PreciosAMano = {}
  for (const [clave, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const d = v as Record<string, unknown>
    const precio = Number(d.precio)
    if (!Number.isFinite(precio) || precio < 0 || typeof d.en !== 'string') continue
    out[clave] = {
      precio,
      por: typeof d.por === 'string' ? d.por : null,
      porId: typeof d.porId === 'string' ? d.porId : null,
      en: d.en,
    }
  }
  return out
}

/** Lee `items.tarifa_pax` sin confiar en su forma: un jsonb viejo o roto no rompe la pantalla. */
export function leerTarifaPax(raw: unknown): TarifaPax {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const casillas: CasillasLeidas = {}
  const crudas = (r.casillas && typeof r.casillas === 'object' ? r.casillas : {}) as Record<string, unknown>
  for (const clave of ['grupo_completo', 'sin_infantes', 'solo_adultos'] as ClaveCasilla[]) {
    const l = leerLectura(crudas[clave])
    if (l) casillas[clave] = l
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
  const moneda = leerDecisionMoneda(r.moneda)
  const costoManual = leerCostoManual(r.costoManual)
  const habitaciones = leerHabitaciones(r.habitaciones)
  const preciosAMano = leerPreciosAMano(r.preciosAMano)
  const fotoHotel = leerFotoDelHotel(r.fotoHotel)
  return {
    composicion: normalizarComposicion(r.composicion),
    casillas,
    confirmada,
    ...(Object.keys(correcciones).length > 0 ? { correcciones } : {}),
    ...(typeof r.descripcionDelSistema === 'string' || r.descripcionDelSistema === null
      ? { descripcionDelSistema: r.descripcionDelSistema as string | null }
      : {}),
    actualizadaEn: typeof r.actualizadaEn === 'string' ? r.actualizadaEn : null,
    // Igual que las correcciones: sin decisión, la llave no aparece.
    ...(moneda ? { moneda } : {}),
    ...(costoManual ? { costoManual } : {}),
    // Sin habitaciones la llave no aparece: una opción de siempre se lee igual que antes.
    ...(habitaciones ? { habitaciones } : {}),
    // Igual: sin precios a mano la llave no aparece.
    ...(Object.keys(preciosAMano).length > 0 ? { preciosAMano } : {}),
    // Igual: sin foto del hotel la llave no aparece.
    ...(fotoHotel ? { fotoHotel } : {}),
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
  /** El precio lo escribió una persona en la tarjeta. */
  aMano?: boolean
}

/**
 * El precio unitario de cada fila cuando alguna lo tiene escrito a mano: esas se quedan con
 * el suyo, y las demás se reparten lo que queda del precio de la línea en proporción a su
 * costo (el mismo criterio de siempre). Al peso. Si lo escrito a mano ya cubre el precio de
 * la línea, a las demás no les queda nada: cero, nunca negativo.
 */
export function repartirConManuales(
  filas: readonly { clave: string; cantidad: number; peso: number }[],
  precioLinea: number,
  aMano: PreciosAMano,
): Map<string, number> {
  const out = new Map<string, number>()
  let fijo = 0
  for (const f of filas) {
    const m = aMano[f.clave]
    if (!m) continue
    out.set(f.clave, Math.round(m.precio))
    fijo += Math.round(m.precio) * f.cantidad
  }
  const libres = filas.filter(f => !aMano[f.clave] && f.cantidad > 0)
  const resto = Math.max(0, Math.round(Number(precioLinea) || 0) - fijo)
  const repartido = repartirProporcional(resto, libres.map(f => f.peso))
  libres.forEach((f, i) => out.set(f.clave, Math.round(repartido[i] / f.cantidad)))
  return out
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
export function precioPorPasajero(
  confirmada: TarifaConfirmada,
  precioLinea: number,
  /** Los precios de fila escritos a mano en la tarjeta (`tarifa_pax.preciosAMano`). */
  aMano?: PreciosAMano | null,
): PrecioPorPasajero[] {
  const total = confirmada.costos.reduce((a, c) => a + c.totalCOP, 0)
  const filas = confirmada.costos.filter(c => c.cantidad > 0)
  if (filas.some(c => aMano?.[c.tipo])) {
    const unitarios = repartirConManuales(
      filas.map(c => ({ clave: c.tipo, cantidad: c.cantidad, peso: c.totalCOP })),
      Number(precioLinea) || 0,
      aMano ?? {},
    )
    return filas.map(c => ({
      tipo: c.tipo,
      cantidad: c.cantidad,
      precioUnitario: unitarios.get(c.tipo) ?? 0,
      ...(aMano?.[c.tipo] ? { aMano: true } : {}),
    }))
  }
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
