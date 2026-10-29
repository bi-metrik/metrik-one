/**
 * VIAJES EN BLOQUEO (Trappvel, reunión Mauricio–Tatiana del 2026-10-26; brief del 2026-10-27).
 *
 * Un operador (Aliados Travel, Tu Reserva…) compra cupo fijo de vuelo + hotel para fechas cerradas y
 * vende un PAQUETE: un valor por persona que ya trae tiquetes, alimentación, planes, traslados y seguro
 * (según los íconos). La asesora no cotiza vuelo ni hotel por separado.
 *
 * En la cotización por pasos, cada opción del servicio «Paquete de bloqueo» es un paquete con DOS
 * pantallazos que van juntos: el del hotel y el del vuelo. Las dos imágenes no tienen nada que las
 * relacione: las une la asesora al cargarlas en el MISMO paquete. ONE nunca las empareja por contenido.
 *
 * ## Qué vive aquí (puro)
 *
 *  · La forma del paquete guardado en `items.tarifa_pax.bloqueo` y su lectura saneada
 *    (`leerPaqueteBloqueo`): toda llave que no se lea aquí se pierde en la siguiente escritura.
 *  · El costo: Σ (precio por persona × personas de esa acomodación) + niños × precio CHD.
 *  · Las fechas: las del vuelo; sin vuelo, salida escrita a mano + noches del hotel.
 *  · Los avisos (fechas que no cuadran con las noches, «Compra antes del» vencido, vuelo sin el ícono
 *    del tiquete, personas que no son los pasajeros de la solicitud).
 *
 * El vuelo NO suma costo: ya está dentro del precio del paquete. El margen NO se inventa aquí: sale de
 * la casilla de comisión que ya existe (`tarifa-publica.ts`: comisión incluida = Pública, margen 0;
 * por incluir = Neta, el margen de la cotización).
 */

import { parseMontoCop } from '@/lib/negocios/monto-cop'

// ── Acomodaciones ─────────────────────────────────────────────────────────────

export const ACOMODACIONES = ['sencilla', 'doble', 'triple', 'cuadruple'] as const
export type Acomodacion = (typeof ACOMODACIONES)[number]

/** Cuántas personas duermen en una habitación de cada acomodación. */
export const PERSONAS_POR_HABITACION: Record<Acomodacion, number> = { sencilla: 1, doble: 2, triple: 3, cuadruple: 4 }

export const ETIQUETA_ACOMODACION: Record<Acomodacion, string> = {
  sencilla: 'Sencilla',
  doble: 'Doble',
  triple: 'Triple',
  cuadruple: 'Cuádruple',
}

export function esAcomodacion(v: unknown): v is Acomodacion {
  return typeof v === 'string' && (ACOMODACIONES as readonly string[]).includes(v)
}

// ── Qué incluye: cinco categorías canónicas ──────────────────────────────────

/**
 * Las cinco categorías en que se lee la fila de íconos. Los íconos CAMBIAN de un operador a otro
 * (Mauricio, 2026-10-27): no hay leyenda fija; el modelo interpreta cada ícono y lo lleva a una de
 * estas. En Aliados son tiquete, cubiertos, lancha, bus y maletín con cruz, pero es solo un ejemplo.
 */
export const CATEGORIAS_INCLUYE = ['tiquete_aereo', 'alimentacion', 'planes_tours', 'traslados', 'seguro_medico'] as const
export type CategoriaIncluye = (typeof CATEGORIAS_INCLUYE)[number]

export const ETIQUETA_INCLUYE: Record<CategoriaIncluye, string> = {
  tiquete_aereo: 'Tiquete aéreo',
  alimentacion: 'Alimentación',
  planes_tours: 'Planes / tours',
  traslados: 'Traslados',
  seguro_medico: 'Seguro médico',
}

export function esCategoriaIncluye(v: unknown): v is CategoriaIncluye {
  return typeof v === 'string' && (CATEGORIAS_INCLUYE as readonly string[]).includes(v)
}

/**
 * Cada casilla tiene TRES estados: `true` incluido, `false` no incluido, `null` sin dato (vacía, para
 * que la asesora la llene). Sin íconos en la pantalla todas quedan en `null`: no se adivina.
 */
