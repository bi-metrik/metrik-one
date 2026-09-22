/**
 * Las reglas de FORMA del documento de Trappvel que se pueden decidir sin dibujar.
 *
 * Sistema visual: `proyectos/trappvel/clarity/docs/diseno/sistema-visual-documento.md`
 * (Ren, 2026-09-22). Viven aparte de la plantilla para probarlas sin renderizar un PDF:
 * qué color lleva cada tarifa, qué sigla lleva cada aerolínea, en qué fecha cae el día 3,
 * cómo se agrupa el viaje por ciudad.
 *
 * Nada de aquí mueve un número de la cotización: formatea, agrupa y colorea.
 */

import type { HotelPDF, VueloPDF } from '@/lib/cotizaciones/detalle-viaje'

// ── Tokens (§2) ───────────────────────────────────────────────────────────────

/**
 * ⚠️ PROVISIONALES: tomados a ojo de las capturas del itinerario de Europa, no de un
 * manual de Trappvel (§2 del sistema visual). Se usan tal cual hasta que Isa o Edgar
 * manden los oficiales; cambiarlos es tocar solo este objeto.
 */
export const TOKENS = {
  magenta: '#E63380',
  purpura: '#8B2FE6',
  azul: '#3D8BE0',
  tinta: '#161A33',
  texto: '#3A3F55',
  gris: '#8A8FA3',
  grisClaro: '#B9BDCC',
  tarjeta: '#F6F5FA',
  linea: '#E6E4EE',
  verde: '#1FB58F',
  rojo: '#E0413A',
  dorado: '#F5B400',
  ambarFondo: '#FFF4E0',
  ambarBorde: '#F0A500',
  ambarTexto: '#7A5200',
  blanco: '#FFFFFF',
} as const

// ── Color por tarifa (§3) ─────────────────────────────────────────────────────

/**
 * Un color por tarifa, el MISMO en todo el documento: así el cliente sigue su opción de
 * punta a punta sin leer una leyenda.
 *
 * La principal es magenta aunque se llame distinto: es la que el documento recomienda y
 * la única cuyo precio coincide con el TOTAL. Una tarifa que no se deja reconocer por su
 * nombre recibe azul, que no choca con ninguna de las tres.
 */
export function colorDeTarifa(titulo: string, esPrincipal: boolean): string {
  if (esPrincipal) return TOKENS.magenta
  const t = sinTildes(titulo)
  if (t.includes('econom')) return TOKENS.verde
  if (t.includes('premium')) return TOKENS.purpura
  if (t.includes('recomend')) return TOKENS.magenta
  return TOKENS.azul
}

// ── Aerolínea ─────────────────────────────────────────────────────────────────

/** Sigla IATA de las aerolíneas que Trappvel vende. Clave: nombre sin tildes, minúscula. */
const SIGLAS: [string, string][] = [
  ['avianca', 'AV'],
  ['latam', 'LA'],
  ['satena', '9R'],
  ['wingo', 'P5'],
  ['easyfly', 'VE'],
  ['clic', 'VE'],
  ['jetsmart', 'JA'],
  ['copa', 'CM'],
  ['iberia', 'IB'],
  ['air europa', 'UX'],
  ['american', 'AA'],
  ['delta', 'DL'],
  ['united', 'UA'],
  ['aeromexico', 'AM'],
  ['volaris', 'Y4'],
  ['viva aerobus', 'VB'],
  ['vivaaerobus', 'VB'],
  ['air france', 'AF'],
  ['klm', 'KL'],
  ['lufthansa', 'LH'],
  ['turkish', 'TK'],
  ['spirit', 'NK'],
  ['arajet', 'DM'],
  ['jetblue', 'B6'],
  ['british airways', 'BA'],
  ['ita airways', 'AZ'],
  ['tap', 'TP'],
  ['emirates', 'EK'],
  ['qatar', 'QR'],
]

/**
 * La sigla de la pastilla. Primero la que trae el número de vuelo (`AV8520` → `AV`),
 * que es un dato leído; si no, la del nombre. Sin ninguna de las dos devuelve `null` y la
 * pastilla no se pinta: dos letras inventadas se leerían como un código real.
 */
export function siglaAerolinea(aerolinea: string | null, numeroVuelo?: string | null): string | null {
  const delNumero = /^([A-Z0-9]{2})\s?\d{1,4}\b/.exec((numeroVuelo ?? '').trim().toUpperCase())
  if (delNumero && /[A-Z]/.test(delNumero[1])) return delNumero[1]
  if (!aerolinea) return null
  const n = sinTildes(aerolinea)
  // La clave tiene que ser palabra entera: «tap» no puede atrapar «Tapachula».
  for (const [clave, sigla] of SIGLAS) {
    if (new RegExp(`(^|[^a-z])${clave}([^a-z]|$)`).test(n)) return sigla
  }
  return null
}

/** Rotación magenta → verde → púrpura por sigla, como en la referencia (§4.4). */
export function colorDeSigla(sigla: string): string {
  const colores = [TOKENS.magenta, TOKENS.verde, TOKENS.purpura]
  let h = 0
  for (const c of sigla) h = (h * 31 + c.charCodeAt(0)) % 997
  return colores[h % colores.length]
}

