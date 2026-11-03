/**
 * Hitos de gestión del viaje (Trappvel, `noor-hana-hitos-de-gestion-2026-10-21.md` y la
 * «Respuesta de Edgar» del 2026-10-21, que manda sobre el resto).
 *
 * Un hito es «una fecha en la que el equipo debe hacer alguna gestión para el cliente»: lo hace UNA
 * PERSONA de la agencia. ONE no le escribe nada al viajero (Edgar: «No, no, no. Cliente.»): a lo
 * sumo deja el mensaje listo para que la persona lo mande desde su WhatsApp.
 *
 * Módulo PURO (sin base ni red): de los servicios con sus fechas y tramos, las fechas del viaje,
 * el catálogo de la línea, las marcas guardadas (`negocio_hitos`), los aprobadores y el calendario
 * de Colombia, a la lista de hitos con fecha real, fecha de aviso, clase, responsable efectivo y
 * estado. Los hitos PENDIENTES no se guardan: se calculan cada vez. Solo se guarda lo que la persona
 * cerró (hecho, no aplica) con la fecha del servicio de ese momento: si la fecha cambia, la llave
 * cambia y el hito vuelve a estar pendiente.
 *
 * Reglas (del diseño, obligatorias):
 *   · Móvil: si cae en día no hábil se ADELANTA al hábil anterior (desfase negativo) o se corre al
 *     siguiente (desfase cero: pedir documentos el día que el cliente confirma un sábado).
 *   · Fijo: se queda en su día aunque sea no hábil (el check-in no se puede hacer antes de que la
 *     aerolínea lo abra). Entra en el resumen del último día hábil anterior.
 *   · Check-in que cae en no hábil: lo cubren los aprobadores de la línea (Edgar, por ahora), no la
 *     asesora. Los demás fijos se quedan con su responsable.
 *   · Sin fecha no se inventa: «Falta la fecha de …». Sin plazo (pre-registro sin verificar), «Falta
 *     el plazo del pre-registro».
 *   · Vencido sin remedio (el vuelo salió, el tour fue): desde el día siguiente es «No se hizo a
 *     tiempo». Sale de la lista de la asesora y queda contado para la dirección.
 *   · Solo viajes confirmados (`ETAPA_VIAJE_CONFIRMADO`, el mismo criterio del PR de fechas) y
 *     servicios que no están en «No va».
 *
 * Fuera de esta ola: la lectura del pasabordo («el pasabordo dice 27 oct y el vuelo es 28 oct»).
 * Queda el gancho `LectorPasabordo`; no se gasta cuota de ningún modelo.
 */

import { esDiaHabil, siguienteDiaHabil } from '@/lib/dates/dias-habiles'
import { anteriorDiaHabil, sumarDias } from '@/lib/recordatorios/reglas'
import { ETAPA_VIAJE_CONFIRMADO } from './mis-pendientes'
import { fechaDeLlegada, fechaEnPalabras, leerTramos, horaHHMM, type TramoServicio } from './fechas-servicio'

// ── Catálogo ────────────────────────────────────────────────────────────────

export const HITO_IDS = [
  'pedir_documentos',
  'requisitos_entrada',
  'asistencia_medica',
  'reconfirmar_hotel',
  'confirmar_traslado',
  'checkin_vuelo',
  'preregistro_migratorio',
  'detalles_tour',
  'tiquetes_tren',
] as const
export type HitoId = (typeof HITO_IDS)[number]

export type ClaseHito = 'fijo' | 'movil'
/**
 * Qué cierra el hito: `adjunto` (adjuntar ES marcar hecho), `marca` (un toque), `nota` (una línea
 * obligatoria: hora y punto de encuentro, quién confirmó) o `derivada` (se cierra solo con un dato
 * que ya existe; también admite la marca a mano).
 */
export type EvidenciaHito = 'adjunto' | 'marca' | 'nota' | 'derivada'

export interface DefinicionHito {
  id: HitoId
  clase: ClaseHito
  evidencia: EvidenciaHito
  /** Días respecto a la fecha que lo dispara (−3 = tres días antes). El check-in usa la ventana. */
  offsetDias: number
  /** Lo que lee la asesora (verbo + qué). */
  titulo: string
  /** Para contar en el resumen: «2 check-in y 1 tour». */
  corto: string
  /** Placeholder de la nota obligatoria. */
  pideNota?: string
  /** Solo se cierra adjuntando (el check-in: «adjuntar el pasabordo = hecho»). */
  adjuntoObligatorio?: boolean
}