export type CasillasIncluye = Record<CategoriaIncluye, boolean | null>

/** Un ícono que el modelo no pudo llevar con certeza a una categoría. Lo clasifica la asesora. */
export interface IconoSinIdentificar {
  /** Lo que se ve («una maleta con ruedas», «un sol»). */
  descripcion: string
  /** Lo que eligió la asesora. `null` = sin clasificar; `'ninguna'` = no es nada de lo que se incluye. */
  categoria: CategoriaIncluye | 'ninguna' | null
}

export interface IncluyeBloqueo {
  casillas: CasillasIncluye
  sinIdentificar: IconoSinIdentificar[]
  /** El texto que acompaña los íconos, tal cual («Receptivos… traslados in y out»). */
  texto: string | null
}

export function casillasVacias(): CasillasIncluye {
  return { tiquete_aereo: null, alimentacion: null, planes_tours: null, traslados: null, seguro_medico: null }
}

// ── El paquete ────────────────────────────────────────────────────────────────

export interface PrecioAcomodacion {
  acomodacion: Acomodacion
  /** Precio POR PERSONA, en la moneda del paquete. */
  precioPorPersona: number | null
}

export interface PrecioNino {
  /** Precio por niño. */
  precio: number | null
  edadMin: number | null
  edadMax: number | null
}

/**
 * El precio del infante (QA del 2026-10-29). La pantalla del operador casi nunca lo trae: lo
 * escribe la asesora después de preguntarlo. `0` es un valor (el infante no paga); `null` = sin
 * dato, y con infantes en el viaje el paquete queda incompleto.
 */
export interface PrecioInfante {
  precio: number | null
}

export interface HotelBloqueo {
  hotel: string | null
  zona: string | null
  noches: number | null
  habitacion: string | null
  planAlimentacion: string | null
  /** «Baja | Regular», tal cual. */
  temporada: string | null
  tarifaPromo: boolean
  /** «Compra antes del 31-Mar-2027» → `2027-03-31`. */
  compraAntesDe: string | null
  moneda: string
  /** Solo las acomodaciones que aparecen en la pantalla, en el orden en que aparecen. */
  precios: PrecioAcomodacion[]
  nino: PrecioNino | null
  /** Ausente en paquetes guardados antes del 2026-10-29: se lee como `null`. */
  infante?: PrecioInfante | null
}

export interface TramoBloqueo {
  aerolinea: string | null
  numeroVuelo: string | null
  origen: string | null
  destino: string | null
  /** AAAA-MM-DD. */
  fecha: string | null
  horaSalida: string | null
  horaLlegada: string | null
  fechaLlegada: string | null
  /** 0 = directo; `null` = no se ve. */
  escalas: number | null
}

export interface VueloBloqueo {
  tramos: TramoBloqueo[]
}

export interface DistribucionBloqueo {
  /** Cuántas HABITACIONES toma de cada acomodación. */
  habitaciones: Partial<Record<Acomodacion, number>>
  ninos: number
  /** Cuántos infantes van en el paquete. Ausente (paquetes viejos) = 0. */
  infantes?: number
  /**
   * La edad de cada niño, la que escribe la asesora. Con ella se revisa el rango CHD del operador:
   * un niño fuera del rango no es tarifa de niño. Ausente o vacío = no se escribió.
   */
  edadesNinos?: number[]
}

/** Lo que se guarda en `items.tarifa_pax.bloqueo`. */
export interface PaqueteBloqueo {
  version: 1
  operador: string | null
  hotel: HotelBloqueo
  /** `null` = sin pantallazo de vuelo: la salida va a mano (`salidaManual`). */
  vuelo: VueloBloqueo | null
  /** Sin vuelo, la fecha de salida que escribió la asesora. El regreso = salida + noches. */
  salidaManual: string | null
  incluye: IncluyeBloqueo
  distribucion: DistribucionBloqueo
  /** Las referencias de los pantallazos guardados (`sbext://…`), si se pudieron guardar. */
  imagenes: { hotel: string | null; vuelo: string | null }
}

