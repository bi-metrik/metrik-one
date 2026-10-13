/**
 * Ingreso manual de un hotel (por habitación) o de un traslado, sin pantallazo (brief del
 * 2026-09-28, `brief-max-2026-09-28-cancelacion-e-ingreso-manual.md`).
 *
 * Tres canales de precio: el pantallazo de la plataforma, el portafolio en PDF del proveedor y
 * la tarifa por teléfono. Los dos últimos terminaban en Excel, y Alejandra armaba un
 * «pantallazo» por habitación para que el lector le entendiera. Esto es ese formulario.
 *
 * ## La decisión de fondo: produce la MISMA lectura que una captura
 *
 * El formulario no escribe nada propio. Arma lo que habría devuelto el modelo (`LecturaCruda`,
 * con los mismos slugs de la ranura), lo pasa por el mismo juez (`evaluarLectura`) y el mismo
 * constructor (`construirLecturaCasilla`), y entra por el mismo camino: bandeja → Aceptar →
 * Componentes. Así las habitaciones (R8), la tarifa por pasajero, el margen, el IVA y el
 * documento funcionan sin una segunda lógica.
 *
 * ## El costo es NETO, y el margen lo pone ONE
 *
 * Lo que se escribe es lo que cobra el proveedor. Se guarda como el total de la lectura y
 * `aPagarAgencia` queda en `null`: la opción hereda el margen de la cotización, igual que una
 * captura que solo muestra un precio. Si el formulario pusiera el neto en `aPagarAgencia`, el
 * margen del proveedor saldría en cero.
 *
 * ## Lo que NO sale de una captura
 *
 * `origen: 'manual'` y `manual` (la fuente, lo que incluye y la edad del niño). La fuente es
 * interna: no se escribe en ningún campo que imprima el documento (en un traslado leído,
 * «Proveedor» sí va a la descripción).
 *
 * Puro: sin red y sin base. La fecha de lectura entra por parámetro.
 */

import { marcarAsistenciaMedica } from './asistencia-medica'
import { nochesEntre } from './estadia'
import { construirLecturaCasilla } from './lectura-casilla'
import { evaluarLectura, type FilaTipoPaxCruda, type LecturaCruda, type ValorLeido } from './lectura-pantallazo'
import type { DefinicionRanura } from './ranuras-pantallazo'
import { describirOcupacion, type Composicion, type LecturaCasilla } from './tarifa-pasajero'

/** El rango de edad del niño que da el hotel (Verdemar: desde 2, hasta 11). */
export interface EdadNino {
  desde: number
  hasta: number
}

/** Lo que el formulario deja además de la lectura. Viaja dentro de `LecturaCasilla.manual`. */
export interface DatosManuales {
  /** «Portafolio Verdemar 2026», «Telefónico Estelar». Interno: no sale al cliente. */
  fuente: string
  /** «Traslado aeropuerto – hotel», «Bebidas nacionales». Solo hotel. */
  incluye: string | null
  /** El rango de edad del niño que da el hotel. `null` = no se llenó. */
  edadNino: EdadNino | null
  /**
   * «Es opcional: el cliente decide (no suma)», marcado en «✎ Escríbelo a mano» (por pasos, C5):
   * el servicio llega a la bandeja en «Opcional». Ausente = no se marcó.
   */
  opcional?: boolean
}

export interface HotelManual {
  hotel: string
  ciudad: string
  /** «AAAA-MM-DD». */
  entrada: string
  salida: string
  habitacion: string
  regimen: string
  incluye: string
  adultos: number
  ninos: number
  infantes: number
  /** Costo NETO por persona por noche, en pesos. */
  netoAdulto: number | null
  netoNino: number | null
  netoInfante: number | null
  edadDesde: number | null
  edadHasta: number | null
  fuente: string
}

export type CobroTraslado = 'por_persona' | 'por_vehiculo'

/**
 * Cómo viene el precio del proveedor (brief del 2026-09-30). Los portafolios de San Andrés dan
 * la tarifa in-out: 45.000 por persona YA es ida y regreso. Con «por trayecto» el neto se
 * multiplica por los trayectos; con `in_out` es el de todo el recorrido y no se multiplica.
 */
export type PrecioTraslado = 'por_trayecto' | 'in_out'

