/**
 * La propuesta de viaje de Trappvel en HTML, para imprimirla con Chromium (motor `html`, PR 2
 * del plan del 2026-10-14). Reproduce el prototipo aprobado (v5):
 *
 *   portada (encabezado, foto, datos, ruta, «Lo que van a vivir») · día a día · dónde duermen ·
 *   vuelos · trenes y traslados · planes para los días libres · elijan su versión + apartar ·
 *   qué incluye y cuándo se paga · términos, firma y créditos
 *
 * PURO: recibe el modelo (`modeloDePropuesta`) y los recursos ya resueltos (fotos reducidas y
 * logo como data URL) y devuelve el HTML. No lee disco ni red; se prueba con vitest.
 *
 * Texto: solo lo que ya existe. El texto revisado del cliente (`documento_cliente`: titular,
 * intro, incluye, antes de viajar) y frases deterministas armadas con los datos. Nada generado.
 *
 * Decisiones de Mauricio del 2026-10-14: sin políticas de cancelación de hoteles; sin anticipo
 * fijo (solo el que la asesora asignó, y el botón abre su WhatsApp); los nombres que dice el
 * documento son los que el modelo deja pasar (`portada.nombres`).
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
} from '@/lib/cotizaciones/propuesta/modelo-documento'
import { notaDeFila } from '@/lib/viaje/asi-puedes-pagar'
import { CSS_PROPUESTA, ICONOS_PROPUESTA } from './estilos'
import { nombreDeAerolinea, pastillaAerolinea, pastillasDeVuelo } from './aerolinea'

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

/** «jueves 10 de diciembre» */
function diaLargo(iso: string | null | undefined): string | null {
  const d = fecha(iso)
  return d ? `${DIAS_LARGOS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES_LARGOS[d.getUTCMonth()]}` : null
}

/** «vie 11 – lun 14 dic» */
function rango(desde: string | null, hasta: string | null): string | null {
  const a = fecha(desde)
  const b = fecha(hasta)
  if (!a) return null
  if (!b) return `${diaCorto(desde)} ${MESES[a.getUTCMonth()]}`
  const mesA = a.getUTCMonth() === b.getUTCMonth() ? '' : ` ${MESES[a.getUTCMonth()]}`
  return `${diaCorto(desde)}${mesA} – ${diaCorto(hasta)} ${MESES[b.getUTCMonth()]}`
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

const ICONO_EVENTO: Record<EventoDoc['tipo'], string> = { vuelo: 'plane', tren: 'train', traslado: 'van', hotel: 'bed', actividad: 'tk' }

function fondo(f: FotoResuelta | null, extra = ''): string {
  if (!f) return extra ? ` style="${extra}"` : ''
  const pos = f.foco ? `${Math.round(f.foco.x * 100)}% ${Math.round(f.foco.y * 100)}%` : 'center'
  return ` style="background-image:url(${f.src});background-position:${pos};${extra}"`
}

// ── Fotos extra en el mismo recuadro ─────────────────────────────────────────

/** Columnas de la cuadrícula de planes (`.opcs` en estilos.ts). */
export const COLUMNAS_OPCIONALES = 4
/** Ancho útil de la hoja (A4 menos 12 mm por lado, `@page` de estilos.ts) y separación de las tarjetas. */
const ANCHO_UTIL_MM = 186
const SEPARACION_MM = 3
/** Alto del recuadro de foto (`.hc .img` y `.oc .img`, la versión compacta de estilos.ts). */
const ALTO_FOTO_MM = { hotel: 29, opcional: 25 } as const
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
  const tarjeta = (ANCHO_UTIL_MM - SEPARACION_MM * (cols - 1)) / cols
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

// ── Secciones ─────────────────────────────────────────────────────────────────

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
  const lista = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
  return lista[0].toUpperCase() + lista.slice(1)
}

function portada(m: ModeloPropuesta, r: RecursosPropuesta): string {
  const p = m.portada
  const foto = r.foto(p.foto?.url)
  const quienes = p.nombres.length > 0 ? p.nombres.join(', ').replace(/, ([^,]*)$/, ' y $1') : p.viajeros
  const dt = [p.fechas, quienes].filter(Boolean).join(' · ')
  const sub = [p.duracion, m.ruta.paradas.length > 1 ? `${m.ruta.paradas.length} ciudades` : null].filter(Boolean).join(' · ')
  const marca = r.logo ? `<img src="${r.logo}" alt="${esc(r.marca)}">` : `<b class="mont">${esc(r.marca)}</b>`
  const destinos = m.ruta.paradas.length > 0
    ? m.ruta.paradas.map((x) => `${x.ciudad}${x.noches ? ` (${x.noches}N)` : ''}`).join(' · ')
    : p.destino
  const incluye = resumenIncluye(m)
  const datos = [
    ['Duración', p.duracion],
    ['Destinos', destinos],
    ['Viajeros', quienes],
    ['Incluye', incluye],
  ].filter((d): d is [string, string] => Boolean(d[1]))
  return [
    `<div class="top"><span class="k"><i></i>Propuesta de viaje · ${esc(p.consecutivo)}</span>${marca}</div>`,
    `<div class="hero"${fondo(foto)}><div class="in">`,
    dt ? `<div class="dt">${esc(dt)}</div>` : '',
    `<h1>${esc(p.titulo)}</h1>`,
    sub ? `<div class="sub">${esc(sub)}</div>` : '',
    `</div>${p.foto?.rotulo ? `<span class="ph">${esc(p.foto.rotulo)}</span>` : ''}</div>`,
    datos.length > 0
      ? `<div class="facts5" style="grid-template-columns:repeat(${datos.length},1fr)">${datos.map(([k, v]) => `<div><b>${esc(k)}</b>${esc(v)}</div>`).join('')}</div>`
      : '',
    p.intro ? `<p class="intro">${esc(p.intro)}</p>` : '',
  ].join('\n')
}

