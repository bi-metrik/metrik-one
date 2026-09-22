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

/** Un número de vuelo suelto: `8832`, `AV8520`, `9R8832`, con una letra de sufijo a lo sumo. */
const NUMERO_DE_VUELO = /^(?:[A-Z0-9]{2})?\d{1,4}[A-Z]?$/i

/**
 * Los números de vuelo de un texto leído, uno por elemento. `null` si algún pedazo no es un
 * número de vuelo: entonces el texto no se puede repartir entre tramos.
 *
 * La lectura los escribe «tal como aparecen», y en las capturas reales aparecen separados
 * por coma (`9782, 9779`), por punto medio (`8832 · 8833`), por barra o por espacio, y con
 * o sin el código de la aerolínea pegado (`AV 8520`).
 */
function numerosSueltos(texto: string): string[] | null {
  const partes = texto.split(/\s*(?:[,;/|+·•–—]|\s-\s|\sy\s)\s*/i).map(p => p.trim()).filter(Boolean)
  const out: string[] = []
  for (const p of partes) {
    const junto = p.replace(/^([A-Z0-9]{2})[\s-]+(\d{1,4}[A-Z]?)$/i, '$1$2')
    if (NUMERO_DE_VUELO.test(junto)) {
      out.push(junto)
      continue
    }
    const sub = p.split(/\s+/)
    if (sub.length > 1 && sub.every(s => NUMERO_DE_VUELO.test(s))) {
      out.push(...sub)
      continue
    }
    return null
  }
  return out
}

/**
 * Los números de vuelo de la ida y del regreso.
 *
 * La lectura guarda el campo «tal como aparece»: `AV8520`, o `9782, 9779`, o `8832 · 8833`,
 * o los cuatro tramos de un viaje con escala. Con una cantidad PAR y regreso, la primera
 * mitad es la ida y la segunda el regreso, que es el orden en que la pantalla los muestra.
 *
 * ⚠️⚠️ Cuando no se puede saber cuál es de cuál —un solo número para un viaje de ida y
 * regreso, tres números, un texto que no se deja partir— NO se imprime todo en la fila de
 * la ida: eso afirmaba que el regreso no tenía vuelo y que la ida tenía tres. Va en
 * `sinAsignar`, que la plantilla imprime a nivel del vuelo entero, sin pegarlo a un tramo.
 * (COT-2026-0006: `8832 · 8833` caía entero en la ida porque el `·` no era separador.)
 */
export function numerosDeVuelo(
  numero: string | null | undefined,
  hayRegreso: boolean,
): { ida: string | null; regreso: string | null; sinAsignar: string | null } {
  const limpio = (numero ?? '').trim()
  if (!limpio) return { ida: null, regreso: null, sinAsignar: null }
  const tokens = numerosSueltos(limpio)
  // Sin regreso todo es de la ida: es la única fila que hay.
  if (!hayRegreso) return { ida: tokens ? tokens.join(' · ') : limpio, regreso: null, sinAsignar: null }
  if (tokens && tokens.length >= 2 && tokens.length % 2 === 0) {
    const mitad = tokens.length / 2
    return { ida: tokens.slice(0, mitad).join(' · '), regreso: tokens.slice(mitad).join(' · '), sinAsignar: null }
  }
  return { ida: null, regreso: null, sinAsignar: tokens ? tokens.join(' · ') : limpio }
}

/**
 * Lo que el NOMBRE de una línea dice de su vuelo: `AVIANCA BOG - ADZ` → aerolínea `AVIANCA`,
 * ruta `BOG` → `ADZ`.
 *
 * Es el último recurso, para una línea de vuelo que no tiene lectura: lo que imprime es lo
 * que quien cotiza escribió, tal cual, y nada más. Ni fechas ni horas, que el nombre no dice.
 *
 * - La ruta: dos códigos IATA en MAYÚSCULA separados por guion, flecha, barra o « a ». En
 *   minúscula no cuenta: «bog-adz» puede ser cualquier cosa.
 * - La aerolínea: lo que queda del nombre sin la ruta y sin paréntesis, solo si es una
 *   aerolínea conocida (`siglaAerolinea`). Sin ruta no se intenta: el resto del nombre sería
 *   el nombre entero, y «SATENA ADZ - PROVIDENCIA» no es el nombre de una aerolínea.
 */
export function vueloDesdeNombre(nombre: string | null | undefined): { aerolinea: string | null; origen: string | null; destino: string | null } {
  const t = (nombre ?? '').trim()
  const ruta = /(^|[^A-Za-z])([A-Z]{3})\s*(?:-|–|—|→|>|\/|\sa\s)\s*([A-Z]{3})(?![A-Za-z])/.exec(t)
  if (!ruta || ruta[2] === ruta[3]) return { aerolinea: null, origen: null, destino: null }
  const resto = (t.slice(0, ruta.index + ruta[1].length) + ' ' + t.slice(ruta.index + ruta[0].length))
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[\s\-–—·,:]+/g, ' ')
    .trim()
  return {
    aerolinea: resto !== '' && siglaAerolinea(resto) !== null ? resto : null,
    origen: ruta[2],
    destino: ruta[3],
  }
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