/**
 * Los números de vuelo de la ida y del regreso.
 *
 * La lectura guarda el campo «tal como aparece»: `AV8520`, o `AV8520 / AV9380`, o los
 * cuatro tramos de un viaje con escala. Con una cantidad PAR y regreso, la primera mitad
 * es la ida y la segunda el regreso, que es el orden en que la pantalla los muestra. Con
 * cualquier otra forma no se reparte: va entero en la ida, y no se adivina.
 */
export function numerosDeVuelo(numero: string | null | undefined, hayRegreso: boolean): { ida: string | null; regreso: string | null } {
  const limpio = (numero ?? '').trim()
  if (!limpio) return { ida: null, regreso: null }
  const tokens = limpio.split(/[\s,;/|+]+/).filter(Boolean)
  const todosVuelos = tokens.length > 1 && tokens.every(t => /^[A-Z0-9]{2}\d{1,4}$/i.test(t))
  if (hayRegreso && todosVuelos && tokens.length % 2 === 0) {
    const mitad = tokens.length / 2
    return { ida: tokens.slice(0, mitad).join(' · '), regreso: tokens.slice(mitad).join(' · ') }
  }
  return { ida: limpio, regreso: null }
}

/**
 * «Bogotá BOG» → `{ nombre: 'Bogotá', iata: 'BOG' }`. La lectura escribe la ciudad con el
 * código pegado; el documento lo muestra como `Bogotá (BOG)`.
 */
export function lugarConCodigo(texto: string | null | undefined): { nombre: string; iata: string | null } | null {
  const t = (texto ?? '').trim()
  if (!t) return null
  const m = /^(.*\S)\s+\(?([A-Z]{3})\)?$/.exec(t)
  if (m) return { nombre: m[1], iata: m[2] }
  if (/^[A-Z]{3}$/.test(t)) return { nombre: t, iata: null }
  return { nombre: t, iata: null }
}

export function lugarLegible(texto: string | null | undefined): string | null {
  const l = lugarConCodigo(texto)
  if (!l) return null
  return l.iata ? `${l.nombre} (${l.iata})` : l.nombre
}

// ── Fechas ────────────────────────────────────────────────────────────────────

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

export interface Fecha {
  anio: number | null
  mes: number // 0-11
  dia: number
}

/**
 * Lee las dos formas de fecha que llegan a la plantilla: ISO (`2027-01-17`) y la corta
 * que arma `fechaCorta` (`17 ene 2027`, o `17 ene` si la captura no traía el año).
 */
export function leerFecha(texto: string | null | undefined): Fecha | null {
  const t = (texto ?? '').trim()
  if (!t) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (iso) return { anio: Number(iso[1]), mes: Number(iso[2]) - 1, dia: Number(iso[3]) }
  const corta = /^(\d{1,2})\s+([a-záéíóú]{3})[a-z]*\.?(?:\s+(\d{4}))?$/i.exec(t)
  if (corta) {
    const mes = MESES.indexOf(sinTildes(corta[2]).slice(0, 3))
    if (mes === -1) return null
    return { anio: corta[3] ? Number(corta[3]) : null, mes, dia: Number(corta[1]) }
  }
  return null
}

function aDia(f: Fecha): number | null {
  if (f.anio === null) return null
  return Date.UTC(f.anio, f.mes, f.dia) / 86_400_000
}

/** La fecha del día N del viaje (el día 1 es el de salida). `null` sin fecha de salida. */
export function fechaDelDia(inicio: string | null | undefined, dia: number): Fecha | null {
  const f = leerFecha(inicio)
  if (!f || f.anio === null) return null
  const d = new Date(Date.UTC(f.anio, f.mes, f.dia + dia - 1))
  return { anio: d.getUTCFullYear(), mes: d.getUTCMonth(), dia: d.getUTCDate() }
}

/** El año que le falta a una fecha corta, tomado del inicio del viaje. */
export function conAnio(f: Fecha | null, inicio: string | null | undefined): Fecha | null {
  if (!f) return null
  if (f.anio !== null) return f
  const i = leerFecha(inicio)
  if (!i || i.anio === null) return f
  // Un viaje de diciembre a enero: la fecha de enero es del año siguiente.
  const anio = f.mes < i.mes ? i.anio + 1 : i.anio
  return { ...f, anio }
}

/** «17» y «ENE»: lo que va dentro del círculo de la línea de tiempo. */
export function circuloDeFecha(f: Fecha): { arriba: string; abajo: string } {
  return { arriba: String(f.dia), abajo: MESES[f.mes].toUpperCase() }
}

/** «Domingo 17 de enero». `null` sin año: el día de la semana no se puede saber. */
export function diaDeLaSemana(f: Fecha): string | null {
  if (f.anio === null) return null
  const d = new Date(Date.UTC(f.anio, f.mes, f.dia))
  return `${DIAS[d.getUTCDay()]} ${f.dia} de ${MESES_LARGOS[f.mes]}`
}