function ruta(m: ModeloPropuesta): string {
  const { origen, paradas, regreso } = m.ruta
  if (paradas.length === 0) return ''
  const sigla = (s: string | null) => {
    const iata = /\b([A-Z]{3})\b/.exec(s ?? '')?.[1]
    return iata ?? (s ?? '').slice(0, 3).toUpperCase()
  }
  const ciudadSola = (s: string | null) => (s ?? '').replace(/\s*\(?\b[A-Z]{3}\b\)?\s*$/, '').trim() || s || ''
  const partes: string[] = []
  if (origen) {
    partes.push(`<div class="stop home"><div class="dot">${esc(sigla(origen))}</div><div class="city">${esc(ciudadSola(origen))}</div></div>`)
    partes.push(`<div class="leg"><div class="bar"></div><div class="ico">${icono('plane')}</div><div class="lbl">vuelo</div></div>`)
  }
  paradas.forEach((x, i) => {
    const cuando = rangoCorto(x.desde, x.hasta)
    partes.push(
      `<div class="stop"><div class="dot">${x.noches ? `${x.noches}n` : '·'}</div><div class="city">${esc(x.ciudad)}</div>${cuando ? `<div class="when">${esc(cuando)}</div>` : ''}</div>`,
    )
    if (i < paradas.length - 1) {
      const tren = x.siguiente !== null
      const lbl = tren ? etiquetaDeTren(x.siguiente as string) : ''
      partes.push(
        `<div class="leg"><div class="bar${tren ? ' train' : ''}"></div><div class="ico">${icono(tren ? 'train' : 'plane')}</div><div class="lbl">${esc(lbl)}</div></div>`,
      )
    }
  })
  if (regreso) {
    partes.push(`<div class="leg"><div class="bar"></div><div class="ico">${icono('plane')}</div><div class="lbl">regreso</div></div>`)
    partes.push(`<div class="stop home"><div class="dot">${esc(sigla(regreso))}</div><div class="city">${esc(ciudadSola(regreso))}</div></div>`)
  }
  return `<div class="route">${partes.join('\n')}</div>`
}

/** «Lo que van a vivir»: una tarjeta por ciudad, con su foto y lo que ya está incluido allí. */
function loQueVanAVivir(m: ModeloPropuesta, r: RecursosPropuesta): string {
  if (m.ruta.paradas.length === 0) return ''
  const tarjetas = m.ruta.paradas.map((x) => {
    const actividades = [
      ...new Set(
        m.dias
          .filter((d) => d.ciudad === x.ciudad)
          .flatMap((d) => d.eventos)
          .filter((e) => e.tipo === 'actividad')
          .map((e) => cabeza(e.texto)),
      ),
    ]
    const ciudadDoc = m.hoteles.find((h) => h.ciudad === x.ciudad)
    const hotel = ciudadDoc ? hotelDeReferencia(ciudadDoc, m) : null
    const texto = actividades.length > 0
      ? `Incluido: ${actividades.slice(0, 3).join(', ')}.`
      : hotel
        ? `${x.noches ?? ''} ${x.noches === 1 ? 'noche' : 'noches'} en ${hotel}.`.trim()
        : null
    const foto = r.fotoDeCiudad(x.ciudad)
    const rotulo = `${x.ciudad}${x.noches ? ` · ${x.noches} ${x.noches === 1 ? 'noche' : 'noches'}` : ''}`
    return `<div class="hl"><div class="img${foto ? '' : ' sinfoto'}"${fondo(foto)}><span class="ct">${esc(rotulo)}</span></div><div class="tx"><h3>${esc(x.ciudad)}</h3>${texto ? `<p>${esc(texto)}</p>` : ''}</div></div>`
  })
  return `${encabezadoDeSeccion('star', 'Lo que van a vivir', 'Una ciudad a la vez')}\n<div class="hls">${tarjetas.join('\n')}</div>`
}

/** El hotel que el documento nombra en una ciudad: el de la tarifa recomendada, o el primero. */
function hotelDeReferencia(c: CiudadDoc, m: ModeloPropuesta): string | null {
  const principal = m.tarifas.find((t) => t.esPrincipal)?.indice
  const o = (principal !== undefined ? c.opciones.find((x) => x.tarifas.includes(principal)) : undefined) ?? c.opciones[0]
  return o?.hotel ?? null
}