export interface TrasladoManual {
  ruta: string
  /** «AAAA-MM-DD», o vacío. */
  fecha: string
  adultos: number
  ninos: number
  infantes: number
  cobro: CobroTraslado
  /** Sin elegir es `null`: el formulario lo pide, porque equivocarse cobra doble o la mitad. */
  precio: PrecioTraslado | null
  /**
   * Costo NETO por ADULTO si se cobra por persona, o por vehículo: por trayecto, o de todo el
   * recorrido si `precio` es `in_out`.
   */
  neto: number | null
  /**
   * Por persona, el niño y el infante tienen su propio costo, como en el hotel. El infante
   * vacío es 0: va en brazos, sin silla, y lo habitual es que no pague. Por vehículo no aplican.
   */
  netoNino: number | null
  netoInfante: number | null
  /** Solo cuenta con `precio: 'por_trayecto'`: in-out ya es ida y regreso. */
  idaYRegreso: boolean
  fuente: string
}

/**
 * Un vuelo escrito a mano («✎ Escríbelo a mano», cotización por pasos, C5). Obligatorio: origen,
 * destino, fecha de ida y costo del adulto. El costo del niño y del infante vacío es que FALTA
 * (no 0): entra el flujo del precio por pasajero que falta, que impide enviar hasta tenerlo.
 */
export interface VueloManual {
  aerolinea: string
  origen: string
  destino: string
  /** «AAAA-MM-DD». */
  ida: string
  horaSalida: string
  horaLlegada: string
  numero: string
  tarifa: string
  /** «AAAA-MM-DD», o vacío = solo ida. */
  regreso: string
  horaSalidaRegreso: string
  horaLlegadaRegreso: string
  numeroRegreso: string
  adultos: number
  ninos: number
  infantes: number
  /** Costo NETO por pasajero, de todo el itinerario (ida y regreso). */
  netoAdulto: number | null
  netoNino: number | null
  netoInfante: number | null
  fuente: string
}

/**
 * Una actividad escrita a mano (C5). Obligatorio: nombre y costo del adulto. Como el vuelo, el
 * niño o el infante sin costo es que falta.
 */
export interface ActividadManual {
  nombre: string
  ciudad: string
  /** «AAAA-MM-DD», o vacío. */
  fecha: string
  adultos: number
  ninos: number
  infantes: number
  /** Costo NETO por persona. */
  netoAdulto: number | null
  netoNino: number | null
  netoInfante: number | null
  /** «Es opcional: el cliente decide (no suma)». */
  opcional: boolean
  fuente: string
}

/** Cómo cobra un «Otro servicio»: el mismo valor por cada viajero, o un valor por todo. */
export type CobroOtroServicio = 'por_persona' | 'total'

/**
 * «Otro servicio» escrito a mano (cotización por pasos, 2026-10-13): asistencia médica, seguro de
 * viaje, tarjeta de turismo, equipaje adicional. Obligatorio: nombre y costo. Por persona, el costo
 * es el mismo para cada viajero (adulto, niño o infante: así cobran los planes); por todo, un solo
 * valor. Opcional: proveedor o detalle y la fuente.
 */
export interface OtroServicioManual {
  nombre: string
  /** «Assist Card, plan Básico». Va a la descripción de la opción: lo ve el cliente. */
  proveedor: string
  adultos: number
  ninos: number
  infantes: number
  cobro: CobroOtroServicio
  /** Costo NETO por persona, o de todo el servicio. */
  neto: number | null
  fuente: string
}

/** Los atajos del nombre (Noor, Paso 1): lo que más se escribe. */
export const ATAJOS_OTRO_SERVICIO = ['Asistencia médica', 'Seguro de viaje', 'Tarjeta de turismo', 'Equipaje adicional'] as const

export type ErroresManual = Record<string, string>

export type ResultadoManual =
  | { ok: true; lectura: LecturaCasilla }
  | { ok: false; errores: ErroresManual }

const FECHA = /^\d{4}-\d{2}-\d{2}$/

const texto = (v: unknown, max = 160): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

function entero(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim() || '0')
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : -1
}

/** Un monto en pesos escrito a mano: «280.000», «280000», «$ 280.000». `null` vacío o ilegible. */
export function montoManual(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v) : null
  const t = String(v ?? '').replace(/[$\s]/g, '').replace(/\./g, '').replace(/,\d{1,2}$/, '')
  if (t === '' || !/^\d+$/.test(t)) return null
  return Number(t)
}

/**
 * Lo que se VE mientras se escribe un monto: «280000» → «280.000» (brief del 2026-10-01,
 * punto 7). Solo dígitos, con el punto de miles; vacío queda vacío. Lo que se guarda es el
 * número: `montoManual` lee «280.000» igual que «280000».
 */