export const DEFINICIONES: Record<HitoId, DefinicionHito> = {
  pedir_documentos: { id: 'pedir_documentos', clase: 'movil', evidencia: 'derivada', offsetDias: 0, titulo: 'Pedir los documentos de los viajeros', corto: 'documentos' },
  requisitos_entrada: { id: 'requisitos_entrada', clase: 'movil', evidencia: 'marca', offsetDias: -30, titulo: 'Revisar requisitos de entrada (pasaporte 6 meses, visa, vacuna)', corto: 'requisitos' },
  asistencia_medica: { id: 'asistencia_medica', clase: 'movil', evidencia: 'adjunto', offsetDias: -7, titulo: 'Emitir la asistencia médica y mandársela al viajero', corto: 'asistencia', adjuntoObligatorio: true },
  reconfirmar_hotel: { id: 'reconfirmar_hotel', clase: 'movil', evidencia: 'nota', offsetDias: -3, titulo: 'Reconfirmar la reserva con el hotel (no con la plataforma)', corto: 'hotel', pideNota: 'Quién confirmó y por dónde (correo, WhatsApp, llamada)' },
  confirmar_traslado: { id: 'confirmar_traslado', clase: 'movil', evidencia: 'nota', offsetDias: -2, titulo: 'Confirmar el traslado con el proveedor y mandarle al viajero la hora de recogida', corto: 'traslado', pideNota: 'Hora de recogida y contacto del conductor' },
  checkin_vuelo: { id: 'checkin_vuelo', clase: 'fijo', evidencia: 'adjunto', offsetDias: 0, titulo: 'Check-in y pasabordo', corto: 'check-in', adjuntoObligatorio: true },
  preregistro_migratorio: { id: 'preregistro_migratorio', clase: 'fijo', evidencia: 'adjunto', offsetDias: 0, titulo: 'Pre-registro migratorio', corto: 'pre-registro' },
  // QA G9 (M9-1) · el tren: el viajero se sube con su tiquete en la estación, sin check-in de aerolínea.
  tiquetes_tren: { id: 'tiquetes_tren', clase: 'movil', evidencia: 'nota', offsetDias: -2, titulo: 'Mandarle al viajero los tiquetes del tren con la estación y la hora de salida', corto: 'tren', pideNota: 'Estación, hora de salida y coche o asiento' },
  detalles_tour: { id: 'detalles_tour', clase: 'fijo', evidencia: 'nota', offsetDias: -1, titulo: 'Confirmar con el proveedor del tour los detalles (hora, punto de encuentro) y mandárselos al viajero', corto: 'tour', pideNota: 'Hora y punto de encuentro' },
}

/**
 * Ventana de check-in por aerolínea (verificado en avianca.com y latamairlines.com el 2026-10-21,
 * nota S1-S3 del diseño): 48 h antes; 24 h en Avianca si el tramo va o viene de EE. UU., Puerto
 * Rico o Canadá; aerolínea desconocida o no listada → 48 h. Configurable en
 * `config_extra.hitos.checkin`, no una constante enterrada.
 */
export interface VentanaAerolinea {
  id: string
  /** Lo que dice el texto de la aerolínea (sin tildes, mayúsculas): «AVIANCA». */
  nombres: string[]
  /** Prefijo del número de vuelo: «AV8520» → AV. */
  prefijos?: string[]
  horas: number
  excepciones?: Array<{ paises: string[]; horas: number }>
}

export interface TablaCheckin {
  porDefectoHoras: number
  aerolineas: VentanaAerolinea[]
}

export const CHECKIN_POR_DEFECTO: TablaCheckin = {
  porDefectoHoras: 48,
  aerolineas: [
    { id: 'avianca', nombres: ['AVIANCA'], prefijos: ['AV'], horas: 48, excepciones: [{ paises: ['US', 'PR', 'CA'], horas: 24 }] },
    { id: 'latam', nombres: ['LATAM'], prefijos: ['LA', '4C'], horas: 48 },
  ],
}

/**
 * Pre-registro migratorio por país de destino (Edgar: RD y México «los exigen»). El plazo sale de la
 * página oficial de migración de cada país; si no se pudo verificar, `null`: el hito aparece como
 * «Falta el plazo del pre-registro» y nadie lo inventa. Sumar un destino = una entrada en
 * `config_extra.hitos.preregistro`, sin código.
 *
 *   · DO (consultado 2026-10-22): eticket.migracion.gob.do responde 403 (Cloudflare) a una consulta
 *     sin navegador; se leyó la copia del mismo portal oficial en web.archive.org del 2026-05-05:
 *     «Solo se puede modificar el e-Eticket hasta un día antes de la fecha de vuelo colocada en el
 *     formulario.» No dice desde cuándo se puede llenar. Hito: el día antes del vuelo.
 *   · MX (consultado 2026-10-22): gob.mx/inm, «Forma Migratoria Múltiple Digital (FMMd)» (copia de
 *     web.archive.org del 2026-07-03; gob.mx en vivo pide un reto de navegador): «Si ingresas vía
 *     aérea, no tendrás que llenar la Forma Migratoria Múltiple Vía Electrónica (FMMe)…», y la FMMd
 *     se descarga DESPUÉS de entrar. La FMMe vigente (inm.gob.mx/fmme, leída en vivo) es solo para
 *     ingreso terrestre. No hay plazo previo que fijar: queda vacío hasta que Edgar diga qué trámite
 *     de México pide.
 */
export interface PreregistroDestino {
  pais: string
  nombre: string
  /** Días respecto a la fecha del tramo de ida (−1 = el día antes). `null` = sin plazo verificado. */
  offsetDias: number | null
  /** Alternativa en horas respecto a la hora del tramo. Gana sobre `offsetDias` si viene. */
  offsetHoras?: number | null
  fuente?: string
}

export const PREREGISTRO_POR_DEFECTO: PreregistroDestino[] = [
  { pais: 'DO', nombre: 'República Dominicana', offsetDias: -1, fuente: 'https://eticket.migracion.gob.do/ (copia web.archive.org 2026-05-05)' },
  { pais: 'MX', nombre: 'México', offsetDias: null, fuente: 'https://www.gob.mx/inm/articulos/forma-migratoria-multiple-digital-fmmd' },
]

