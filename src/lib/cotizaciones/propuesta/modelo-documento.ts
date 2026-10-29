/**
 * El MODELO del documento nuevo de la propuesta de viaje (PR 1 del plan del 2026-10-14,
 * `proyectos/trappvel/clarity/diseno/propuesta-emocional/max.md` §3).
 *
 * Una función pura: de la cotización, tal como ya la arma `generateCotizacionPDF` para
 * @react-pdf (`CotizacionPDFProps`), a las secciones del prototipo aprobado:
 *
 *   1 ruta · 2 día a día · 3 hoteles por ciudad · 4 vuelos · 5 trenes y traslados ·
 *   6 opcionales · 7 «Elige tu versión» · 8 precio, incluidos y plan de pagos · 9 lo formal
 *
 * ## Por qué parte de `CotizacionPDFProps`
 *
 * El dinero NO se vuelve a calcular. Las cifras salen de las mismas props que imprime el PDF
 * de hoy, con las mismas reglas: el precio de cada tarifa es el de su bloque, el TOTAL es
 * `fiscal.totalBruto` (o la suma de las líneas más el IVA), y el plan de pagos sale de
 * `asiPuedesPagar` sobre ese total. Si el documento nuevo y el de hoy dijeran cifras
 * distintas del mismo viaje, el cliente no sabría cuál vale. Lo prueba
 * `modelo-documento.test.ts`, que imprime el PDF de @react-pdf y compara.
 *
 * Lo que el prototipo pide y las props de hoy no traen entra como dato opcional:
 * `servicios` (traslados, trenes y actividades con su fecha, de `serviciosDeItems`). Sin
 * él, el día a día se arma con vuelos, hoteles y los días asignados, y la sección de trenes
 * queda vacía.
 *
 * ## Léxico
 * La tarifa que en los datos se llama «Premium» se le muestra al cliente como «Superior»
 * (`nombreDeTarifaParaCliente`). El nombre guardado no cambia.
 *
 * ## Decisiones de Mauricio del 2026-10-14 (vinculantes)
 * 1. Los nombres de pila de los niños van en la propuesta SOLO si el cliente autorizó el
 *    tratamiento de datos de menores (`nombresParaLaPropuesta`). Hoy ONE no guarda esos
 *    nombres: el dato queda listo, con su guarda, para el texto generado (PR 6).
 * 2. La propuesta NO muestra políticas de cancelación de hoteles. `cancelacion` viaja en el
 *    modelo (la pantalla la usa) pero ninguna plantilla de la propuesta la imprime.
 * 3. Sin anticipo fijo: el que la asesora asignó a mano (`anticipo.ts`), o ninguna cifra. El
 *    llamado a apartar abre el WhatsApp de la asesora, no un link de pago.
 */
import type { CotizacionPDFProps, FotoPDF } from '@/lib/pdf/cotizacion-props'
import type { CargoEnDestinoPDF, HotelPDF, ServicioPDF, VueloPDF } from '@/lib/cotizaciones/detalle-viaje'
import {
  capitulosDelViaje,
  ciudadDeCapitulo,
  claveDeCiudad,
  claveDeFecha,
  conAnio,
  esDeLaPrincipal,
  fechaDelDia,
  filasDelVuelo,
  leerFecha,
  sinCancelacionDelProveedor,
  type Fecha,
} from '@/lib/pdf/cotizacion-trappvel-formato'
import { creditosDeFotos } from '@/lib/pdf/fotos-del-viaje'
import { tituloDeBloquePDF } from '@/lib/cotizaciones/itinerarios'
import { claveTarifa } from '@/lib/cotizaciones/tarifas'
import { siglasDeTramos } from '@/lib/cotizaciones/aerolineas'
import { textoIvaIncluido } from '@/lib/fiscal/iva-cotizacion'
import { asiPuedesPagar, type AsiPuedesPagar } from '@/lib/viaje/asi-puedes-pagar'
import type { AnticipoPropuesta } from './anticipo'
import { destinatarioDeLaPropuesta, type ClienteDelNegocio, type Destinatario } from './destinatario'

// ── Entrada ───────────────────────────────────────────────────────────────────

/** Un traslado, tren o actividad del viaje. `tarifas` como en `VueloPDF.tarifas`. */
export interface ServicioDelDocumento extends ServicioPDF {
  /** «09:30» si la lectura la trae. */
  hora?: string | null
  tarifas?: number[]
  /**
   * El trayecto de vuelta de un traslado de ida y vuelta cuya captura trae una sola fecha: la del
   * de ida. El modelo le pone la salida de la estadía donde cae esa fecha (`trayectos.ts`).
   */
  fechaIda?: string | null
  /**
   * La línea de la que sale. El día a día la usa para no pintar dos veces la misma línea: la que
   * tiene día asignado llega aquí Y en `props.dias` (brief del 2026-10-22, punto 1).
   */
  itemId?: string
  /**
   * N7-4 / V7-3 (QA del 2026-10-29): la línea es un carro de alquiler, no un traslado. Dónde se
   * recoge y dónde se devuelve, tal como los leyó la captura.
   */
  alquiler?: { recogida: string | null; devolucion: string | null; vehiculo: string | null; fechaDevolucion?: string | null }
}

/** Un viajero con nombre. `menor` = niño o infante. */
export interface ViajeroConNombre {
  nombre: string
  menor: boolean
}

export interface EntradaModeloPropuesta {
  props: CotizacionPDFProps
  servicios?: ServicioDelDocumento[]
  /** Decisión 1: los viajeros con nombre, si ONE los tiene. */
  viajeros?: ViajeroConNombre[]
  /** Decisión 1: la casilla `menores` de la autorización de datos, vigente (`autorizacion_datos_estado`). */
  menoresAutorizados?: boolean
  /** Decisión 3: el anticipo que la asesora asignó en esta cotización. */
  anticipo?: AnticipoPropuesta | null
  /** Decisión 3: quien atiende al cliente; su WhatsApp es el botón de apartar. */
  asesora?: { nombre: string | null; whatsapp: string | null } | null
  /**
   * Dónde y cuándo es cada plan opcional, en el MISMO orden que `props.sugeridos`
   * (`lugaresDeOpcionales`). Sin él, la ciudad se busca en el nombre del plan.
   */
  lugaresDeOpcionales?: ({ ciudad: string | null; fecha: string | null } | null)[]
  /** El contacto y la empresa del negocio: a quién va dirigida la propuesta (2026-10-27). */
  cliente?: ClienteDelNegocio | null
  /**
   * S3 (QA del 2026-10-29): cuántos viajan (adultos, niños e infantes). Con uno, el documento le habla
   * de usted; con varios o sin dato, de ustedes.
   */
  numeroDeViajeros?: number | null
}

// ── Salida ────────────────────────────────────────────────────────────────────

export type ClaveTarifa = 'economica' | 'intermedia' | 'recomendada' | 'superior' | 'otra'

/** Una línea de dinero, como la imprime «Inversión» hoy (`lineasImpresas` de la plantilla). */
export interface LineaDoc {
  nombre: string
  cantidad: number
  unidad: string | null
  total: number
  adicionales: string[]
  /** Reglas de margen: «Descuento · motivo: −$X» bajo la opción con descuento. `null` = nada. */
  nota: string | null
}

export interface TarifaDoc {
  /** Posición en `props.itinerarios`: es el índice al que apuntan `tarifas` de vuelos y hoteles. */
  indice: number
  clave: ClaveTarifa
  /** El nombre para el cliente: «Económica», «Recomendada», «Superior». */
  nombre: string
  esPrincipal: boolean
  /** El precio que imprime el PDF de hoy en el bloque de esta tarifa. */
  precio: number
  /** «Incluye IVA de $ X» con `linea_incluida`; si no, `null`. Igual que hoy. */
  notaIva: string | null
  lineas: LineaDoc[]
  /** Reglas de margen: los descuentos sobre el total de esta tarifa, con su descripción. */
  descuentos: { descripcion: string; valor: number }[]
  /** Las estrellas que tienen TODOS sus hoteles con categoría («4★»); `null` si varían o no hay. */
  estrellas: number | null
  hoteles: { nombre: string; estrellas: number | null; ciudad: string | null }[]
  vuelos: FilaVueloDoc[]
}

export interface FilaVueloDoc {
  sentido: 'ida' | 'regreso'
  /** Índices de tarifa; vacío = de todas (cotización de una sola opción). */
  tarifas: number[]
  aerolinea: string | null
  numero: string | null
  desde: string | null
  hasta: string | null
  /** «Vuelo directo» o «Escala en Madrid (MAD)», tal como la tabla de hoy. */
  escala: string | null
  fecha: string | null
  salida: string | null
  llegada: string | null
  /** La tarifa de la aerolínea («Light», «Classic»). */
  tarifaAerolinea: string | null
  equipaje: string | null
  adicionales: string[]
}

export interface ParadaDoc {
  ciudad: string
  noches: number | null
  desde: string | null
  hasta: string | null
  /** Cómo se llega a la SIGUIENTE parada (el tren de ese día), si se sabe. */
  siguiente: string | null
}

export interface EventoDoc {
  tipo: 'vuelo' | 'hotel' | 'tren' | 'traslado' | 'actividad' | 'carro'
  hora: string | null
  texto: string
  /**
   * Con varias tarifas, lo que cambia en cada una. Solo los VUELOS (aerolínea, hora, directo o
   * vía): el hotel de cada versión ya está en «Dónde duermen» y no se repite día a día.
   * Vacío = igual en todas.
   */
  porTarifa: { tarifas: number[]; texto: string; siglas?: string[] }[]
  /** Solo vuelos: `salida` el día que sale, `llegada` el día que llega (si llega al día siguiente). */
  momento?: 'salida' | 'llegada'
}