export function montoConMiles(v: string): string {
  const digitos = v.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  return digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

function edad(v: unknown): number | null {
  const t = String(v ?? '').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isInteger(n) && n >= 0 && n <= 17 ? n : -1
}

/** Noches entre dos fechas «AAAA-MM-DD». 0 si no se puede. Vive en `estadia.ts`. */
export { nochesEntre }

/** Lo que llega del navegador, sin confiar en su forma. */
export function leerHotelManual(raw: unknown): HotelManual {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    hotel: texto(r.hotel),
    ciudad: texto(r.ciudad, 80),
    entrada: texto(r.entrada, 10),
    salida: texto(r.salida, 10),
    habitacion: texto(r.habitacion),
    regimen: texto(r.regimen),
    incluye: texto(r.incluye, 300),
    adultos: entero(r.adultos),
    ninos: entero(r.ninos),
    infantes: entero(r.infantes),
    netoAdulto: montoManual(r.netoAdulto),
    netoNino: montoManual(r.netoNino),
    netoInfante: montoManual(r.netoInfante),
    edadDesde: edad(r.edadDesde),
    edadHasta: edad(r.edadHasta),
    fuente: texto(r.fuente),
  }
}

export function leerTrasladoManual(raw: unknown): TrasladoManual {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    ruta: texto(r.ruta),
    fecha: texto(r.fecha, 10),
    adultos: entero(r.adultos),
    ninos: entero(r.ninos),
    infantes: entero(r.infantes),
    cobro: r.cobro === 'por_vehiculo' ? 'por_vehiculo' : 'por_persona',
    precio: r.precio === 'in_out' || r.precio === 'por_trayecto' ? r.precio : null,
    neto: montoManual(r.neto),
    netoNino: montoManual(r.netoNino),
    netoInfante: montoManual(r.netoInfante),
    idaYRegreso: r.idaYRegreso === true,
    fuente: texto(r.fuente),
  }
}

export function leerVueloManual(raw: unknown): VueloManual {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    aerolinea: texto(r.aerolinea, 80),
    origen: texto(r.origen, 80),
    destino: texto(r.destino, 80),
    ida: texto(r.ida, 10),
    horaSalida: texto(r.horaSalida, 5),
    horaLlegada: texto(r.horaLlegada, 5),
    numero: texto(r.numero, 40),
    tarifa: texto(r.tarifa, 60),
    regreso: texto(r.regreso, 10),
    horaSalidaRegreso: texto(r.horaSalidaRegreso, 5),
    horaLlegadaRegreso: texto(r.horaLlegadaRegreso, 5),
    numeroRegreso: texto(r.numeroRegreso, 40),
    adultos: entero(r.adultos),
    ninos: entero(r.ninos),
    infantes: entero(r.infantes),
    netoAdulto: montoManual(r.netoAdulto),
    netoNino: montoManual(r.netoNino),
    netoInfante: montoManual(r.netoInfante),
    fuente: texto(r.fuente),
  }
}

export function leerActividadManual(raw: unknown): ActividadManual {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    nombre: texto(r.nombre),
    ciudad: texto(r.ciudad, 80),
    fecha: texto(r.fecha, 10),
    adultos: entero(r.adultos),
    ninos: entero(r.ninos),
    infantes: entero(r.infantes),
    netoAdulto: montoManual(r.netoAdulto),
    netoNino: montoManual(r.netoNino),
    netoInfante: montoManual(r.netoInfante),
    opcional: r.opcional === true,
    fuente: texto(r.fuente),
  }
}

export function leerOtroServicioManual(raw: unknown): OtroServicioManual {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    nombre: texto(r.nombre, 100),
    proveedor: texto(r.proveedor, 120),
    adultos: entero(r.adultos),
    ninos: entero(r.ninos),
    infantes: entero(r.infantes),
    cobro: r.cobro === 'total' ? 'total' : 'por_persona',
    neto: montoManual(r.neto),
    fuente: texto(r.fuente),
  }
}

const OBLIGATORIO = 'Escríbelo.'
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

function erroresDePasajeros(p: { adultos: number; ninos: number; infantes: number }, e: ErroresManual) {
  if (p.adultos < 0) e.adultos = 'Un número de 0 a 99.'
  if (p.ninos < 0) e.ninos = 'Un número de 0 a 99.'
  if (p.infantes < 0) e.infantes = 'Un número de 0 a 99.'
  if (!e.adultos && !e.ninos && !e.infantes && p.adultos + p.ninos + p.infantes === 0) e.adultos = 'Al menos un pasajero.'
}