export interface ConfigHitos {
  activo: boolean
  /** Desfase en días por hito (sobreescribe el del catálogo). */
  plazos: Partial<Record<HitoId, number>>
  /** Hitos que la línea no quiere. */
  apagados: HitoId[]
  checkin: TablaCheckin
  preregistro: PreregistroDestino[]
}

const esHitoId = (v: unknown): v is HitoId => typeof v === 'string' && (HITO_IDS as readonly string[]).includes(v)
const entero = (v: unknown, tope: number): number | null => (typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= tope ? v : null)

function leerTablaCheckin(raw: unknown): TablaCheckin {
  if (!raw || typeof raw !== 'object') return CHECKIN_POR_DEFECTO
  const r = raw as Record<string, unknown>
  const porDefecto = entero(r.por_defecto_horas, 240) ?? CHECKIN_POR_DEFECTO.porDefectoHoras
  if (!Array.isArray(r.aerolineas)) return { ...CHECKIN_POR_DEFECTO, porDefectoHoras: porDefecto }
  const aerolineas: VentanaAerolinea[] = []
  for (const a of r.aerolineas) {
    if (!a || typeof a !== 'object') continue
    const x = a as Record<string, unknown>
    const horas = entero(x.horas, 240)
    const nombres = Array.isArray(x.nombres) ? x.nombres.filter((n): n is string => typeof n === 'string' && n.trim() !== '').map(normalizar) : []
    if (horas === null || nombres.length === 0) continue
    const prefijos = Array.isArray(x.prefijos) ? x.prefijos.filter((p): p is string => typeof p === 'string' && /^[A-Z0-9]{2}$/i.test(p)).map(p => p.toUpperCase()) : []
    const excepciones = Array.isArray(x.excepciones)
      ? x.excepciones.flatMap(e => {
          const ex = e as Record<string, unknown> | null
          const h = entero(ex?.horas, 240)
          const paises = Array.isArray(ex?.paises) ? (ex.paises as unknown[]).filter((p): p is string => typeof p === 'string' && /^[A-Z]{2}$/i.test(p)).map(p => p.toUpperCase()) : []
          return h !== null && paises.length > 0 ? [{ paises, horas: h }] : []
        })
      : []
    aerolineas.push({ id: typeof x.id === 'string' ? x.id : nombres[0].toLowerCase(), nombres, prefijos, horas, excepciones })
  }
  return { porDefectoHoras: porDefecto, aerolineas }
}

function leerPreregistro(raw: unknown): PreregistroDestino[] {
  if (!Array.isArray(raw)) return PREREGISTRO_POR_DEFECTO
  const out: PreregistroDestino[] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const x = p as Record<string, unknown>
    const pais = typeof x.pais === 'string' && /^[A-Z]{2}$/i.test(x.pais) ? x.pais.toUpperCase() : null
    if (!pais) continue
    out.push({
      pais,
      nombre: typeof x.nombre === 'string' && x.nombre.trim() ? x.nombre.trim() : pais,
      offsetDias: entero(x.offset_dias, 60),
      offsetHoras: entero(x.offset_horas, 24 * 60),
      fuente: typeof x.fuente === 'string' ? x.fuente : undefined,
    })
  }
  return out
}

/**
 * Lee `lineas_negocio.config_extra.hitos`. Ausente o `activo` distinto de `true` = apagado: la línea
 * no tiene hitos y «Mis pendientes» queda como antes. El catálogo por defecto vive aquí y la línea
 * lo sobreescribe por partes (`plazos`, `apagados`, `checkin`, `preregistro`).
 */
export function configHitos(configExtra: unknown): ConfigHitos {
  const raw = (configExtra && typeof configExtra === 'object' ? (configExtra as Record<string, unknown>).hitos : null) as Record<string, unknown> | null | undefined
  const activo = !!raw && typeof raw === 'object' && raw.activo === true
  const plazos: Partial<Record<HitoId, number>> = {}
  if (raw && raw.plazos && typeof raw.plazos === 'object') {
    for (const [k, v] of Object.entries(raw.plazos as Record<string, unknown>)) {
      const n = entero(v, 365)
      if (esHitoId(k) && n !== null) plazos[k] = n
    }
  }
  return {
    activo,
    plazos,
    apagados: Array.isArray(raw?.apagados) ? (raw.apagados as unknown[]).filter(esHitoId) : [],
    checkin: leerTablaCheckin(raw?.checkin),
    preregistro: leerPreregistro(raw?.preregistro),
  }
}

// ── Lugares: país de un origen/destino escrito a mano ───────────────────────

/** Sin tildes, mayúsculas, espacios simples. */
export function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
}

/**
 * Mapeo MÍNIMO de códigos IATA y ciudades a país, solo para lo que decide algo: la excepción de
 * 24 h de Avianca (EE. UU., Puerto Rico, Canadá) y el pre-registro (RD, México). Es FRÁGIL a
 * propósito acotado: el origen y el destino del tramo son texto libre leído de la cotización; lo
 * que no está aquí devuelve `null` (48 h y sin pre-registro, salvo que el destino del viaje diga
 * otra cosa). «SAN JUAN» se toma como Puerto Rico.
 */