function tituloDelDia(d: DiaDoc, i: number, dias: DiaDoc[], m: ModeloPropuesta): { titulo: string; lugar: string | null } {
  const tipos = new Set(d.eventos.map((e) => e.tipo))
  const anterior = i > 0 ? dias[i - 1].ciudad : null
  const ciudadSola = (s: string | null) => (s ?? '').replace(/\s*\(?\b[A-Z]{3}\b\)?\s*$/, '').trim() || null
  // El título que escriba el texto generado (PR 6) manda; el lugar sigue saliendo de los datos.
  const conTitulo = (t: { titulo: string; lugar: string | null }) => (d.titulo ? { ...t, titulo: d.titulo } : t)
  const sale = d.eventos.some((e) => e.tipo === 'vuelo' && e.momento === 'salida')
  if (i === 0 && sale) {
    const origen = ciudadSola(m.ruta.origen)
    return conTitulo({ titulo: origen ? `Salida desde ${origen}` : 'Salida', lugar: origen })
  }
  if (i === dias.length - 1 && sale) {
    const casa = ciudadSola(m.ruta.regreso)
    return conTitulo({ titulo: 'Regreso a casa', lugar: [anterior, casa].filter(Boolean).join(' → ') || null })
  }
  if (tipos.has('tren') && d.ciudad && anterior && d.ciudad !== anterior) {
    return conTitulo({ titulo: `En tren a ${d.ciudad}`, lugar: `${anterior} → ${d.ciudad}` })
  }
  if (d.ciudad && d.ciudad !== anterior) return conTitulo({ titulo: `Llegada a ${d.ciudad}`, lugar: d.ciudad })
  const actividad = d.eventos.find((e) => e.tipo === 'actividad')
  if (actividad) return conTitulo({ titulo: cabeza(actividad.texto), lugar: d.ciudad })
  if (d.libre) return conTitulo({ titulo: 'Día libre', lugar: d.ciudad })
  return conTitulo({ titulo: d.ciudad ? `En ${d.ciudad}` : 'En ruta', lugar: d.ciudad })
}