export function validarHotelManual(h: HotelManual): ErroresManual {
  const e: ErroresManual = {}
  if (!h.hotel) e.hotel = OBLIGATORIO
  if (!h.habitacion) e.habitacion = OBLIGATORIO
  if (!FECHA.test(h.entrada)) e.entrada = 'Escoge la fecha.'
  if (!FECHA.test(h.salida)) e.salida = 'Escoge la fecha.'
  if (!e.entrada && !e.salida && nochesEntre(h.entrada, h.salida) === 0) e.salida = 'La salida va después de la entrada.'
  erroresDePasajeros(h, e)
  if (h.adultos === 0 && !e.adultos) e.adultos = 'Al menos un adulto en la habitación.'
  if (h.adultos > 0 && !(h.netoAdulto && h.netoAdulto > 0)) e.netoAdulto = 'Escribe lo que cobra el proveedor por adulto.'
  if (h.ninos > 0 && !(h.netoNino !== null && h.netoNino >= 0)) e.netoNino = 'Escribe lo que cobra por niño (0 si no paga).'
  const conDesde = h.edadDesde !== null
  const conHasta = h.edadHasta !== null
  if (h.edadDesde === -1) e.edadDesde = 'Una edad de 0 a 17.'
  if (h.edadHasta === -1) e.edadHasta = 'Una edad de 0 a 17.'
  if (!e.edadDesde && !e.edadHasta && conDesde !== conHasta) e[conDesde ? 'edadHasta' : 'edadDesde'] = 'Escribe las dos edades, o ninguna.'
  if (!e.edadDesde && !e.edadHasta && conDesde && conHasta && (h.edadDesde as number) > (h.edadHasta as number)) {
    e.edadHasta = 'No puede ser menor que «Desde».'
  }
  if (!h.fuente) e.fuente = 'Escribe de dónde sale la tarifa.'
  return e
}

export function validarTrasladoManual(t: TrasladoManual): ErroresManual {
  const e: ErroresManual = {}
  if (!t.ruta) e.ruta = OBLIGATORIO
  if (t.fecha !== '' && !FECHA.test(t.fecha)) e.fecha = 'Escoge la fecha.'
  erroresDePasajeros(t, e)
  if (t.precio === null) e.precio = 'Elige cómo viene el precio.'
  if (t.cobro === 'por_vehiculo') {
    if (!(t.neto && t.neto > 0)) e.neto = 'Escribe lo que cobra el proveedor.'
  } else {
    if ((t.adultos > 0 || t.ninos + t.infantes <= 0) && !(t.neto && t.neto > 0)) e.neto = 'Escribe lo que cobra el proveedor por adulto.'
    if (t.ninos > 0 && !(t.netoNino !== null && t.netoNino >= 0)) e.netoNino = 'Escribe lo que cobra por niño (0 si no paga).'
    if (t.adultos === 0 && t.ninos === 0 && t.infantes > 0 && !(t.netoInfante && t.netoInfante > 0)) {
      e.netoInfante = 'Escribe lo que cobra el proveedor por infante.'
    }
  }
  if (!t.fuente) e.fuente = 'Escribe de dónde sale la tarifa.'
  return e
}

export function validarVueloManual(v: VueloManual): ErroresManual {
  const e: ErroresManual = {}
  if (!v.origen) e.origen = OBLIGATORIO
  if (!v.destino) e.destino = OBLIGATORIO
  if (!FECHA.test(v.ida)) e.ida = 'Escoge la fecha.'
  if (v.regreso !== '' && !FECHA.test(v.regreso)) e.regreso = 'Escoge la fecha.'
  if (!e.ida && !e.regreso && v.regreso !== '' && v.regreso < v.ida) e.regreso = 'El regreso va después de la ida.'
  for (const k of ['horaSalida', 'horaLlegada', 'horaSalidaRegreso', 'horaLlegadaRegreso'] as const) {
    if (v[k] !== '' && !HORA.test(v[k])) e[k] = 'Una hora como 07:45.'
  }
  erroresDePasajeros(v, e)
  if (v.adultos === 0 && !e.adultos) e.adultos = 'Al menos un adulto.'
  if (v.adultos > 0 && !(v.netoAdulto && v.netoAdulto > 0)) e.netoAdulto = 'Escribe lo que cobra el proveedor por adulto.'
  return e
}

export function validarActividadManual(a: ActividadManual): ErroresManual {
  const e: ErroresManual = {}
  if (!a.nombre) e.nombre = OBLIGATORIO
  if (a.fecha !== '' && !FECHA.test(a.fecha)) e.fecha = 'Escoge la fecha.'
  erroresDePasajeros(a, e)
  if (a.adultos === 0 && !e.adultos) e.adultos = 'Al menos un adulto.'
  if (a.adultos > 0 && !(a.netoAdulto && a.netoAdulto > 0)) e.netoAdulto = 'Escribe lo que cobra el proveedor por adulto.'
  return e
}