export function hotelVacio(): HotelBloqueo {
  return {
    hotel: null, zona: null, noches: null, habitacion: null, planAlimentacion: null, temporada: null,
    tarifaPromo: false, compraAntesDe: null, moneda: 'COP', precios: [], nino: null, infante: null,
  }
}

export function paqueteVacio(operador: string | null = null): PaqueteBloqueo {
  return {
    version: 1,
    operador,
    hotel: hotelVacio(),
    vuelo: null,
    salidaManual: null,
    incluye: { casillas: casillasVacias(), sinIdentificar: [], texto: null },
    distribucion: { habitaciones: {}, ninos: 0, infantes: 0, edadesNinos: [] },
    imagenes: { hotel: null, vuelo: null },
  }
}

// ── Lectura saneada ───────────────────────────────────────────────────────────

type Obj = Record<string, unknown>
const esObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

export function textoCorto(v: unknown, max = 160): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const t = String(v).replace(/\s+/g, ' ').trim()
  if (!t || /^(null|n\/a|ninguno|ninguna)$/i.test(t)) return null
  return t.length <= max ? t : t.slice(0, max)
}

/** Un monto positivo (acepta «$ 1.649.915»). `null` si no hay monto legible o no es positivo. */
export function montoPositivo(v: unknown): number | null {
  const n = parseMontoCop(v)
  if (n === null || !Number.isFinite(n) || n <= 0 || n > 100_000_000_000) return null
  return Math.round(n * 100) / 100
}

function enteroEntre(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : NaN
  if (!Number.isFinite(n)) return null
  const e = Math.round(n)
  return e >= min && e <= max ? e : null
}

const MESES: Record<string, number> = {
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8,
  sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12,
}

function fechaValida(a: number, m: number, d: number): string | null {
  if (a < 2000 || a > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const f = new Date(Date.UTC(a, m - 1, d))
  if (f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Una fecha a AAAA-MM-DD: acepta la ISO que se le pide al modelo y la forma en que la escribe el
 * operador («05-Feb-2027», «31-Mar-2027», «5 feb 2027»). Sin año, `null`: nunca se inventa.
 */
export function fechaIso(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().toLowerCase()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t)
  if (m) return fechaValida(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{1,2})[\s/.-]+([a-záéíóú]{3,})\.?[\s/.-]+(?:de\s+)?(\d{4})$/.exec(t.replace(/\bde\b/g, ' ').replace(/\s+/g, ' '))
  if (m) {
    const mes = MESES[m[2].normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 3)]
    return mes ? fechaValida(Number(m[3]), mes, Number(m[1])) : null
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t)
  if (m) return fechaValida(Number(m[3]), Number(m[2]), Number(m[1]))
  return null
}

/** «4:45», «04:45», «21:39» → «04:45». `null` si no es una hora. */
export function horaHHMM(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{1,2})[:.h](\d{2})/.exec(v.trim())
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 23 || mi > 59) return null
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
}

function leerPrecios(v: unknown): PrecioAcomodacion[] {
  if (!Array.isArray(v)) return []
  const vistos = new Set<Acomodacion>()
  const fuera: PrecioAcomodacion[] = []
  for (const p of v) {
    if (!esObj(p) || !esAcomodacion(p.acomodacion) || vistos.has(p.acomodacion)) continue
    vistos.add(p.acomodacion)
    fuera.push({ acomodacion: p.acomodacion, precioPorPersona: montoPositivo(p.precioPorPersona) })
  }
  return fuera
}

export function leerHotel(v: unknown): HotelBloqueo {
  if (!esObj(v)) return hotelVacio()
  const nino = esObj(v.nino)
    ? { precio: montoPositivo(v.nino.precio), edadMin: enteroEntre(v.nino.edadMin, 0, 17), edadMax: enteroEntre(v.nino.edadMax, 0, 17) }
    : null
  return {
    hotel: textoCorto(v.hotel),
    zona: textoCorto(v.zona),
    noches: enteroEntre(v.noches, 1, 60),
    habitacion: textoCorto(v.habitacion),
    planAlimentacion: textoCorto(v.planAlimentacion, 200),
    temporada: textoCorto(v.temporada, 60),
    tarifaPromo: v.tarifaPromo === true,
    compraAntesDe: fechaIso(v.compraAntesDe),
    moneda: (textoCorto(v.moneda, 3) ?? 'COP').toUpperCase(),
    precios: leerPrecios(v.precios),
    nino: nino && (nino.precio !== null || nino.edadMin !== null || nino.edadMax !== null) ? nino : null,
    infante: esObj(v.infante) ? { precio: montoNoNegativo(v.infante.precio) } : null,
  }
}