export interface DiaDoc {
  /** ISO `YYYY-MM-DD`. */
  fecha: string
  /** Día del viaje: 1 es el de salida. */
  numero: number
  /** Dónde duermen esa noche (la ciudad del hotel de la tarifa principal). */
  ciudad: string | null
  eventos: EventoDoc[]
  /** Sin nada programado. */
  libre: boolean
  /** Los planes opcionales que se proponen ese día (los de su ciudad, en sus días libres). */
  opcionales: string[]
  /**
   * Ganchos para el texto generado (PR 6): el título del día («Arte para toda la familia») y una
   * sugerencia libre. Hoy siempre `null`: la plantilla arma un título con los datos.
   */
  titulo: string | null
  sugerencia: string | null
}

export interface OpcionHotelDoc {
  tarifas: number[]
  hotel: string
  estrellas: number | null
  /**
   * V6 / V8-3 (QA del 2026-10-29): la zona o el barrio de ESTE hotel («NoMad, Manhattan», «Centro»).
   * La tarjeta la imprime; la ciudad del capítulo es el destino. `null` = no se sabe.
   */
  zona?: string | null
  habitacion: string | null
  regimen: string | null
  /**
   * Lo que incluye la opción además del régimen: las casillas del paquete de bloqueo, o lo escrito en
   * el ingreso manual (D6, 2026-10-29). `null` = nada que decir.
   */
  incluye: string | null
  /**
   * Con varias versiones: lo que el paquete de ESTA marca como no incluido y otra versión sí trae
   * («Alimentación, Traslados»). Ausente = nada que decir (prueba corta del #1352).
   */
  noIncluye?: string
  /** Ver la cabecera: viaja en el modelo, imprimirla es decisión aparte. */
  cancelacion: string | null
  /** Lo que se paga en el hotel («Tasa turística: 41,28 EUR»). */
  cargoEnDestino: string | null
  foto: { url: string; proporcion?: number | null } | null
}

export interface CiudadDoc {
  ciudad: string | null
  desde: string | null
  hasta: string | null
  noches: number | null
  opciones: OpcionHotelDoc[]
}

export interface TrayectoDoc {
  /** `alquiler`: un carro de alquiler (N7-4), que no es un traslado. */
  tipo: 'tren' | 'traslado' | 'alquiler'
  fecha: string | null
  hora: string | null
  descripcion: string
  tarifas: number[]
  /** Solo `alquiler`: dónde se recoge, dónde y cuándo se devuelve, y el vehículo. */
  alquiler?: { recogida: string | null; devolucion: string | null; fechaDevolucion: string | null; vehiculo: string | null }
}

export interface OpcionalDoc {
  nombre: string
  descripcion: string | null
  /** Lo que imprime la tarjeta de hoy: `precio_venta × cantidad`. 0 = sin precio. */
  valor: number
  unidad: string | null
  /** La parada del viaje donde se hace (la leída, o la que el nombre nombra). `null` = no se sabe. */
  ciudad: string | null
  /** ISO, si el plan tiene día. */
  fecha: string | null
}

export interface PlanDoc {
  /** `null` = sin tarifas: el plan es el del total. */
  tarifa: number | null
  nombre: string | null
  plan: AsiPuedesPagar
}

export interface ModeloPropuesta {
  portada: {
    consecutivo: string
    titulo: string
    intro: string | null
    viajeros: string | null
    /** Cuántos viajan (adultos, niños e infantes). `null` = nadie declaró la composición. */
    numeroDeViajeros: number | null
    destino: string | null
    fechas: string | null
    duracion: string | null
    foto: FotoPDF | null
    fotosCiudades: FotoPDF[]
    /** Decisión 1: nombres de pila que se pueden imprimir (los de menores solo con autorización). */
    nombres: string[]
    /** A quién va dirigida, con nombre propio; `null` sin contacto (el documento habla a los pasajeros). */
    destinatario: Destinatario | null
  }
  ruta: { origen: string | null; paradas: ParadaDoc[]; regreso: string | null }
  dias: DiaDoc[]
  hoteles: CiudadDoc[]
  vuelos: FilaVueloDoc[]
  trayectos: { filas: TrayectoDoc[]; igualEnTodas: boolean }
  opcionales: OpcionalDoc[]
  /** En el orden del cliente: Económica, Recomendada, Superior. Vacío con una sola opción. */
  tarifas: TarifaDoc[]
  /** Líneas que están en TODAS las tarifas («Igual en las tres»), por nombre. */
  igualEnTodas: string[]
  precio: {
    /** El TOTAL que imprime el PDF de hoy. */
    total: number
    subtotal: number
    iva: number
    notaIva: string | null
    /** ¿El TOTAL es el de la Recomendada? Como la leyenda de hoy. */
    totalEsDeLaRecomendada: boolean
    /** Sin tarifas: las líneas del documento («Inversión» de hoy). */
    lineas: LineaDoc[]
    /** Reglas de margen: los descuentos sobre el TOTAL, con su descripción. Vacío = ninguno. */
    descuentos: { descripcion: string; valor: number }[]
    incluye: string[]
    noIncluye: string[]
    /** Uno por tarifa (en el orden de `tarifas`), o uno solo con el total. Vacío sin plan en la línea. */
    planes: PlanDoc[]
    /** Decisión 3: el anticipo asignado a mano. `null` = la propuesta no dice ninguna cifra para apartar. */
    anticipo: AnticipoPropuesta | null
  }
  formal: {
    terminos: string | null
    pie: string
    firma: { nombre: string; cargo: string | null; contacto: string | null } | null
    creditos: string[]
    /** «Antes de viajar» del texto revisado (`documento_cliente`). */
    antesDeViajar: string[]
    /** Decisión 3: a quién le escribe el cliente para apartar. */
    asesora: { nombre: string | null; whatsapp: string | null } | null
  }
  /**
   * S3 (QA del 2026-10-29): a quién le habla el documento. `singular` = viaja una persona (usted);
   * `plural` = dos o más, o no se sabe (ustedes). Nunca tú.
   */
  voz: VozDelDocumento
  /** Lo que no cuadra y alguien tiene que mirar antes de imprimir. */
  avisos: string[]
}

export type VozDelDocumento = 'singular' | 'plural'

/** La voz por la cantidad de viajeros: una persona, usted; varias o sin dato, ustedes. */
export function vozPorViajeros(n: number | null | undefined): VozDelDocumento {
  return n === 1 ? 'singular' : 'plural'
}

// ── Reglas ────────────────────────────────────────────────────────────────────

const pesos = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

/**
 * El nombre de una tarifa para el cliente. El de la plantilla de hoy (`tituloDeBloquePDF`)
 * con el léxico de marca: «Premium» se dice «Superior».
 */
export function nombreDeTarifaParaCliente(nombre: string | null | undefined, esPrincipal: boolean, posicion: number): string {
  return tituloDeBloquePDF(nombre, esPrincipal, posicion).replace(/\bpremium\b/gi, (m) =>
    m === m.toUpperCase() ? 'SUPERIOR' : m[0] === 'P' ? 'Superior' : 'superior',
  )
}

export function claveDeTarifa(nombre: string | null | undefined): ClaveTarifa {
  const k = claveTarifa(nombre)
  if (k.includes('econom')) return 'economica'
  if (k.includes('intermedia')) return 'intermedia'
  if (k.includes('recomend')) return 'recomendada'
  if (k.includes('premium') || k.includes('superior')) return 'superior'
  return 'otra'
}

// La Intermedia va entre la Económica y la Recomendada: solo existe cuando la Recomendada es la más
// cara (segunda vuelta de la COT-2026-0008, `repartoPorPrecio`), y el orden sigue al precio.
const ORDEN_CLAVE: Record<ClaveTarifa, number> = { economica: 0, intermedia: 0.5, recomendada: 1, superior: 2, otra: 3 }

/**
 * Lo mismo que `lineasImpresas` de `cotizacion-trappvel-pdf.tsx`: el total de una línea es
 * `round(precio × cantidad × (1 − descuento))` más sus adicionales. Repetida aquí para no
 * cargar @react-pdf en un módulo puro; la prueba de paridad la vigila.
 */
export function lineasDelDocumento(
  items: { nombre: string; precio_venta: number; descuento_porcentaje: number; cantidad: number; unidad?: string | null; adicionales?: string[]; valorAdicionales?: number; nota?: string | null }[],
): LineaDoc[] {
  return items.map((i) => {
    const cantidad = i.cantidad ?? 1
    const base = Math.round(i.precio_venta * cantidad * (1 - (i.descuento_porcentaje || 0) / 100))
    return {
      nombre: i.nombre,
      cantidad,
      unidad: i.unidad ?? null,
      total: base + (i.valorAdicionales ?? 0),
      adicionales: i.adicionales ?? [],
      nota: i.nota ?? null,
    }
  })
}

const MARCA_DE_TREN = /\b(tren|trenes|ave|avlo|alvia|iryo|ouigo|renfe|tgv|inoui|sncf|eurostar|thalys|ice|italo|trenitalia|frecciarossa|railjet)\b/i
const ESTACION = /\b(estaci[oó]n|gare|station|bahnhof|hbf|centraal|sants|atocha|termini)\b/i
const NO_ES_ESTACION = /\b(hotel|aeropuerto|airport)\b/i