export function validarOtroServicioManual(o: OtroServicioManual): ErroresManual {
  const e: ErroresManual = {}
  if (!o.nombre) e.nombre = OBLIGATORIO
  erroresDePasajeros(o, e)
  if (!(o.neto && o.neto > 0)) e.neto = o.cobro === 'total' ? 'Escribe lo que cobra el proveedor por todo.' : 'Escribe lo que cobra el proveedor por persona.'
  return e
}

const leido = (value: string | null): ValorLeido => ({ value, confidence: 1 })

function crudaDe(campos: Record<string, string | null>, porTipoPax: FilaTipoPaxCruda[], totalGeneral: number | null): LecturaCruda {
  return {
    veredicto: 'detalle_unico',
    observacion: null,
    campos: Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, leido(v)])),
    desglose: [],
    porTipoPax,
    totalGeneral,
    opcionesVisibles: 1,
  }
}

function filas(p: Composicion, unitario: (tipo: 'adulto' | 'nino' | 'infante') => number, veces: number): FilaTipoPaxCruda[] {
  const out: FilaTipoPaxCruda[] = []
  for (const [tipo, cantidad] of [['adulto', p.adultos], ['nino', p.ninos], ['infante', p.infantes]] as const) {
    if (cantidad <= 0) continue
    out.push({ tipo, cantidad, subtotal_tipo: Math.round(unitario(tipo) * veces * cantidad), moneda: 'COP', confidence: 1 })
  }
  return out
}

/** Lo que habría leído el modelo de un «pantallazo» de esta habitación. */
export function crudaDeHotelManual(h: HotelManual): LecturaCruda {
  const noches = nochesEntre(h.entrada, h.salida)
  const pax: Composicion = { adultos: h.adultos, ninos: h.ninos, infantes: h.infantes }
  const porTipo = filas(pax, t => (t === 'adulto' ? h.netoAdulto : t === 'nino' ? h.netoNino : h.netoInfante) ?? 0, noches)
  const total = porTipo.reduce((a, f) => a + f.subtotal_tipo, 0)
  return crudaDe({
    hotel: h.hotel,
    ciudad: h.ciudad || null,
    tipo_habitacion: h.habitacion,
    regimen: h.regimen || null,
    check_in: h.entrada,
    check_out: h.salida,
    noches: String(noches),
    ocupacion: describirOcupacion(pax),
    ocupacion_adultos: String(h.adultos),
    ocupacion_ninos: String(h.ninos),
    ocupacion_infantes: String(h.infantes),
    moneda: 'COP',
    precio_total: String(total),
    base_precio: 'total',
  }, porTipo, total)
}

/** Lo mismo para un traslado. Por vehículo no hay filas por pasajero: es un solo total. */
export function crudaDeTrasladoManual(t: TrasladoManual): LecturaCruda {
  // In-out: el neto ya es el de ida y regreso. Por trayecto: se multiplica por los trayectos.
  const idaYRegreso = t.precio === 'in_out' || t.idaYRegreso
  const trayectos = t.precio === 'in_out' ? 1 : idaYRegreso ? 2 : 1
  const pax: Composicion = { adultos: t.adultos, ninos: t.ninos, infantes: t.infantes }
  const personas = t.adultos + t.ninos + t.infantes
  // El mismo reparto del hotel: cada tipo con su costo, y el infante sin costo escrito en 0.
  const porTipo = t.cobro === 'por_persona'
    ? filas(pax, tipo => (tipo === 'adulto' ? t.neto : tipo === 'nino' ? t.netoNino : t.netoInfante) ?? 0, trayectos)
    : []
  const total = t.cobro === 'por_persona' ? porTipo.reduce((a, f) => a + f.subtotal_tipo, 0) : Math.round((t.neto ?? 0) * trayectos)
  return crudaDe({
    trayecto: `${t.ruta} (${idaYRegreso ? 'ida y regreso' : 'solo ida'})`,
    fecha_hora: t.fecha || null,
    pax: String(personas),
    ocupacion_adultos: String(t.adultos),
    ocupacion_ninos: String(t.ninos),
    ocupacion_infantes: String(t.infantes),
    moneda: 'COP',
    precio_total: String(total),
    base_precio: 'total',
  }, porTipo, porTipo.length > 0 ? total : null)
}

/**
 * Las filas por pasajero de lo escrito a mano en un vuelo o una actividad: cada tipo con su costo.
 * Un niño o un infante SIN costo escrito no lleva fila: es el precio que falta (no un 0).
 */