/** «A», «A o B», «A, B o C». */
function oLista(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} o ${xs[xs.length - 1]}`
}

/** «Aeropuerto Barajas T4 - hotel» → «Aeropuerto Barajas T4 → hotel». */
function flecha(trayecto: string): string {
  // «Hotel» va en minúscula en medio de la frase: «Traslado hotel → estación».
  return trayecto.replace(/\s+(?:-|–)\s+/, ' → ').replace(/^Hotel\b/, 'hotel')
}

const minuscula = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)

/** «Barcelona Sants - hotel · Compartido» con hora o sin ella: ¿es el traslado al llegar a la ciudad? */
function esTrasladoAlLlegar(texto: string): boolean {
  const extremos = cabeza(texto).split(/\s+(?:-|→|–)\s+/)
  return extremos.length === 2 && /\bhotel\b/i.test(extremos[1]) && !/\bhotel\b/i.test(extremos[0])
}

/**
 * Un renglón del día: hora a la izquierda (o «al llegar»), ícono y el texto en frase. Nada que no
 * esté en los datos: sin hora, la columna queda en blanco.
 */
function renglonDeEvento(e: EventoDoc, d: DiaDoc, porIndice: Map<number, TarifaDoc>): string {
  let hora = e.hora ?? ''
  let texto: string
  switch (e.tipo) {
    case 'vuelo':
      texto = e.momento === 'llegada' ? esc(e.texto.replace(/^Llegada a /, 'Llegan a ')) : `Vuelo ${esc(e.texto)}`
      break
    case 'tren': {
      const [trayecto, ...resto] = e.texto.split(' · ')
      texto = resto.length > 0 ? `Tren ${esc(resto.join(' · '))} · ${esc(flecha(trayecto))}` : `Tren ${esc(flecha(trayecto))}`
      break
    }
    case 'traslado': {
      const [trayecto, ...resto] = e.texto.split(' · ')
      texto = `Traslado ${esc(flecha(trayecto))}${resto.length > 0 ? ` · ${esc(minuscula(resto.join(' · ')))}` : ''}`
      // Del aeropuerto o la estación al hotel, el día que llegan: «al llegar».
      if (!hora && esTrasladoAlLlegar(e.texto) && d.eventos.some((x) => x.tipo === 'tren' || x.tipo === 'vuelo')) hora = 'al llegar'
      break
    }
    case 'actividad': {
      // La ciudad del día ya está en el título: «Museo del Prado · 2 h · Madrid» → «Museo del Prado · 2 h».
      const partes = e.texto.split(' · ')
      const ultima = partes[partes.length - 1]
      const sinCiudad = partes.length > 1 && d.ciudad && llano(ultima) === llano(d.ciudad) ? partes.slice(0, -1) : partes
      texto = `${esc(sinCiudad.join(' · '))}. <b>Incluida.</b>`
      break
    }
    default:
      texto = esc(e.texto)
  }
  const linea = `<div class="ev"><span class="h">${esc(hora)}</span><span class="i">${icono(ICONO_EVENTO[e.tipo])}</span><span>${texto}</span></div>`
  // Las cajitas por versión: solo los vuelos (el modelo ya no las pone en los hoteles).
  if (e.tipo !== 'vuelo' || e.porTarifa.length === 0) return linea
  const celdas = e.porTarifa
    .map((pt) => {
      const nombres = pt.tarifas
        .map((i) => porIndice.get(i))
        .filter((t): t is TarifaDoc => t !== undefined)
        .map((t) => `<span class="c${LETRA[t.clave]} fl">${esc(t.nombre)}</span>`)
        .join(' · ')
      return `<div>${nombres || '<span class="fl">Todas</span>'}<br>${(pt.siglas ?? []).map(pastillaAerolinea).join('')}${esc(pt.texto)}</div>`
    })
    .join('')
  return `${linea}<div class="opt3" style="grid-template-columns:repeat(${Math.min(3, e.porTarifa.length)},1fr)">${celdas}</div>`
}

function llano(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

/**
 * «Así se ve cada día», como el prototipo v4 (pedido de Mauricio del 2026-10-14): el número del
 * día grande con «JUE · DIC» debajo, el título y la ciudad en rosado, un renglón por hecho, las
 * versiones en cajitas solo el día de un vuelo, y los días libres con los planes de su ciudad.
 * Un día no se parte entre hojas (`.day` es `break-inside: avoid`).
 */
function diaADia(m: ModeloPropuesta): string {
  if (m.dias.length === 0) return ''
  const porIndice = tarifaPorIndice(m)
  const hayOpcionales = m.opcionales.length > 0
  const ubicados = new Set(m.dias.flatMap((d) => d.opcionales))
  const sueltos = m.opcionales.some((o) => !ubicados.has(o.nombre))
  const ver = '(ver «Planes para los días libres»)'
  const bloques = m.dias.map((d, i) => {
    const f = fecha(d.fecha)
    const { titulo, lugar } = tituloDelDia(d, i, m.dias, m)
    const renglones = d.eventos.map((e) => renglonDeEvento(e, d, porIndice))
    const sol = (h: string, contenido: string) =>
      `<div class="ev"><span class="h">${esc(h)}</span><span class="i">${icono('sun')}</span><span class="free">${contenido}</span></div>`
    const opcional = d.opcionales.length > 0 ? `<b>Opcional:</b> ${esc(oLista(d.opcionales))} ${ver}.` : null
    if (d.libre) {
      const resto = opcional ?? (hayOpcionales && sueltos ? 'Pueden sumar uno de los planes del final.' : '')
      renglones.push(sol('', `Libre para ustedes.${resto ? ` ${resto}` : ''}`))
    } else if (opcional) {
      renglones.push(sol('', opcional))
    }
    if (d.sugerencia) renglones.push(sol('', `Sugerencia: ${esc(d.sugerencia)}`))
    return `<div class="day"><div class="d">${f ? f.getUTCDate() : d.numero}<small>${f ? `${DIAS[f.getUTCDay()]} · ${MESES[f.getUTCMonth()]}` : `día ${d.numero}`}</small></div><div>
    <div class="t">${esc(titulo)}${lugar ? ` <span class="city">${esc(lugar)}</span>` : ''}</div>
    ${renglones.join('\n')}
  </div></div>`
  })
  const sub = hayOpcionales
    ? 'Lo que está en negrilla ya está incluido. Los días libres los pueden llenar con los planes opcionales del final, o simplemente caminar.'
    : 'Lo que está en negrilla ya está incluido.'
  // Sin salto de hoja forzado: con la portada larga (la COT-2026-0026 real, ruta con textos crudos)
  // las tarjetas de «Lo que van a vivir» pasaban a la hoja 2 y el salto la dejaba con dos tarjetas
  // y 85 % en blanco.
  // El encabezado va pegado al primer día en un bloque que no se parte: `break-after: avoid` del
  // `.sh` Chromium no lo respeta y el título quedaba solo al pie de la hoja 1.
  const [primero, ...resto] = bloques
  return `<section class="sec dias">\n<div class="nobr">${encabezadoDeSeccion('cal', 'Así se ve cada día', sub)}\n${primero}</div>\n${resto.join('\n')}\n</section>`
}

function dondeDuermen(m: ModeloPropuesta, r: RecursosPropuesta): string {
  if (m.hoteles.length === 0) return ''
  const porIndice = tarifaPorIndice(m)
  const regimenes = [...new Set(m.hoteles.flatMap((c) => c.opciones.map((o) => o.regimen)).filter(Boolean))]
  const sub = [
    regimenes.length === 1 ? `${regimenes[0]} en todos los hoteles.` : null,
    m.tarifas.length > 0 ? 'Un hotel por versión del viaje; la etiqueta de color dice cuál.' : null,
  ].filter(Boolean).join(' ')
  // Un hotel solo lleva la foto que subió la asesora (Mauricio, 2026-10-14); sin ella, el
  // degradado. Repetir la de la ciudad en cada hotel diría que los tres son el mismo sitio. Si
  // ningún hotel tiene foto, las tarjetas van sin imagen, como antes.
  const conImagen = m.hoteles.some((c) => c.opciones.some((o) => r.foto(o.foto?.url)))
  const ciudades = m.hoteles.map((c) => {
    const caben = extrasQueCaben('hotel', Math.min(3, Math.max(1, c.opciones.length)))
    const cuando = rango(c.desde, c.hasta)
    const noches = c.noches ? `${c.noches} ${c.noches === 1 ? 'noche' : 'noches'}` : null
    const tarjetas = c.opciones.map((o) => {
      const principal = o.tarifas.some((i) => porIndice.get(i)?.esPrincipal)
      const foto = r.foto(o.foto?.url)
      const tags = etiquetasDe(o.tarifas, porIndice)
      const tagsHtml = tags ? `<span class="tags">${tags}</span>` : ''
      const detalle = [
        estrellas(o.estrellas),
        o.habitacion ? esc(o.habitacion) : '',
      ].filter(Boolean).join(' · ')
      // Decisión 2 (2026-10-14): la cancelación del hotel NO se imprime.
      const extras = foto ? (r.extrasDeHotel?.(c.ciudad, o.hotel) ?? []).slice(0, caben) : []
      const imagen = foto || conImagen ? imagenDeTarjeta(foto, extras, tagsHtml) : ''
      return `<div class="hc${principal && m.tarifas.length > 0 ? ' rec' : ''}">${imagen}<div class="b">${imagen ? '' : tagsHtml}<div class="n">${esc(o.hotel)}</div>${detalle}${o.regimen && regimenes.length !== 1 ? `<br>${esc(o.regimen)}` : ''}${o.cargoEnDestino ? `<br><span class="muted">${esc(o.cargoEnDestino)}, se paga en el hotel</span>` : ''}</div></div>`
    })
    const columnas = Math.min(3, Math.max(1, c.opciones.length))
    return `<div class="nobr">
  <div class="cityhead"><span class="mont">${esc(c.ciudad ?? 'Hotel')}</span><span class="muted small">${esc([cuando, noches].filter(Boolean).join(' · '))}</span></div>
  <div class="hotels" style="grid-template-columns:repeat(${columnas},1fr)">${tarjetas.join('\n')}</div></div>`
  })
  return `<section class="sec">\n${encabezadoDeSeccion('bed', 'Dónde duermen', sub || null)}\n${ciudades.join('\n')}\n</section>`
}

/** Los vuelos agrupados por trayecto y fecha, en orden. */
function gruposDeVuelos(m: ModeloPropuesta): { titulo: string; filas: FilaVueloDoc[] }[] {
  const grupos = new Map<string, FilaVueloDoc[]>()
  for (const f of m.vuelos) {
    const k = `${f.fecha ?? ''}|${f.desde ?? ''}|${f.hasta ?? ''}`
    grupos.set(k, [...(grupos.get(k) ?? []), f])
  }
  const casa = (m.ruta.origen ?? '').toLowerCase()
  const lista = [...grupos.values()].sort((a, b) => (a[0].fecha ?? '').localeCompare(b[0].fecha ?? ''))
  return lista.map((filas, i) => {
    const f = filas[0]
    const vuelve = casa !== '' && (f.hasta ?? '').toLowerCase() === casa
    const nombre = vuelve && i > 0 ? 'Regreso' : i === 0 ? 'Ida' : 'Vuelo'
    const cuando = diaLargo(f.fecha) ?? f.fecha
    return { titulo: [nombre, [f.desde, f.hasta].filter(Boolean).join(' → '), cuando].filter(Boolean).join(' · '), filas }
  })
}

function vuelos(m: ModeloPropuesta): string {
  if (m.vuelos.length === 0) return ''
  const porIndice = tarifaPorIndice(m)
  const conTarifas = m.tarifas.length > 0
  const filas = gruposDeVuelos(m).map((g) => {
    const cols = conTarifas ? 4 : 3
    const sub = `<tr class="sub"><td colspan="${cols}">${esc(g.titulo)}</td></tr>`
    const cuerpo = g.filas.map((f) => {
      const vuelo = [nombreDeAerolinea(f.aerolinea, f.numero), f.numero].filter(Boolean).join(' ')
      const horario = f.salida || f.llegada ? `${f.salida ?? '?'} → ${f.llegada ?? '?'}` : ''
      const equipaje = [f.tarifaAerolinea, f.equipaje, ...f.adicionales].filter(Boolean).join(' · ')
      return `<tr>${conTarifas ? `<td>${etiquetasDe(f.tarifas.length > 0 ? f.tarifas : m.tarifas.map((t) => t.indice), porIndice)}</td>` : ''}<td>${pastillasDeVuelo(f.aerolinea, f.numero)}<span class="fl">${esc(vuelo)}</span>${f.escala ? `<br>${esc(f.escala)}` : ''}</td><td>${esc(horario)}</td><td>${esc(equipaje)}</td></tr>`
    })
    // Cada tramo (ida, regreso) es un bloque que no se parte; la tabla sí puede seguir en la
    // hoja siguiente, con la cabecera repetida. Antes la tabla entera no se partía y, detrás de
    // los hoteles, saltaba de hoja dejando media página en blanco.
    return `<tbody class="nobr">${[sub, ...cuerpo].join('\n')}</tbody>`
  })
  return `<section class="sec">\n${encabezadoDeSeccion('plane', 'Vuelos', null)}
  <table><thead><tr>${conTarifas ? '<th style="width:24mm">Versión</th>' : ''}<th>Vuelo</th><th>Horario</th><th>Equipaje</th></tr></thead>