/**
 * ¿Este traslado es un tren? No hay tipo «Tren» todavía (los trenes son traslados con su
 * trayecto leído, max.md §4): se reconoce por el trayecto. Un tipo propio es otro PR.
 *
 * Por la marca del tren (AVE, TGV, Eurostar…), o de estación a estación. Una estación en UN
 * extremo no basta: «Hotel - estación Puerta de Atocha» es el traslado que lleva al tren (lo
 * vio la prueba del documento del 2026-10-14, que contaba 9 trenes donde había 3).
 */
export function esTren(descripcion: string): boolean {
  if (MARCA_DE_TREN.test(descripcion)) return true
  const trayecto = descripcion.split(' · ')[0]
  if (NO_ES_ESTACION.test(trayecto)) return false
  const extremos = trayecto.split(/\s+(?:-|→|–)\s+/)
  return extremos.length === 2 && extremos.every((e) => ESTACION.test(e))
}

/**
 * Sin la cancelación del proveedor, también cuando viene pegada a la descripción
 * («… del Real Madrid. Cancelación: gratuita hasta 01/12/2026»). La propuesta no imprime
 * políticas de cancelación (decisión del 2026-10-14).
 */
export function sinCancelacion(descripcion: string | null | undefined): string | null {
  const base = sinCancelacionDelProveedor(descripcion)
  if (!base) return null
  const partes = base
    .split(' · ')
    .map((parte) =>
      parte
        .split(/(?<=\.)\s+/)
        .filter((frase) => !/^\s*cancelaci[oó]n\b/i.test(frase))
        .join(' ')
        .trim(),
    )
    .filter(Boolean)
  return partes.length === 0 ? null : partes.join(' · ')
}

function iso(f: Fecha | null): string | null {
  if (!f || f.anio === null) return null
  return `${f.anio}-${String(f.mes + 1).padStart(2, '0')}-${String(f.dia).padStart(2, '0')}`
}

function fechaIso(texto: string | null | undefined, inicio: string | null | undefined): string | null {
  return iso(conAnio(leerFecha(texto), inicio))
}

function diaNumero(fecha: string): number {
  const f = leerFecha(fecha)
  return f ? (claveDeFecha(f) ?? 0) : 0
}

function sumarDias(fecha: string, n: number): string {
  const f = leerFecha(fecha) as Fecha
  const d = new Date(Date.UTC(f.anio as number, f.mes, f.dia + n))
  return d.toISOString().slice(0, 10)
}

/** Agrupa elementos marcados con tarifas por un texto: «Avianca AV26» en Económica y Superior va una vez. */
function agruparPorTexto<T extends { tarifas?: number[] }>(lista: T[], texto: (x: T) => string): { tarifas: number[]; texto: string }[] {
  const salida: { tarifas: number[]; texto: string }[] = []
  for (const x of lista) {
    const t = texto(x)
    const ya = salida.find((s) => s.texto === t)
    const tarifas = x.tarifas ?? []
    if (ya) ya.tarifas = [...new Set([...ya.tarifas, ...tarifas])].sort((a, b) => a - b)
    else salida.push({ tarifas: [...tarifas].sort((a, b) => a - b), texto: t })
  }
  return salida
}

/**
 * El vuelo en la caja de su versión, como el prototipo v4: «Avianca 19:20, directo»,
 * «Iberia 06:25, vía Madrid · llega 15:45». La llegada solo si es el mismo día; si llega al día
 * siguiente, se cuenta ese día.
 */
function textoDeVueloDelDia(v: VueloPDF, fila: { salida: string | null; llegada: string | null; escala: string | null }): string {
  const via = fila.escala?.startsWith('Escala en ')
    ? `vía ${fila.escala.slice('Escala en '.length).replace(/\s*\(?\b[A-Z]{3}\b\)?\s*$/, '').trim()}`
    : fila.escala === 'Vuelo directo'
      ? 'directo'
      : null
  const sale = [v.aerolinea ?? v.linea, fila.salida].filter(Boolean).join(' ')
  const llega = fila.llegada && !llegaAlDiaSiguiente(fila) ? `llega ${fila.llegada}` : null
  return [[sale, via].filter(Boolean).join(', '), llega].filter(Boolean).join(' · ')
}

function cargoDelHotel(props: CotizacionPDFProps, h: HotelPDF): string | null {
  const cargos = props.viaje?.cargosEnDestino ?? []
  const destino = props.viaje?.destino ?? null
  const ciudadDelCargo = (c: CargoEnDestinoPDF) => claveDeCiudad(lugarDelHotel(c.ciudad, destino).ciudad)
  const delHotel = cargos.find((c) => c.hotel && h.hotel && c.hotel === h.hotel)
    ?? cargos.find((c) => !c.hotel && ciudadDelCargo(c) !== '' && ciudadDelCargo(c) === claveDeCiudad(h.ciudad))
  if (!delHotel) return null
  const { concepto, monto } = cargoParaElCliente(delHotel)
  return `${concepto}: ${monto}`
}

/**
 * Decisión 1: los nombres de pila que la propuesta puede decir. Los adultos siempre; los de
 * los menores, solo con la autorización de datos de menores vigente. Sin autorización, el
 * menor no se nombra (la portada dice «2 niños», como hoy). Solo el primer nombre.
 */
export function nombresParaLaPropuesta(viajeros: readonly ViajeroConNombre[], menoresAutorizados: boolean): string[] {
  const salida: string[] = []
  for (const v of viajeros) {
    if (v.menor && !menoresAutorizados) continue
    const pila = v.nombre.trim().split(/\s+/)[0] ?? ''
    if (pila && !salida.includes(pila)) salida.push(pila)
  }
  return salida
}

// ── Ciudad y zona del hotel (V6, V8-3, V7-4 del QA del 2026-10-29) ─────────────