function filasConFaltante(p: Composicion, netos: { adulto: number | null; nino: number | null; infante: number | null }): FilaTipoPaxCruda[] {
  const out: FilaTipoPaxCruda[] = []
  for (const [tipo, cantidad] of [['adulto', p.adultos], ['nino', p.ninos], ['infante', p.infantes]] as const) {
    const neto = netos[tipo]
    if (cantidad <= 0 || neto === null) continue
    out.push({ tipo, cantidad, subtotal_tipo: Math.round(neto * cantidad), moneda: 'COP', confidence: 1 })
  }
  return out
}

/** Lo que habría leído el modelo del pantallazo de este vuelo. */
export function crudaDeVueloManual(v: VueloManual): LecturaCruda {
  const pax: Composicion = { adultos: v.adultos, ninos: v.ninos, infantes: v.infantes }
  const porTipo = filasConFaltante(pax, { adulto: v.netoAdulto, nino: v.netoNino, infante: v.netoInfante })
  const total = porTipo.reduce((a, f) => a + f.subtotal_tipo, 0)
  const numero = [v.numero, v.numeroRegreso].filter(Boolean).join(' / ')
  return crudaDe({
    aerolinea: v.aerolinea || null,
    origen: v.origen,
    destino: v.destino,
    fecha_salida: v.ida,
    fecha_regreso: v.regreso || null,
    hora_salida: v.horaSalida || null,
    hora_llegada: v.horaLlegada || null,
    hora_salida_regreso: v.regreso ? v.horaSalidaRegreso || null : null,
    hora_llegada_regreso: v.regreso ? v.horaLlegadaRegreso || null : null,
    numero_vuelo: numero || null,
    familia_tarifa: v.tarifa || null,
    pax: String(v.adultos + v.ninos + v.infantes),
    ocupacion: describirOcupacion(pax),
    ocupacion_adultos: String(v.adultos),
    ocupacion_ninos: String(v.ninos),
    ocupacion_infantes: String(v.infantes),
    moneda: 'COP',
    precio_total: String(total),
    base_precio: 'total',
  }, porTipo, total)
}

/** Lo que habría leído el modelo de la ficha de esta actividad. */
export function crudaDeActividadManual(a: ActividadManual): LecturaCruda {
  const pax: Composicion = { adultos: a.adultos, ninos: a.ninos, infantes: a.infantes }
  const porTipo = filasConFaltante(pax, { adulto: a.netoAdulto, nino: a.netoNino, infante: a.netoInfante })
  const total = porTipo.reduce((x, f) => x + f.subtotal_tipo, 0)
  return crudaDe({
    nombre: a.nombre,
    ciudad: a.ciudad || null,
    fecha: a.fecha || null,
    pax: String(a.adultos + a.ninos + a.infantes),
    ocupacion: describirOcupacion(pax),
    ocupacion_adultos: String(a.adultos),
    ocupacion_ninos: String(a.ninos),
    ocupacion_infantes: String(a.infantes),
    moneda: 'COP',
    precio_total: String(total),
    base_precio: 'total',
  }, porTipo, total)
}

/**
 * Lo que habría leído el modelo de la cotización de este «Otro servicio». Por persona, cada
 * viajero con el mismo costo. Por todo, el valor se reparte por igual entre los viajeros, con el
 * redondeo en el primer tipo: así suma exactamente lo escrito y el costo se confirma solo, sin
 * pedir «otra búsqueda con los niños» (un solo total con menores pide desglose, TP4).
 */
export function crudaDeOtroServicioManual(o: OtroServicioManual): LecturaCruda {
  const pax: Composicion = { adultos: o.adultos, ninos: o.ninos, infantes: o.infantes }
  const personas = o.adultos + o.ninos + o.infantes
  const neto = o.neto ?? 0
  const porTipo = filas(pax, () => (o.cobro === 'por_persona' ? neto : personas > 0 ? neto / personas : 0), 1)
  if (o.cobro === 'total' && porTipo.length > 0) {
    porTipo[0].subtotal_tipo += Math.round(neto) - porTipo.reduce((a, f) => a + f.subtotal_tipo, 0)
  }
  const total = porTipo.reduce((a, f) => a + f.subtotal_tipo, 0)
  return crudaDe({
    nombre: o.nombre,
    proveedor: o.proveedor || null,
    pax: String(o.adultos + o.ninos + o.infantes),
    ocupacion_adultos: String(o.adultos),
    ocupacion_ninos: String(o.ninos),
    ocupacion_infantes: String(o.infantes),
    moneda: 'COP',
    precio_total: String(total),
    base_precio: 'total',
  }, porTipo, total)
}