${filas.join('\n')}
  </table>\n</section>`
}

function trenesYTraslados(m: ModeloPropuesta): string {
  const filas = m.trayectos.filas
  if (filas.length === 0) return ''
  const porIndice = tarifaPorIndice(m)
  const conColumna = m.tarifas.length > 0 && !m.trayectos.igualEnTodas
  const hayTren = filas.some((t) => t.tipo === 'tren')
  const titulo = hayTren ? 'Trenes y traslados' : 'Traslados'
  const sub = m.tarifas.length > 0 && m.trayectos.igualEnTodas ? 'Iguales en todas las versiones.' : null
  const conHora = filas.some((t) => t.hora)
  const cuerpo = filas.map((t) => {
    const dia = diaCorto(t.fecha) ?? t.fecha ?? ''
    const desc = t.tipo === 'tren' ? `<b>${esc(t.descripcion)}</b>` : esc(t.descripcion)
    return `<tr><td>${esc(dia)}</td><td>${icono(t.tipo === 'tren' ? 'train' : 'van')} ${desc}</td>${conHora ? `<td>${esc(t.hora ?? '')}</td>` : ''}${conColumna ? `<td>${etiquetasDe(t.tarifas, porIndice)}</td>` : ''}</tr>`
  })
  return `<section class="sec">\n${encabezadoDeSeccion(hayTren ? 'train' : 'van', titulo, sub)}
  <table><thead><tr><th style="width:20mm">Día</th><th>Servicio</th>${conHora ? '<th style="width:18mm">Hora</th>' : ''}${conColumna ? '<th>Versión</th>' : ''}</tr></thead>