/** «SAN ANDRÉS» → «San Andrés»; lo que ya viene con minúsculas queda igual. */
export function nombrePropio(s: string | null | undefined): string | null {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  if (t !== t.toUpperCase()) return t
  const menores = new Set(['y', 'e', 'de', 'del', 'la', 'las', 'los', 'el', 'en'])
  return t
    .toLowerCase()
    .split(' ')
    .map((p, i) => (i > 0 && menores.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ')
}

/** El destino del viaje si es UN lugar («San Andrés»); con varios («Orlando y Miami»), `null`. */
export function destinoUnico(destino: string | null | undefined): string | null {
  const t = nombrePropio(destino)
  if (!t) return null
  return /\s(?:y|e)\s|,|·|\//i.test(t) ? null : t
}

const contienePalabras = (largo: string, corto: string) => {
  const k = llano(corto).replace(/[^a-z0-9]+/g, ' ').trim()
  return k.length >= 3 && ` ${llano(largo).replace(/[^a-z0-9]+/g, ' ')} `.includes(` ${k} `)
}

/**
 * La ciudad y la zona de un hotel desde lo que leyó la captura. La lectura escribe la zona y la
 * ciudad juntas, en dos órdenes:
 *  - «zona / ciudad»: «NoMad, Manhattan / Nueva York», «Disney Springs / Orlando»,
 *    «Willemstad / Curazao». La ciudad es la parte que nombra el destino del viaje; si ninguna lo
 *    nombra, la última.
 *  - «ciudad - zona» o «ciudad · zona»: «Madrid - Sol», «Santa Marta · Bello Horizonte».
 * La coma sola no separa zona: «Providencia, San Andrés y Providencia, Colombia» es la ciudad con
 * su departamento y su país. Antes la propuesta tomaba la primera parte: «DESTINOS: NoMad».
 */
export function lugarDelHotel(texto: string | null | undefined, destino?: string | null): { ciudad: string | null; zona: string | null } {
  const t = (texto ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return { ciudad: null, zona: null }
  const partes = t.split(/\s+\/\s+/).map((x) => x.trim()).filter(Boolean)
  if (partes.length > 1) {
    const nombraDestino = destino ? partes.findIndex((p) => contienePalabras(destino, ciudadDeCapitulo(p) ?? p)) : -1
    const i = nombraDestino >= 0 ? nombraDestino : partes.length - 1
    const zona = partes.filter((_, j) => j !== i).join(' · ')
    return { ciudad: ciudadDeCapitulo(partes[i]), zona: zona || null }
  }
  const zona = /^[^,]*?\s+[-–—·|]\s+(.+)$/.exec(t.split(',')[0])?.[1]?.trim() ?? null
  return { ciudad: ciudadDeCapitulo(t), zona }
}

/**
 * El cargo en destino como lo lee el cliente (V7-2 del QA del 2026-10-29): «Resort fee (cargo del
 * hotel): 35 USD por noche (210 USD por 6 noches)». Una lectura anterior no sabe qué cargo es ni si
 * es por noche: dice «Impuestos o cargos del hotel» y el valor tal cual, sin afirmar que es un
 * impuesto.
 */
export function cargoParaElCliente(c: CargoEnDestinoPDF): { concepto: string; monto: string } {
  const leido = (c.conceptoLeido ?? '').replace(/\s+/g, ' ').trim()
  const k = llano(leido)
  const concepto = /resort|destination|facility|amenit|urban fee/.test(k)
    ? 'Resort fee (cargo del hotel)'
    : /city tax|tourist tax|tasa turistica|impuesto turistico|taxe de sejour|tassa di soggiorno|ecotasa/.test(k)
      ? 'Tasa turística'
      : /impuesto|tasa|tax/.test(k)
        ? 'Impuestos y tasas de hospedaje'
        : c.concepto && c.concepto !== 'Impuestos y tasas de hospedaje'
          ? c.concepto
          : 'Impuestos o cargos del hotel'
  if (!c.porNoche || typeof c.valor !== 'number') return { concepto, monto: c.monto }
  const cifra = (v: number) => `${v.toLocaleString('es-CO', { maximumFractionDigits: 2 })}${c.moneda ? ` ${c.moneda}` : ''}`
  const total = c.noches && c.noches > 1 ? ` (${cifra(Math.round(c.valor * c.noches * 100) / 100)} por ${c.noches} noches)` : ''
  return { concepto, monto: `${cifra(c.valor)} por noche${total}` }
}

// ── El modelo ─────────────────────────────────────────────────────────────────

export function modeloDePropuesta({
  props,
  servicios = [],
  viajeros = [],
  menoresAutorizados = false,
  anticipo = null,
  asesora = null,
  lugaresDeOpcionales = [],
  cliente = null,
  numeroDeViajeros: viajerosDeclarados = null,
}: EntradaModeloPropuesta): ModeloPropuesta {
  const v = props.viaje ?? null
  const inicio = v?.fechaInicio ?? null
  const avisos: string[] = []

  // ── Tarifas ──
  const itinerarios = props.itinerarios ?? []
  const ivaIncluido = props.ivaEnPrecios ?? null
  const bloques: TarifaDoc[] = itinerarios.map((it, i) => {
    const ivaDelBloque = ivaIncluido?.nota ? ivaIncluido.porBloque[i] ?? 0 : 0
    return {
      indice: i,
      clave: it.esPrincipal && claveDeTarifa(it.nombre) === 'otra' ? 'recomendada' : claveDeTarifa(it.nombre),
      nombre: nombreDeTarifaParaCliente(it.nombre, it.esPrincipal, i + 1),
      esPrincipal: it.esPrincipal,
      precio: it.precio,
      notaIva: ivaDelBloque > 0 ? `Incluye IVA de ${pesos(ivaDelBloque)}` : null,
      lineas: lineasDelDocumento(it.items),
      descuentos: it.descuentos ?? [],
      estrellas: null,
      hoteles: [],
      vuelos: [],
    }
  })
  const porTarifas = bloques.length > 1
  const tarifas = porTarifas ? bloques : []
  const principal = porTarifas ? Math.max(0, bloques.findIndex((b) => b.esPrincipal)) : null
  const deLaTarifa = (x: { tarifas?: number[] }, i: number) => !x.tarifas || x.tarifas.length === 0 || x.tarifas.includes(i)

  // ── Vuelos ──
  const vuelos: FilaVueloDoc[] = (v?.vuelos ?? []).flatMap((vu) =>
    filasDelVuelo(vu).map((f, k) => ({
      sentido: k === 0 ? ('ida' as const) : ('regreso' as const),
      tarifas: porTarifas ? [...(vu.tarifas ?? [])] : [],
      aerolinea: vu.aerolinea ?? vu.linea,
      numero: f.numero,
      desde: f.desde,
      hasta: f.hasta,
      escala: f.escala,
      fecha: fechaIso(f.fecha, inicio) ?? f.fecha,
      salida: f.salida,
      llegada: f.llegada,
      tarifaAerolinea: vu.tarifa,
      equipaje: vu.equipaje,
      adicionales: vu.adicionales,
    })),
  )

  // ── Hoteles por ciudad ──
  // V6 / V8-3 / V7-4 · la ciudad del hotel es la del destino; la zona va aparte (`lugarDelHotel`).
  const hotelesTodos: HotelPDF[] = (v?.hoteles ?? []).map((h) => {
    const lugar = lugarDelHotel(h.ciudad, v?.destino ?? null)
    return { ...h, ciudad: lugar.ciudad, zona: h.zona ?? lugar.zona }
  })
  const capitulos = capitulosDelViaje(hotelesTodos, principal, v?.destino ?? null).filter((c) => c.hotel || c.alternativas.length > 0)
  const noIncluidasDe = new WeakMap<OpcionHotelDoc, string[]>()
  const opcion = (h: HotelPDF): OpcionHotelDoc => {
    const o = opcionSinNoIncluye(h)
    if (h.noIncluidoEnCasillas?.length) noIncluidasDe.set(o, h.noIncluidoEnCasillas)
    return o
  }
  const opcionSinNoIncluye = (h: HotelPDF): OpcionHotelDoc => ({
    tarifas: porTarifas ? [...(h.tarifas ?? [])] : [],
    hotel: h.hotel ?? h.linea,
    estrellas: h.estrellas ?? null,
    zona: h.zona ?? null,
    habitacion: h.habitacion,
    regimen: h.regimen,
    incluye: h.incluye ?? null,
    cancelacion: h.cancelacion,
    cargoEnDestino: cargoDelHotel(props, h),
    foto: h.foto ?? null,
  })
  const ordenDeOpcion = (o: OpcionHotelDoc) =>
    o.tarifas.length === 0 ? -1 : Math.min(...o.tarifas.map((t) => ORDEN_CLAVE[bloques[t]?.clave ?? 'otra'] * 100 + t))
  const hoteles: CiudadDoc[] = capitulos.map((c) => {
    const ancla = c.hotel ?? c.alternativas[0]
    return {
      ciudad: c.ciudad,
      desde: fechaIso(ancla?.checkIn, inicio),
      hasta: fechaIso(ancla?.checkOut, inicio),
      noches: ancla?.noches ?? null,
      opciones: [c.hotel, ...c.alternativas].filter((h): h is HotelPDF => h !== null).map(opcion).sort((a, b) => ordenDeOpcion(a) - ordenDeOpcion(b)),
    }
  })
  // Un hotel sin ciudad (el paquete de bloqueo solo dice la zona) duerme en el destino del viaje,
  // si el viaje es a un solo lugar. Antes la zona hacía de destino: «DESTINOS: Centro (4N)».
  const unico = destinoUnico(v?.destino)
  if (unico) for (const c of hoteles) if (!c.ciudad) c.ciudad = unico
  // En el orden del viaje, no en el de las líneas: la COT-2026-0026 real decía «Madrid ·
  // Ámsterdam · Barcelona · París» porque Ámsterdam se cargó segundo. Sin fecha, al final.
  hoteles.sort((a, b) => (a.desde ?? '9999').localeCompare(b.desde ?? '9999'))
  // Prueba corta del #1352 · con varias versiones, cada tarjeta dice lo que a su paquete le falta y
  // otra versión sí trae: «Incluido en todas» ya no lo afirma de todas.
  if (porTarifas) {
    const todas = hoteles.flatMap((c) => c.opciones)
    for (const o of todas) {
      const faltan = (noIncluidasDe.get(o) ?? []).filter((x) =>
        todas.some((otra) => otra !== o && (otra.incluye ?? '').split(',').some((y) => llano(y).trim() === llano(x).trim())))
      if (faltan.length > 0) o.noIncluye = faltan.join(', ')
    }
  }

  // El trayecto de vuelta sin fecha propia sale el día que termina la estadía donde cae el de ida
  // («Amsterdam Centraal - hotel» el 21 y «hotel - aeropuerto Schiphol» el 23).
  const serviciosConFecha: ServicioDelDocumento[] = servicios.map((s) => {
    // La fecha de devolución del carro solo sale si la trae la lectura (Vera, 2026-10-29): deducirla
    // del primer vuelo y mostrarla al cliente sería afirmar algo que nadie leyó.
    if (s.alquiler) return s
    if (s.fecha || !s.fechaIda) return s
    const ida = fechaIso(s.fechaIda, inicio)
    const estadia = ida ? hoteles.find((h) => h.desde && h.hasta && ida >= h.desde && ida < h.hasta) : undefined
    return estadia?.hasta ? { ...s, fecha: estadia.hasta } : s
  })

  // ── Trenes y traslados ──
  const filasTrayecto: TrayectoDoc[] = serviciosConFecha
    .filter((s) => s.tipo === 'traslado')
    .map((s) => ({
      tipo: s.alquiler ? ('alquiler' as const) : esTren(s.descripcion) ? ('tren' as const) : ('traslado' as const),
      fecha: fechaIso(s.fecha, inicio) ?? s.fecha,
      hora: s.hora ?? null,
      descripcion: s.descripcion,
      tarifas: porTarifas ? [...(s.tarifas ?? [])] : [],
      ...(s.alquiler
        ? { alquiler: { recogida: s.alquiler.recogida, devolucion: s.alquiler.devolucion, fechaDevolucion: s.alquiler.fechaDevolucion ?? null, vehiculo: s.alquiler.vehiculo } }
        : {}),
    }))
    .sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? '') || (a.hora ?? '').localeCompare(b.hora ?? ''))
  const trayectos = {
    filas: filasTrayecto,
    igualEnTodas: filasTrayecto.every((t) => t.tarifas.length === 0 || t.tarifas.length === bloques.length),
  }

  // ── Ruta ──
  const idaPrincipal = (v?.vuelos ?? []).find((x) => esDeLaPrincipal(x, principal))
  const filasIda = idaPrincipal ? filasDelVuelo(idaPrincipal) : []
  const paradas: ParadaDoc[] = hoteles
    .filter((h) => h.ciudad)
    .map((h, i, todas) => {
      const siguiente = todas[i + 1]
      const tren = siguiente && h.hasta
        ? filasTrayecto.find((t) => t.tipo === 'tren' && t.fecha === h.hasta)
        : undefined
      return { ciudad: h.ciudad as string, noches: h.noches, desde: h.desde, hasta: h.hasta, siguiente: tren?.descripcion ?? null }
    })
  const ruta = {
    origen: filasIda[0]?.desde ?? null,
    paradas,
    regreso: filasIda[1]?.hasta ?? filasIda[0]?.desde ?? null,
  }

  // ── Elige tu versión ──
  for (const t of tarifas) {
    const suyos = hotelesTodos
      .filter((h) => deLaTarifa(h, t.indice))
      .map((h) => ({ h, desde: fechaIso(h.checkIn, inicio) ?? '9999' }))
      .sort((a, b) => a.desde.localeCompare(b.desde))
      .map((x) => x.h)
    t.hoteles = suyos.map((h) => ({ nombre: h.hotel ?? h.linea, estrellas: h.estrellas ?? null, ciudad: ciudadDeCapitulo(h.ciudad) }))
    const conCategoria = suyos.map((h) => h.estrellas).filter((e): e is number => e !== null && e !== undefined)
    t.estrellas = conCategoria.length > 0 && conCategoria.length === suyos.length && conCategoria.every((e) => e === conCategoria[0]) ? conCategoria[0] : null
    t.vuelos = vuelos.filter((f) => deLaTarifa(f, t.indice))
  }
  const tarifasOrdenadas = [...tarifas].sort((a, b) => ORDEN_CLAVE[a.clave] - ORDEN_CLAVE[b.clave] || a.indice - b.indice)
  const igualEnTodas = porTarifas
    ? [...new Set(bloques[0].lineas.map((l) => l.nombre))].filter((n) => bloques.every((b) => b.lineas.some((l) => l.nombre === n)))
    : []

  // ── Precio: las MISMAS cuentas que la plantilla de hoy ──
  const lineas = lineasDelDocumento(props.items)
  const subtotal = lineas.reduce((a, l) => a + l.total, 0)
  const notaIva = ivaIncluido && ivaIncluido.nota && ivaIncluido.iva > 0 ? textoIvaIncluido(ivaIncluido.iva, pesos) : null
  const iva = ivaIncluido ? 0 : props.fiscal?.iva ?? 0
  const total = props.fiscal?.totalBruto ?? subtotal + iva
  const totalEsDeLaRecomendada = porTarifas && bloques.some((b) => b.esPrincipal)

  const entrada = props.asiPuedesPagar ?? null
  const planes: PlanDoc[] = !entrada
    ? []
    : porTarifas
      ? tarifasOrdenadas.map((t) => ({
          tarifa: t.indice,
          nombre: t.nombre,
          // La principal paga sobre el TOTAL impreso, como el plan de hoy; las demás sobre su precio.
          plan: asiPuedesPagar(t.esPrincipal ? total : t.precio, entrada),
        }))
      : [{ tarifa: null, nombre: null, plan: asiPuedesPagar(total, entrada) }]

  const recomendada = bloques.find((b) => b.esPrincipal)
  if (porTarifas && recomendada && recomendada.precio !== total) {
    avisos.push(
      `El precio de la ${recomendada.nombre} (${pesos(recomendada.precio)}) no es el TOTAL del documento (${pesos(total)}).`,
    )
  }

  const opcionales: OpcionalDoc[] = (props.sugeridos ?? []).map((o, i) => {
    const lugar = lugaresDeOpcionales[i] ?? null
    return {
      nombre: o.nombre,
      descripcion: descripcionDeOpcional(o.descripcion),
      valor: Math.round((o.precio_venta || 0) * (o.cantidad ?? 1)),
      unidad: o.unidad ?? null,
      ciudad: ciudadDelOpcional(lugar?.ciudad ?? null, `${o.nombre} ${o.descripcion ?? ''}`, paradas.map((x) => x.ciudad)),
      fecha: fechaIso(lugar?.fecha, inicio),
    }
  })

  // V7-2 (QA del 2026-10-29): qué cargo es y, con varias versiones, en cuáles aplica. Antes decía
  // «Impuestos y tasas de hospedaje (Orlando)» a secas, aunque solo lo pagaba la Económica.
  const versionesDe = (idx: number[] | undefined): string => {
    if (!porTarifas || !idx || idx.length === 0 || idx.length >= bloques.length) return ''
    const nombres = [...new Set(idx)].sort((a, b) => ORDEN_CLAVE[bloques[a]?.clave ?? 'otra'] - ORDEN_CLAVE[bloques[b]?.clave ?? 'otra']).map((i) => bloques[i]?.nombre).filter((x): x is string => !!x)
    if (nombres.length === 0) return ''
    return nombres.length === 1 ? `, solo en la versión ${nombres[0]}` : `, solo en las versiones ${yLista(nombres)}`
  }
  const noIncluye = [
    ...new Set((v?.cargosEnDestino ?? []).map((c) => {
      const ciudad = lugarDelHotel(c.ciudad, v?.destino ?? null).ciudad
      const { concepto } = cargoParaElCliente(c)
      return `${concepto}${ciudad ? ` en ${ciudad}` : ''}: se paga en el hotel${versionesDe(c.tarifas)}`
    })),
    ...(opcionales.length > 0 ? ['Las actividades opcionales listadas al final de este documento'] : []),
  ]

  // ── Día a día ──
  const dias = diaADia({ props, inicio, vuelos: v?.vuelos ?? [], hoteles: hotelesTodos, capitulos: hoteles, servicios: serviciosConFecha, porTarifas, principal })
  repartirOpcionales(dias, opcionales)

  // ── Portada y lo formal ──
  const titulo = (v?.titular?.trim() || props.negocio?.nombre || props.cotizacion.descripcion || 'Propuesta de viaje').trim()
  const pie = v?.pie ?? [props.vendedor.nombre, props.vendedor.email, props.vendedor.telefono, props.vendedor.ciudad].filter(Boolean).join(' · ')
  const firma = v?.firma ?? (props.emisor ? { nombre: props.emisor.nombre, cargo: props.emisor.cargo, contacto: null } : null)

  // Las noches son las de hotel: el vuelo nocturno no es noche (la COT-2026-0026 real decía
  // «14 días / 13 noches» arriba e «Incluye 12 noches» al lado).
  const nochesDeHotel = paradas.reduce((a, x) => a + (x.noches ?? 0), 0)
  const diasDelViaje = Number(/(\d+)\s*d[ií]as?/i.exec(v?.duracion ?? '')?.[1] ?? 0) || (dias.length > 0 ? dias.length : 0)
  const duracion = nochesDeHotel > 0 && diasDelViaje > 0
    ? `${diasDelViaje} ${diasDelViaje === 1 ? 'día' : 'días'} · ${nochesDeHotel} ${nochesDeHotel === 1 ? 'noche' : 'noches'}`
    : v?.duracion ?? null
  // S3 (QA del 2026-10-29): con un solo viajero el documento le habla a él (usted), no al grupo.
  const numeroDeViajeros = typeof viajerosDeclarados === 'number' && viajerosDeclarados > 0 ? viajerosDeclarados : null
  const voz = vozPorViajeros(numeroDeViajeros)
  const introGuardado = v?.intro?.trim() || null
  const intro = introGuardado && textoConLaVozDelDocumento(introGuardado, nochesDeHotel, voz)
    ? introGuardado
    : introDeterminista({ paradas, trenes: filasTrayecto.filter((t) => t.tipo === 'tren').length, hoteles, dias, voz })

  return {
    portada: {
      consecutivo: props.cotizacion.consecutivo,
      titulo,
      intro,
      viajeros: v?.viajeros ?? null,
      numeroDeViajeros,
      destino: v?.destino ?? null,
      fechas: v?.fechas ?? null,
      duracion,
      foto: v?.foto ?? null,
      fotosCiudades: v?.fotosCiudades ?? [],
      nombres: nombresParaLaPropuesta(viajeros, menoresAutorizados),
      destinatario: destinatarioDeLaPropuesta(cliente),
    },
    ruta,
    dias,
    hoteles,
    vuelos,
    trayectos,
    opcionales,
    tarifas: tarifasOrdenadas,
    igualEnTodas,
    precio: {
      total,
      subtotal,
      iva,
      notaIva,
      totalEsDeLaRecomendada,
      lineas,
      descuentos: props.descuentosTotal ?? [],
      incluye: porTarifas
        ? incluyeDeTodas(v?.incluye ?? [], {
          hoteles, vuelos, tarifas: bloques.length, noches: nochesDeHotel,
          nochesPorVersion: bloques.map((_, i) => hotelesTodos.filter((h) => deLaTarifa(h, i)).reduce((a, h) => a + (h.noches ?? 0), 0)),
        })
        : v?.incluye ?? [],
      noIncluye,
      planes,
      anticipo: anticipo && anticipo.monto > 0 ? anticipo : null,
    },
    formal: {
      terminos: props.cotizacion.terminos_condiciones ?? null,
      pie,
      firma,
      creditos: creditosDeFotos([v?.foto, ...(v?.fotosCiudades ?? [])]),
      antesDeViajar: (v?.antesDeViajar ?? []).map((t) => enLaVozDelDocumento(t, voz)),
      asesora,
    },
    voz,
    avisos,
  }
}

// ── Textos con datos reales (hallazgos de la COT-2026-0026 real, 2026-10-14) ──

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** «2026-12-19» → «19 dic»: una fecha cruda no va al cliente. */
function fechasLegibles(texto: string): string {
  return texto.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, _a, mes, dia) => {
    const nombre = MESES_CORTOS[Number(mes) - 1]
    return nombre ? `${Number(dia)} ${nombre}` : m
  })
}