/** Como `montoPositivo`, pero el 0 vale: «el infante no paga» es un precio. */
export function montoNoNegativo(v: unknown): number | null {
  if (v === 0 || v === '0') return 0
  return montoPositivo(v)
}

export function leerTramo(v: unknown): TramoBloqueo | null {
  if (!esObj(v)) return null
  const t: TramoBloqueo = {
    aerolinea: textoCorto(v.aerolinea, 60),
    numeroVuelo: textoCorto(v.numeroVuelo, 20),
    origen: textoCorto(v.origen, 60),
    destino: textoCorto(v.destino, 60),
    fecha: fechaIso(v.fecha),
    horaSalida: horaHHMM(v.horaSalida),
    horaLlegada: horaHHMM(v.horaLlegada),
    fechaLlegada: fechaIso(v.fechaLlegada),
    escalas: enteroEntre(v.escalas, 0, 5),
  }
  return Object.values(t).some(x => x !== null) ? t : null
}

export function leerVuelo(v: unknown): VueloBloqueo | null {
  if (!esObj(v) || !Array.isArray(v.tramos)) return null
  const tramos = v.tramos.map(leerTramo).filter((t): t is TramoBloqueo => t !== null).slice(0, 8)
  return tramos.length > 0 ? { tramos } : null
}

export function leerIncluye(v: unknown): IncluyeBloqueo {
  const casillas = casillasVacias()
  if (!esObj(v)) return { casillas, sinIdentificar: [], texto: null }
  const crudas = esObj(v.casillas) ? v.casillas : {}
  for (const c of CATEGORIAS_INCLUYE) {
    const x = crudas[c]
    casillas[c] = x === true ? true : x === false ? false : null
  }
  const sinIdentificar = (Array.isArray(v.sinIdentificar) ? v.sinIdentificar : [])
    .filter(esObj)
    .map(i => ({
      descripcion: textoCorto(i.descripcion, 120) ?? 'Ícono',
      categoria: esCategoriaIncluye(i.categoria) || i.categoria === 'ninguna' ? (i.categoria as CategoriaIncluye | 'ninguna') : null,
    }))
    .slice(0, 12)
  return { casillas, sinIdentificar, texto: textoCorto(v.texto, 400) }
}

export function leerDistribucion(v: unknown): DistribucionBloqueo {
  const habitaciones: Partial<Record<Acomodacion, number>> = {}
  if (!esObj(v)) return { habitaciones, ninos: 0, infantes: 0, edadesNinos: [] }
  const crudas = esObj(v.habitaciones) ? v.habitaciones : {}
  for (const a of ACOMODACIONES) {
    const n = enteroEntre(crudas[a], 0, 200)
    if (n !== null && n > 0) habitaciones[a] = n
  }
  const edadesNinos = (Array.isArray(v.edadesNinos) ? v.edadesNinos : [])
    .map(e => enteroEntre(e, 0, 17))
    .filter((e): e is number => e !== null)
    .slice(0, 200)
  return { habitaciones, ninos: enteroEntre(v.ninos, 0, 200) ?? 0, infantes: enteroEntre(v.infantes, 0, 200) ?? 0, edadesNinos }
}

function refImagen(v: unknown): string | null {
  return typeof v === 'string' && v.startsWith('sbext://') ? v.slice(0, 500) : null
}