// ── Precio por pasajero contra el TOTAL ───────────────────────────────────────

export interface FilaPorPasajeroDoc {
  tipo: 'adulto' | 'nino' | 'infante'
  cantidad: number | null
  precioUnitario: number
}

/**
 * Deja la tabla por pasajero sumando EXACTAMENTE el total, absorbiendo en una fila el
 * residuo del redondeo.
 *
 * ## Por qué (COT-2026-0006, 2026-09-22)
 *
 * Cada línea reparte su precio entre tipos al peso, y luego lo divide entre cuántos son:
 * `9.911.816 / 6` no da entero, se redondea a 1.651.969 y se pierden 2 pesos. El documento
 * los publicaba como «Se cobra por el grupo $ 2»: un cobro que no existe, con nombre, en la
 * sección que el cliente usa para saber cuánto paga cada uno.
 *
 * Esta función solo recibe un residuo que YA se sabe que es de redondeo (la plantilla lo
 * decide: nada se cobra por el grupo y el residuo cabe en un peso por pasajero y línea).
 * Lo pone en la fila donde cabe entero —`residuo % cantidad === 0`, o sea siempre en una
 * fila de un solo pasajero— y entre esas, en la de mayor subtotal, donde menos se nota.
 * Así `c/u × cantidad` sigue siendo el subtotal de cada fila y la columna suma el TOTAL.
 *
 * Si ninguna fila puede absorberlo entero (seis adultos y dos niños con 1 peso de
 * residuo), devuelve el residuo intacto: la plantilla lo nombra como ajuste de redondeo,
 * que es lo que es. Repartirlo en un `c/u` que no multiplique bien sería otra cifra que no
 * cuadra.
 */
export function absorberRedondeo(
  filas: FilaPorPasajeroDoc[],
  residuo: number,
): { filas: FilaPorPasajeroDoc[]; residuo: number } {
  if (residuo === 0) return { filas, residuo: 0 }
  let mejor = -1
  filas.forEach((f, i) => {
    if (f.cantidad === null || f.cantidad <= 0) return
    if (residuo % f.cantidad !== 0) return
    if (f.precioUnitario + residuo / f.cantidad <= 0) return
    if (mejor === -1) { mejor = i; return }
    const actual = filas[mejor]
    if (f.precioUnitario * f.cantidad > actual.precioUnitario * (actual.cantidad as number)) mejor = i
  })
  if (mejor === -1) return { filas, residuo }
  return {
    filas: filas.map((f, i) => (i === mejor ? { ...f, precioUnitario: f.precioUnitario + residuo / (f.cantidad as number) } : f)),
    residuo: 0,
  }
}

// ── Utilidades ────────────────────────────────────────────────────────────────

export function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Sin tildes, en minúscula, sin puntuación y con un solo espacio. */
function comparable(s: string): string {
  return sinTildes(s).replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * La línea bajo el título de la portada: contacto y empresa, sin repetir.
 *
 * Una persona natural suele quedar con una empresa creada a su nombre, así que contacto y
 * empresa dicen lo mismo y la portada imprimía «Ana Gómez · Ana Gómez». Se comparan sin
 * mayúsculas, sin tildes, sin puntuación y sin espacios sobrantes; si son el mismo nombre,
 * sale uno solo (el del contacto, como se escribió). `null` si no hay ninguno.
 */
export function clienteDeLaPortada(contacto: string | null | undefined, empresa: string | null | undefined): string | null {
  const c = contacto?.trim() || null
  const e = empresa?.trim() || null
  if (c && e && comparable(c) === comparable(e)) return c
  return [c, e].filter(Boolean).join(' · ') || null
}

/**
 * ¿Este nombre ya está dicho en el título de la portada?
 *
 * Con un solo capítulo, su nombre es casi siempre el destino del negocio, y el título de la
 * portada casi siempre lo nombra: «San Andrés - Providencia» salía en 34 pt arriba y otra
 * vez en 22 pt media página más abajo. Se compara por palabras enteras y sin tildes, así
 * que «Cancún» está en «Viaje a Cancún» y «Roma» no está en «Romería».
 */
export function yaEstaEnElTitulo(nombre: string | null | undefined, titulo: string): boolean {
  const n = comparable(nombre ?? '')
  if (n === '') return false
  return ` ${comparable(titulo)} `.includes(` ${n} `)
}

/** El vuelo tiene regreso si la captura leyó algo suyo: la misma regla de `trayectosDelVuelo`. */
export function tieneRegreso(v: VueloPDF): boolean {
  return v.fechaRegreso !== null || v.horaSalidaRegreso !== null || v.horaLlegadaRegreso !== null
}