/** «1 DÍA» → «1 día»; lo que ya viene en minúsculas o con mayúscula inicial queda igual. */
function sinGritar(s: string): string {
  return s === s.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{2}/.test(s) ? s.toLowerCase() : s
}

/**
 * La descripción corta de un plan opcional. La línea guarda la ficha del sistema («Ciudad: París ·
 * Fecha: 2026-12-19 · Duración: 1 día · Idioma: Francés / Inglés · Proveedor: Explora Tours») y la
 * propuesta real la imprimía entera: con el PROVEEDOR, que nunca va al cliente. Quedan la duración y
 * el idioma («1 día · en francés o inglés»); la ciudad y el día ya están sobre la foto. El texto
 * libre (sin «Campo:») queda como está, sin cancelación y con las fechas legibles.
 */
export function descripcionDeOpcional(descripcion: string | null | undefined): string | null {
  const base = sinCancelacion(descripcion)
  if (!base) return null
  const salida: string[] = []
  for (const parte of base.split(' · ').map((p) => p.trim()).filter(Boolean)) {
    if (/proveedor|operador/i.test(parte)) continue
    const campo = /^([A-Za-zÁÉÍÓÚáéíóúÑñ /]{3,30}):\s*(.+)$/.exec(parte)
    if (!campo) {
      salida.push(fechasLegibles(parte))
      continue
    }
    const nombre = llano(campo[1]).trim()
    const valor = sinGritar(campo[2].trim())
    if (nombre === 'duracion') salida.push(valor)
    else if (nombre === 'idioma' || nombre === 'idiomas') {
      salida.push(/\ben\b/i.test(valor) ? valor[0].toLowerCase() + valor.slice(1) : `en ${valor.toLowerCase().replace(/\s*\/\s*/g, ' o ')}`)
    } else if (nombre === 'incluye') salida.push(`Incluye ${valor[0].toLowerCase()}${valor.slice(1)}`)
    // Ciudad, fecha, proveedor, precio, personas y demás campos de la ficha: fuera.
  }
  return salida.length > 0 ? salida.join(' · ') : null
}