const IATA: Record<string, string> = {
  // EE. UU.
  MIA: 'US', FLL: 'US', MCO: 'US', JFK: 'US', EWR: 'US', LGA: 'US', ATL: 'US', IAH: 'US', DFW: 'US', LAX: 'US', SFO: 'US',
  ORD: 'US', BOS: 'US', IAD: 'US', DCA: 'US', TPA: 'US', LAS: 'US', SEA: 'US', PHX: 'US', DEN: 'US', CLT: 'US', MSY: 'US',
  // Puerto Rico
  SJU: 'PR', BQN: 'PR', PSE: 'PR',
  // Canadá
  YYZ: 'CA', YUL: 'CA', YVR: 'CA', YYC: 'CA', YOW: 'CA',
  // República Dominicana
  PUJ: 'DO', SDQ: 'DO', STI: 'DO', LRM: 'DO', POP: 'DO', AZS: 'DO', JBQ: 'DO',
  // México
  CUN: 'MX', MEX: 'MX', NLU: 'MX', GDL: 'MX', MTY: 'MX', PVR: 'MX', SJD: 'MX', CZM: 'MX', TQO: 'MX', MID: 'MX', OAX: 'MX',
}

const CIUDADES: Array<[string, string]> = [
  ['ESTADOS UNIDOS', 'US'], ['EE. UU', 'US'], ['EEUU', 'US'], ['USA', 'US'], ['MIAMI', 'US'], ['FORT LAUDERDALE', 'US'],
  ['ORLANDO', 'US'], ['NUEVA YORK', 'US'], ['NEW YORK', 'US'], ['ATLANTA', 'US'], ['HOUSTON', 'US'], ['DALLAS', 'US'],
  ['LOS ANGELES', 'US'], ['SAN FRANCISCO', 'US'], ['CHICAGO', 'US'], ['BOSTON', 'US'], ['WASHINGTON', 'US'], ['TAMPA', 'US'],
  ['LAS VEGAS', 'US'], ['PUERTO RICO', 'PR'], ['SAN JUAN', 'PR'], ['CANADA', 'CA'], ['TORONTO', 'CA'], ['MONTREAL', 'CA'],
  ['VANCOUVER', 'CA'], ['CALGARY', 'CA'], ['REPUBLICA DOMINICANA', 'DO'], ['PUNTA CANA', 'DO'], ['SANTO DOMINGO', 'DO'],
  ['LA ROMANA', 'DO'], ['PUERTO PLATA', 'DO'], ['SAMANA', 'DO'], ['BAYAHIBE', 'DO'], ['SANTIAGO DE LOS CABALLEROS', 'DO'],
  ['CANCUN', 'MX'], ['CIUDAD DE MEXICO', 'MX'], ['PLAYA DEL CARMEN', 'MX'], ['TULUM', 'MX'], ['RIVIERA MAYA', 'MX'],
  ['COZUMEL', 'MX'], ['GUADALAJARA', 'MX'], ['MONTERREY', 'MX'], ['PUERTO VALLARTA', 'MX'], ['LOS CABOS', 'MX'], ['MEXICO', 'MX'],
]

/** País (ISO alfa-2) de un lugar escrito a mano, o `null` si no se reconoce. */
export function paisDeLugar(texto: string | null | undefined): string | null {
  if (!texto) return null
  const t = normalizar(texto)
  for (const tok of t.split(/[^A-Z]+/)) if (tok.length === 3 && IATA[tok]) return IATA[tok]
  for (const [ciudad, pais] of CIUDADES) if (t.includes(ciudad)) return pais
  return null
}

/** Las horas antes del vuelo en que abre el check-in en línea para ese tramo. */
export function ventanaCheckin(tabla: TablaCheckin, tramo: Pick<TramoServicio, 'aerolinea' | 'numero_vuelo' | 'origen' | 'destino'>): { horas: number; aerolinea: string | null } {
  // Palabra completa: «LATAM AIRLINES» sí, «ATLANTIC» no se confunde con nada.
  const nombre = tramo.aerolinea ? ` ${normalizar(tramo.aerolinea).replace(/[^A-Z0-9]+/g, ' ')} ` : ''
  const prefijo = tramo.numero_vuelo ? normalizar(tramo.numero_vuelo).replace(/\s/g, '').slice(0, 2) : ''
  const a = tabla.aerolineas.find(x =>
    x.nombres.some(n => nombre.includes(` ${n.trim()} `)) || (!!prefijo && (x.prefijos ?? []).includes(prefijo)),
  )
  if (!a) return { horas: tabla.porDefectoHoras, aerolinea: null }
  const paises = [paisDeLugar(tramo.origen), paisDeLugar(tramo.destino)].filter((p): p is string => !!p)
  const ex = (a.excepciones ?? []).find(e => e.paises.some(p => paises.includes(p)))
  return { horas: ex ? ex.horas : a.horas, aerolinea: a.id }
}

// ── Entrada ─────────────────────────────────────────────────────────────────

export interface ServicioHitos {
  id: string
  tipo: string
  nombre: string
  /** Estado escrito: `cancelado` = «No va». */
  estado: string
  responsable_staff_id: string | null
  fecha_servicio: string | null
  hora_inicio: string | null
  fecha_fin: string | null
  hora_fin: string | null
  tramos: unknown
  voucher_ref: string | null
  confirmacion_ref: string | null
}

export type EstadoMarca = 'hecho' | 'no_aplica' | 'no_se_hizo'

export interface MarcaHito {
  servicio_id: string | null
  tramo: number | null
  hito_id: string
  fecha_objetivo: string
  estado: EstadoMarca
  evidencia_ref: string | null
  nota: string | null
  hecho_por: string | null
  hecho_at: string | null
}