/** `tarifa_pax.bloqueo`, saneado. `null` si la línea no es un paquete de bloqueo. */
export function leerPaqueteBloqueo(raw: unknown): PaqueteBloqueo | null {
  if (!esObj(raw) || raw.version !== 1) return null
  const imagenes = esObj(raw.imagenes) ? raw.imagenes : {}
  return {
    version: 1,
    operador: textoCorto(raw.operador, 120),
    hotel: leerHotel(raw.hotel),
    vuelo: leerVuelo(raw.vuelo),
    salidaManual: fechaIso(raw.salidaManual),
    incluye: leerIncluye(raw.incluye),
    distribucion: leerDistribucion(raw.distribucion),
    imagenes: { hotel: refImagen(imagenes.hotel), vuelo: refImagen(imagenes.vuelo) },
  }
}

// ── El costo ──────────────────────────────────────────────────────────────────

export interface FilaDeCosto {
  clave: Acomodacion | 'nino' | 'infante'
  etiqueta: string
  habitaciones: number | null
  personas: number
  precioPorPersona: number | null
  total: number | null
}

export interface CostoDelPaquete {
  filas: FilaDeCosto[]
  /** Adultos (personas en habitaciones) + niños + infantes. */
  personas: number
  adultos: number
  ninos: number
  infantes: number
  /** `null` si falta algún precio de lo distribuido o no hay nada distribuido. */
  total: number | null
  /** Por qué no hay total. */
  falta: string[]
}

const redondear = (n: number) => Math.round(n * 100) / 100

/**
 * Costo del paquete = Σ (precio por persona × personas de esa acomodación) + niños × precio CHD.
 * Ej.: 2 dobles + 1 sencilla + 3 triples = 4 + 1 + 9 = 14 personas.
 */
export function costoDelPaquete(p: Pick<PaqueteBloqueo, 'hotel' | 'distribucion'>): CostoDelPaquete {
  const filas: FilaDeCosto[] = []
  const falta: string[] = []
  let adultos = 0
  let total = 0
  for (const a of ACOMODACIONES) {
    const hab = p.distribucion.habitaciones[a] ?? 0
    if (hab <= 0) continue
    const personas = hab * PERSONAS_POR_HABITACION[a]
    adultos += personas
    const precio = p.hotel.precios.find(x => x.acomodacion === a)?.precioPorPersona ?? null
    if (precio === null) falta.push(`Falta el precio por persona de la ${ETIQUETA_ACOMODACION[a].toLowerCase()}.`)
    else total += precio * personas
    filas.push({ clave: a, etiqueta: ETIQUETA_ACOMODACION[a], habitaciones: hab, personas, precioPorPersona: precio, total: precio === null ? null : redondear(precio * personas) })
  }
  const ninos = p.distribucion.ninos
  if (ninos > 0) {
    const precio = p.hotel.nino?.precio ?? null
    if (precio === null) falta.push('Falta el precio por niño (CHD).')
    else total += precio * ninos
    filas.push({ clave: 'nino', etiqueta: 'Niño', habitaciones: null, personas: ninos, precioPorPersona: precio, total: precio === null ? null : redondear(precio * ninos) })
  }
  const infantes = p.distribucion.infantes ?? 0
  if (infantes > 0) {
    const precio = p.hotel.infante?.precio ?? null
    if (precio === null) falta.push('Falta el precio por infante.')
    else total += precio * infantes
    filas.push({ clave: 'infante', etiqueta: 'Infante', habitaciones: null, personas: infantes, precioPorPersona: precio, total: precio === null ? null : redondear(precio * infantes) })
  }
  if (filas.length === 0) falta.push('Pon cuántas habitaciones de cada acomodación toma el grupo.')
  return { filas, personas: adultos + ninos + infantes, adultos, ninos, infantes, total: falta.length === 0 ? redondear(total) : null, falta }
}

// ── Las fechas ────────────────────────────────────────────────────────────────

function sumarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  const f = new Date(Date.UTC(a, m - 1, d + dias))
  return f.toISOString().slice(0, 10)
}

export function diasEntre(desde: string, hasta: string): number {
  const [a1, m1, d1] = desde.split('-').map(Number)
  const [a2, m2, d2] = hasta.split('-').map(Number)
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000)
}

export interface FechasDelPaquete {
  salida: string | null
  regreso: string | null
  origen: 'vuelo' | 'manual' | null
}