/**
 * ¿El texto guardado (`documento_cliente`) habla como la propuesta? La voz decidida es «ustedes»,
 * sin exclamaciones (decisión de marca). El de Gemini de la COT-2026-0026 decía «¡Prepárese para un
 * viaje por Europa! … 13 noches» (usted, exclamación y una noche de más). Un texto que no pasa no se
 * imprime: sale el determinista (`introDeterminista`).
 */
export function textoConLaVozDelDocumento(texto: string, nochesDeHotel: number, voz: VozDelDocumento = 'plural'): boolean {
  if (/[¡!]/.test(texto)) return false
  if (voz === 'singular') {
    // S3 · un viajero: el texto le habla a él. «Ustedes» o un imperativo plural no van.
    if (/\bustedes\b/i.test(texto)) return false
    if (/\b(prep[aá]rense|disfruten|descubran|recuerden|tengan|lleguen|conozcan|rel[aá]jense|d[eé]jense|vivan)\b/i.test(texto)) return false
  } else {
    if (/\busted\b/i.test(texto)) return false
    // Imperativos de usted que los modelos repiten al abrir.
    if (/\b(prep[aá]rese|disfrute|descubra|recuerde|tenga|llegue|conozca|rel[aá]jese|d[eé]jese|sum[eé]rjase|viva)\b/i.test(texto)) return false
  }
  const noches = /(\d+)\s+noches?\b/i.exec(texto)
  if (noches && nochesDeHotel > 0 && Number(noches[1]) !== nochesDeHotel) return false
  return true
}

const IMPERATIVOS_DE_USTED: [string, string][] = [
  ['recuerde', 'recuerden'], ['llegue', 'lleguen'], ['tenga', 'tengan'], ['lleve', 'lleven'], ['verifique', 'verifiquen'],
  ['revise', 'revisen'], ['consulte', 'consulten'], ['disfrute', 'disfruten'], ['prepárese', 'prepárense'],
  ['asegúrese', 'asegúrense'], ['empaque', 'empaquen'], ['considere', 'consideren'], ['confirme', 'confirmen'],
  ['presente', 'presenten'], ['evite', 'eviten'], ['reserve', 'reserven'], ['descubra', 'descubran'], ['conozca', 'conozcan'],
]

/**
 * Un renglón del texto guardado («Antes de viajar»), llevado a la voz del documento: de usted a
 * ustedes y sin exclamaciones. El de Gemini de la COT-2026-0026 decía «Recuerde llevar sus
 * documentos», «Llegue al aeropuerto…», «le sugerimos empacar ropa abrigada». Solo cambia lo que
 * conoce (una lista cerrada de imperativos y «le sugerimos»); el resto queda como se revisó.
 */
export function enLaVozDelDocumento(texto: string, voz: VozDelDocumento = 'plural'): string {
  let t = texto.replace(/¡/g, '').replace(/!/g, '.').replace(/\.{2,}/g, '.')
  if (voz === 'singular') {
    // S3 · un solo viajero: de ustedes a usted, con la misma lista cerrada al revés.
    for (const [uno, varios] of IMPERATIVOS_DE_USTED) {
      t = t.replace(new RegExp(`(^|[^\\p{L}])(${varios})(?![\\p{L}])`, 'giu'), (_m, antes: string, palabra: string) =>
        `${antes}${palabra[0] === palabra[0].toUpperCase() ? uno[0].toUpperCase() + uno.slice(1) : uno}`,
      )
    }
    return t
      .replace(/\b([Ll])es (sugerimos|recomendamos|pedimos|aconsejamos|recordamos)\b/g, '$1e $2')
      .replace(/\bustedes\b/g, 'usted')
      .replace(/\bUstedes\b/g, 'Usted')
      .trim()
  }
  for (const [uno, varios] of IMPERATIVOS_DE_USTED) {
    t = t.replace(new RegExp(`(^|[^\\p{L}])(${uno})(?![\\p{L}])`, 'giu'), (_m, antes: string, palabra: string) =>
      `${antes}${palabra[0] === palabra[0].toUpperCase() ? varios[0].toUpperCase() + varios.slice(1) : varios}`,
    )
  }
  return t
    .replace(/\b([Ll])e (sugerimos|recomendamos|pedimos|aconsejamos|recordamos)\b/g, '$1es $2')
    .replace(/\busted\b/g, 'ustedes')
    .replace(/\bUsted\b/g, 'Ustedes')
    .trim()
}

/**
 * ¿El régimen es SOLO alojamiento con desayuno? (D6 de Mauricio, 2026-10-29.) «Todos los hoteles
 * incluyen el desayuno» se decía de «(FULL) Desayuno, Almuer.» porque nombra el desayuno: el cliente
 * leía un plan que no es el suyo. Un plan con almuerzo, cena, pensión o todo incluido no se resume así.
 */
export function regimenSoloDesayuno(regimen: string | null | undefined): boolean {
  const r = llano(regimen ?? '')
  return /desayuno/.test(r) && !/(almuer|cena|full|todo incluido|pension|all inclusive|media pension|completa)/.test(r)
}