${tramosDeFilas(cuerpo)}
  </table>\n</section>`
}

/**
 * Las filas de una tabla larga en tramos: las primeras van juntas (el título de la sección, que no
 * se separa de lo que sigue, nunca queda al pie con una sola fila) y las últimas también (ninguna
 * fila sola arriba de la hoja siguiente). Lo del medio se parte entre cualquier par de filas.
 */
function tramosDeFilas(filas: string[], juntas = FILAS_JUNTAS): string {
  if (filas.length <= juntas * 2) return `<tbody class="nobr">${filas.join('\n')}</tbody>`
  const cola = Math.min(2, filas.length - juntas)
  return [
    `<tbody class="nobr">${filas.slice(0, juntas).join('\n')}</tbody>`,
    `<tbody>${filas.slice(juntas, filas.length - cola).join('\n')}</tbody>`,
    `<tbody class="nobr">${filas.slice(filas.length - cola).join('\n')}</tbody>`,
  ].join('\n')
}
const FILAS_JUNTAS = 3

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
  // de tarjetas con y sin imagen se ve rota. Sin ninguna, como antes.
  const conImagen = fotos.some(Boolean)
  const caben = extrasQueCaben('opcional', COLUMNAS_OPCIONALES)
  const tarjetas = m.opcionales.map((o, i) => {
    const valor = o.valor > 0 ? `+ ${pesos(o.valor)}` : 'consultar'
    const lugar = lugarDelOpcional(o, m)
    const extras = fotos[i] ? (r.extrasDeOpcional?.(o.nombre) ?? []).slice(0, caben) : []
    const imagen = conImagen ? imagenDeTarjeta(fotos[i], extras, lugar ? `<div class="where">${esc(lugar)}</div>` : '') : ''
    return `<div class="oc">${imagen}<div class="b"><div class="n">${esc(o.nombre)}</div>${o.descripcion ? `<div class="muted">${esc(o.descripcion)}</div>` : ''}<div class="foot"><span class="muted">${esc(o.unidad ?? '')}</span><span class="pr money">${esc(valor)}</span></div></div></div>`
  })
  return `<section class="sec">\n${encabezadoDeSeccion('sun', 'Planes para los días libres', 'Escojan los que quieran y los sumamos a la reserva. Precio para el grupo.')}
  <div class="opcs">${tarjetas.join('\n')}</div>\n</section>`
}

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
      <div class="kicker" style="color:#ff8fbf">Aparta tu viaje</div>
      <div class="ctt">${esc(titulo)}</div>
      ${detalle ? `<div class="small" style="opacity:.85">${esc(detalle)}</div>` : ''}
    </div>
    ${botones.length > 0 ? `<div class="btns">${botones.join('\n')}</div>` : ''}
  </div>`
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
    return `<section class="sec">\n${encabezadoDeSeccion('tag', 'Precio del viaje', 'Precio total para el grupo.')}
  <table class="nobr">${lineas}${descuentos}
  <tr class="sub"><td>Total</td><td class="r money">${esc(pesos(m.precio.total))}</td></tr></table>
  ${m.precio.notaIva ? `<p class="small muted">${esc(m.precio.notaIva)}</p>` : ''}
  ${apartar(m)}\n</section>`
  }
  const tarjetas = m.tarifas.map((t) => {
    const precio = t.esPrincipal ? m.precio.total : t.precio
    const pp = ['el grupo', t.estrellas ? `${t.estrellas}★` : null].filter(Boolean).join(' · ')
    const filasVuelo = gruposDeVuelos({ ...m, vuelos: t.vuelos }).map((g) => {
      const f = g.filas[0]
      const vuelo = [nombreDeAerolinea(f.aerolinea, f.numero), f.numero].filter(Boolean).join(' ')
      const horas = f.salida || f.llegada ? ` · ${f.salida ?? '?'} → ${f.llegada ?? '?'}` : ''
      const extra = [f.tarifaAerolinea, f.equipaje, ...f.adicionales].filter(Boolean).join(' · ')
      return `<div class="row"><b>${esc(g.titulo.split(' · ')[0])}${f.fecha ? ` · ${esc(diaCorto(f.fecha) ?? '')}` : ''}</b>${pastillasDeVuelo(f.aerolinea, f.numero)}${esc(vuelo)}${f.escala ? ` · ${esc(f.escala)}` : ''}${esc(horas)}${extra ? `<br><span class="muted">${esc(extra)}</span>` : ''}</div>`
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
      ${t.esPrincipal ? '<span class="tag tR badge">La que recomendamos</span>' : ''}
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
  return `<section class="sec">\n${encabezadoDeSeccion('tag', 'Elijan su versión', sub)}
  <div class="tarifas nobr" style="grid-template-columns:repeat(${Math.min(3, m.tarifas.length)},1fr)">${tarjetas.join('\n')}</div>
  ${apartar(m)}\n</section>`
}

function incluyeYPagos(m: ModeloPropuesta): string {
  const incluye = m.precio.incluye.length > 0
    ? m.precio.incluye
    : m.tarifas.length > 0
      ? m.igualEnTodas
      : m.precio.lineas.map((l) => l.nombre)
  const lista = (xs: string[]) => `<ul class="list small">${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
  const tituloIncluye = m.tarifas.length > 0 ? 'Incluido en todas' : 'Incluido'
  const columnas = [
    incluye.length > 0 ? `<div><h3>${tituloIncluye}</h3>${lista(incluye)}</div>` : '',
    m.precio.noIncluye.length > 0 ? `<div><h3>No incluido</h3>${lista(m.precio.noIncluye)}</div>` : '',
  ].filter(Boolean)

  let plan = ''
  const planes = m.precio.planes
  if (planes.length > 0) {
    const conFilas = planes.filter((p) => p.plan.filas !== null)
    if (conFilas.length === 0) {
      plan = `<p class="small">${esc(planes[0].plan.regla)}</p>`
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
          `<tr><td><b>${esc(f.cuando[0].toUpperCase() + f.cuando.slice(1))}</b>${nota && planes.length === 1 ? ` <span class="muted">(${esc(nota)})</span>` : ''}</td>${planes
            .map((p) => `<td class="r money">${p.plan.filas?.[i] ? esc(pesos(p.plan.filas[i].monto)) : ''}</td>`)
            .join('')}</tr>`,
        )
      }
      filas.push(`<tr><td><b>Total</b></td>${planes.map((p) => `<td class="r money"><b>${esc(pesos(p.plan.suma))}</b></td>`).join('')}</tr>`)
      plan = `<table class="nobr">${cabecera}${filas.join('\n')}</table><p class="small muted">${esc(conFilas[0].plan.regla)} ${esc(conFilas[0].plan.pie)}</p>`
    }
  }
  const antes = m.formal.antesDeViajar.length > 0 ? `<div class="nobr"><h3 style="margin-top:5mm">Antes de viajar</h3>${lista(m.formal.antesDeViajar)}</div>` : ''
  if (columnas.length === 0 && !plan && !antes) return ''
  return `<section class="sec">\n<div class="nobr">${encabezadoDeSeccion('doc', plan ? 'Qué incluye y cuándo se paga' : 'Qué incluye', null)}
  ${columnas.length > 0 ? `<div class="two">${columnas.join('\n')}</div>` : ''}</div>
  ${plan ? `<div class="nobr"><h3 style="margin-top:6mm">Cuánto pagan y cuándo</h3>${plan}</div>` : ''}
  ${antes}\n</section>`
}

function formal(m: ModeloPropuesta, r: RecursosPropuesta): string {
  const terminos = (m.formal.terminos ?? '')
    .split(/\n+/)
    .map((x) => x.replace(/^\s*[-•·*]\s*/, '').trim())
    .filter(Boolean)
  const firma = m.formal.firma
  const creditos = [...new Set([...m.formal.creditos, ...(r.creditosExtra ?? [])])]
  return `<section class="sec">
  ${terminos.length > 0 ? `${encabezadoDeSeccion('doc', 'Términos y condiciones', null)}<ul class="list small">${terminos.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
  <div class="sign">
    <div>${firma ? `<b class="mont" style="color:var(--navy)">${esc(firma.nombre)}</b><br><span class="muted small">${esc([firma.cargo, firma.contacto].filter(Boolean).join(' · '))}</span>` : ''}</div>
    ${r.logo ? `<img src="${r.logo}" alt="${esc(r.marca)}" style="height:9mm">` : `<b class="mont">${esc(r.marca)}</b>`}
  </div>
  ${creditos.length > 0 ? `<div class="credits"><b>Fotografías:</b> ${creditos.map(esc).join(' · ')}</div>` : ''}
</section>`
}

/** Lo que el prototipo no tenía: tarjetas sin foto, el llamado sin botones y tablas que se parten. */
const CSS_EXTRA = `
.tN { background: var(--navy); } .cN { color: var(--navy); } .bN { background: var(--navy); }
.sinfoto { background: linear-gradient(135deg,#e63380,#8b4fa0 55%,#1fa7bd); }
.cta.solo { grid-template-columns: 1fr; }
.hc .img .tags { position:absolute; top: 2mm; left: 2mm; display:flex; gap: 1mm; flex-wrap: wrap; }
.hc .img .tags .tag { position: static; }
.hc .b > .tags { display:flex; gap: 1mm; flex-wrap: wrap; margin-bottom: 1.2mm; }
.top b.mont { font-size: 13pt; color: var(--navy); }
/* Día a día como el prototipo v4: número grande, «JUE · DIC» debajo y un separador fino entre
   días (sin la línea de tiempo ni los círculos del v5). */
.dias .day { grid-template-columns: 22mm 1fr; gap: 4mm; padding: 2.6mm 0; border-bottom: 1px solid var(--line); }
.dias > .day:last-child { border-bottom: 0; }
.dias .day::before { display: none; }
.dias .day .d { width: auto; height: auto; border-radius: 0; background: none; color: var(--navy); font: 800 15pt Montserrat; line-height: 1; display: block; }
.dias .day .d small { color: var(--mute); opacity: 1; font: 600 7pt Montserrat; letter-spacing: 1px; text-transform: uppercase; margin-top: 1mm; }
.dias .day .t { font-size: 10pt; margin-top: 0; }
.dias .ev { grid-template-columns: 14mm 5mm 1fr; }
.dias .ev .h { white-space: nowrap; }
/* Las tablas siguen en la hoja siguiente (cabecera repetida); una fila nunca se parte. */
tr { break-inside: avoid; }
thead { display: table-header-group; }
/* Fotos extra de la biblioteca: en el MISMO recuadro (mismo alto), principal 2/3 y extras 1/3. */
.img.mosaico { display:grid; grid-template-columns: 2fr 1fr; gap: .6mm; background: #fff; }
.img.mosaico.n1 { grid-template-rows: 1fr; }
.img.mosaico.n2 { grid-template-rows: 1fr 1fr; }
.img.mosaico .m0 { grid-row: 1 / -1; background-size: cover; background-position: center; }
.img.mosaico .mx { background-size: cover; background-position: center; }
/* Una tarjeta de versión no se parte nunca; si las tres no caben, el bloque salta entero. */
.tf { break-inside: avoid; }
`

export function htmlDePropuesta(m: ModeloPropuesta, r: RecursosPropuesta): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${esc(m.portada.consecutivo)} · ${esc(m.portada.titulo)}</title>
<style>${CSS_PROPUESTA}${CSS_EXTRA}</style></head><body>
${ICONOS_PROPUESTA}
<section>
${portada(m, r)}
${ruta(m)}
${loQueVanAVivir(m, r)}
</section>
${diaADia(m)}
${dondeDuermen(m, r)}
${vuelos(m)}
${trenesYTraslados(m)}
${opcionales(m, r)}
${eligeTuVersion(m)}
${incluyeYPagos(m)}
${formal(m, r)}
</body></html>`
}

// ── Encabezado y pie de cada hoja (Chromium los pinta aparte) ──────────────────

const COLOR_EXACTO = '-webkit-print-color-adjust:exact;print-color-adjust:exact;'

/** La franja degradada de 1,6 mm arriba de cada hoja. */
export function encabezadoDeHoja(): string {
  return `<div style="${COLOR_EXACTO}width:100%;margin:-4mm 0 0;height:1.6mm;background:linear-gradient(90deg,#e63380,#8b4fa0 55%,#1fa7bd)"></div>`
}

/**
 * La banda navy del pie: los datos de la agencia a la izquierda (el pie configurado del
 * documento) y «COT-xxxx · N de M» a la derecha. `cssFuente` es el `@font-face` de Inter: el
 * pie se pinta en otro contexto, sin las fuentes de la página.
 */
export function pieDeHoja(opts: { texto: string; codigo: string; cssFuente?: string | null }): string {
  const ff = opts.cssFuente ? `<style>${opts.cssFuente}</style>` : ''
  return `${ff}<div style="${COLOR_EXACTO}width:100%;margin:0 0 -4mm;background:#2b1840;color:#fff;font:6.8pt Inter,sans-serif;padding:3mm 12mm 3.4mm;display:flex;justify-content:space-between;gap:6mm"><span>${esc(opts.texto)}</span><span style="white-space:nowrap">${esc(opts.codigo)} · <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`
}