export interface ViajeHitos {
  id: string
  workspaceId?: string
  nombre: string
  cliente: string
  clienteTelefono?: string | null
  estado: string
  etapaNumero: number | null
  esPrueba: boolean
  salida: string | null
  regreso: string | null
  /** `destino_tipo` de la etapa 1: true internacional, false nacional, null sin dato. */
  internacional: boolean | null
  /** Destino del viaje (texto de la etapa 1): respaldo del pre-registro si el tramo no lo dice. */
  destino: string | null
  /** Día en que el cliente confirmó (aceptó la cotización). */
  confirmadoEl: string | null
  /** Todos los viajeros con sus documentos guardados en el contacto (`pedir_documentos` derivado). */
  documentosCompletos: boolean | null
  comercialStaffId: string | null
  operacionesStaffId: string | null
  aprobadoresStaffIds: string[]
  catalogo: ConfigHitos
  servicios: ServicioHitos[]
  marcas: MarcaHito[]
}

// ── Salida ──────────────────────────────────────────────────────────────────

export type EstadoHito = 'pendiente' | 'hecho' | 'no_aplica' | 'no_se_hizo' | 'falta_fecha' | 'falta_plazo'

export interface Hito {
  /** Llave estable: negocio, servicio, tramo, hito y la fecha del servicio de la que cuelga. */
  llave: string
  hitoId: HitoId
  negocioId: string
  viaje: string
  cliente: string
  /** Teléfono del contacto, para el mensaje listo de WhatsApp (lo manda la persona). */
  telefono: string | null
  esPrueba: boolean
  servicioId: string | null
  servicioNombre: string | null
  tipoServicio: string
  /** Tramo del vuelo (1, 2, …) o `null`. */
  tramo: number | null
  /** «Check-in y pasabordo · vuelo de ida». */
  titulo: string
  /** «Avianca AV8520 · BOG → MIA», «Hotel Brisa del Mar». */
  detalle: string | null
  clase: ClaseHito
  evidencia: EvidenciaHito
  pideNota: string | null
  /** La fecha del servicio de la que cuelga (T). Va en la llave: si cambia, el hito vuelve a pendiente. */
  fechaAncla: string | null
  horaAncla: string | null
  /** Qué es T en palabras: 'sale', 'llegan', 'es', 'viajan', 'confirmó'. */
  verboAncla: string
  /** El momento real del hito (sin correr): sábado 6:10 para un vuelo del lunes 6:10. */
  fechaObjetivo: string | null
  horaObjetivo: string | null
  /** El día en que aparece en la agenda: móvil corrido al hábil, fijo en su día. */
  fechaAviso: string | null
  /** Check-in sin hora del tramo: se usa el inicio del día y se dice «hora por confirmar». */
  horaPorConfirmar: boolean
  /** Quién lo hace (staff). Vacío = sin responsable (lo ve la dirección). */
  responsables: string[]
  /** Check-in en no hábil: lo cubre la dirección. */
  cubreDireccion: boolean
  estado: EstadoHito
  /** Se cerró solo con un dato que ya existe (documentos, confirmación del proveedor, voucher). */
  derivado: boolean
  marca: MarcaHito | null
  /** Pendiente y su día de aviso ya pasó. */
  vencido: boolean
  /** Día tras el cual ya no tiene remedio (la fecha del servicio o la salida). */
  limite: string | null
  /** Para el pre-registro: el país. */
  pais: string | null
}

export function llaveHito(negocioId: string, servicioId: string | null, tramo: number | null, hitoId: string, fechaAncla: string | null): string {
  return [negocioId, servicioId ?? '-', tramo ?? '-', hitoId, fechaAncla ?? 'sin-fecha'].join('|')
}

/** El viaje genera hitos: línea encendida, abierto y confirmado (etapa ≥ 4, como el PR de fechas). */
export function viajeConHitos(v: Pick<ViajeHitos, 'catalogo' | 'estado' | 'etapaNumero'>): boolean {
  return v.catalogo.activo && v.estado === 'abierto' && (v.etapaNumero ?? 0) >= ETAPA_VIAJE_CONFIRMADO
}

function restarHoras(fecha: string, hora: string, horas: number): { fecha: string; hora: string } {
  const d = new Date(Date.parse(`${fecha}T${hora}:00Z`) - horas * 3_600_000).toISOString()
  return { fecha: d.slice(0, 10), hora: d.slice(11, 16) }
}

/** Móvil: desfase negativo → hábil anterior; cero o positivo → siguiente hábil. Fijo: tal cual. */
export function fechaDeAviso(fechaObjetivo: string, clase: ClaseHito, offsetDias: number): string {
  if (clase === 'fijo') return fechaObjetivo
  return offsetDias < 0 ? anteriorDiaHabil(fechaObjetivo) : siguienteDiaHabil(fechaObjetivo)
}

function etiquetaTramo(i: number, n: number, fecha: string, v: Pick<ViajeHitos, 'salida' | 'regreso'>): 'ida' | 'regreso' | 'interno' {
  if (n >= 2) return i === 0 ? 'ida' : i === n - 1 ? 'regreso' : 'interno'
  if (v.regreso && fecha === v.regreso && fecha !== v.salida) return 'regreso'
  if (v.salida && fecha !== v.salida) return 'interno'
  return 'ida'
}

const TEXTO_TRAMO = { ida: 'vuelo de ida', regreso: 'vuelo de regreso', interno: 'vuelo interno' } as const