/**
 * Las fechas del paquete. Con vuelo: la salida es la del primer tramo y el regreso la del último
 * (si hay más de uno). Sin vuelo: la salida que escribió la asesora y el regreso = salida + noches.
 */
export function fechasDelPaquete(p: Pick<PaqueteBloqueo, 'vuelo' | 'salidaManual' | 'hotel'>): FechasDelPaquete {
  const tramos = (p.vuelo?.tramos ?? []).filter(t => t.fecha)
  if (tramos.length > 0) {
    const ordenados = [...tramos].sort((a, b) => (a.fecha! < b.fecha! ? -1 : a.fecha! > b.fecha! ? 1 : 0))
    const ultimo = ordenados[ordenados.length - 1]
    return {
      salida: ordenados[0].fecha,
      regreso: ordenados.length > 1 ? (ultimo.fechaLlegada ?? ultimo.fecha) : null,
      origen: 'vuelo',
    }
  }
  if (p.salidaManual) {
    return {
      salida: p.salidaManual,
      regreso: p.hotel.noches ? sumarDias(p.salidaManual, p.hotel.noches) : null,
      origen: 'manual',
    }
  }
  return { salida: null, regreso: null, origen: null }
}

// ── Los avisos ────────────────────────────────────────────────────────────────

export interface AvisoBloqueo {
  clave: 'falta_costo' | 'fechas_noches' | 'compra_vencida' | 'sin_tiquete' | 'personas' | 'infantes' | 'nino_fuera_de_rango' | 'acomodacion_sin_precio' | 'sin_fechas' | 'moneda' | 'iconos_sin_clasificar'
  /** `rojo` = no se puede guardar el costo; `ambar` = se guarda, pero hay que mirarlo. */
  nivel: 'rojo' | 'ambar'
  texto: string
}

