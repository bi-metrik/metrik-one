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

function edad(v: unknown): number | null {
  const t = String(v ?? '').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isInteger(n) && n >= 0 && n <= 17 ? n : -1
}

/** Noches entre dos fechas «AAAA-MM-DD». 0 si no se puede. */
export function nochesEntre(entrada: string, salida: string): number {
  if (!FECHA.test(entrada) || !FECHA.test(salida)) return 0
  const n = Math.round((Date.parse(`${salida}T00:00:00Z`) - Date.parse(`${entrada}T00:00:00Z`)) / 86_400_000)
  return Number.isFinite(n) && n > 0 ? n : 0
}

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

const OBLIGATORIO = 'Escríbelo.'

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
 * De lo que llenó la persona a la lectura de una captura, por el mismo juez y el mismo
 * constructor. `leidaEn` y `hoy` entran por parámetro para poder probarlo. Con `viaje`, un
 * hotel fuera de sus fechas lleva un aviso (`avisoFechasFueraDelViaje`).
 */
export function lecturaManual(args: {
  ranura: DefinicionRanura
  entrada: { tipo: 'hotel'; datos: HotelManual } | { tipo: 'traslado'; datos: TrasladoManual }
  leidaEn: string
  hoy?: string
  viaje?: { inicio: string | null; fin: string | null } | null
}): ResultadoManual {
  const { ranura, entrada } = args
  const errores = entrada.tipo === 'hotel' ? validarHotelManual(entrada.datos) : validarTrasladoManual(entrada.datos)
  if (Object.keys(errores).length > 0) return { ok: false, errores }
  const cruda = entrada.tipo === 'hotel' ? crudaDeHotelManual(entrada.datos) : crudaDeTrasladoManual(entrada.datos)
  const veredicto = evaluarLectura(ranura, cruda, { soloMinimosDeCosto: true, manual: true, ...(args.hoy ? { hoy: args.hoy } : {}) })
  if (!veredicto.ok) return { ok: false, errores: { _: veredicto.instruccion } }
  const lectura = construirLecturaCasilla(ranura, veredicto, args.leidaEn)
  const h = entrada.tipo === 'hotel' ? entrada.datos : null
  lectura.origen = 'manual'
  const aviso = h ? avisoFechasFueraDelViaje(h.entrada, h.salida, args.viaje) : null
  if (aviso) lectura.alertas = [...lectura.alertas, aviso]
  lectura.manual = {
    fuente: entrada.datos.fuente,
    incluye: h?.incluye ? h.incluye : null,
    edadNino: h && h.edadDesde !== null && h.edadHasta !== null && h.edadDesde >= 0 && h.edadHasta >= 0
      ? { desde: h.edadDesde, hasta: h.edadHasta }
      : null,
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
  }
}