/** «A», «A y B», «A, B y C». */
function yLista(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`
}

/** El intro armado solo con datos, en la voz del documento. `null` sin paradas. */
export function introDeterminista(p: { paradas: ParadaDoc[]; trenes: number; hoteles: CiudadDoc[]; dias: DiaDoc[]; voz?: VozDelDocumento }): string | null {
  if (p.paradas.length === 0) return null
  const uno = p.voz === 'singular'
  // Dos estadías seguidas en la misma ciudad (dos hoteles en Orlando) se nombran una vez.
  const nombres = p.paradas.map((x) => x.ciudad).filter((c, i, xs) => i === 0 || claveDeCiudad(c) !== claveDeCiudad(xs[i - 1]))
  const noches = p.paradas.reduce((a, x) => a + (x.noches ?? 0), 0)
  const ciudades = yLista(nombres)
  const abre = noches > 0 ? `${noches} ${noches === 1 ? 'noche' : 'noches'} en ${ciudades}` : `Un viaje por ${ciudades}`
  const tren = p.trenes > 0 && p.paradas.length > 1 ? `, y entre ciudades ${uno ? 'va' : 'van'} en tren, de centro a centro` : ''
  const frases = [`${abre}${tren}.`]
  const regimenes = p.hoteles.flatMap((c) => c.opciones.map((o) => o.regimen ?? ''))
  if (regimenes.length > 0 && regimenes.every(regimenSoloDesayuno)) frases.push('Todos los hoteles incluyen el desayuno.')
  if (p.dias.some((d) => d.libre)) frases.push(uno ? 'Los días libres quedan abiertos para que usted decida.' : 'Los días libres quedan abiertos para que ustedes decidan.')
  return frases.join(' ')
}

/**
 * «Incluido en todas», de verdad en todas. El texto guardado describe la Recomendada («3 noches en
 * el Hotel Catalonia Puerta del Sol», «Tiquetes … con Air France») y la propuesta real lo imprimía
 * bajo «Incluido en todas», o sea que le decía al cliente de la Económica que dormía en el Catalonia.
 * La línea que nombra un hotel o una aerolínea que cambia según la versión sale, y en su lugar va
 * una sola que lo dice.
 */
export function incluyeDeTodas(
  incluye: string[],
  m: {
    hoteles: CiudadDoc[]
    vuelos: FilaVueloDoc[]
    tarifas: number
    noches: number
    /**
     * Las noches de hotel de cada versión (prueba corta del #1352). Con paquetes sin ciudad no hay
     * paradas y `noches` daba 0: el renglón decía «Hoteles» sin noches. Si todas coinciden manda esta
     * cifra; si no, el rango.
     */
    nochesPorVersion?: number[]
  },
): string[] {
  const deUnaVersion = (tarifas: number[]) => tarifas.length > 0 && tarifas.length < m.tarifas
  const nombres = (xs: (string | null)[]) =>
    [...new Set(xs.filter((x): x is string => !!x).flatMap((x) => [llano(x).trim(), llano(x.replace(/^hotel\s+/i, '')).trim()]))].filter((x) => x.length >= 3)
  // Prueba corta del #1352 · el mismo hotel o la misma aerolínea en TODAS las versiones (dos filas
  // iguales, una por versión) no «cambia según la versión»: se cuenta la unión de sus versiones.
  const cubre = (xs: { nombre: string | null; tarifas: number[] }[]) => {
    const por = new Map<string, Set<number>>()
    for (const x of xs) {
      if (!x.nombre) continue
      const k = llano(x.nombre).trim()
      por.set(k, new Set([...(por.get(k) ?? []), ...x.tarifas]))
    }
    return (x: { nombre: string | null }) => !x.nombre || (por.get(llano(x.nombre).trim())?.size ?? 0) < m.tarifas
  }
  const opcionesHotel = m.hoteles.flatMap((c) => c.opciones).map((o) => ({ nombre: o.hotel, tarifas: o.tarifas }))
  const filasVuelo = m.vuelos.map((f) => ({ nombre: f.aerolinea, tarifas: f.tarifas }))
  const hotelCambia = cubre(opcionesHotel)
  const aerolineaCambia = cubre(filasVuelo)
  const hoteles = nombres(opcionesHotel.filter((o) => deUnaVersion(o.tarifas) && hotelCambia(o)).map((o) => o.nombre))
  const aerolineas = nombres(filasVuelo.filter((f) => deUnaVersion(f.tarifas) && aerolineaCambia(f)).map((f) => f.nombre))
  const nombra = (linea: string, lista: string[]) => {
    const t = ` ${llano(linea).replace(/[^a-z0-9]+/g, ' ')} `
    return lista.some((n) => t.includes(` ${n.replace(/[^a-z0-9]+/g, ' ').trim()} `))
  }
  const desayuno = m.hoteles.length > 0 && m.hoteles.every((c) => c.opciones.every((o) => regimenSoloDesayuno(o.regimen ?? '')))
  const porVersion = (m.nochesPorVersion ?? []).length === m.tarifas && (m.nochesPorVersion ?? []).every((n) => n > 0) ? m.nochesPorVersion! : []
  const minimo = porVersion.length > 0 ? Math.min(...porVersion) : 0
  const maximo = porVersion.length > 0 ? Math.max(...porVersion) : 0
  const nochesN = (n: number) => `${n} ${n === 1 ? 'noche' : 'noches'}`
  const cuantasNoches = porVersion.length > 0
    ? minimo === maximo ? `${nochesN(minimo)} de hotel` : `De ${minimo} a ${nochesN(maximo)} de hotel`
    : m.noches > 0 ? `${nochesN(m.noches)} de hotel` : 'Hoteles'
  const queCambia = porVersion.length > 0 && minimo !== maximo ? 'el hotel y las noches cambian según la versión' : 'el hotel cambia según la versión'
  const lineaHotel = `${cuantasNoches}${desayuno ? ' con desayuno' : ''}; ${queCambia}`
  // Prueba corta del #1352 · «Incluido en todas» es la INTERSECCIÓN: lo que una opción de hotel dice
  // que incluye (las casillas del paquete) solo va aquí si lo incluyen todas las versiones. Lo que
  // va en algunas ya lo dice la tarjeta de su hotel.
  const deLaOpcion = (o: OpcionHotelDoc) => (o.incluye ?? '').split(',').map((x) => llano(x).trim()).filter(Boolean)
  const opciones = m.hoteles.flatMap((c) => c.opciones)
  const dichoPorAlguna = new Set(opciones.flatMap(deLaOpcion))
  const enTodasLasVersiones = (linea: string) => {
    const k = llano(linea).trim()
    if (!dichoPorAlguna.has(k)) return true
    for (let i = 0; i < m.tarifas; i++) {
      const suyas = opciones.filter((o) => o.tarifas.length === 0 || o.tarifas.includes(i))
      if (!suyas.some((o) => deLaOpcion(o).includes(k))) return false
    }
    return true
  }
  const lineaVuelo = 'Tiquetes aéreos de ida y regreso; la aerolínea cambia según la versión'
  const salida: string[] = []
  for (const linea of incluye) {
    if (nombra(linea, hoteles)) {
      if (!salida.includes(lineaHotel)) salida.push(lineaHotel)
    } else if (nombra(linea, aerolineas)) {
      if (!salida.includes(lineaVuelo)) salida.push(lineaVuelo)
    } else if (enTodasLasVersiones(linea)) salida.push(linea)
  }
  return salida
}

/** «Walt Disney World · 4 días · Orlando» → 4. Solo de 2 a 14: más es un dato mal leído. */
function diasDeLaActividad(descripcion: string): number | null {
  const m = /(?:^|·)\s*(\d{1,2})\s*d[ií]as?\b/i.exec(descripcion) ?? /\bde\s+(\d{1,2})\s+d[ií]as\b/i.exec(descripcion)
  const n = m ? Number(m[1]) : 0
  return n >= 2 && n <= 14 ? n : null
}

/** Más días que esto es un dato mal leído, no un viaje. */
const MAX_DIAS = 60

function diaADia(p: {
  props: CotizacionPDFProps
  inicio: string | null
  vuelos: VueloPDF[]
  hoteles: HotelPDF[]
  capitulos: CiudadDoc[]
  servicios: ServicioDelDocumento[]
  porTarifas: boolean
  principal: number | null
}): DiaDoc[] {
  const inicio = iso(leerFecha(p.inicio))
  if (!inicio) return []
  const eventos = new Map<string, EventoDoc[]>()
  const poner = (fecha: string | null, e: EventoDoc) => {
    if (!fecha) return
    eventos.set(fecha, [...(eventos.get(fecha) ?? []), e])
  }

  // Vuelos: uno por fecha y sentido; con tarifas, lo que cambia va por tarifa (aerolínea, hora,
  // directo o vía). Un vuelo que llega al día siguiente también se cuenta el día que llega.
  const tramos = p.vuelos.flatMap((vu) =>
    filasDelVuelo(vu).map((f, k) => ({ vu, f, sentido: k, fecha: fechaIso(f.fecha, p.inicio), tarifas: p.porTarifas ? vu.tarifas ?? [] : [] })),
  )
  const llaves = [...new Set(tramos.filter((t) => t.fecha).map((t) => `${t.fecha}|${t.sentido}`))]
  for (const llave of llaves) {
    const grupo = tramos.filter((t) => `${t.fecha}|${t.sentido}` === llave)
    const primero = grupo.find((t) => esDeLaPrincipal({ tarifas: t.tarifas }, p.principal)) ?? grupo[0]
    // Cada caja lleva la pastilla de su aerolínea (una por tramo), como la tabla «Vuelos».
    const porTarifa = (p.porTarifas ? agruparPorTexto(grupo, (t) => textoDeVueloDelDia(t.vu, t.f)) : []).map((pt) => {
      const t = grupo.find((x) => textoDeVueloDelDia(x.vu, x.f) === pt.texto)
      return { ...pt, siglas: t ? siglasDeTramos(t.vu.aerolinea ?? t.vu.linea, t.f.numero) : [] }
    })
    const conCajas = porTarifa.length > 1
    poner(primero.fecha, {
      tipo: 'vuelo',
      // Con una caja por versión, la hora va en cada caja: cada versión sale a una hora distinta.
      hora: conCajas ? null : primero.f.salida,
      texto: `${primero.f.desde ?? '?'} → ${primero.f.hasta ?? '?'}`,
      porTarifa: conCajas ? porTarifa : [],
      momento: 'salida',
    })
    const llegan = grupo.filter((t) => llegaAlDiaSiguiente(t.f))
    if (llegan.length > 0 && primero.fecha) {
      const alLlegar = p.porTarifas ? agruparPorTexto(llegan, (t) => `llega ${t.f.llegada}`) : []
      const cajas = alLlegar.length > 1
      poner(sumarDias(primero.fecha, 1), {
        tipo: 'vuelo',
        hora: cajas ? null : (llegan[0].f.llegada ?? null),
        texto: `Llegada a ${primero.f.hasta ?? '?'}`,
        porTarifa: cajas ? alLlegar : [],
        momento: 'llegada',
      })
    }
  }

  // Hoteles: la entrada a cada ciudad. El hotel de cada versión NO va aquí: ya está en «Dónde
  // duermen» (pedido de Mauricio del 2026-10-14, al ver el día a día con los hoteles repetidos).
  for (const c of p.capitulos) {
    if (!c.desde) continue
    poner(c.desde, {
      tipo: 'hotel',
      hora: null,
      texto: c.ciudad ? `Llegada al hotel en ${c.ciudad}` : 'Llegada al hotel',
      porTarifa: [],
    })
  }

  // Traslados, trenes y actividades con fecha.
  const yaEnServicios = new Set<string>()
  // Hasta dónde llega el viaje antes de los servicios: una actividad de varios días no lo alarga.
  const ultimoDia = [...eventos.keys(), ...p.capitulos.map((c) => c.hasta).filter((f): f is string => f !== null)].sort().pop() ?? null
  for (const s of p.servicios) {
    if (s.itemId && fechaIso(s.fecha, p.inicio)) yaEnServicios.add(s.itemId)
    // N7-4 / V7-3 · el carro de alquiler: el día que se recoge y el día que se devuelve.
    if (s.alquiler) {
      const vehiculo = s.alquiler.vehiculo ? ` · ${s.alquiler.vehiculo}` : ''
      poner(fechaIso(s.fecha, p.inicio), { tipo: 'carro', hora: s.hora ?? null, texto: `Recogida del carro de alquiler${s.alquiler.recogida ? ` en ${s.alquiler.recogida}` : ''}${vehiculo}`, porTarifa: [] })
      if (s.alquiler.fechaDevolucion) {
        poner(s.alquiler.fechaDevolucion, { tipo: 'carro', hora: null, texto: `Devolución del carro${s.alquiler.devolucion ? ` en ${s.alquiler.devolucion}` : ''}`, porTarifa: [] })
      }
      continue
    }
    const tipo = s.tipo === 'actividad' ? 'actividad' : esTren(s.descripcion) ? 'tren' : 'traslado'
    const fecha = fechaIso(s.fecha, p.inicio)
    poner(fecha, { tipo, hora: s.hora ?? null, texto: s.descripcion, porTarifa: [] })
    // V7-5 (QA del 2026-10-29) · una actividad de varios días (Disney, 4 días) ocupa los días que
    // siguen: antes solo salía el primero y los demás decían «Día libre», aunque estaban pagados.
    const dias = tipo === 'actividad' && fecha ? diasDeLaActividad(s.descripcion) : null
    if (dias && fecha) {
      const nombre = s.descripcion.split(' · ')[0].trim()
      for (let k = 2; k <= dias; k++) {
        const otro = sumarDias(fecha, k - 1)
        if (ultimoDia && otro >= ultimoDia) break
        poner(otro, { tipo: 'actividad', hora: null, texto: `${nombre} (día ${k} de ${dias})`, porTarifa: [] })
      }
    }
  }

  // Los días que alguien asignó (sin tarifas: así llegan hoy en `props.dias`). La actividad o el
  // traslado con día asignado YA salió arriba como servicio (el día manda sobre la fecha leída,
  // `servicios-del-documento.ts`): pintarlo otra vez daba la actividad dos veces y «2 visitas» en
  // la portada con un solo servicio (brief del 2026-10-22, punto 1). Se reconoce por la línea.
  for (const d of p.props.dias ?? []) {
    const fecha = iso(fechaDelDia(p.props.viaje?.inicioDeLosDias ?? p.inicio, d.dia))
    for (const it of d.items) {
      if (it.id && yaEnServicios.has(it.id)) continue
      poner(fecha, { tipo: 'actividad', hora: null, texto: it.nombre, porTarifa: [] })
    }
  }

  const fechas = [...eventos.keys(), ...p.capitulos.map((c) => c.hasta).filter((f): f is string => f !== null)]
  const fin = fechas.reduce((a, f) => (diaNumero(f) > diaNumero(a) ? f : a), inicio)
  // Tope: una fecha mal leída (el año de otro viaje) no puede pintar meses de días vacíos.
  const total = Math.min(diaNumero(fin) - diaNumero(inicio) + 1, MAX_DIAS)
  const orden: Record<EventoDoc['tipo'], number> = { vuelo: 1, traslado: 1, tren: 1, carro: 2, hotel: 3, actividad: 4 }
  // El traslado que sale del hotel (al aeropuerto, a la estación) va antes que el vuelo o el tren
  // de ese día; el que llega al hotel, después. La COT-2026-0026 real ponía «Estación Barcelona
  // Sants → hotel» antes del AVE que los llevaba a Barcelona.
  const rango = (e: EventoDoc) => {
    if (e.tipo !== 'traslado') return orden[e.tipo]
    if (llegaAlHotel(e.texto)) return 2
    return vaAlAeropuerto(e.texto) || saleDelHotel(e.texto) ? 0 : orden.traslado
  }
  const salida: DiaDoc[] = []
  for (let n = 0; n < total; n++) {
    const fecha = sumarDias(inicio, n)
    const lista = (eventos.get(fecha) ?? []).slice().sort((a, b) => {
      if (rango(a) !== rango(b)) return rango(a) - rango(b)
      if (a.hora && b.hora && a.hora !== b.hora) return a.hora.localeCompare(b.hora)
      return 0
    })
    const ciudad = p.capitulos.find((c) => c.desde && c.hasta && fecha >= c.desde && fecha < c.hasta)?.ciudad ?? null
    salida.push({ fecha, numero: n + 1, ciudad, eventos: lista, libre: lista.length === 0, opcionales: [], titulo: null, sugerencia: null })
  }
  return salida
}

/** «Hotel - aeropuerto Schiphol · Privado»: el destino del trayecto es un aeropuerto. */
function vaAlAeropuerto(descripcion: string): boolean {
  const extremos = descripcion.split(' · ')[0].split(/\s+(?:-|→|–)\s+/)
  return extremos.length === 2 && /\b(aeropuerto|airport|aeroporto|a[ée]roport)\b/i.test(extremos[1])
}

/** Los dos extremos de un trayecto («Hotel - estación · Privado» → [«Hotel», «estación»]). */
function extremosDe(descripcion: string): string[] {
  return descripcion.split(' · ')[0].split(/\s+(?:-|→|–)\s+/)
}

/** «Barcelona Sants - hotel»: llega al hotel desde otro sitio. */
function llegaAlHotel(descripcion: string): boolean {
  const e = extremosDe(descripcion)
  return e.length === 2 && /\bhotel\b/i.test(e[1]) && !/\bhotel\b/i.test(e[0])
}

/** «Hotel - estación Puerta de Atocha»: sale del hotel hacia otro sitio. */
function saleDelHotel(descripcion: string): boolean {
  const e = extremosDe(descripcion)
  return e.length === 2 && /\bhotel\b/i.test(e[0]) && !/\bhotel\b/i.test(e[1])
}

/** Sale y llega con hora, y llega «antes» de salir: llega al día siguiente (vuelo de noche). */
function llegaAlDiaSiguiente(f: { salida: string | null; llegada: string | null }): boolean {
  const hhmm = /^\d{1,2}:\d{2}$/
  if (!f.salida || !f.llegada || !hhmm.test(f.salida.trim()) || !hhmm.test(f.llegada.trim())) return false
  const min = (h: string) => Number(h.split(':')[0]) * 60 + Number(h.split(':')[1])
  return min(f.llegada.trim()) < min(f.salida.trim())
}

/** Minúsculas y sin tildes, para comparar nombres de ciudad. */
function llano(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/**
 * La parada del viaje donde se hace un plan opcional: la ciudad leída si es una de las paradas
 * (con el nombre de la parada), si no la leída tal cual; sin lectura, la parada que el nombre o
 * la descripción del plan nombran («Palacio Real de Madrid»). Si nombra varias, ninguna.
 */
export function ciudadDelOpcional(leida: string | null, texto: string, paradas: string[]): string | null {
  if (leida && leida.trim()) {
    const k = claveDeCiudad(leida)
    return paradas.find((p) => claveDeCiudad(p) === k) ?? leida.trim()
  }
  const t = llano(texto)
  const nombradas = paradas.filter((p) => {
    const k = llano(p).trim()
    return k.length > 0 && new RegExp(`(^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(t)
  })
  return nombradas.length === 1 ? nombradas[0] : null
}