export interface ContextoAvisos {
  /** Hoy en Bogotá, AAAA-MM-DD: contra él se mide «Compra antes del». */
  hoy: string
  /** Los pasajeros de la solicitud. `null` = la solicitud no los dice. */
  pasajeros: { adultos: number; ninos: number; infantes: number } | null
}

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number)
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${d} ${meses[m - 1]} ${a}`
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

export function avisosDelPaquete(p: PaqueteBloqueo, ctx: ContextoAvisos): AvisoBloqueo[] {
  const avisos: AvisoBloqueo[] = []
  const costo = costoDelPaquete(p)
  for (const f of costo.falta) avisos.push({ clave: 'falta_costo', nivel: 'rojo', texto: f })
  // Lo que deja el paquete incompleto y no sale del costo (QA del 2026-10-29): frena «Enviar».
  for (const f of faltasFueraDelCosto(p, ctx.pasajeros)) avisos.push({ clave: f.clave, nivel: 'rojo', texto: f.texto })
  if (p.hotel.moneda !== 'COP') {
    avisos.push({ clave: 'moneda', nivel: 'rojo', texto: `El paquete está en ${p.hotel.moneda}: por ahora el bloqueo se cotiza en pesos. Escribe los precios en COP.` })
  }

  const fechas = fechasDelPaquete(p)
  if (!fechas.salida) {
    avisos.push({ clave: 'sin_fechas', nivel: 'ambar', texto: 'Sin fechas: pega el vuelo o escribe la fecha de salida.' })
  } else if (fechas.origen === 'vuelo' && fechas.regreso && p.hotel.noches) {
    const dias = diasEntre(fechas.salida, fechas.regreso)
    if (dias !== p.hotel.noches) {
      avisos.push({
        clave: 'fechas_noches',
        nivel: 'ambar',
        texto: `El vuelo va del ${fechaCorta(fechas.salida)} al ${fechaCorta(fechas.regreso)} (${plural(dias, 'noche', 'noches')}) y el hotel dice ${plural(p.hotel.noches, 'noche', 'noches')}.`,
      })
    }
  }

  if (p.hotel.compraAntesDe && ctx.hoy > p.hotel.compraAntesDe) {
    avisos.push({
      clave: 'compra_vencida',
      nivel: 'ambar',
      texto: `La tarifa decía «Compra antes del ${fechaCorta(p.hotel.compraAntesDe)}» y ya pasó: confirma el precio con ${p.operador ?? 'el operador'} antes de enviar.`,
    })
  }

  if (p.vuelo && p.vuelo.tramos.length > 0 && p.incluye.casillas.tiquete_aereo !== true) {
    avisos.push({ clave: 'sin_tiquete', nivel: 'ambar', texto: 'Hay vuelo, pero el hotel no muestra el tiquete aéreo como incluido. Revisa si el paquete trae los tiquetes.' })
  }

  const pendientes = p.incluye.sinIdentificar.filter(i => i.categoria === null).length
  if (pendientes > 0) {
    avisos.push({ clave: 'iconos_sin_clasificar', nivel: 'ambar', texto: `${plural(pendientes, 'ícono sin identificar', 'íconos sin identificar')}: dile a ONE qué es.` })
  }

  const pax = ctx.pasajeros
  if (pax && costo.filas.length > 0) {
    const partes: string[] = []
    if (costo.adultos !== pax.adultos) partes.push(`${plural(costo.adultos, 'adulto', 'adultos')} en las habitaciones y la solicitud dice ${pax.adultos}`)
    if (costo.ninos !== pax.ninos) partes.push(`${plural(costo.ninos, 'niño', 'niños')} en el paquete y la solicitud dice ${pax.ninos}`)
    if (costo.infantes !== pax.infantes) partes.push(`${plural(costo.infantes, 'infante', 'infantes')} en el paquete y la solicitud dice ${pax.infantes}`)
    if (partes.length > 0) avisos.push({ clave: 'personas', nivel: 'ambar', texto: `No cuadra con la solicitud: ${partes.join('; ')}.` })
  }
  return avisos
}

// ── Paquete incompleto: frena «Enviar» (QA del 2026-10-29) ───────────────────

export interface FaltaDelPaquete {
  clave: 'falta_costo' | 'infantes' | 'nino_fuera_de_rango' | 'acomodacion_sin_precio'
  texto: string
}

export const FALTA_EL_COSTO = 'Falta el costo del paquete.'

/**
 * Lo que deja el paquete incompleto sin salir de `costoDelPaquete`: una acomodación de la tabla sin
 * precio, un infante sin costo y un niño fuera del rango CHD del operador.
 */
function faltasFueraDelCosto(p: PaqueteBloqueo, pasajeros: ContextoAvisos['pasajeros']): FaltaDelPaquete[] {
  const out: FaltaDelPaquete[] = []
  const repartidas = new Set(ACOMODACIONES.filter(a => (p.distribucion.habitaciones[a] ?? 0) > 0))
  for (const pr of p.hotel.precios) {
    // La repartida sin precio ya la dice el costo; aquí la que está en la tabla y nadie llenó.
    if (pr.precioPorPersona === null && !repartidas.has(pr.acomodacion)) {
      out.push({ clave: 'acomodacion_sin_precio', texto: `La ${ETIQUETA_ACOMODACION[pr.acomodacion].toLowerCase()} no tiene precio: escríbelo o quita la acomodación.` })
    }
  }
  // Un infante repartido sin precio ya lo dice el costo; aquí el que trae la solicitud.
  const infantesDelPaquete = p.distribucion.infantes ?? 0
  const infantes = pasajeros?.infantes ?? 0
  if (infantes > 0 && infantesDelPaquete === 0 && (p.hotel.infante?.precio ?? null) === null) {
    out.push({ clave: 'infantes', texto: `${infantes === 1 ? 'Va 1 infante' : `Van ${infantes} infantes`} y el paquete no tiene su costo: pregúntalo al operador y escríbelo (0 si no paga).` })
  }
  const min = p.hotel.nino?.edadMin ?? null
  const max = p.hotel.nino?.edadMax ?? null
  if (min !== null || max !== null) {
    const fuera = (p.distribucion.edadesNinos ?? []).filter(e => (min !== null && e < min) || (max !== null && e > max))
    if (fuera.length > 0) {
      const rango = `${min ?? 0}-${max ?? 17} años`
      const edades = fuera.length === 1 ? `Un niño de ${fuera[0]} años está` : `Niños de ${fuera.join(', ')} años están`
      out.push({ clave: 'nino_fuera_de_rango', texto: `${edades} fuera del rango CHD del operador (${rango}): cotízalo como adulto o confirma el precio con el operador.` })
    }
  }
  return out
}

/**
 * Por qué este paquete no se puede enviar. Vacío = completo. `null` en `paquete` es una opción del
 * bloqueo que nunca se guardó: no tiene costo.
 *
 * El costo en cero va primero y con su nombre («Falta el costo del paquete»): sin él, la cotización
 * frenaba como margen bajo el mínimo (COT-2026-0007 de Trappvel, QA del 2026-10-29).
 */
export function faltasDelPaquete(paquete: PaqueteBloqueo | null, pasajeros: ContextoAvisos['pasajeros']): FaltaDelPaquete[] {
  if (!paquete) return [{ clave: 'falta_costo', texto: FALTA_EL_COSTO }]
  const costo = costoDelPaquete(paquete)
  const out: FaltaDelPaquete[] = []
  if (costo.total === null || costo.total <= 0) {
    out.push({ clave: 'falta_costo', texto: costo.falta[0] ? `${FALTA_EL_COSTO} ${costo.falta[0]}` : FALTA_EL_COSTO })
  }
  return [...out, ...faltasFueraDelCosto(paquete, pasajeros)]
}


// ── Para el documento y la tarjeta ────────────────────────────────────────────

/** «BOG → CTG · JA 5150 · 05 feb 04:45» */
export function textoDeTramo(t: TramoBloqueo): string {
  const ruta = [t.origen, t.destino].filter(Boolean).join(' → ')
  const vuelo = [t.aerolinea, t.numeroVuelo].filter(Boolean).join(' ')
  const cuando = [t.fecha ? fechaCorta(t.fecha) : null, t.horaSalida].filter(Boolean).join(' ')
  const directo = t.escalas === 0 ? 'directo' : t.escalas ? plural(t.escalas, 'escala', 'escalas') : null
  return [ruta, vuelo, cuando, directo].filter(Boolean).join(' · ')
}

/** Lo que incluye, en palabras: solo lo marcado como incluido. */
export function incluidoEnPalabras(i: IncluyeBloqueo): string[] {
  const marcadas = new Set<CategoriaIncluye>(CATEGORIAS_INCLUYE.filter(c => i.casillas[c] === true))
  for (const s of i.sinIdentificar) if (esCategoriaIncluye(s.categoria)) marcadas.add(s.categoria)
  return CATEGORIAS_INCLUYE.filter(c => marcadas.has(c)).map(c => ETIQUETA_INCLUYE[c])
}

/**
 * La descripción que la línea lleva en `items.descripcion` (la ve el documento del cliente): hotel,
 * noches, plan, lo que incluye y los vuelos. Sin precios por persona: esos son del operador.
 */
export function descripcionDelPaquete(p: PaqueteBloqueo): string {
  const h = p.hotel
  const partes: string[] = []
  const cabeza = [h.hotel, h.zona].filter(Boolean).join(' · ')
  if (cabeza) partes.push(cabeza)
  const estadia = [h.noches ? plural(h.noches, 'noche', 'noches') : null, h.habitacion, h.planAlimentacion].filter(Boolean).join(' · ')
  if (estadia) partes.push(estadia)
  const incluye = incluidoEnPalabras(p.incluye)
  if (incluye.length > 0) partes.push(`Incluye: ${incluye.join(', ')}`)
  for (const t of p.vuelo?.tramos ?? []) partes.push(`Vuelo ${textoDeTramo(t)}`)
  return partes.join('\n')
}

/**
 * El vuelo para ofrecer al crear OTRO paquete del mismo bloqueo: el del primer paquete que lo tenga
 * (mismo vuelo, otro hotel). Editable: es una sugerencia.
 */
export function vueloParaReutilizar(paquetes: readonly (PaqueteBloqueo | null)[]): VueloBloqueo | null {
  for (const p of paquetes) if (p?.vuelo && p.vuelo.tramos.length > 0) return p.vuelo
  return null
}