export function claveDeFecha(f: Fecha): number | null {
  return aDia(f)
}

/**
 * «17–24 ene» si caen en el mismo mes, «28 ene – 3 feb» si no. Con una sola punta, esa;
 * si no se pueden leer, las dos tal como llegaron.
 */
export function rangoCompacto(desde: string | null, hasta: string | null): string | null {
  const a = leerFecha(desde)
  const b = leerFecha(hasta)
  if (a && b) {
    if (a.mes === b.mes && a.anio === b.anio) return `${a.dia}–${b.dia} ${MESES[a.mes]}`
    return `${a.dia} ${MESES[a.mes]} – ${b.dia} ${MESES[b.mes]}`
  }
  if (desde && hasta) return `${desde} – ${hasta}`
  return desde ?? hasta ?? null
}

// ── Tarifas de un vuelo o un hotel ────────────────────────────────────────────

/**
 * ¿Pertenece a la tarifa principal? Sin tarifas declaradas pertenece a todas: es la
 * cotización de una sola opción, o una sin itinerarios.
 */
export function esDeLaPrincipal(elemento: { tarifas?: number[] }, principal: number | null): boolean {
  if (!elemento.tarifas || elemento.tarifas.length === 0 || principal === null) return true
  return elemento.tarifas.includes(principal)
}

// ── Capítulos por ciudad (§4.3) ───────────────────────────────────────────────

export interface Capitulo {
  /** El nombre como lo escribió la lectura. `null` = capítulo sin ciudad (un solo destino). */
  ciudad: string | null
  /** El hotel grande: el de la tarifa principal en esa ciudad. */
  hotel: HotelPDF | null
  /** Los hoteles de las otras tarifas en esa ciudad: una línea cada uno. */
  alternativas: HotelPDF[]
}

/**
 * El viaje partido por ciudad, en el orden de los hoteles de la tarifa principal.
 *
 * Un hotel de otra tarifa va al capítulo de SU ciudad; si esa ciudad no tiene hotel de la
 * principal, al primero. Sin hoteles hay un solo capítulo, con el destino del negocio.
 */
export function capitulosDelViaje(hoteles: HotelPDF[], principal: number | null, destino: string | null): Capitulo[] {
  const deLaPrincipal = hoteles.filter(h => esDeLaPrincipal(h, principal))
  const otros = hoteles.filter(h => !esDeLaPrincipal(h, principal))
  const capitulos: Capitulo[] = []
  for (const h of deLaPrincipal) {
    const clave = sinTildes(h.ciudad ?? '')
    const ya = capitulos.find(c => sinTildes(c.ciudad ?? '') === clave)
    if (ya) ya.alternativas.push(h)
    else capitulos.push({ ciudad: h.ciudad, hotel: h, alternativas: [] })
  }
  if (capitulos.length === 0) capitulos.push({ ciudad: destino, hotel: null, alternativas: [] })
  for (const h of otros) {
    const clave = sinTildes(h.ciudad ?? '')
    const destinoCap = capitulos.find(c => sinTildes(c.ciudad ?? '') === clave) ?? capitulos[0]
    destinoCap.alternativas.push(h)
  }
  return capitulos
}

/** ¿Esta fecha cae dentro de la estadía del hotel del capítulo? El día de salida no. */
export function fechaEnCapitulo(f: Fecha, c: Capitulo, inicio: string | null | undefined): boolean {
  if (!c.hotel) return false
  const d = claveDeFecha(f)
  const a = conAnio(leerFecha(c.hotel.checkIn), inicio)
  const b = conAnio(leerFecha(c.hotel.checkOut), inicio)
  if (d === null || !a || !b) return false
  const da = claveDeFecha(a)
  const db = claveDeFecha(b)
  if (da === null || db === null) return false
  return d >= da && d < db
}

// ── Títulos ───────────────────────────────────────────────────────────────────

/**
 * El título partido para pintar una parte en magenta (§4.2): el destino si el título lo
 * nombra; si no, la última palabra. El texto no se reescribe: sale como se escribió.
 */
export function tituloConAcento(titulo: string, destino: string | null): { antes: string; acento: string; despues: string } {
  const t = titulo.trim()
  if (destino) {
    const i = sinTildes(t).indexOf(sinTildes(destino.trim()))
    if (i >= 0 && destino.trim()) {
      const largo = destino.trim().length
      return { antes: t.slice(0, i), acento: t.slice(i, i + largo), despues: t.slice(i + largo) }
    }
  }
  const m = /^(.*\s)?(\S+)$/.exec(t)
  if (!m) return { antes: '', acento: t, despues: '' }
  return { antes: m[1] ?? '', acento: m[2], despues: '' }
}

// ── Utilidades ────────────────────────────────────────────────────────────────

export function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** El vuelo tiene regreso si la captura leyó algo suyo: la misma regla de `trayectosDelVuelo`. */
export function tieneRegreso(v: VueloPDF): boolean {
  return v.fechaRegreso !== null || v.horaSalidaRegreso !== null || v.horaLlegadaRegreso !== null
}