function rutaDe(t: TramoServicio): string | null {
  const aero = [t.aerolinea, t.numero_vuelo].filter(Boolean).join(' ')
  const ruta = t.origen || t.destino ? `${t.origen ?? '?'} → ${t.destino ?? '?'}` : null
  return [aero || null, ruta].filter(Boolean).join(' · ') || null
}

/** Todos los hitos del viaje (pendientes, cerrados y los que les falta la fecha). */
export function hitosDelViaje(v: ViajeHitos, hoy: string): Hito[] {
  if (!viajeConHitos(v)) return []
  const cat = v.catalogo
  const out: Hito[] = []
  const comercial = v.comercialStaffId ?? v.operacionesStaffId
  const delServicio = (s: ServicioHitos) => s.responsable_staff_id ?? v.operacionesStaffId ?? v.comercialStaffId
  const vivos = v.servicios.filter(s => s.estado !== 'cancelado')

  const agregar = (p: {
    id: HitoId
    servicio: ServicioHitos | null
    tramo?: number | null
    titulo?: string
    detalle?: string | null
    fechaAncla: string | null
    horaAncla?: string | null
    verboAncla: string
    /** El momento real; `undefined` = ancla + desfase del catálogo. `null` = sin plazo. */
    objetivo?: { fecha: string; hora: string | null } | null
    horaPorConfirmar?: boolean
    responsable: string | null
    derivado?: boolean
    limite?: string | null
    pais?: string | null
  }) => {
    if (cat.apagados.includes(p.id)) return
    const def = DEFINICIONES[p.id]
    const offset = cat.plazos[p.id] ?? def.offsetDias
    const tramo = p.tramo ?? null
    const servicioId = p.servicio?.id ?? null
    const llave = llaveHito(v.id, servicioId, tramo, p.id, p.fechaAncla)
    const marca = p.fechaAncla
      ? v.marcas.find(m => m.hito_id === p.id && (m.servicio_id ?? null) === servicioId && (m.tramo ?? null) === tramo && m.fecha_objetivo === p.fechaAncla) ?? null
      : null
    let objetivo: { fecha: string; hora: string | null } | null = null
    if (p.fechaAncla) objetivo = p.objetivo === undefined ? { fecha: sumarDias(p.fechaAncla, offset), hora: null } : p.objetivo
    let fechaAviso = objetivo ? fechaDeAviso(objetivo.fecha, def.clase, offset) : null
    // Un viaje confirmado tarde no nace con hitos vencidos de antes de la confirmación: el aviso no
    // sale antes de ese día (p. ej. requisitos a −30 de un viaje que se confirmó a 10 días).
    if (fechaAviso && v.confirmadoEl && fechaAviso < v.confirmadoEl && def.clase === 'movil') fechaAviso = siguienteDiaHabil(v.confirmadoEl)
    // Check-in en día no hábil: lo cubren los aprobadores (Edgar, 2026-10-21), no la asesora.
    const cubreDireccion = p.id === 'checkin_vuelo' && !!objetivo && !esDiaHabil(objetivo.fecha) && v.aprobadoresStaffIds.length > 0
    const responsables = cubreDireccion ? [...v.aprobadoresStaffIds] : p.responsable ? [p.responsable] : []
    const limite = p.limite === undefined ? p.fechaAncla : p.limite
    let estado: EstadoHito
    if (marca) estado = marca.estado
    else if (p.derivado) estado = 'hecho'
    else if (!p.fechaAncla) estado = 'falta_fecha'
    else if (!objetivo) estado = 'falta_plazo'
    else if (limite && limite < hoy) estado = 'no_se_hizo'
    else estado = 'pendiente'
    out.push({
      llave,
      hitoId: p.id,
      negocioId: v.id,
      viaje: v.nombre,
      cliente: v.cliente,
      telefono: v.clienteTelefono ?? null,
      esPrueba: v.esPrueba,
      servicioId,
      servicioNombre: p.servicio?.nombre ?? null,
      tipoServicio: p.servicio?.tipo ?? 'viaje',
      tramo,
      titulo: p.titulo ?? def.titulo,
      detalle: p.detalle ?? p.servicio?.nombre ?? null,
      clase: def.clase,
      evidencia: def.evidencia,
      pideNota: def.pideNota ?? null,
      fechaAncla: p.fechaAncla,
      horaAncla: p.horaAncla ?? null,
      verboAncla: p.verboAncla,
      fechaObjetivo: objetivo?.fecha ?? null,
      horaObjetivo: objetivo?.hora ?? null,
      fechaAviso,
      horaPorConfirmar: !!p.horaPorConfirmar,
      responsables,
      cubreDireccion,
      estado,
      derivado: !marca && !!p.derivado,
      marca,
      vencido: estado === 'pendiente' && !!fechaAviso && fechaAviso < hoy,
      limite: limite ?? null,
      pais: p.pais ?? null,
    })
  }

  // ── Del viaje ──
  agregar({
    id: 'pedir_documentos', servicio: null, fechaAncla: v.confirmadoEl, verboAncla: 'confirmó',
    responsable: comercial, derivado: v.documentosCompletos === true, limite: v.salida,
  })
  if (v.internacional === true) {
    agregar({ id: 'requisitos_entrada', servicio: null, fechaAncla: v.salida, verboAncla: 'viajan', responsable: comercial })
  }

  // ── Por servicio ──
  // El paquete de bloqueo (tipo «otro» con los tramos de su vuelo, H10 del 2026-10-29) se vuela igual.
  const vuelaConTramos = (s: (typeof vivos)[number]) => s.tipo === 'vuelo' || (s.tipo === 'otro' && (leerTramos(s.tramos)?.length ?? 0) > 0)
  const vuelos = vivos.filter(vuelaConTramos)
  // El traslado de llegada es el día en que ATERRIZA el primer tramo: en un vuelo nocturno, el
  // siguiente al de salida (QA 2026-10-29, S9-2).
  const primerTramo = vuelos
    .map(s => { const t = leerTramos(s.tramos)?.[0]; return t ? fechaDeLlegada(t) : s.fecha_servicio })
    .filter((f): f is string => !!f).sort()[0] ?? null
  const trasladosSinFecha = vivos.filter(s => s.tipo === 'traslado' && !s.fecha_servicio).length
  let preregistroPuesto = false

  for (const s of vivos) {
    const resp = delServicio(s)
    if (vuelaConTramos(s)) {
      const tramos = leerTramos(s.tramos) ?? []
      // Sin tramos leídos pero con fecha de inicio: un tramo con lo que hay (sin hora ni ruta).
      const lista: TramoServicio[] = tramos.length > 0
        ? tramos
        : s.fecha_servicio
          ? [{ fecha: s.fecha_servicio, hora_salida: horaHHMM(s.hora_inicio), hora_llegada: null, origen: null, destino: null, aerolinea: null, numero_vuelo: null }]
          : []
      if (lista.length === 0) {
        agregar({ id: 'checkin_vuelo', servicio: s, tramo: null, titulo: `${DEFINICIONES.checkin_vuelo.titulo} · vuelo`, fechaAncla: null, verboAncla: 'sale', responsable: resp })
        continue
      }
      lista.forEach((t, i) => {
        const etq = etiquetaTramo(i, lista.length, t.fecha, v)
        const { horas } = ventanaCheckin(cat.checkin, t)
        const sinHora = !t.hora_salida
        const abre = restarHoras(t.fecha, t.hora_salida ?? '00:00', horas)
        agregar({
          id: 'checkin_vuelo', servicio: s, tramo: i + 1,
          titulo: `${DEFINICIONES.checkin_vuelo.titulo} · ${TEXTO_TRAMO[etq]}`,
          detalle: rutaDe(t) ?? s.nombre,
          fechaAncla: t.fecha, horaAncla: t.hora_salida, verboAncla: 'sale',
          objetivo: { fecha: abre.fecha, hora: sinHora ? null : abre.hora }, horaPorConfirmar: sinHora,
          responsable: resp,
        })
        // Pre-registro: el primer tramo que entra a un país que lo pide (el de ida). Si el tramo no
        // dice a dónde va, el destino del viaje de la etapa 1.
        if (!preregistroPuesto && etq !== 'regreso') {
          const pais = paisDeLugar(t.destino) ?? (t.destino ? null : paisDeLugar(v.destino))
          const destino = pais ? cat.preregistro.find(d => d.pais === pais) : undefined
          if (destino) {
            preregistroPuesto = true
            const objetivo = destino.offsetHoras !== null && destino.offsetHoras !== undefined
              ? restarHoras(t.fecha, t.hora_salida ?? '00:00', -destino.offsetHoras)
              : destino.offsetDias !== null
                ? { fecha: sumarDias(t.fecha, destino.offsetDias), hora: null }
                : null
            agregar({
              id: 'preregistro_migratorio', servicio: s, tramo: i + 1,
              titulo: `${DEFINICIONES.preregistro_migratorio.titulo} · ${destino.nombre}`,
              detalle: rutaDe(t) ?? s.nombre,
              fechaAncla: t.fecha, horaAncla: t.hora_salida, verboAncla: 'sale',
              objetivo, responsable: resp, pais: destino.pais,
            })
          }
        }
      })
      continue
    }
    if (s.tipo === 'hotel') {
      agregar({ id: 'reconfirmar_hotel', servicio: s, fechaAncla: s.fecha_servicio, horaAncla: horaHHMM(s.hora_inicio), verboAncla: 'llegan', responsable: resp, derivado: !!s.confirmacion_ref })
      continue
    }
    if (s.tipo === 'traslado') {
      // Sin fecha: la del vuelo con el que conecta. Solo se sabe cuál cuando hay UN traslado sin
      // fecha (el de llegada, con el primer tramo); con varios, «Falta la fecha».
      const fecha = s.fecha_servicio ?? (trasladosSinFecha === 1 ? primerTramo : null)
      agregar({ id: 'confirmar_traslado', servicio: s, fechaAncla: fecha, horaAncla: horaHHMM(s.hora_inicio), verboAncla: 'es', responsable: resp })
      continue
    }
    if (s.tipo === 'tren') {
      agregar({ id: 'tiquetes_tren', servicio: s, fechaAncla: s.fecha_servicio, horaAncla: horaHHMM(s.hora_inicio), verboAncla: 'sale', responsable: resp })
      continue
    }
    if (s.tipo === 'actividad') {
      agregar({ id: 'detalles_tour', servicio: s, fechaAncla: s.fecha_servicio, horaAncla: horaHHMM(s.hora_inicio), verboAncla: 'es', responsable: resp })
      continue
    }
    if (s.tipo === 'asistencia') {
      agregar({
        id: 'asistencia_medica', servicio: s, fechaAncla: v.salida ?? s.fecha_servicio, verboAncla: 'viajan',
        responsable: s.responsable_staff_id ?? comercial, derivado: !!s.voucher_ref,
      })
    }
  }
  return out
}

