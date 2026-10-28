/**
 * La propuesta de viaje de Trappvel en HTML, para imprimirla con Chromium (motor `html`).
 *
 * Desde el 2026-10-27 (decisión de Mauricio) copia el formato que mandó Edgar Alarcón el
 * 2026-10-14 (`proyectos/trappvel/clarity/docs/entrada/formato-edgar/`), con una hoja de precios
 * al final en el mismo sistema visual:
 *
 *   portada (encabezado, collage, aviso, 4 tarjetas, viajeros) · vuelos y tren · hospedaje ·
 *   traslados · itinerario día a día (línea de tiempo) · planes opcionales · información útil ·
 *   HOJA DE PRECIOS (elijan su versión + apartar · cuánto pagan y cuándo · qué incluye y
 *   términos, en tarjetas · firma)
 *
 * Lo que el formato de Edgar tiene y una cotización NO (localizadores, «confirmado», e-tickets,
 * «Realizado», chips de reservas, clima, contactos de proveedores) no se imprime: aquí solo va lo
 * que existe en el modelo. Una fila sin dato no sale.
 *
 * PURO: recibe el modelo (`modeloDePropuesta`) y los recursos ya resueltos (fotos reducidas y
 * logo como data URL) y devuelve el HTML. No lee disco ni red; se prueba con vitest.
 *
 * Decisiones de Mauricio del 2026-10-14 que siguen: sin políticas de cancelación de hoteles; sin
 * anticipo fijo (solo el que la asesora asignó, y el botón abre su WhatsApp); los nombres que
 * dice el documento son los que el modelo deja pasar (`portada.nombres`).
 */
import type {
  CiudadDoc,
  ClaveTarifa,
  DiaDoc,
  EventoDoc,
  FilaVueloDoc,
  ModeloPropuesta,
  OpcionalDoc,
  TarifaDoc,
  TrayectoDoc,
} from '@/lib/cotizaciones/propuesta/modelo-documento'
import { notaDeFila } from '@/lib/viaje/asi-puedes-pagar'
import { textoDelDestinatario } from '@/lib/cotizaciones/propuesta/destinatario'
import { CSS_PROPUESTA, ICONOS_PROPUESTA } from './estilos'
import { insigniasDeVuelo, nombreDeAerolinea, pastillaAerolinea, pastillasDeVuelo } from './aerolinea'

export interface FotoResuelta {
  /** data URL ya reducida. */
  src: string
  /** Encuadre: fracciones del ancho y del alto. */
  foco?: { x: number; y: number } | null
}

export interface RecursosPropuesta {
  /** La foto ya reducida para una URL o ruta del modelo; `null` si no se pudo. */
  foto: (url: string | null | undefined) => FotoResuelta | null
  /** Foto del banco de ciudades para una parada. `null` = la ciudad no tiene foto. */
  fotoDeCiudad: (ciudad: string | null) => FotoResuelta | null
  /** Foto del catálogo (`fotos_catalogo`) para un plan opcional, por su nombre. Sin ella, degradado. */
  fotoDeOpcional?: (nombre: string) => FotoResuelta | null
  /** Foto del catálogo para una actividad incluida, por su nombre corto. Va al lado de su día. */
  fotoDeActividad?: (nombre: string) => FotoResuelta | null
  /**
   * Las fotos extra (biblioteca, hasta dos) de un hotel o de un plan. Van en el MISMO recuadro de
   * la principal (`imagenDeTarjeta`): la tarjeta no crece, así que no agregan hojas ni huecos.
   */
  extrasDeHotel?: (ciudad: string | null, hotel: string) => FotoResuelta[]
  extrasDeOpcional?: (nombre: string) => FotoResuelta[]
  /** Logo del workspace como data URL; sin logo va el nombre escrito. */
  logo: string | null
  marca: string
  /** Créditos de fotos que el documento usó además de las del modelo (las de ciudad por parada). */
  creditosExtra?: string[]
}

// ── Formato ───────────────────────────────────────────────────────────────────

export function esc(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** «$ 44.869.124», sin depender del ICU del servidor. */
export function pesos(v: number): string {
  const n = Math.round(Math.abs(v))
  const s = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${v < 0 ? '−' : ''}$ ${s}`
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function fecha(iso: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null
}

/** «jue 10» */
function diaCorto(iso: string | null | undefined): string | null {
  const d = fecha(iso)
  return d ? `${DIAS[d.getUTCDay()]} ${d.getUTCDate()}` : null
}

/** «Jue 10 dic», como debajo de la hora en las tarjetas de vuelo de Edgar. */
function diaConMes(iso: string | null | undefined): string | null {
  const d = fecha(iso)
  if (!d) return null
  const dia = DIAS[d.getUTCDay()]
  return `${dia[0].toUpperCase()}${dia.slice(1)} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`
}

/** «10 dic» */
function diaMes(iso: string | null | undefined): string | null {
  const d = fecha(iso)
  return d ? `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}` : null
}

/** «jueves 10 de diciembre» */
function diaLargo(iso: string | null | undefined): string | null {
  const d = fecha(iso)
  return d ? `${DIAS_LARGOS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES_LARGOS[d.getUTCMonth()]}` : null
}

/** «11 – 14 dic» */
function rangoCorto(desde: string | null, hasta: string | null): string | null {
  const a = fecha(desde)
  const b = fecha(hasta)
  if (!a || !b) return null
  const mesA = a.getUTCMonth() === b.getUTCMonth() ? '' : ` ${MESES[a.getUTCMonth()]}`
  return `${a.getUTCDate()}${mesA} – ${b.getUTCDate()} ${MESES[b.getUTCMonth()]}`
}

const LETRA: Record<ClaveTarifa, string> = { economica: 'E', recomendada: 'R', superior: 'P', otra: 'N' }

function etiqueta(t: TarifaDoc): string {
  return `<span class="tag t${LETRA[t.clave]}">${esc(t.nombre)}</span>`
}

function estrellas(n: number | null | undefined): string {
  return n && n > 0 ? `<span class="stars">${'★'.repeat(Math.min(5, n))}</span>` : ''
}

function icono(id: string): string {
  return `<svg class="ic" viewBox="0 0 24 24"><use href="#${id}"/></svg>`
}

function fondo(f: FotoResuelta | null, extra = ''): string {
  if (!f) return extra ? ` style="${extra}"` : ''
  const pos = f.foco ? `${Math.round(f.foco.x * 100)}% ${Math.round(f.foco.y * 100)}%` : 'center'
  return ` style="background-image:url(${f.src});background-position:${pos};${extra}"`
}

const llano = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const minuscula = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)
const mayuscula = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** «A», «A o B», «A, B o C». */
function oLista(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} o ${xs[xs.length - 1]}`
}