/**
 * Pone cada plan opcional en un día: el de su fecha si la tiene; si no, en los días LIBRES de su
 * ciudad, repartidos en orden (con dos días libres y tres planes: dos y uno). Una ciudad sin
 * días libres los propone en sus días de solo visitas. Lo que no tiene ciudad queda en la
 * sección del final.
 */
function repartirOpcionales(dias: DiaDoc[], opcionales: OpcionalDoc[]): void {
  const porCiudad = new Map<string, string[]>()
  for (const o of opcionales) {
    const dia = o.fecha ? dias.find((d) => d.fecha === o.fecha) : undefined
    if (dia) {
      dia.opcionales.push(o.nombre)
      continue
    }
    if (!o.ciudad) continue
    const k = claveDeCiudad(o.ciudad)
    porCiudad.set(k, [...(porCiudad.get(k) ?? []), o.nombre])
  }
  for (const [k, nombres] of porCiudad) {
    const deLaCiudad = dias.filter((d) => d.ciudad && claveDeCiudad(d.ciudad) === k && d.opcionales.length === 0)
    const libres = deLaCiudad.filter((d) => d.libre)
    const destino = libres.length > 0 ? libres : deLaCiudad.filter((d) => d.eventos.length > 0 && d.eventos.every((e) => e.tipo === 'actividad'))
    if (destino.length === 0) continue
    destino.forEach((d, j) => {
      const desde = Math.round((j * nombres.length) / destino.length)
      const hasta = Math.round(((j + 1) * nombres.length) / destino.length)
      d.opcionales.push(...nombres.slice(desde, hasta))
    })
  }
}