// ── Cerrar un hito ──────────────────────────────────────────────────────────

/**
 * ¿Se puede cerrar así? «No aplica» exige motivo; los hitos con nota (hora y punto de encuentro,
 * quién confirmó) la exigen; el check-in y la asistencia solo se cierran adjuntando. Copy para el
 * toast, tal cual.
 */
export function validarCierreHito(
  h: Pick<Hito, 'hitoId' | 'fechaAncla' | 'marca'>,
  p: { estado: 'hecho' | 'no_aplica'; nota: string | null; conAdjunto: boolean },
): { ok: true; nota: string | null } | { ok: false; error: string } {
  const nota = (p.nota ?? '').trim().slice(0, 500) || null
  if (!h.fechaAncla) return { ok: false, error: 'Primero pon la fecha del servicio: sin ella este hito no se puede cerrar.' }
  if (p.estado === 'no_aplica') return nota ? { ok: true, nota } : { ok: false, error: 'Escribe por qué no aplica.' }
  const def = DEFINICIONES[h.hitoId]
  if (def.adjuntoObligatorio && !p.conAdjunto && !h.marca?.evidencia_ref) {
    return { ok: false, error: h.hitoId === 'checkin_vuelo' ? 'Adjunta el pasabordo: adjuntarlo marca el check-in hecho.' : 'Adjunta el voucher: adjuntarlo lo marca hecho.' }
  }
  if (def.evidencia === 'nota' && !nota) return { ok: false, error: `Escribe ${(def.pideNota ?? 'el detalle').charAt(0).toLowerCase()}${(def.pideNota ?? 'el detalle').slice(1)}.` }
  return { ok: true, nota }
}