/** Lo que entra a `lecturaManual`: uno de los cinco tipos con sus datos. */
export type EntradaManual =
  | { tipo: 'hotel'; datos: HotelManual }
  | { tipo: 'traslado'; datos: TrasladoManual }
  | { tipo: 'vuelo'; datos: VueloManual }
  | { tipo: 'actividad'; datos: ActividadManual }
  | { tipo: 'otro'; datos: OtroServicioManual }

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const fechaCorta = (f: string) => `${Number(f.slice(8, 10))} ${MESES[Number(f.slice(5, 7)) - 1]} ${f.slice(0, 4)}`

/**
 * El aviso cuando las fechas del hotel caen fuera de las del viaje (COT-2026-0018: la entrada
 * se escribió en octubre y el viaje es en noviembre). Es un AVISO: la habitación entra igual,
 * y quien la acepta decide. Sin fechas del viaje no se compara nada.
 */
export function avisoFechasFueraDelViaje(
  entrada: string,
  salida: string,
  viaje: { inicio: string | null; fin: string | null } | null | undefined,
): string | null {
  if (!viaje || !FECHA.test(entrada) || !FECHA.test(salida)) return null
  const inicio = viaje.inicio && FECHA.test(viaje.inicio) ? viaje.inicio : null
  const fin = viaje.fin && FECHA.test(viaje.fin) ? viaje.fin : null
  const antes = !!inicio && entrada < inicio
  const despues = !!fin && salida > fin
  if (!antes && !despues) return null
  const delViaje = inicio && fin
    ? `del ${fechaCorta(inicio)} al ${fechaCorta(fin)}`
    : inicio ? `desde el ${fechaCorta(inicio)}` : `hasta el ${fechaCorta(fin as string)}`
  return `El hotel va del ${fechaCorta(entrada)} al ${fechaCorta(salida)} y el viaje es ${delViaje}. Revisa las fechas.`
}

/**
 * El aviso cuando la fecha de una actividad cae fuera de las del viaje (COT-2026-0020: la
 * excursión leída el 15 nov en un viaje del 9 al 13). Mismo criterio que el del hotel: es un
 * AVISO, la actividad entra igual. Sin fecha leída o sin fechas del viaje no se compara nada.
 *
 * Acepta la fecha como la deja la lectura (`2026-11-15`, o `2026-11-15/dom` con el día de la
 * semana): solo cuenta el AAAA-MM-DD.
 */
export function avisoFechaActividadFueraDelViaje(
  fecha: string | null | undefined,
  viaje: { inicio: string | null; fin: string | null } | null | undefined,
): string | null {
  const dia = (fecha ?? '').trim().slice(0, 10)
  if (!viaje || !FECHA.test(dia)) return null
  const inicio = viaje.inicio && FECHA.test(viaje.inicio) ? viaje.inicio : null
  const fin = viaje.fin && FECHA.test(viaje.fin) ? viaje.fin : null
  const fuera = (!!inicio && dia < inicio) || (!!fin && dia > fin)
  if (!fuera) return null
  const delViaje = inicio && fin
    ? `del ${fechaCorta(inicio)} al ${fechaCorta(fin)}`
    : inicio ? `desde el ${fechaCorta(inicio)}` : `hasta el ${fechaCorta(fin as string)}`
  return `La actividad es el ${fechaCorta(dia)} y el viaje es ${delViaje}. Revisa la fecha.`
}

/**
 * ¿Esta alerta es la de `avisoFechasFueraDelViaje` (hotel) o la de
 * `avisoFechaActividadFueraDelViaje`? La bandeja la pinta como texto en la fila, no escondida
 * en el ícono de las demás alertas (brief del 2026-09-30, punto 2; actividad: 2026-10-01).
 */
export function esAvisoFechasFueraDelViaje(alerta: string): boolean {
  return /^El hotel va del .+ y el viaje es .+\. Revisa las fechas\.$/.test(alerta)
    || /^La actividad es el .+ y el viaje es .+\. Revisa la fecha\.$/.test(alerta)
}

/**
 * De lo que llenó la persona a la lectura de una captura, por el mismo juez y el mismo
 * constructor. `leidaEn` y `hoy` entran por parámetro para poder probarlo. Con `viaje`, un
 * hotel fuera de sus fechas lleva un aviso (`avisoFechasFueraDelViaje`).
 */
