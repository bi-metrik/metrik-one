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
import type { HotelPDF, ServicioPDF, VueloPDF } from '@/lib/cotizaciones/detalle-viaje'
import {
  capitulosDelViaje,
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
import { textoIvaIncluido } from '@/lib/fiscal/iva-cotizacion'
import { asiPuedesPagar, type AsiPuedesPagar } from '@/lib/viaje/asi-puedes-pagar'
import type { AnticipoPropuesta } from './anticipo'

// ── Entrada ───────────────────────────────────────────────────────────────────

/** Un traslado, tren o actividad del viaje. `tarifas` como en `VueloPDF.tarifas`. */
export interface ServicioDelDocumento extends ServicioPDF {
  /** «09:30» si la lectura la trae. */
  hora?: string | null
  tarifas?: number[]
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
}

// ── Salida ────────────────────────────────────────────────────────────────────

export type ClaveTarifa = 'economica' | 'recomendada' | 'superior' | 'otra'

/** Una línea de dinero, como la imprime «Inversión» hoy (`lineasImpresas` de la plantilla). */
export interface LineaDoc {
  nombre: string
  cantidad: number
  unidad: string | null
  total: number
  adicionales: string[]
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
  tipo: 'vuelo' | 'hotel' | 'tren' | 'traslado' | 'actividad'
  hora: string | null
  texto: string
  /** Con varias tarifas, lo que cambia en cada una (un vuelo, un hotel). Vacío = igual en todas. */
  porTarifa: { tarifas: number[]; texto: string }[]
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
}

export interface OpcionHotelDoc {
  tarifas: number[]
  hotel: string
  estrellas: number | null
  habitacion: string | null
  regimen: string | null
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
  tipo: 'tren' | 'traslado'
  fecha: string | null
  hora: string | null
  descripcion: string
  tarifas: number[]
}

export interface OpcionalDoc {
  nombre: string
  descripcion: string | null
  /** Lo que imprime la tarjeta de hoy: `precio_venta × cantidad`. 0 = sin precio. */
  valor: number
  unidad: string | null
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
    destino: string | null
    fechas: string | null
    duracion: string | null
    foto: FotoPDF | null
    fotosCiudades: FotoPDF[]
    /** Decisión 1: nombres de pila que se pueden imprimir (los de menores solo con autorización). */
    nombres: string[]
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
  /** Lo que no cuadra y alguien tiene que mirar antes de imprimir. */
  avisos: string[]
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
  if (k.includes('recomend')) return 'recomendada'
  if (k.includes('premium') || k.includes('superior')) return 'superior'
  return 'otra'
}

const ORDEN_CLAVE: Record<ClaveTarifa, number> = { economica: 0, recomendada: 1, superior: 2, otra: 3 }

/**
 * Lo mismo que `lineasImpresas` de `cotizacion-trappvel-pdf.tsx`: el total de una línea es
 * `round(precio × cantidad × (1 − descuento))` más sus adicionales. Repetida aquí para no
 * cargar @react-pdf en un módulo puro; la prueba de paridad la vigila.
 */
export function lineasDelDocumento(
  items: { nombre: string; precio_venta: number; descuento_porcentaje: number; cantidad: number; unidad?: string | null; adicionales?: string[]; valorAdicionales?: number }[],
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

function textoDeVuelo(v: VueloPDF, fila: { numero: string | null; salida: string | null; llegada: string | null; escala: string | null }): string {
  const horas = fila.salida || fila.llegada ? `${fila.salida ?? '?'} → ${fila.llegada ?? '?'}` : null
  return [[v.aerolinea ?? v.linea, fila.numero].filter(Boolean).join(' '), fila.escala, horas].filter(Boolean).join(' · ')
}

function cargoDelHotel(props: CotizacionPDFProps, h: HotelPDF): string | null {
  const cargos = props.viaje?.cargosEnDestino ?? []
  const delHotel = cargos.find((c) => c.hotel && h.hotel && c.hotel === h.hotel)
    ?? cargos.find((c) => !c.hotel && claveDeCiudad(c.ciudad) !== '' && claveDeCiudad(c.ciudad) === claveDeCiudad(h.ciudad))
  return delHotel ? `${delHotel.concepto}: ${delHotel.monto}` : null
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

// ── El modelo ─────────────────────────────────────────────────────────────────

export function modeloDePropuesta({
  props,
  servicios = [],
  viajeros = [],
  menoresAutorizados = false,
  anticipo = null,
  asesora = null,
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
  const hotelesTodos = v?.hoteles ?? []
  const capitulos = capitulosDelViaje(hotelesTodos, principal, v?.destino ?? null).filter((c) => c.hotel || c.alternativas.length > 0)
  const opcion = (h: HotelPDF): OpcionHotelDoc => ({
    tarifas: porTarifas ? [...(h.tarifas ?? [])] : [],
    hotel: h.hotel ?? h.linea,
    estrellas: h.estrellas ?? null,
    habitacion: h.habitacion,
    regimen: h.regimen,
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

  // ── Trenes y traslados ──
  const filasTrayecto: TrayectoDoc[] = servicios
    .filter((s) => s.tipo === 'traslado')
    .map((s) => ({
      tipo: esTren(s.descripcion) ? ('tren' as const) : ('traslado' as const),
      fecha: fechaIso(s.fecha, inicio) ?? s.fecha,
      hora: s.hora ?? null,
      descripcion: s.descripcion,
      tarifas: porTarifas ? [...(s.tarifas ?? [])] : [],
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
    const suyos = hotelesTodos.filter((h) => deLaTarifa(h, t.indice))
    t.hoteles = suyos.map((h) => ({ nombre: h.hotel ?? h.linea, estrellas: h.estrellas ?? null, ciudad: h.ciudad }))
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

  const opcionales: OpcionalDoc[] = (props.sugeridos ?? []).map((o) => ({
    nombre: o.nombre,
    descripcion: sinCancelacion(o.descripcion),
    valor: Math.round((o.precio_venta || 0) * (o.cantidad ?? 1)),
    unidad: o.unidad ?? null,
  }))

  const noIncluye = [
    ...new Set((v?.cargosEnDestino ?? []).map((c) => `${c.concepto}${c.ciudad ? ` (${c.ciudad})` : ''}, que se pagan en destino`)),
    ...(opcionales.length > 0 ? ['Las actividades opcionales listadas al final de este documento'] : []),
  ]

  // ── Día a día ──
  const dias = diaADia({ props, inicio, vuelos: v?.vuelos ?? [], hoteles: hotelesTodos, capitulos: hoteles, servicios, porTarifas, principal })

  // ── Portada y lo formal ──
  const titulo = (v?.titular?.trim() || props.negocio?.nombre || props.cotizacion.descripcion || 'Propuesta de viaje').trim()
  const pie = v?.pie ?? [props.vendedor.nombre, props.vendedor.email, props.vendedor.telefono, props.vendedor.ciudad].filter(Boolean).join(' · ')
  const firma = v?.firma ?? (props.emisor ? { nombre: props.emisor.nombre, cargo: props.emisor.cargo, contacto: null } : null)

  return {
    portada: {
      consecutivo: props.cotizacion.consecutivo,
      titulo,
      intro: v?.intro?.trim() || null,
      viajeros: v?.viajeros ?? null,
      destino: v?.destino ?? null,
      fechas: v?.fechas ?? null,
      duracion: v?.duracion ?? null,
      foto: v?.foto ?? null,
      fotosCiudades: v?.fotosCiudades ?? [],
      nombres: nombresParaLaPropuesta(viajeros, menoresAutorizados),
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
      incluye: v?.incluye ?? [],
      noIncluye,
      planes,
      anticipo: anticipo && anticipo.monto > 0 ? anticipo : null,
    },
    formal: {
      terminos: props.cotizacion.terminos_condiciones ?? null,
      pie,
      firma,
      creditos: creditosDeFotos([v?.foto, ...(v?.fotosCiudades ?? [])]),
      antesDeViajar: v?.antesDeViajar ?? [],
      asesora,
    },
    avisos,
  }
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

  // Vuelos: uno por fecha y sentido; con tarifas, lo que cambia va por tarifa.
  const tramos = p.vuelos.flatMap((vu) =>
    filasDelVuelo(vu).map((f, k) => ({ vu, f, sentido: k, fecha: fechaIso(f.fecha, p.inicio), tarifas: p.porTarifas ? vu.tarifas ?? [] : [] })),
  )
  const llaves = [...new Set(tramos.filter((t) => t.fecha).map((t) => `${t.fecha}|${t.sentido}`))]
  for (const llave of llaves) {
    const grupo = tramos.filter((t) => `${t.fecha}|${t.sentido}` === llave)
    const primero = grupo.find((t) => esDeLaPrincipal({ tarifas: t.tarifas }, p.principal)) ?? grupo[0]
    const porTarifa = p.porTarifas ? agruparPorTexto(grupo, (t) => textoDeVuelo(t.vu, t.f)) : []
    poner(primero.fecha, {
      tipo: 'vuelo',
      hora: primero.f.salida,
      texto: `${primero.f.desde ?? '?'} → ${primero.f.hasta ?? '?'}`,
      porTarifa: porTarifa.length > 1 ? porTarifa : [],
    })
  }

  // Hoteles: la entrada a cada ciudad, con el hotel de cada tarifa.
  for (const c of p.capitulos) {
    if (!c.desde) continue
    const porTarifa = p.porTarifas ? agruparPorTexto(c.opciones, (o) => o.hotel) : []
    poner(c.desde, {
      tipo: 'hotel',
      hora: null,
      texto: c.ciudad ? `Llegada al hotel en ${c.ciudad}` : 'Llegada al hotel',
      porTarifa: porTarifa.length > 1 ? porTarifa : [],
    })
  }

  // Traslados, trenes y actividades con fecha.
  for (const s of p.servicios) {
    const tipo = s.tipo === 'actividad' ? 'actividad' : esTren(s.descripcion) ? 'tren' : 'traslado'
    poner(fechaIso(s.fecha, p.inicio), { tipo, hora: s.hora ?? null, texto: s.descripcion, porTarifa: [] })
  }

  // Los días que alguien asignó (sin tarifas: así llegan hoy en `props.dias`).
  for (const d of p.props.dias ?? []) {
    const fecha = iso(fechaDelDia(p.inicio, d.dia))
    for (const it of d.items) poner(fecha, { tipo: 'actividad', hora: null, texto: it.nombre, porTarifa: [] })
  }

  const fechas = [...eventos.keys(), ...p.capitulos.map((c) => c.hasta).filter((f): f is string => f !== null)]
  const fin = fechas.reduce((a, f) => (diaNumero(f) > diaNumero(a) ? f : a), inicio)
  // Tope: una fecha mal leída (el año de otro viaje) no puede pintar meses de días vacíos.
  const total = Math.min(diaNumero(fin) - diaNumero(inicio) + 1, MAX_DIAS)
  const orden: Record<EventoDoc['tipo'], number> = { vuelo: 0, traslado: 1, tren: 1, hotel: 2, actividad: 3 }
  const salida: DiaDoc[] = []
  for (let n = 0; n < total; n++) {
    const fecha = sumarDias(inicio, n)
    const lista = (eventos.get(fecha) ?? []).slice().sort((a, b) => {
      if (a.hora && b.hora && a.hora !== b.hora) return a.hora.localeCompare(b.hora)
      return orden[a.tipo] - orden[b.tipo]
    })
    const ciudad = p.capitulos.find((c) => c.desde && c.hasta && fecha >= c.desde && fecha < c.hasta)?.ciudad ?? null
    salida.push({ fecha, numero: n + 1, ciudad, eventos: lista, libre: lista.length === 0 })
  }
  return salida
}