/** «A», «A y B», «A, B y C». */
function yLista(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`
}

// ── Fotos extra en el mismo recuadro ─────────────────────────────────────────

/** Columnas de la cuadrícula de planes (`.opcs` en estilos.ts). */
export const COLUMNAS_OPCIONALES = 4
/** Columnas del hospedaje (`.hg` en estilos.ts): dos, como el formato de Edgar. */
export const COLUMNAS_HOTELES = 2
/** Ancho útil de la hoja (carta: 215,9 mm menos 9 mm por lado, `@page` de estilos.ts). */
const ANCHO_UTIL_MM = 197.9
/** Separación de las tarjetas por cuadrícula (`gap` de `.hg` y `.opcs`). */
const SEPARACION_MM = { hotel: 3.7, opcional: 3 } as const
/** Alto del recuadro de foto (`.hc .img` y `.oc .img` de estilos.ts). */
const ALTO_FOTO_MM = { hotel: 25, opcional: 25 } as const
/** Una foto extra más chica que esto no se reconoce: mejor no ponerla. */
const EXTRA_MINIMA_MM = { ancho: 14, alto: 12 } as const
const ESPACIO_MOSAICO_MM = 0.6

/**
 * Cuántas fotos extra (0 a 2) caben en el recuadro de una tarjeta SIN agrandarla: la principal
 * ocupa dos tercios y las extras, apiladas, el tercio de la derecha. Las extras nunca cambian el
 * alto de la tarjeta (Edgar se quejó de los blancos y del exceso de fotos: la regla de saltos
 * manda), así que no pueden agregar hojas; aquí solo se decide si se verían.
 */
export function extrasQueCaben(seccion: 'hotel' | 'opcional', columnas: number): number {
  const cols = Math.max(1, Math.floor(columnas))
  const tarjeta = (ANCHO_UTIL_MM - SEPARACION_MM[seccion] * (cols - 1)) / cols
  const ancho = (tarjeta - ESPACIO_MOSAICO_MM) / 3
  if (ancho < EXTRA_MINIMA_MM.ancho) return 0
  for (const n of [2, 1]) {
    const alto = (ALTO_FOTO_MM[seccion] - ESPACIO_MOSAICO_MM * (n - 1)) / n
    if (alto >= EXTRA_MINIMA_MM.alto) return n
  }
  return 0
}

/**
 * El recuadro de foto de una tarjeta: la principal sola o, con extras, el mosaico (principal a la
 * izquierda, extras apiladas a la derecha) en el MISMO alto. `dentro` = etiquetas o rótulo.
 */
function imagenDeTarjeta(principal: FotoResuelta | null, extras: FotoResuelta[], dentro: string): string {
  if (!principal) return `<div class="img sinfoto">${dentro}</div>`
  if (extras.length === 0) return `<div class="img"${fondo(principal)}>${dentro}</div>`
  return `<div class="img mosaico n${extras.length}"><div class="m0"${fondo(principal)}></div>${extras.map((e) => `<div class="mx"${fondo(e)}></div>`).join('')}${dentro}</div>`
}

/** «Madrid Atocha - Barcelona Sants · AVE 03071 Renfe, Estándar» → «AVE 03071 Renfe». */
function etiquetaDeTren(descripcion: string): string {
  const servicio = descripcion.split(' · ')[1]
  return (servicio ?? descripcion).split(',')[0].trim()
}

/** El texto corto de un servicio: «Sagrada Familia · 1 h 30 · Barcelona» → «Sagrada Familia». */
function cabeza(texto: string): string {
  return texto.split(' · ')[0].trim()
}

function tarifaPorIndice(m: ModeloPropuesta): Map<number, TarifaDoc> {
  return new Map(m.tarifas.map((t) => [t.indice, t]))
}

function etiquetasDe(indices: number[], porIndice: Map<number, TarifaDoc>): string {
  return indices
    .map((i) => porIndice.get(i))
    .filter((t): t is TarifaDoc => t !== undefined)
    .map(etiqueta)
    .join(' ')
}

/** ¿Estas tarifas son todas las del documento? Entonces la etiqueta sobra. */
function enTodas(indices: number[], m: ModeloPropuesta): boolean {
  return m.tarifas.every((t) => indices.includes(t.indice))
}

/** «Aeropuerto Barajas T4 - hotel» → «Aeropuerto Barajas T4 → hotel». */
function flecha(trayecto: string): string {
  // «Hotel» va en minúscula en medio de la frase: «Traslado hotel → estación».
  return trayecto.replace(/\s+(?:-|–)\s+/, ' → ').replace(/^Hotel\b/, 'hotel')
}

/** «Bogotá BOG» → «Bogotá». */
const ciudadSola = (s: string | null) => (s ?? '').replace(/\s*\(?\b[A-Z]{3}\b\)?\s*$/, '').trim() || null

// ── Secciones ─────────────────────────────────────────────────────────────────

/** Parte una lista de tarjetas en filas de `n`. */
function enFilas<T>(xs: T[], n: number): T[][] {
  const filas: T[][] = []
  for (let i = 0; i < xs.length; i += n) filas.push(xs.slice(i, i + n))
  return filas
}

function encabezadoDeSeccion(icon: string, titulo: string, sub: string | null): string {
  return `<div class="sh"><div class="sq">${icono(icon)}</div><div><h2>${esc(titulo)}</h2>${sub ? `<div class="st">${esc(sub)}</div>` : ''}</div></div>`
}

function resumenIncluye(m: ModeloPropuesta): string | null {
  const partes: string[] = []
  if (m.vuelos.length > 0) partes.push('vuelos')
  const noches = m.ruta.paradas.reduce((a, p) => a + (p.noches ?? 0), 0)
  if (noches > 0) partes.push(`${noches} ${noches === 1 ? 'noche' : 'noches'}`)
  const trenes = m.trayectos.filas.filter((t) => t.tipo === 'tren').length
  if (trenes > 0) partes.push(`${trenes} ${trenes === 1 ? 'tren' : 'trenes'}`)
  const traslados = m.trayectos.filas.filter((t) => t.tipo === 'traslado').length
  if (traslados > 0) partes.push(`${traslados} ${traslados === 1 ? 'traslado' : 'traslados'}`)
  const visitas = m.dias.flatMap((d) => d.eventos).filter((e) => e.tipo === 'actividad').length
  if (visitas > 0) partes.push(`${visitas} ${visitas === 1 ? 'visita' : 'visitas'}`)
  if (partes.length === 0) return null
  return mayuscula(yLista(partes))
}

/** El hotel que el documento nombra en una ciudad: el de la tarifa recomendada, o el primero. */
function opcionDeReferencia(c: CiudadDoc, m: ModeloPropuesta) {
  const principal = m.tarifas.find((t) => t.esPrincipal)?.indice
  return (principal !== undefined ? c.opciones.find((x) => x.tarifas.includes(principal)) : undefined) ?? c.opciones[0]
}

/**
 * Las fotos del collage de la portada (hasta 4, como el de Edgar): la de la portada, las de cada
 * ciudad y, si faltan, las de los hoteles de la versión recomendada. Sin repetir; sin ninguna,
 * la banda queda con el degradado oscuro.
 */
export function fotosDePortada(m: ModeloPropuesta, r: RecursosPropuesta): FotoResuelta[] {
  const fotos: FotoResuelta[] = []
  const vistas = new Set<string>()
  const sumar = (f: FotoResuelta | null | undefined) => {
    if (!f || vistas.has(f.src) || fotos.length >= 4) return
    vistas.add(f.src)
    fotos.push(f)
  }
  sumar(r.foto(m.portada.foto?.url))
  for (const p of m.ruta.paradas) sumar(r.fotoDeCiudad(p.ciudad))
  for (const c of m.hoteles) {
    const o = opcionDeReferencia(c, m)
    const principal = o ? r.foto(o.foto?.url) : null
    sumar(principal)
    if (o && principal) for (const x of r.extrasDeHotel?.(c.ciudad, o.hotel) ?? []) sumar(x)
  }
  for (const c of m.hoteles) for (const o of c.opciones) sumar(r.foto(o.foto?.url))
  return fotos
}

function marcaDe(r: RecursosPropuesta, alto?: string): string {
  return r.logo
    ? `<img src="${r.logo}" alt="${esc(r.marca)}"${alto ? ` style="height:${alto}"` : ''}>`
    : `<b class="pop">${esc(r.marca)}</b>`
}

function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  const letras = partes.length > 1 ? partes[0][0] + partes[partes.length - 1][0] : (partes[0] ?? '').slice(0, 2)
  return letras.toUpperCase()
}

function portada(m: ModeloPropuesta, r: RecursosPropuesta): string {
  const p = m.portada
  const quienes = p.nombres.length > 0 ? yLista(p.nombres) : null
  const sub = [p.duracion, quienes].filter(Boolean).join(' · ')
  const destinos = m.ruta.paradas.length > 0
    ? m.ruta.paradas.map((x) => `${x.ciudad}${x.noches ? ` (${x.noches}N)` : ''}`).join(' · ')
    : p.destino
  // A quién va dirigida (2026-10-27): el contacto del negocio, como «Titular de la reserva» en el
  // formato de Edgar. Sin contacto, la cuarta tarjeta vuelve a «Incluye» y el aviso, a los pasajeros.
  const para = p.destinatario ? textoDelDestinatario(p.destinatario) : null
  const datos = [
    ['Duración', p.duracion],
    ['Destinos', destinos],
    ['Viajeros', p.viajeros],
    para ? ['Cotizada para', para] : ['Incluye', resumenIncluye(m)],
  ].filter((d): d is [string, string] => Boolean(d[1]))
  const fotos = fotosDePortada(m, r)
  const collage = fotos.length > 0
    ? `<div class="fotos" style="grid-template-columns:repeat(${fotos.length},1fr)">${fotos.map((f) => `<div${fondo(f)}></div>`).join('')}</div>`
    : ''
  // El aviso blanco va donde Edgar pone la caja verde de «servicios confirmados»: aquí, el texto
  // revisado del cliente. Sin texto, no hay aviso.
  const aviso = p.intro
    ? `<div class="aviso"><span class="ok">${icono('pin')}</span><b>${esc(para ? `Propuesta de viaje para ${para}` : quienes ? `Propuesta de viaje para ${quienes}` : 'Su propuesta de viaje')}</b><p>${esc(p.intro)}</p></div>`
    : ''
  const largo = p.titulo.length > 46
  return [
    `<div class="top"><span class="k"><i></i>Propuesta de viaje · ${esc(p.consecutivo)}</span>${marcaDe(r)}</div>`,
    `<div class="hero${aviso ? ' conaviso' : ''}">${collage}<div class="in">`,
    p.fechas ? `<div class="dt">${esc(p.fechas)}</div>` : '',
    `<h1${largo ? ' class="largo"' : ''}>${esc(p.titulo)}</h1>`,
    sub ? `<div class="sub">${esc(sub)}</div>` : '',
    `</div></div>`,
    aviso,
    datos.length > 0
      ? `<div class="facts" style="grid-template-columns:repeat(${datos.length},1fr)">${datos.map(([k, v]) => `<div><b>${esc(k)}</b>${esc(v)}</div>`).join('')}</div>`
      : '',
    p.nombres.length > 0
      ? `<div class="viajeros">${p.nombres.map((n) => `<div class="vj"><i>${esc(iniciales(n))}</i><b>${esc(n)}</b></div>`).join('')}</div>`
      : '',
  ].join('\n')
}

// ── Vuelos y tren ─────────────────────────────────────────────────────────────

/** «Madrid MAD» → «MAD»; sin código, la ciudad en mayúscula (como «SEVILLA» en el tren de Edgar). */
function codigoDe(lugar: string | null): string {
  const iata = /\b([A-Z]{3})\b\)?\s*$/.exec(lugar ?? '')?.[1]
  return iata ?? (ciudadSola(lugar) ?? lugar ?? '').toUpperCase()
}

function punto(lugar: string | null, hora: string | null, dia: string | null): string {
  const cod = codigoDe(lugar)
  return `<div class="pt"><div class="cod${cod.length > 7 ? ' largo' : ''}">${esc(cod)}</div>${hora ? `<div class="h">${esc(hora)}</div>` : ''}${dia ? `<div class="f">${esc(dia)}</div>` : ''}</div>`
}

interface VueloUnico {
  fila: FilaVueloDoc
  tarifas: number[]
}

/** Un vuelo una vez aunque lo lleven varias versiones: la etiqueta dice cuáles. */
function vuelosUnicos(m: ModeloPropuesta): VueloUnico[] {
  const porClave = new Map<string, VueloUnico>()
  for (const f of m.vuelos) {
    const k = [f.numero, f.aerolinea, f.fecha, f.desde, f.hasta, f.salida, f.llegada].join('|')
    const ya = porClave.get(k)
    const tarifas = f.tarifas.length > 0 ? f.tarifas : m.tarifas.map((t) => t.indice)
    if (ya) ya.tarifas = [...new Set([...ya.tarifas, ...tarifas])]
    else porClave.set(k, { fila: f, tarifas })
  }
  return [...porClave.values()].sort(
    (a, b) => (a.fila.fecha ?? '').localeCompare(b.fila.fecha ?? '') || (a.fila.salida ?? '').localeCompare(b.fila.salida ?? ''),
  )
}

function tarjetaDeVuelo(v: VueloUnico, i: number, m: ModeloPropuesta, porIndice: Map<number, TarifaDoc>): string {
  const f = v.fila
  const casa = llano(ciudadSola(m.ruta.origen) ?? '')
  const vuelve = casa !== '' && llano(ciudadSola(f.hasta) ?? '') === casa
  const linea = f.escala ?? (vuelve && i > 0 ? 'Vuelo de regreso' : null)
  // La fecha de llegada solo si es la misma de la salida: el modelo no trae la otra.
  const mismoDia = f.salida && f.llegada && f.llegada >= f.salida
  const tags = m.tarifas.length > 0 && !enTodas(v.tarifas, m) ? `<span class="tags">${etiquetasDe(v.tarifas, porIndice)}</span>` : ''
  const nota = [f.equipaje, ...f.adicionales].filter(Boolean).join(' · ')
  return `<div class="vc"><div class="fila">
    <div class="quien">${insigniasDeVuelo(f.aerolinea, f.numero)}${f.numero ? `<span class="num">${esc(f.numero)}</span>` : ''}${tags}</div>
    ${punto(f.desde, f.salida, diaConMes(f.fecha))}
    <div class="linea"><div class="l">${esc(linea ?? '')}</div><div class="b">${icono('plane')}</div></div>
    ${punto(f.hasta, f.llegada, mismoDia ? diaConMes(f.fecha) : null)}
    <div class="der">${f.tarifaAerolinea ? `<div class="k">Tarifa</div><div class="v">${esc(f.tarifaAerolinea)}</div>` : ''}</div>
  </div>${nota ? `<div class="nota">${esc(nota)}</div>` : ''}</div>`
}

function tarjetaDeTren(t: TrayectoDoc, m: ModeloPropuesta, porIndice: Map<number, TarifaDoc>): string {
  const [trayecto, ...resto] = t.descripcion.split(' · ')
  const [desde, hasta] = trayecto.split(/\s+(?:-|–|→)\s+/)
  const servicio = resto.join(' · ')
  const clase = servicio.includes(',') ? servicio.slice(servicio.indexOf(',') + 1).trim() : null
  const tags = m.tarifas.length > 0 && t.tarifas.length > 0 && !enTodas(t.tarifas, m) ? `<span class="tags">${etiquetasDe(t.tarifas, porIndice)}</span>` : ''
  return `<div class="vc"><div class="fila">
    <div class="quien"><span class="bd" style="background:#5a2a82;color:#fff">Tren</span><span class="num">${esc(etiquetaDeTren(t.descripcion))}</span>${tags}</div>
    ${punto(desde ?? trayecto, t.hora, diaConMes(t.fecha))}
    <div class="linea"><div class="l"></div><div class="b">${icono('train')}</div></div>
    ${punto(hasta ?? null, null, null)}
    <div class="der">${clase ? `<div class="k">Clase</div><div class="v">${esc(mayuscula(clase))}</div>` : ''}</div>
  </div></div>`
}

function vuelosYTren(m: ModeloPropuesta): string {
  const trenes = m.trayectos.filas.filter((t) => t.tipo === 'tren')
  if (m.vuelos.length === 0 && trenes.length === 0) return ''
  const porIndice = tarifaPorIndice(m)
  const vuelos = vuelosUnicos(m)
  const tarjetas = [
    ...vuelos.map((v, i) => ({ fecha: v.fila.fecha ?? '', html: tarjetaDeVuelo(v, i, m, porIndice) })),
    ...trenes.map((t) => ({ fecha: t.fecha ?? '', html: tarjetaDeTren(t, m, porIndice) })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha))
  const titulo = vuelos.length > 0 ? (trenes.length > 0 ? 'Vuelos y tren' : 'Vuelos') : 'Trenes'
  const iguales = m.tarifas.length > 1 && vuelos.every((v) => enTodas(v.tarifas, m))
  const sub = m.tarifas.length > 1 ? (iguales ? 'Iguales en todas las versiones.' : 'La etiqueta de color dice en qué versión va cada uno.') : null
  // El título va pegado a la primera tarjeta: nunca queda solo al pie de la hoja.
  const [primera, ...resto] = tarjetas.map((t) => t.html)
  return `<section class="sec">\n<div class="nobr">${encabezadoDeSeccion(titulo === 'Trenes' ? 'train' : 'plane', titulo, sub)}\n${primera}</div>\n${resto.join('\n')}\n</section>`
}

// ── Hospedaje ─────────────────────────────────────────────────────────────────

function hospedaje(m: ModeloPropuesta, r: RecursosPropuesta): string {
  if (m.hoteles.length === 0) return ''
  const porIndice = tarifaPorIndice(m)
  const regimenes = [...new Set(m.hoteles.flatMap((c) => c.opciones.map((o) => o.regimen)).filter(Boolean))]
  const sub = [
    regimenes.length === 1 ? `${regimenes[0]} en todos los hoteles.` : null,
    m.tarifas.length > 0 ? 'Un hotel por versión del viaje; la etiqueta de color dice cuál.' : null,
  ].filter(Boolean).join(' ')
  // Un hotel solo lleva la foto que subió la asesora (Mauricio, 2026-10-14); sin ella, el
  // degradado. Si ningún hotel tiene foto, las tarjetas van sin imagen.
  const conImagen = m.hoteles.some((c) => c.opciones.some((o) => r.foto(o.foto?.url)))
  const caben = extrasQueCaben('hotel', COLUMNAS_HOTELES)
  const tarjetas = m.hoteles.flatMap((c) =>
    c.opciones.map((o) => {
      const foto = r.foto(o.foto?.url)
      const tags = etiquetasDe(o.tarifas, porIndice)
      const tagsHtml = tags ? `<span class="tags">${tags}</span>` : ''
      const stars = o.estrellas && o.estrellas > 0 ? `<span class="stars">${'★'.repeat(Math.min(5, o.estrellas))}</span>` : ''
      // Decisión 2 (2026-10-14): la cancelación del hotel NO se imprime.
      const extras = foto ? (r.extrasDeHotel?.(c.ciudad, o.hotel) ?? []).slice(0, caben) : []
      const imagen = foto || conImagen ? imagenDeTarjeta(foto, extras, `${tagsHtml}${stars}`) : ''
      const estancia = [rangoCorto(c.desde, c.hasta), c.noches ? `(${c.noches} ${c.noches === 1 ? 'noche' : 'noches'})` : null].filter(Boolean).join(' ')
      const filas = [
        ['Estancia', estancia],
        ['Habitación', o.habitacion],
        ['Régimen', o.regimen],
      ].filter((x): x is [string, string] => Boolean(x[1]))
      const enTexto = imagen ? '' : `${tagsHtml}`
      return `<div class="hc">${imagen}<div class="b">${enTexto}<div class="n">${esc(o.hotel)}${!imagen && stars ? ` ${estrellas(o.estrellas)}` : ''}</div>${c.ciudad ? `<div class="caps zona">${esc(c.ciudad)}</div>` : ''}${filas.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div>${o.cargoEnDestino ? `<div class="pie">${esc(o.cargoEnDestino)}, se paga en el hotel.</div>` : ''}</div>`
    }),
  )
  const filas: string[] = []
  for (let i = 0; i < tarjetas.length; i += COLUMNAS_HOTELES) filas.push(`<div class="hg">${tarjetas.slice(i, i + COLUMNAS_HOTELES).join('\n')}</div>`)
  const [primera, ...resto] = filas
  return `<section class="sec hospedaje">\n<div class="nobr">${encabezadoDeSeccion('bed', 'Hospedaje', sub || null)}\n${primera}</div>\n${resto.join('\n')}\n</section>`
}

// ── Traslados ─────────────────────────────────────────────────────────────────

function traslados(m: ModeloPropuesta): string {
  const filas = m.trayectos.filas.filter((t) => t.tipo === 'traslado')
  if (filas.length === 0) return ''
  const porIndice = tarifaPorIndice(m)
  const conVersion = m.tarifas.length > 0 && !m.trayectos.igualEnTodas
  const sub = m.tarifas.length > 1 && m.trayectos.igualEnTodas ? 'Iguales en todas las versiones.' : null
  const cuerpo = filas.map((t) => {
    const [trayecto, ...resto] = t.descripcion.split(' · ')
    const dia = diaMes(t.fecha) ?? t.fecha
    const derecha = [t.hora ? esc(t.hora) : '', conVersion ? etiquetasDe(t.tarifas, porIndice) : ''].filter(Boolean).join(' ')
    return `<tr><td>${esc([dia, flecha(trayecto).replace(/^hotel\b/, 'Hotel')].filter(Boolean).join(' · '))}</td><td>${esc(mayuscula(resto.join(' · ')))}</td><td class="est">${derecha}</td></tr>`
  })
  // El título va en un bloque que no se parte con las primeras filas (en una tabla aparte, con las
  // mismas columnas): un `.sh` suelto antes de la tabla quedaba solo al pie de la hoja.
  const [juntas, medio, cola] = tramosDeFilas(cuerpo)
  const columnas = '<colgroup><col style="width:49%"><col><col style="width:16%"></colgroup>'
  const tabla = (tbodies: string[], clase: string) => `<table class="${clase}">${columnas}\n${tbodies.join('\n')}\n</table>`
  return `<section class="sec">
<div class="nobr">${encabezadoDeSeccion('van', 'Traslados', sub)}
${tabla([`<tbody class="nobr">${juntas.join('\n')}</tbody>`], 'tr fija')}</div>
${medio ? tabla([`<tbody>${medio.join('\n')}</tbody>`, `<tbody class="nobr">${cola!.join('\n')}</tbody>`], 'tr fija sigue') : ''}
</section>`
}

/**
 * Las filas de una tabla larga en tramos: las primeras van juntas (el título de la sección, que no
 * se separa de lo que sigue, nunca queda al pie con una sola fila) y las últimas también (ninguna
 * fila sola arriba de la hoja siguiente). Lo del medio se parte entre cualquier par de filas.
 * Corta (hasta el doble de `juntas`), va entera en el primer tramo.
 */
function tramosDeFilas(filas: string[], juntas = FILAS_JUNTAS): [string[], string[] | null, string[] | null] {
  if (filas.length <= juntas * 2) return [filas, null, null]
  const cola = Math.min(2, filas.length - juntas)
  return [filas.slice(0, juntas), filas.slice(juntas, filas.length - cola), filas.slice(filas.length - cola)]
}
const FILAS_JUNTAS = 3

// ── Itinerario día a día ──────────────────────────────────────────────────────

function tituloDelDia(d: DiaDoc, i: number, dias: DiaDoc[], m: ModeloPropuesta): string {
  // El título que escriba el texto generado manda.
  if (d.titulo) return d.titulo
  const tipos = new Set(d.eventos.map((e) => e.tipo))
  const anterior = i > 0 ? dias[i - 1].ciudad : null
  const sale = d.eventos.some((e) => e.tipo === 'vuelo' && e.momento === 'salida')
  if (i === 0 && sale) {
    const origen = ciudadSola(m.ruta.origen)
    return origen ? `Salida desde ${origen}` : 'Salida'
  }
  if (i === dias.length - 1 && sale) return 'Regreso a casa'
  if (tipos.has('tren') && d.ciudad && anterior && d.ciudad !== anterior) return `${anterior} → ${d.ciudad} en tren`
  if (d.ciudad && d.ciudad !== anterior) return `Llegada a ${d.ciudad}`
  const actividad = d.eventos.find((e) => e.tipo === 'actividad')
  if (actividad) return cabeza(actividad.texto)
  if (d.libre) return d.ciudad ? `Día libre en ${d.ciudad}` : 'Día libre'
  return d.ciudad ? `En ${d.ciudad}` : 'En ruta'
}

/** Del aeropuerto o la estación al hotel: «Barcelona Sants - hotel · Compartido». */
function esTrasladoAlLlegar(texto: string): boolean {
  const extremos = cabeza(texto).split(/\s+(?:-|→|–)\s+/)
  return extremos.length === 2 && /\bhotel\b/i.test(extremos[1]) && !/\bhotel\b/i.test(extremos[0])
}

const PALABRA_EVENTO: Record<EventoDoc['tipo'], string> = { vuelo: 'Vuelo', tren: 'Tren', traslado: 'Traslado', hotel: 'Hotel', actividad: 'Incluida' }

/**
 * Un renglón del día: la hora en morado a la izquierda (o, sin hora, la palabra del hecho, como
 * «Llegada» o «Libre» en el formato de Edgar) y el texto en frase. Nada que no esté en los datos.
 */
function renglonDeEvento(e: EventoDoc, d: DiaDoc): string {
  let etiquetaIzq = e.hora ?? ''
  let texto: string
  switch (e.tipo) {
    case 'vuelo':
      if (e.momento === 'llegada') {
        texto = esc(e.texto.replace(/^Llegada a /, 'Llegan a '))
        etiquetaIzq ||= 'Llegada'
      } else {
        texto = `${etiquetaIzq ? 'Vuelo ' : ''}${esc(e.texto)}`
      }
      break
    case 'tren': {
      const [trayecto, ...resto] = e.texto.split(' · ')
      const cuerpo = resto.length > 0 ? `${esc(resto.join(' · '))} · ${esc(flecha(trayecto))}` : esc(flecha(trayecto))
      texto = `${etiquetaIzq ? 'Tren ' : ''}${cuerpo}`
      break
    }
    case 'traslado': {
      const [trayecto, ...resto] = e.texto.split(' · ')
      if (!etiquetaIzq && esTrasladoAlLlegar(e.texto) && d.eventos.some((x) => x.tipo === 'tren' || x.tipo === 'vuelo')) etiquetaIzq = 'Al llegar'
      texto = `${etiquetaIzq ? 'Traslado ' : ''}${esc(flecha(trayecto))}${resto.length > 0 ? ` · ${esc(minuscula(resto.join(' · ')))}` : ''}`
      break
    }
    case 'actividad': {
      // La ciudad del día ya está en la píldora: «Museo del Prado · 2 h · Madrid» → «Museo del Prado · 2 h».
      const partes = e.texto.split(' · ')
      const ultima = partes[partes.length - 1]
      const sinCiudad = partes.length > 1 && d.ciudad && llano(ultima) === llano(d.ciudad) ? partes.slice(0, -1) : partes
      // Sin hora, «Incluida» va a la izquierda; con hora, al final de la frase.
      texto = `<b>${esc(sinCiudad[0])}</b>${sinCiudad.length > 1 ? ` · ${esc(sinCiudad.slice(1).join(' · '))}` : ''}.${etiquetaIzq ? ' Incluida.' : ''}`
      break
    }
    default:
      texto = esc(e.texto)
  }
  // Sin hora, la palabra del hecho va a la izquierda y el texto no la repite.
  etiquetaIzq ||= PALABRA_EVENTO[e.tipo]
  return `<div class="ev"><span class="h">${esc(etiquetaIzq)}</span><span>${texto}</span></div>`
}

/** Las versiones del día de un vuelo, en chips: «Recomendada · AV Avianca 19:20, directo». */
function chipsDeVuelo(e: EventoDoc, porIndice: Map<number, TarifaDoc>): string[] {
  if (e.tipo !== 'vuelo' || e.porTarifa.length === 0) return []
  return e.porTarifa.map((pt) => {
    const nombres = pt.tarifas
      .map((i) => porIndice.get(i))
      .filter((t): t is TarifaDoc => t !== undefined)
      .map((t) => `<span class="c${LETRA[t.clave]}">${esc(t.nombre)}</span>`)
      .join(' · ')
    return `<span class="chip">${nombres || 'Todas'} · ${(pt.siglas ?? []).map(pastillaAerolinea).join('')}${esc(pt.texto)}</span>`
  })
}

/**
 * «Itinerario día a día», como el de Edgar: una píldora con la ciudad cada vez que cambia, el
 * círculo «DÍA n» con su línea de tiempo, la fecha en rosa, el título, la foto (la de la actividad
 * incluida o, el primer día en una ciudad, la de la ciudad) y un renglón por hecho. Las versiones
 * de los vuelos y los planes opcionales van en chips. Un día no se parte entre hojas.
 */
function itinerario(m: ModeloPropuesta, r: RecursosPropuesta): string {
  if (m.dias.length === 0) return ''
  const porIndice = tarifaPorIndice(m)
  const hayOpcionales = m.opcionales.length > 0
  const ubicados = new Set(m.dias.flatMap((d) => d.opcionales))
  const sueltos = m.opcionales.some((o) => !ubicados.has(o.nombre))
  const ciudadesConFoto = new Set<string>()
  let ciudadPrevia: string | null = null
  const bloques = m.dias.map((d, i) => {
    const f = fecha(d.fecha)
    const titulo = tituloDelDia(d, i, m.dias, m)
    const renglones = d.eventos.map((e) => renglonDeEvento(e, d))
    const chips = d.eventos.flatMap((e) => chipsDeVuelo(e, porIndice))
    if (d.libre) {
      const resto = d.opcionales.length > 0 ? '' : hayOpcionales && sueltos ? ' Pueden sumar uno de los planes del final.' : ''
      renglones.push(`<div class="ev"><span class="h">Libre</span><span>Día abierto para ustedes.${resto}</span></div>`)
    }
    if (d.opcionales.length > 0) chips.push(`<span class="chip">Opcional: ${esc(oLista(d.opcionales))} (ver «Planes para los días libres»)</span>`)
    if (d.sugerencia) renglones.push(`<div class="ev"><span class="h">Idea</span><span>${esc(d.sugerencia)}</span></div>`)
    // La foto: la de la actividad incluida; si no, la de la ciudad el primer día que se está en ella.
    const actividad = d.eventos.find((e) => e.tipo === 'actividad')
    let foto = actividad ? (r.fotoDeActividad?.(cabeza(actividad.texto)) ?? null) : null
    if (!foto && d.ciudad && !ciudadesConFoto.has(d.ciudad)) foto = r.fotoDeCiudad(d.ciudad)
    if (d.ciudad && foto) ciudadesConFoto.add(d.ciudad)
    const contenido = `<div>${renglones.join('\n')}${chips.length > 0 ? `<div class="chips">${chips.join('')}</div>` : ''}</div>`
    const pildora = d.ciudad && d.ciudad !== ciudadPrevia ? `<div class="pill"><span>${icono('pin')}${esc(d.ciudad)}</span></div>\n` : ''
    if (d.ciudad) ciudadPrevia = d.ciudad
    const dia = `<div class="day"><div class="dn"><small>DÍA</small>${d.numero}</div><div>
    ${f ? `<div class="df">${esc(diaLargo(d.fecha))}</div>` : ''}
    <div class="t">${esc(titulo)}</div>
    <div class="cuerpo${foto ? ' foto' : ''}">${foto ? `<div class="ph"${fondo(foto)}></div>` : ''}${contenido}</div>
  </div></div>`
    // La píldora no queda sola al pie: va pegada a su día.
    return pildora ? `<div class="nobr">${pildora}${dia}</div>` : dia
  })
  const sub = hayOpcionales
    ? 'Lo que dice «Incluida» ya está en el precio. Los días libres los pueden llenar con los planes opcionales.'
    : 'Lo que dice «Incluida» ya está en el precio.'
  // El encabezado va pegado al primer día en un bloque que no se parte: `break-after: avoid` del
  // `.sh` Chromium no lo respeta y el título quedaba solo al pie de la hoja.
  const [primero, ...resto] = bloques
  return `<section class="sec dias">\n<div class="nobr">${encabezadoDeSeccion('cal', 'Itinerario día a día', sub)}\n${primero}</div>\n${resto.join('\n')}\n</section>`
}

// ── Planes opcionales ─────────────────────────────────────────────────────────

/** «Madrid · dom 13»: la ciudad del plan y el día en que el día a día lo propone. */
function lugarDelOpcional(o: OpcionalDoc, m: ModeloPropuesta): string | null {
  const fechaDelDia = o.fecha ?? m.dias.find((d) => d.opcionales.includes(o.nombre))?.fecha ?? null
  const partes = [o.ciudad, diaCorto(fechaDelDia)].filter(Boolean)
  return partes.length > 0 ? partes.join(' · ') : null
}

function opcionales(m: ModeloPropuesta, r: RecursosPropuesta): string {
  if (m.opcionales.length === 0) return ''
  const fotos = m.opcionales.map((o) => r.fotoDeOpcional?.(o.nombre) ?? null)
  // Con alguna foto, todas las tarjetas llevan imagen (la que no tiene, el degradado): una fila
  // de tarjetas con y sin imagen se ve rota. Sin ninguna, sin imagen.
  const conImagen = fotos.some(Boolean)
  const caben = extrasQueCaben('opcional', COLUMNAS_OPCIONALES)
  const tarjetas = m.opcionales.map((o, i) => {
    const valor = o.valor > 0 ? `+ ${pesos(o.valor)}` : 'consultar'
    const lugar = lugarDelOpcional(o, m)
    const extras = fotos[i] ? (r.extrasDeOpcional?.(o.nombre) ?? []).slice(0, caben) : []
    const imagen = conImagen ? imagenDeTarjeta(fotos[i], extras, lugar ? `<div class="where">${esc(lugar)}</div>` : '') : ''
    return `<div class="oc">${imagen}<div class="b"><div class="n">${esc(o.nombre)}</div>${!imagen && lugar ? `<div class="caps">${esc(lugar)}</div>` : ''}${o.descripcion ? `<div class="muted">${esc(o.descripcion)}</div>` : ''}<div class="foot"><span class="muted">${esc(o.unidad ?? '')}</span><span class="pr money">${esc(valor)}</span></div></div></div>`
  })
  // Por filas: el título va con la primera y las demás pueden pasar a la hoja siguiente.
  const [primera, ...resto] = enFilas(tarjetas, COLUMNAS_OPCIONALES).map((f) => `<div class="opcs">${f.join('\n')}</div>`)
  return `<section class="sec">\n<div class="nobr">${encabezadoDeSeccion('sun', 'Planes para los días libres', 'Escojan los que quieran y los sumamos a la reserva. Precio para el grupo.')}
  ${primera}</div>\n${resto.join('\n')}\n</section>`
}

// ── Información útil ──────────────────────────────────────────────────────────

const lista = (xs: string[]) => `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`

function informacionUtil(m: ModeloPropuesta): string {
  const antes = m.formal.antesDeViajar
  if (antes.length === 0) return ''
  return `<section class="sec nobr">\n${encabezadoDeSeccion('info', 'Información útil', 'Lo que conviene tener listo antes de salir')}
  <div class="cards"><div class="card${antes.length > 3 ? ' dos' : ''}"><span class="caps">Antes de viajar</span>${lista(antes)}</div></div>\n</section>`
}

// ── Hoja de precios ───────────────────────────────────────────────────────────

function enlaceWhatsApp(numero: string, texto: string): string {
  return `https://wa.me/${numero.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`
}

/** El llamado a apartar (decisión 3): la cifra solo si la asesora la asignó; el botón, su WhatsApp. */
function apartar(m: ModeloPropuesta): string {
  const a = m.precio.anticipo
  const asesora = m.formal.asesora
  const titulo = a ? `Apártenlo con ${pesos(a.monto)}.` : '¿Les gusta? Escríbannos y se lo apartamos.'
  const detalle = a?.texto ?? null
  const numero = asesora?.whatsapp ?? null
  const saludo = asesora?.nombre ? `Hola ${asesora.nombre.split(/\s+/)[0]}` : 'Hola'
  const botones = !numero
    ? []
    : m.tarifas.length > 0
      ? m.tarifas.map(
          (t) =>
            `<a class="btn b${LETRA[t.clave]}" href="${esc(enlaceWhatsApp(numero, `${saludo}, queremos apartar la versión ${t.nombre} de la propuesta ${m.portada.consecutivo}.`))}"><span>${esc(t.nombre)}</span><b>Apartar por WhatsApp</b></a>`,
        )
      : [`<a class="btn bR" href="${esc(enlaceWhatsApp(numero, `${saludo}, queremos apartar el viaje de la propuesta ${m.portada.consecutivo}.`))}"><span>${esc(asesora?.nombre ?? 'Su asesora')}</span><b>Apartar por WhatsApp</b></a>`]
  return `<div class="cta${botones.length === 0 ? ' solo' : ''}">
    <div class="ctl">
      <div class="caps">Aparta tu viaje</div>
      <div class="ctt">${esc(titulo)}</div>
      ${detalle ? `<div class="small" style="opacity:.85">${esc(detalle)}</div>` : ''}
    </div>
    ${botones.length > 0 ? `<div class="btns">${botones.join('\n')}</div>` : ''}
  </div>`
}

/** Los vuelos de una versión agrupados por trayecto y fecha, en orden. */
function gruposDeVuelos(vuelos: FilaVueloDoc[], m: ModeloPropuesta): { titulo: string; filas: FilaVueloDoc[] }[] {
  const grupos = new Map<string, FilaVueloDoc[]>()
  for (const f of vuelos) {
    const k = `${f.fecha ?? ''}|${f.desde ?? ''}|${f.hasta ?? ''}`
    grupos.set(k, [...(grupos.get(k) ?? []), f])
  }
  const casa = (m.ruta.origen ?? '').toLowerCase()
  const listaG = [...grupos.values()].sort((a, b) => (a[0].fecha ?? '').localeCompare(b[0].fecha ?? ''))
  return listaG.map((filas, i) => {
    const f = filas[0]
    const vuelve = casa !== '' && (f.hasta ?? '').toLowerCase() === casa
    return { titulo: vuelve && i > 0 ? 'Regreso' : i === 0 ? 'Ida' : 'Vuelo', filas }
  })
}

function eligeTuVersion(m: ModeloPropuesta): string {
  if (m.tarifas.length === 0) {
    const lineas = m.precio.lineas
      .map((l) => `<tr><td>${esc(l.nombre)}${l.adicionales.length > 0 ? `<br><span class="muted small">${esc(l.adicionales.join(' · '))}</span>` : ''}${l.nota ? `<br><span class="small">${esc(l.nota)}</span>` : ''}</td><td class="r money">${esc(pesos(l.total))}</td></tr>`)
      .join('\n')
    // Reglas de margen: el subtotal y cada descuento sobre el total, con su descripción.
    const descuentos = m.precio.descuentos.length > 0
      ? `<tr><td class="muted">Subtotal</td><td class="r money">${esc(pesos(m.precio.lineas.reduce((a, l) => a + l.total, 0)))}</td></tr>${m.precio.descuentos
          .map((d) => `<tr><td>${esc(d.descripcion)}</td><td class="r money">−${esc(pesos(d.valor))}</td></tr>`)
          .join('')}`
      : ''
    return `<div class="nobr">${encabezadoDeSeccion('tag', 'Precio del viaje', 'Precio total para el grupo.')}
  <table class="tr pagos">${lineas}${descuentos}
  <tr class="tot"><td>Total</td><td class="r money">${esc(pesos(m.precio.total))}</td></tr></table>
  ${m.precio.notaIva ? `<p class="small muted">${esc(m.precio.notaIva)}</p>` : ''}</div>
  ${apartar(m)}`
  }
  const tarjetas = m.tarifas.map((t) => {
    const precio = t.esPrincipal ? m.precio.total : t.precio
    const pp = ['el grupo', t.estrellas ? `${t.estrellas}★` : null].filter(Boolean).join(' · ')
    const filasVuelo = gruposDeVuelos(t.vuelos, m).map((g) => {
      const f = g.filas[0]
      const vuelo = [nombreDeAerolinea(f.aerolinea, f.numero), f.numero].filter(Boolean).join(' ')
      const horas = f.salida || f.llegada ? ` · ${f.salida ?? '?'} → ${f.llegada ?? '?'}` : ''
      const extra = [f.tarifaAerolinea, f.equipaje, ...f.adicionales].filter(Boolean).join(' · ')
      return `<div class="row"><b>${esc(g.titulo)}${f.fecha ? ` · ${esc(diaCorto(f.fecha) ?? '')}` : ''}</b>${pastillasDeVuelo(f.aerolinea, f.numero)}${esc(vuelo)}${f.escala ? ` · ${esc(f.escala)}` : ''}${esc(horas)}${extra ? `<br><span class="muted">${esc(extra)}</span>` : ''}</div>`
    })
    const hoteles = t.hoteles.length > 0
      ? `<div class="row"><b>Hoteles</b>${t.hoteles.map((h) => `${esc(h.nombre)} ${estrellas(h.estrellas)}`).join('<br>')}</div>`
      : ''
    // Reglas de margen: el descuento de cada hotel y los descuentos sobre el total de ESTA tarifa.
    const notas = t.lineas.filter((l) => l.nota).map((l) => esc(l.nota))
    const descuentos = t.descuentos.map((d) => `${esc(d.descripcion)}: −${esc(pesos(d.valor))}`)
    const conDescuento = notas.length + descuentos.length > 0
      ? `<div class="row"><b>Descuentos</b>${[...notas, ...descuentos].join('<br>')}</div>`
      : ''
    return `<div class="tf${t.esPrincipal ? ' rec' : ''}">
      ${t.esPrincipal ? '<span class="tag badge">La que recomendamos</span>' : ''}
      <div class="name c${LETRA[t.clave]}">${esc(t.nombre)}</div>
      <div class="price money">${esc(pesos(precio))}</div>
      <div class="pp">${esc(pp)}${t.notaIva ? `<br>${esc(t.notaIva)}` : ''}</div>
      ${filasVuelo.join('\n')}
      ${hoteles}
      ${conDescuento}
    </div>`
  })
  const sub = m.igualEnTodas.length > 0
    ? 'Precio total para el grupo. Lo demás va igual en todas; cambian los vuelos y los hoteles.'
    : 'Precio total para el grupo.'
  return `<div class="nobr">${encabezadoDeSeccion('tag', 'Elijan su versión', sub)}
  <div class="tarifas nobr" style="grid-template-columns:repeat(${Math.min(3, m.tarifas.length)},1fr)">${tarjetas.join('\n')}</div></div>
  ${apartar(m)}`
}

function cuantoYCuando(m: ModeloPropuesta): string {
  const planes = m.precio.planes
  if (planes.length === 0) return ''
  const conFilas = planes.filter((p) => p.plan.filas !== null)
  let cuerpo: string
  if (conFilas.length === 0) {
    cuerpo = `<p class="small">${esc(planes[0].plan.regla)}</p>`
  } else {
    const n = Math.max(...conFilas.map((p) => p.plan.filas!.length))
    const cabecera = planes.length > 1
      ? `<tr><th></th>${planes.map((p) => {
          const t = m.tarifas.find((x) => x.indice === p.tarifa)
          return `<th class="r">${t ? `<span class="c${LETRA[t.clave]}">${esc(t.nombre)}</span>` : ''}</th>`
        }).join('')}</tr>`
      : ''
    const filas: string[] = []
    for (let i = 0; i < n; i++) {
      const ref = conFilas.find((p) => p.plan.filas![i])!.plan
      const f = ref.filas![i]
      const nota = notaDeFila(f, ref.pctMinimo, pesos)
      filas.push(
        `<tr><td><b>${esc(mayuscula(f.cuando))}</b>${nota && planes.length === 1 ? ` <span class="muted">(${esc(nota)})</span>` : ''}</td>${planes
          .map((p) => `<td class="r money">${p.plan.filas?.[i] ? esc(pesos(p.plan.filas[i].monto)) : ''}</td>`)
          .join('')}</tr>`,
      )
    }
    filas.push(`<tr class="tot"><td>Total</td>${planes.map((p) => `<td class="r money">${esc(pesos(p.plan.suma))}</td>`).join('')}</tr>`)
    // El total va en el mismo bloque que las cuotas: nunca se separa de ellas.
    cuerpo = `<table class="tr pagos">${cabecera}${filas.join('\n')}</table><p class="small muted">${esc(conFilas[0].plan.regla)} ${esc(conFilas[0].plan.pie)}</p>`
  }
  return `<div class="sec nobr">${encabezadoDeSeccion('cal', 'Cuánto pagan y cuándo', null)}${cuerpo}</div>`
}

/**
 * Los términos en tarjetas: un renglón corto sin punto final («Condiciones generales», «Medios de
 * pago») abre una tarjeta nueva con ese título; lo demás son sus puntos.
 */
export function bloquesDeTerminos(texto: string | null): { titulo: string | null; puntos: string[] }[] {
  const lineas = (texto ?? '')
    .split(/\n+/)
    .map((x) => x.replace(/^\s*[-•·*]\s*/, '').trim())
    .filter(Boolean)
  const bloques: { titulo: string | null; puntos: string[] }[] = []
  lineas.forEach((l, i) => {
    const esTitulo = i < lineas.length - 1 && l.split(/\s+/).length <= 4 && !/[.:;,]$/.test(l) && !/\d/.test(l)
    if (esTitulo) bloques.push({ titulo: l, puntos: [] })
    else if (bloques.length === 0) bloques.push({ titulo: null, puntos: [l] })
    else bloques[bloques.length - 1].puntos.push(l)
  })
  return bloques.filter((b) => b.puntos.length > 0)
}

/**
 * Lo que incluye y los términos en una sola fila de tarjetas (hasta tres por fila), como las de
 * «Información útil» del formato de Edgar: así la hoja de precios cabe en una hoja.
 */
function incluyeYCondiciones(m: ModeloPropuesta, firma: string): string {
  const xs = m.precio.incluye.length > 0
    ? m.precio.incluye
    : m.tarifas.length > 0
      ? m.igualEnTodas
      : m.precio.lineas.map((l) => l.nombre)
  const tarjetasIncluye = [
    xs.length > 0 ? `<div class="card"><span class="caps">${m.tarifas.length > 0 ? 'Incluido en todas' : 'Incluido'}</span>${lista(xs)}</div>` : '',
    m.precio.noIncluye.length > 0 ? `<div class="card"><span class="caps">No incluido</span>${lista(m.precio.noIncluye)}</div>` : '',
  ].filter(Boolean)
  const tarjetasTerminos = bloquesDeTerminos(m.formal.terminos).map(
    (b) => `<div class="card"><span class="caps">${esc(b.titulo ?? 'Términos y condiciones')}</span>${lista(b.puntos)}</div>`,
  )
  const tarjetas = [...tarjetasIncluye, ...tarjetasTerminos]
  if (tarjetas.length === 0) return firma
  const titulo = tarjetasIncluye.length === 0 ? 'Términos y condiciones' : tarjetasTerminos.length === 0 ? 'Qué incluye' : 'Qué incluye y condiciones'
  // Por filas de tres: el título va con la primera; con más bloques, las del medio pueden pasar a la
  // hoja siguiente. Cada tarjeta (`.card`) no se parte, y la firma va pegada a la última fila: sola
  // arriba de una hoja la dejaba casi vacía.
  const columnas = Math.min(3, tarjetas.length)
  const filas = enFilas(tarjetas, columnas).map(
    (f) => `<div class="cards" style="grid-template-columns:repeat(${columnas},1fr)">${f.join('\n')}</div>`,
  )
  const encabezado = encabezadoDeSeccion('doc', titulo, null)
  if (filas.length === 1) return `<div class="sec"><div class="nobr">${encabezado}${filas[0]}${firma}</div></div>`
  const [primera, ...resto] = filas
  const ultima = resto.pop()!
  return `<div class="sec"><div class="nobr">${encabezado}${primera}</div>${resto.join('\n')}<div class="nobr">${ultima}${firma}</div></div>`
}

function firmaDe(m: ModeloPropuesta, r: RecursosPropuesta): string {
  const firma = m.formal.firma
  return `<div class="sign">
    <div>${firma ? `<b class="pop">${esc(firma.nombre)}</b><br><span class="muted small">${esc([firma.cargo, firma.contacto].filter(Boolean).join(' · '))}</span>` : ''}</div>
    ${marcaDe(r, '9mm')}
  </div>`
}

function creditosDe(m: ModeloPropuesta, r: RecursosPropuesta): string {
  const creditos = [...new Set([...m.formal.creditos, ...(r.creditosExtra ?? [])])]
  return creditos.length > 0 ? `<div class="credits"><b>Fotografías:</b> ${creditos.map(esc).join(' · ')}</div>` : ''
}

/**
 * Los precios al final. Ya no arrancan en hoja nueva (pedido de Edgar del 2026-10-28: menos blanco y
 * menos hojas): siguen a lo anterior y solo saltan si su primer bloque no cabe.
 */
function hojaDePrecios(m: ModeloPropuesta, r: RecursosPropuesta): string {
  return `<section class="sec precios">
${eligeTuVersion(m)}
${cuantoYCuando(m)}
${incluyeYCondiciones(m, firmaDe(m, r))}
${creditosDe(m, r)}
</section>`
}

export function htmlDePropuesta(m: ModeloPropuesta, r: RecursosPropuesta): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${esc(m.portada.consecutivo)} · ${esc(m.portada.titulo)}</title>
<style>${CSS_PROPUESTA}</style></head><body>
${ICONOS_PROPUESTA}
<section>
${portada(m, r)}
</section>
${vuelosYTren(m)}
${hospedaje(m, r)}
${traslados(m)}
${itinerario(m, r)}
${opcionales(m, r)}
${informacionUtil(m)}
${hojaDePrecios(m, r)}
</body></html>`
}

// ── Encabezado y pie de cada hoja (Chromium los pinta aparte) ──────────────────

const COLOR_EXACTO = '-webkit-print-color-adjust:exact;print-color-adjust:exact;'

/** La franja degradada de arriba de cada hoja (rosa → morado → turquesa, como la de Edgar). */
export function encabezadoDeHoja(): string {
  return `<div style="${COLOR_EXACTO}width:100%;margin:-4mm 0 0;height:1.6mm;background:linear-gradient(90deg,#e6197a,#8a2cb5 50%,#1ca2b8)"></div>`
}

/**
 * La banda azul oscura del pie: los datos de la agencia al centro (el pie configurado del
 * documento), como el de Edgar, y «COT-xxxx · N de M» discreto a la derecha. `cssFuente` es el
 * `@font-face` de Inter: el pie se pinta en otro contexto, sin las fuentes de la página.
 */
export function pieDeHoja(opts: { texto: string; codigo: string; cssFuente?: string | null }): string {
  const ff = opts.cssFuente ? `<style>${opts.cssFuente}</style>` : ''
  return `${ff}<div style="${COLOR_EXACTO}position:relative;width:100%;margin:0 0 -4mm;background:linear-gradient(90deg,#1b1f3b,#1e2e5c);color:#fff;font:600 7.6pt Inter,sans-serif;padding:3.9mm 9mm 4mm;text-align:center"><span>${esc(opts.texto)}</span><span style="position:absolute;right:9mm;top:4.3mm;font-size:6pt;font-weight:400;opacity:.6;white-space:nowrap">${esc(opts.codigo)} · <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`
}