// ── En palabras ─────────────────────────────────────────────────────────────

/** «sale mañana 8:40», «llegan el vie 24», «sale el lun 26 6:10 (hora por confirmar)». */
export function cuandoEnPalabras(h: Pick<Hito, 'fechaAncla' | 'horaAncla' | 'verboAncla' | 'horaPorConfirmar'>, hoy: string): string | null {
  if (!h.fechaAncla) return null
  const dia = h.fechaAncla === hoy ? 'hoy' : h.fechaAncla === sumarDias(hoy, 1) ? 'mañana' : `el ${fechaEnPalabras(h.fechaAncla)}`
  const hora = h.horaAncla ? ` ${h.horaAncla}` : ''
  return `${h.verboAncla} ${dia}${hora}${h.horaPorConfirmar ? ' (hora por confirmar)' : ''}`
}

/** «Falta la fecha del Hotel X: ponla para saber cuándo reconfirmar la reserva». */
export function textoFaltaFecha(h: Pick<Hito, 'hitoId' | 'servicioNombre' | 'titulo' | 'pais' | 'estado'>): string {
  if (h.estado === 'falta_plazo') return `Falta el plazo del ${DEFINICIONES.preregistro_migratorio.titulo.toLowerCase()} · ${h.titulo.split(' · ').pop()}`
  const que = h.servicioNombre ?? (h.hitoId === 'pedir_documentos' ? 'la confirmación del cliente' : 'la salida del viaje')
  const para = DEFINICIONES[h.hitoId].titulo.split(' (')[0]
  return `Falta la fecha de ${que}: ponla para saber cuándo ${para.charAt(0).toLowerCase()}${para.slice(1)}.`
}

/** El mensaje que la persona le manda al viajero desde su WhatsApp (ONE no lo manda). */
export function mensajeAlViajero(h: Pick<Hito, 'hitoId' | 'cliente' | 'fechaAncla' | 'horaAncla' | 'detalle' | 'titulo' | 'marca'>): string | null {
  const nombre = h.cliente.trim().split(/\s+/)[0] || ''
  const hola = nombre ? `Hola ${nombre}` : 'Hola'
  const dia = h.fechaAncla ? fechaEnPalabras(h.fechaAncla) : ''
  const hora = h.horaAncla ? ` a las ${h.horaAncla}` : ''
  switch (h.hitoId) {
    case 'checkin_vuelo':
      return `${hola}, ya hicimos el check-in de tu vuelo${h.detalle ? ` ${h.detalle}` : ''} del ${dia}${hora}. Te comparto el pasabordo.`
    case 'detalles_tour':
      return `${hola}, te confirmo los detalles de ${h.detalle ?? 'tu actividad'} del ${dia}: ${h.marca?.nota ?? '(hora y punto de encuentro)'}.`
    case 'confirmar_traslado':
      return `${hola}, tu traslado del ${dia} está confirmado: ${h.marca?.nota ?? '(hora de recogida y contacto)'}.`
    case 'asistencia_medica':
      return `${hola}, te comparto tu asistencia médica para el viaje.`
    case 'preregistro_migratorio':
      return `${hola}, ya está listo tu ${h.titulo.toLowerCase()}. Te comparto el comprobante.`
    case 'pedir_documentos':
      return `${hola}, para avanzar con tu viaje necesitamos los documentos de cada viajero (pasaporte o documento de identidad y, si aplica, visa).`
    default:
      return null
  }
}

/**
 * Gancho de la lectura del pasabordo (fuera de esta ola): cuando exista, recibe la referencia
 * `one://` del adjunto y devuelve lo que leyó, para avisar en ámbar si no cuadra con la fila.
 */
export type LectorPasabordo = (referencia: string) => Promise<{ fecha?: string | null; vuelo?: string | null; nombre?: string | null } | null>