export function lecturaManual(args: {
  ranura: DefinicionRanura
  entrada: EntradaManual
  leidaEn: string
  hoy?: string
  viaje?: { inicio: string | null; fin: string | null } | null
  /**
   * «✎ Escríbelo a mano» de la cotización por pasos (C5): la fuente de la tarifa es opcional,
   * como el resto de lo que no lleva *. El ingreso manual de siempre la sigue pidiendo.
   */
  fuenteOpcional?: boolean
}): ResultadoManual {
  const { ranura, entrada } = args
  const errores = entrada.tipo === 'hotel'
    ? validarHotelManual(entrada.datos)
    : entrada.tipo === 'traslado'
      ? validarTrasladoManual(entrada.datos)
      : entrada.tipo === 'vuelo'
        ? validarVueloManual(entrada.datos)
        : entrada.tipo === 'actividad'
          ? validarActividadManual(entrada.datos)
          : validarOtroServicioManual(entrada.datos)
  if (args.fuenteOpcional) delete errores.fuente
  if (Object.keys(errores).length > 0) return { ok: false, errores }
  const cruda = entrada.tipo === 'hotel'
    ? crudaDeHotelManual(entrada.datos)
    : entrada.tipo === 'traslado'
      ? crudaDeTrasladoManual(entrada.datos)
      : entrada.tipo === 'vuelo'
        ? crudaDeVueloManual(entrada.datos)
        : entrada.tipo === 'actividad'
          ? crudaDeActividadManual(entrada.datos)
          : crudaDeOtroServicioManual(entrada.datos)
  const veredicto = evaluarLectura(ranura, cruda, { soloMinimosDeCosto: true, manual: true, ...(args.hoy ? { hoy: args.hoy } : {}) })
  if (!veredicto.ok) return { ok: false, errores: { _: veredicto.instruccion } }
  const lectura = construirLecturaCasilla(ranura, veredicto, args.leidaEn)
  const h = entrada.tipo === 'hotel' ? entrada.datos : null
  lectura.origen = 'manual'
  const aviso = h ? avisoFechasFueraDelViaje(h.entrada, h.salida, args.viaje) : null
  if (aviso) lectura.alertas = [...lectura.alertas, aviso]
  // Vuelo y actividad: el niño o el infante sin costo escrito viajan igual, sin precio (C5).
  if (entrada.tipo === 'vuelo' || entrada.tipo === 'actividad') {
    const d = entrada.datos
    const sinPrecio = ([['nino', d.ninos, d.netoNino], ['infante', d.infantes, d.netoInfante]] as const)
      .filter(([, cantidad, neto]) => cantidad > 0 && neto === null)
      .map(([tipo]) => tipo)
    if (sinPrecio.length > 0) lectura.sinPrecio = [...sinPrecio]
  }
  // «Otro servicio» que es una asistencia médica: marcada para «Documentos del viajero».
  if (entrada.tipo === 'otro') marcarAsistenciaMedica('otro', lectura)
  const avisoActividad = entrada.tipo === 'actividad' ? avisoFechaActividadFueraDelViaje(entrada.datos.fecha, args.viaje) : null
  if (avisoActividad) lectura.alertas = [...lectura.alertas, avisoActividad]
  lectura.manual = {
    fuente: entrada.datos.fuente,
    incluye: h?.incluye ? h.incluye : null,
    edadNino: h && h.edadDesde !== null && h.edadHasta !== null && h.edadDesde >= 0 && h.edadHasta >= 0
      ? { desde: h.edadDesde, hasta: h.edadHasta }
      : null,
    ...(entrada.tipo === 'actividad' && entrada.datos.opcional ? { opcional: true } : {}),
  }
  return { ok: true, lectura }
}

/** ¿La lectura la escribió una persona en el formulario, y no salió de un pantallazo? */
export function esManual(l: Pick<LecturaCasilla, 'origen'> | null | undefined): boolean {
  return l?.origen === 'manual'
}

/** Los datos manuales guardados, sin confiar en su forma. `null` si no hay. */
export function datosManuales(l: { origen?: unknown; manual?: unknown } | null | undefined): DatosManuales | null {
  if (!l || l.origen !== 'manual' || !l.manual || typeof l.manual !== 'object') return null
  const m = l.manual as Record<string, unknown>
  const e = m.edadNino as Record<string, unknown> | null | undefined
  const edadNino = e && Number.isInteger(e.desde) && Number.isInteger(e.hasta)
    ? { desde: e.desde as number, hasta: e.hasta as number }
    : null
  return {
    fuente: typeof m.fuente === 'string' ? m.fuente : '',
    incluye: typeof m.incluye === 'string' && m.incluye.trim() !== '' ? m.incluye : null,
    edadNino,
    ...(m.opcional === true ? { opcional: true } : {}),
  }
}
