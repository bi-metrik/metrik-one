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
import { siglaAerolinea } from '@/lib/cotizaciones/aerolineas'

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
 * **Va por el NOMBRE** (decisión de Mauricio, 2026-09-22): Recomendada magenta, Económica
 * verde, Premium púrpura. Hasta ese día la principal se pintaba magenta sin importar cómo
 * se llamara, y con la Económica como principal el documento salía con DOS tarifas
 * magenta. Una tarifa que no se deja reconocer por su nombre recibe azul, que no choca
 * con ninguna de las tres.
 */
export function colorDeTarifa(titulo: string): string {
  const t = sinTildes(titulo)
  if (t.includes('econom')) return TOKENS.verde
  if (t.includes('premium')) return TOKENS.purpura
  if (t.includes('recomend')) return TOKENS.magenta
  return TOKENS.azul
}

// ── Aerolínea ─────────────────────────────────────────────────────────────────

/**
 * La sigla y el color de la pastilla salen del catálogo único de aerolíneas (brief del
 * 2026-10-08): `@/lib/cotizaciones/aerolineas`. Se reexporta la sigla porque la usan esta
 * misma hoja (`partirLineaDeVuelo`) y las pruebas de la plantilla.
 */
export { siglaAerolinea } from '@/lib/cotizaciones/aerolineas'

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

/**
 * «Tarifa niño de X a Y años cumplidos a la fecha del viaje»: el rango que da el hotel, escrito
 * en el ingreso manual (`ingreso-manual.ts`). Rige la edad A LA FECHA DEL VIAJE, no la de la
 * cotización (llamada con Alejandra, 2026-09-28). Sin rango, nada.
 */
export function textoTarifaNino(e: { desde: number; hasta: number } | null | undefined): string | null {
  if (!e) return null
  if (e.desde === e.hasta) return `Tarifa niño de ${e.desde} años cumplidos a la fecha del viaje`
  return `Tarifa niño de ${e.desde} a ${e.hasta} años cumplidos a la fecha del viaje`
}

// ── La tarjeta de un hotel (§4.3) ─────────────────────────────────────────────

/**
 * Lo que dice la tarjeta de un hotel en el documento, en palabras: el nombre, el renglón de
 * la estadía, las condiciones, los adicionales y la nota. `general` = el nivel de detalle que
 * no nombra habitación ni régimen.
 *
 * Es la ÚNICA fuente de esos textos: la pinta el PDF (`TarjetaHotel`) y la pinta «Así lo ve el
 * cliente» en la tarjeta de la opción. Escritos dos veces, la vista previa y el documento
 * dirían cosas distintas.
 *
 * ⚠️ La política de cancelación leída de la captura NO sale en ningún nivel (2026-09-28): es la
 * condición que el proveedor le da a la AGENCIA, no la que Trappvel le promete al viajero. Se
 * sigue leyendo y guardando, y se ve en la ficha interna de la tarjeta (el equipo la necesita
 * para saber hasta cuándo puede soltar la reserva). Lo que se le promete al cliente va en los
 * términos y condiciones. Entre el 2026-09-22 y el 2026-09-28 salía en «normal».
 */
export function textosDeTarjetaHotel(h: HotelPDF, general: boolean): {
  nombre: string
  estrellas: number | null
  resumen: string
  condiciones: string
  adicionales: string | null
  nota: string | null
} {
  const resumen = [
    rangoCompacto(h.checkIn, h.checkOut),
    h.noches ? `${h.noches} ${h.noches === 1 ? 'noche' : 'noches'}` : null,
    !general ? h.regimen : null,
    !general ? h.habitacion : null,
  ].filter(Boolean).join(' · ')
  const condiciones = [
    !general && h.ocupacion ? `Acomodación: ${h.ocupacion}` : null,
    !general && h.incluye ? `Incluye: ${h.incluye}` : null,
    // Condición del PRECIO, no letra chica: sale en los tres niveles (ingreso manual).
    textoTarifaNino(h.edadNino),
    h.localizador ? `Localizador: ${h.localizador}` : null,
  ].filter(Boolean).join(' · ')
  return {
    nombre: h.hotel ?? h.linea,
    estrellas: h.estrellas ?? null,
    resumen,
    condiciones,
    adicionales: h.adicionales.length > 0 ? `Adicionales: ${h.adicionales.join(' · ')}` : null,
    nota: h.nota ? h.nota : null,
  }
}

/**
 * Una descripción de línea sin la condición de cancelación del proveedor.
 *
 * La lectura de una captura escribe en la descripción del ítem «… · Cancelación: gratuita hasta
 * 18/11/2026 · …» (`lectura-pantallazo.ts`), y el documento imprime esa descripción en los días
 * y en los opcionales. Esa condición es de la agencia con el proveedor (ver
 * `textosDeTarjetaHotel`): se quita el segmento, lo demás queda igual. `null` si no queda nada.
 */
export function sinCancelacionDelProveedor(descripcion: string | null | undefined): string | null {
  if (!descripcion) return null
  const partes = descripcion.split(' · ').filter(p => !/^\s*Cancelaci[oó]n:/i.test(p))
  const t = partes.join(' · ').trim()
  return t === '' ? null : t
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
  /**
   * Los demás hoteles de esa ciudad (otras tarifas, o un segundo hotel de la principal): una
   * línea cada uno, o su tarjeta con la miniatura si el asesor le puso foto (2026-10-08).
   */
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
    const clave = claveDeCiudad(h.ciudad)
    const ya = capitulos.find(c => claveDeCiudad(c.ciudad) === clave)
    if (ya) ya.alternativas.push(h)
    else capitulos.push({ ciudad: ciudadDeCapitulo(h.ciudad), hotel: h, alternativas: [] })
  }
  if (capitulos.length === 0) capitulos.push({ ciudad: destino, hotel: null, alternativas: [] })
  for (const h of otros) {
    const clave = claveDeCiudad(h.ciudad)
    const destinoCap = capitulos.find(c => claveDeCiudad(c.ciudad) === clave) ?? capitulos[0]
    destinoCap.alternativas.push(h)
  }
  return capitulos
}

/**
 * La ciudad de un hotel tal como nombra su capítulo: lo que va antes de la primera coma.
 *
 * Brief del 2026-10-05, punto 9: el hotel a mano decía «Providencia» y el de pantallazo
 * «Providencia, San Andrés y Providencia, Colombia» (Bedsonline escribe la ciudad, el
 * departamento y el país). Comparando el texto entero eran dos ciudades, y el PDF abría
 * «Destino 2 de 2» para la misma isla.
 */
export function ciudadDeCapitulo(ciudad: string | null | undefined): string | null {
  const t = (ciudad ?? '').split(',')[0].trim()
  return t === '' ? null : t
}

/** La llave con que se juntan los hoteles de una misma ciudad: sin tildes, sin código ni país. */
export function claveDeCiudad(ciudad: string | null | undefined): string {
  const corta = ciudadDeCapitulo(ciudad) ?? ''
  return sinTildes(lugarConCodigo(corta)?.nombre ?? corta).replace(/\s+/g, ' ').trim()
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

// ── Encuadre de una foto ──────────────────────────────────────────────────────

/**
 * Dónde anclar una foto recortada con `objectFit: 'cover'` para que el sujeto quede
 * dentro del marco: el valor de `objectPosition` («30% 93%»).
 *
 * El foco es UNO por foto (lo fija quien la mira: `fotos-ciudad.ts`), y el marco cambia
 * según dónde va (la portada es 2,7 veces más ancha que alta; una miniatura, 1,5). Con
 * `cover`, la foto se escala hasta llenar el marco y sobra por un solo eje: el ancho, si
 * la foto es más apaisada que el marco; el alto, si no. Por ese eje se ve una franja de
 * la foto, y el ancla se elige para que el foco quede en el centro de esa franja:
 *
 *     visible = la fracción de la foto que cabe por el eje que sobra
 *     ancla   = (foco − visible/2) / (1 − visible), entre 0 y 1
 *
 * react-pdf aplica el porcentaje igual que CSS: desplaza la foto `(marco − foto) × ancla`.
 * Por eso la fórmula centra el foco. Cuando el foco está tan al borde que centrarlo
 * dejaría un hueco, el ancla se queda en el borde: se ve todo lo que cabe hacia ese lado.
 *
 * Sin foco o sin proporción (una foto propia del cliente), el centro: como antes.
 */
export function encuadreDeFoto(
  foco: { x: number; y: number } | null | undefined,
  proporcionFoto: number | null | undefined,
  proporcionMarco: number,
): string {
  const centro = '50% 50%'
  if (!foco || !proporcionFoto || !(proporcionFoto > 0) || !(proporcionMarco > 0)) return centro
  const acotar = (v: number) => Math.min(1, Math.max(0, v))
  const pct = (v: number) => `${Math.round(v * 1000) / 10}%`
  const ancla = (f: number, visible: number) => acotar((acotar(f) - visible / 2) / (1 - visible))
  if (proporcionFoto > proporcionMarco) return `${pct(ancla(foco.x, proporcionMarco / proporcionFoto))} 50%`
  if (proporcionFoto < proporcionMarco) return `50% ${pct(ancla(foco.y, proporcionFoto / proporcionMarco))}`
  return centro
}

// ── Día a día ─────────────────────────────────────────────────────────────────

/**
 * ¿Imprimir el día a día? Solo si dice algo que la tabla de vuelos no diga ya.
 *
 * Los días de vuelo que entran al día a día son, por construcción, vuelos de la tabla de
 * «Vuelos». En un viaje que es SOLO vuelos (COT-2026-0006: dos rutas, ida y regreso) el día
 * a día repetía las cuatro filas de la tabla, una por tarjeta: media página de lo mismo.
 * Con un solo día que no sea vuelo (un traslado, un tour), el día a día cuenta el viaje y
 * los vuelos van en él, en su día.
 */
export function diaADiaSeImprime(entradas: { esVuelo: boolean }[]): boolean {
  return entradas.some(e => !e.esVuelo)
}

/** Lo que la agrupación por día necesita de una entrada. */
export interface EntradaConDia {
  fecha: Fecha | null
  /** El día relativo del viaje, cuando no hay fecha. */
  dia: number | null
}

/**
 * Las entradas del día a día agrupadas por día: seguidas y del MISMO día. Cada grupo se
 * imprime sin partir, con su círculo una vez: el vuelo que llega y el traslado de esa tarde
 * no se separan en dos páginas.
 *
 * Mismo día: las dos con fecha y la misma fecha, o las dos sin fecha y el mismo día
 * relativo. Una entrada sin fecha ni día va sola.
 */
export function gruposPorDia<T extends EntradaConDia>(entradas: T[]): T[][] {
  const grupos: T[][] = []
  const mismoDia = (a: T, b: T) => {
    if (a.fecha && b.fecha) {
      const ka = claveDeFecha(a.fecha)
      return ka !== null && ka === claveDeFecha(b.fecha)
    }
    return !a.fecha && !b.fecha && a.dia !== null && a.dia === b.dia
  }
  for (const e of entradas) {
    const ultimo = grupos[grupos.length - 1]
    if (ultimo && mismoDia(ultimo[ultimo.length - 1], e)) ultimo.push(e)
    else grupos.push([e])
  }
  return grupos
}

// ── Incluido, a tener en cuenta y antes de viajar ─────────────────────────────

export type ListaDelCierre = 'incluye' | 'noIncluye' | 'antes'

/**
 * Una fila del bloque de listas. Con UNA columna la lista va a todo el ancho y se puede
 * partir entre páginas (entre ítems); con DOS, las columnas van lado a lado y la fila no se
 * parte. Cada columna es una o varias listas, una debajo de la otra.
 */
export type FilaDeListas = ListaDelCierre[][]

/**
 * Lo que mide un título de sección con su aire en espaciado normal (§4.11: 32 arriba entre
 * secciones, 26 de alto, 16 abajo hasta el contenido).
 */
const ALTO_TITULO = 74
/** Un renglón de 9 pt con su interlineado. */
const ALTO_RENGLON = 11.5
/** El aire entre dos ítems de una lista. */
const AIRE_ITEM = 4
/** Lo que ocupa un carácter promedio de Helvetica a 9 pt. */
const ANCHO_CARACTER = 4.5
/** Lo que se come el marcador del ítem (chulo, equis o viñeta) y la franja ámbar. */
const SANGRIA_ITEM = 16
/** El aire entre las dos columnas. */
export const CANAL_COLUMNAS = 24

/**
 * Hasta cuánto puede medir una columna para ir lado a lado con otra.
 *
 * Lado a lado la fila NO se parte (una fila de dos columnas partida en dos páginas se
 * desarma), así que si no cabe baja entera y deja su alto en blanco arriba. Con este tope,
 * lo más que puede dejar es un tercio de página; más larga, cada lista va a todo el ancho y
 * se parte entre ítems como cualquier texto.
 */
export const ALTO_MAXIMO_COLUMNA = 260

/** Cuánto mide una lista (título incluido) en una columna de este ancho. Estimado, no medido. */
export function altoEstimadoDeLista(items: string[], anchoColumna: number): number {
  if (items.length === 0) return 0
  const porRenglon = Math.max(1, Math.floor((anchoColumna - SANGRIA_ITEM) / ANCHO_CARACTER))
  const renglones = items.reduce((a, t) => a + Math.max(1, Math.ceil(t.length / porRenglon)), 0)
  return ALTO_TITULO + renglones * ALTO_RENGLON + items.length * AIRE_ITEM
}

/**
 * Cómo se reparten «Incluido en el plan», «A tener en cuenta» y «Antes de viajar».
 *
 * «Antes de viajar» va CON «Incluido», no al final: suelto al final era lo único que
 * quedaba para la última página, y COT-2026-0006 terminaba en una hoja en blanco al 70 %
 * con ese recuadro y la firma.
 *
 * 1. Si hay «Antes» y algo de lo otro, y las dos columnas son cortas: lado a lado. A la
 *    izquierda lo que incluye y lo que no (una debajo de la otra: son la misma pregunta),
 *    a la derecha «Antes de viajar».
 * 2. Si alguna es larga: «Incluido» y «A tener en cuenta» lado a lado si las dos son
 *    cortas (como siempre), y «Antes de viajar» debajo, a todo el ancho.
 * 3. Lo que no cabe en una columna va solo, a todo el ancho.
 *
 * Una lista vacía no ocupa lugar. Sin ninguna, no hay filas.
 */
export function disposicionDeListas(
  listas: Record<ListaDelCierre, string[]>,
  anchoContenido: number,
): FilaDeListas[] {
  const hay = (l: ListaDelCierre) => listas[l].length > 0
  const anchoColumna = (anchoContenido - CANAL_COLUMNAS) / 2
  const alto = (ls: ListaDelCierre[]) => ls.reduce((a, l) => a + altoEstimadoDeLista(listas[l], anchoColumna), 0)
  const cabe = (ls: ListaDelCierre[]) => alto(ls) <= ALTO_MAXIMO_COLUMNA

  const izquierda = (['incluye', 'noIncluye'] as ListaDelCierre[]).filter(hay)
  if (hay('antes') && izquierda.length > 0 && cabe(izquierda) && cabe(['antes'])) {
    return [[izquierda, ['antes']]]
  }
  const filas: FilaDeListas[] = []
  if (izquierda.length === 2 && cabe(['incluye']) && cabe(['noIncluye'])) {
    filas.push([['incluye'], ['noIncluye']])
  } else {
    for (const l of izquierda) filas.push([[l]])
  }
  if (hay('antes')) filas.push([['antes']])
  return filas
}

// ── Franja de fotos ───────────────────────────────────────────────────────────

/**
 * La forma de una foto en un renglón de tres (ancho / alto): 3:2, la de una foto de viaje,
 * a la que el recorte le quita poco. De ella sale el alto de TODO renglón de la franja.
 */
export const FORMA_DE_FOTO_EN_TERCIO = 3 / 2

/** Un renglón de la franja: qué fotos lleva (desde la posición `desde`) y cuánto mide cada una. */
export interface RenglonDeFotos {
  desde: number
  fotos: number
  ancho: number
  alto: number
}

/**
 * Cómo se reparten N fotos en renglones que llenan el ancho del contenido.
 *
 * Hasta el 2026-09-23 cada foto medía un tercio del ancho fuera cual fuera la cuenta: con
 * dos fotos (COT-2026-0006) la franja dejaba el tercio de la derecha vacío. Ahora cada
 * renglón se reparte el ancho entero entre SUS fotos, así que nunca queda un hueco:
 *
 * - Hasta tres por renglón, y los renglones lo más parejos posible: cuatro van 2 + 2, no
 *   3 + 1, y cinco van 3 + 2. Un renglón de una sola foto solo existe si hay una sola.
 * - Todo renglón mide de alto lo que medía el de tres (3:2 a un tercio del ancho): con
 *   menos fotos cada una es más ancha, no más alta. Así una franja de 3 + 2 no queda con
 *   dos renglones de alto distinto, una sola foto es una tira y no una segunda portada, y
 *   llenar el hueco no le agrega alto al documento. El recorte lo guía el foco de cada foto.
 */
export function renglonesDeFotos(n: number, anchoContenido: number, canal: number): RenglonDeFotos[] {
  if (n <= 0) return []
  const alto = (anchoContenido - canal * 2) / 3 / FORMA_DE_FOTO_EN_TERCIO
  const cuantos = Math.ceil(n / 3)
  const base = Math.floor(n / cuantos)
  const conUnaMas = n % cuantos
  const renglones: RenglonDeFotos[] = []
  let desde = 0
  for (let i = 0; i < cuantos; i += 1) {
    const fotos = base + (i < conUnaMas ? 1 : 0)
    const ancho = (anchoContenido - canal * (fotos - 1)) / fotos
    renglones.push({ desde, fotos, ancho, alto })
    desde += fotos
  }
  return renglones
}

// ── Tabla de vuelos ───────────────────────────────────────────────────────────

/** Lo que mide el encabezado en degradado de la tabla de vuelos. */
export const ALTO_ENCABEZADO_VUELOS = 18

/** Lo que la tabla de vuelos imprime de un vuelo (un grupo: su ida, su regreso y su línea gris). */
export interface GrupoDeVuelosAMedir {
  /** Una fila por tramo: si lleva la escala bajo la ruta y si lleva la marca de su tarifa. */
  filas: { conEscala: boolean; conTarifa: boolean }[]
  /** La línea gris de abajo (números sin tramo, tarifa, equipaje, adicionales). Vacía, no sale. */
  meta: string
}

// Medidas del JSX de `TablaVuelos`, a 1,1 veces el tamaño de la letra por renglón: un
// vuelo de un tramo con escala y línea gris mide 38 pt; uno de ida y regreso, 60. La fila
// nunca mide menos que la píldora de la sigla (14 pt), que va en la columna de aerolínea.
const RELLENO_GRUPO = 8
const ALTO_SIGLA = 14
const RENGLON_RUTA = 9.4
const RENGLON_CHICO = 8.3
const AIRE_ESCALA = 0
const ALTO_MARCA_TARIFA = 13
const AIRE_ENTRE_FILAS = 4
const AIRE_META = 4
const CARACTER_META = 3.75

/** Cuánto mide un grupo de la tabla de vuelos a este ancho de línea gris. Estimado, no medido. */
export function altoEstimadoDeGrupoDeVuelos(g: GrupoDeVuelosAMedir, anchoMeta: number): number {
  const filas = g.filas.reduce(
    (a, f) => a + Math.max(
      ALTO_SIGLA,
      RENGLON_RUTA + (f.conEscala ? AIRE_ESCALA + RENGLON_CHICO : 0) + (f.conTarifa ? ALTO_MARCA_TARIFA : 0),
    ),
    0,
  ) + AIRE_ENTRE_FILAS * Math.max(0, g.filas.length - 1)
  const porRenglon = Math.max(1, Math.floor(anchoMeta / CARACTER_META))
  const meta = g.meta === '' ? 0 : AIRE_META + RENGLON_CHICO * Math.ceil(g.meta.length / porRenglon)
  return RELLENO_GRUPO + filas + meta
}

/**
 * ¿La tabla de vuelos va entera, sin partirse?
 *
 * Una tabla corta es una sola lectura: partirla, aun repitiendo el encabezado, deja dos
 * vuelos de un mismo viaje en dos hojas. COT-2026-0006 tenía Avianca en la primera y
 * SATENA en la segunda, sin encabezado. Pero ir entera tiene un precio: si no cabe, baja
 * completa y deja en blanco lo que sobraba arriba. Por eso va entera solo si mide, con su
 * título y su encabezado, lo mismo que una columna de listas (`ALTO_MAXIMO_COLUMNA`): lo
 * más que deja en blanco es un tercio de página. Más larga, se parte entre vuelos y el
 * encabezado se repite arriba de cada página que ocupa.
 */
export function tablaDeVuelosVaEntera(altosDeGrupos: number[]): boolean {
  const alto = ALTO_TITULO + ALTO_ENCABEZADO_VUELOS + altosDeGrupos.reduce((a, h) => a + h, 0)
  return alto <= ALTO_MAXIMO_COLUMNA
}

// ── Espacio y paginación (§4.11, Ren, 2026-10-08) ─────────────────────────────

/**
 * Los ÚNICOS espacios permitidos en el documento (§4.11, punto 2). Ningún margen suelto
 * fuera de esta escala: si hace falta otro, se escoge el vecino de la escala.
 *
 * ⚠️ Lo que NO es espacio entre elementos sino geometría de una pieza dibujada (el relleno
 * de una pastilla, la veladura del rótulo, el alto del encabezado de una tabla, el ajuste
 * óptico que alinea un ícono con su renglón) no entra en la escala: es el dibujo de esa
 * pieza, como su radio o su tamaño.
 */
export const ESCALA_DE_ESPACIOS = [4, 8, 12, 16, 24, 32, 48] as const
export type EspacioDeEscala = (typeof ESCALA_DE_ESPACIOS)[number]

/** Los espacios del documento por su función (la tabla del punto 2). */
export interface Espaciado {
  /** Entre renglones de una misma tarjeta. Igual en compacto. */
  fino: EspacioDeEscala
  /** El relleno de una tarjeta. Igual en compacto. */
  dentro: EspacioDeEscala
  /** Entre tarjetas o filas de un mismo bloque. */
  tarjetas: EspacioDeEscala
  /** Del título de una sección a su contenido, y entre bloques de una misma sección. */
  bloque: EspacioDeEscala
  /** Entre secciones (Vuelos, Inversión, Incluido…). */
  seccion: EspacioDeEscala
  /** Entre capítulos de destino. */
  capitulo: EspacioDeEscala
}

export const ESPACIADO_NORMAL: Espaciado = { fino: 4, dentro: 8, tarjetas: 12, bloque: 16, seccion: 32, capitulo: 48 }

/** El paso 1 de «la última hoja trabaja»: la columna derecha de la tabla del punto 2. */
export const ESPACIADO_COMPACTO: Espaciado = { fino: 4, dentro: 8, tarjetas: 8, bloque: 12, seccion: 24, capitulo: 32 }

/**
 * La hoja (§4.11, punto 1): A4 vertical, 40 pt de margen lateral, la barra de 4 pt y el logo
 * arriba (el contenido empieza en 58), el pie de 26 pt abajo y una franja de 16 pt sobre el
 * pie que el contenido nunca invade.
 */
export const HOJA = {
  ancho: 595.28,
  alto: 841.89,
  margen: 40,
  arriba: 58,
  altoPie: 26,
  franjaSobrePie: 16,
} as const

/** Lo que el contenido puede ocupar de una hoja, de arriba abajo. */
export const ALTO_UTIL = HOJA.alto - HOJA.arriba - HOJA.altoPie - HOJA.franjaSobrePie

/** Por debajo de esto la última hoja «no trabaja» y el documento se recompone (punto 6). */
export const UMBRAL_ULTIMA_HOJA = 0.35

/** Un salto que deja en blanco más que esto al pie de una hoja se intenta cerrar (punto 8). */
export const UMBRAL_HUECO_AL_PIE = 0.25

/** El costo acotado de recomponer: nunca más de cuatro renders por documento. */
export const MAXIMO_DE_RENDERS = 4

/**
 * Los pasos del punto 6, en orden. Cada nivel incluye los anteriores:
 * 0 · normal; 1 · espaciado compacto; 2 · + fotos de las alternativas a 1/4 del ancho;
 * 3 · + foto de ciudad del capítulo a 110 pt de alto.
 */
export type NivelDeCompactacion = 0 | 1 | 2 | 3

/**
 * Cómo se compone el documento. `compactas` es el punto 8: secciones sueltas que van en
 * espaciado compacto aunque el nivel sea 0.
 */
export interface Composicion {
  nivel: NivelDeCompactacion
  compactas?: string[]
}

export const COMPOSICION_NORMAL: Composicion = { nivel: 0 }

/** El espaciado de una sección según la composición. */
export function espaciadoDe(composicion: Composicion | undefined, seccion: string): Espaciado {
  if (!composicion) return ESPACIADO_NORMAL
  return composicion.nivel >= 1 || (composicion.compactas ?? []).includes(seccion) ? ESPACIADO_COMPACTO : ESPACIADO_NORMAL
}

/**
 * Las secciones del documento, en su orden, con el número de su marca (el que la plantilla
 * pinta en el azul de un punto invisible al inicio de cada una, ver `medir-pdf.ts`). El
 * orden de los números ES el orden del documento.
 */
const NUMERO_DE_SECCION: Record<string, number> = {
  portada: 1,
  dias: 120,
  vuelos: 130,
  inversion: 140,
  porPasajero: 150,
  listas: 160,
  opcionales: 170,
  cargos: 180,
  notas: 190,
  terminos: 200,
  cierre: 210,
}

/** El número de la marca de una sección. Los capítulos van del 10 en adelante. */
export function numeroDeSeccion(seccion: string): number {
  const cap = /^capitulo-(\d+)$/.exec(seccion)
  if (cap) return 10 + Math.min(Number(cap[1]), 100)
  return NUMERO_DE_SECCION[seccion] ?? 0
}

export function seccionDeNumero(n: number): string | null {
  if (n >= 10 && n <= 110) return `capitulo-${n - 10}`
  return Object.entries(NUMERO_DE_SECCION).find(([, v]) => v === n)?.[0] ?? null
}

/** Lo que el paso de composición necesita saber de un PDF ya renderizado. */
export interface MedidaDeHojas {
  /** Borde inferior del contenido de cada hoja, en pt desde arriba (`null` si está vacía). */
  fondos: (number | null)[]
  /** En qué hoja (desde 1) empieza cada sección que tiene marca. */
  inicios: Map<string, number>
}

/** Qué fracción del alto útil ocupa el contenido de una hoja. */
export function ocupacionDeHoja(fondo: number | null): number {
  if (fondo === null) return 0
  return Math.max(0, Math.min(1, (fondo - HOJA.arriba) / ALTO_UTIL))
}

/**
 * ¿La última hoja trabaja? Con una sola hoja no hay hoja que desaparecer: trabaja siempre.
 */
export function ultimaHojaTrabaja(m: MedidaDeHojas): boolean {
  if (m.fondos.length <= 1) return true
  return ocupacionDeHoja(m.fondos[m.fondos.length - 1]) >= UMBRAL_ULTIMA_HOJA
}

/**
 * ¿La recomposición con el nivel siguiente ya cumplió? Para en cuanto la última hoja
 * desaparezca o pase del umbral (punto 6).
 */
export function recomposicionCumple(antes: MedidaDeHojas, despues: MedidaDeHojas): boolean {
  return despues.fondos.length < antes.fondos.length || ultimaHojaTrabaja(despues)
}

/**
 * Las hojas (desde 1, sin la última) que terminan con un blanco al pie mayor que el umbral
 * del punto 8: ahí una unidad no cupo y pasó a la siguiente.
 */
export function hojasConHueco(m: MedidaDeHojas): number[] {
  const fondoUtil = HOJA.arriba + ALTO_UTIL
  const out: number[] = []
  m.fondos.forEach((f, i) => {
    if (i === m.fondos.length - 1 || f === null) return
    if ((fondoUtil - f) / ALTO_UTIL > UMBRAL_HUECO_AL_PIE) out.push(i + 1)
  })
  return out
}

/**
 * Qué secciones se componen en compacto para intentar cerrar el hueco al pie de la hoja `p`
 * (punto 8): las que tienen contenido en esa hoja —la unidad anterior al salto es de alguna
 * de ellas— y la que empieza en la siguiente, que es la de la unidad que saltó.
 */
export function seccionesParaCerrarHueco(m: MedidaDeHojas, p: number): string[] {
  const orden = [...m.inicios.entries()].sort((a, b) => numeroDeSeccion(a[0]) - numeroDeSeccion(b[0]))
  const out: string[] = []
  orden.forEach(([seccion, inicio], i) => {
    const siguiente = orden[i + 1]?.[1] ?? Number.POSITIVE_INFINITY
    // Toca la hoja p si empieza en ella o antes y sigue hasta ella; o si empieza en p + 1.
    const tocaP = inicio <= p && siguiente >= p
    if (tocaP || inicio === p + 1) out.push(seccion)
  })
  return out
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

/**
 * ¿La portada ya dijo este nombre? Con un solo capítulo, su nombre casi siempre es el
 * destino, y la portada lo dice por tres lados: el título, el nombre del negocio y la ficha
 * DESTINO. Con un titular redactado el título ya no es el nombre del negocio, así que
 * comparar solo contra el título dejaba pasar el «San Andrés - Providencia» repetido bajo las
 * fotos (COT-2026-0006). Se compara contra los tres.
 */
export function yaLoDiceLaPortada(
  nombre: string | null | undefined,
  portada: (string | null | undefined)[],
): boolean {
  return portada.some(t => !!t && yaEstaEnElTitulo(nombre, t))
}

/** El vuelo tiene regreso si la captura leyó algo suyo: la misma regla de `trayectosDelVuelo`. */
export function tieneRegreso(v: VueloPDF): boolean {
  return v.fechaRegreso !== null || v.horaSalidaRegreso !== null || v.horaLlegadaRegreso !== null
}

// ── Las filas de la tabla «Vuelos» ────────────────────────────────────────────
//
// Viven aquí (y no en la plantilla) desde el brief del 2026-10-05, punto 18: «Así lo ve el
// cliente» del vuelo pinta las mismas filas que la tabla del documento.

export interface FilaVuelo {
  vuelo: VueloPDF
  desde: string | null
  hasta: string | null
  escala: string | null
  fecha: string | null
  salida: string | null
  llegada: string | null
  numero: string | null
}

/**
 * Los números de vuelo que no se sabe a qué tramo pertenecen. Van bajo el vuelo entero, en
 * la línea gris: pegados a la ida afirmarían que el regreso no tiene vuelo.
 */
export function numerosSinTramo(v: VueloPDF): string | null {
  const { sinAsignar } = numerosDelVuelo(v)
  if (!sinAsignar) return null
  return `${sinAsignar.includes('·') ? 'Vuelos' : 'Vuelo'} ${sinAsignar}`
}

/**
 * Los números de cada fila: los de los tramos del vuelo (B3) cuando vienen repartidos, y si
 * no, el reparto del número leído. ⚠️ Un número de regreso sin fila de regreso (la captura
 * leyó una hora que no se entiende) se perdería: ahí manda el reparto de siempre.
 */
export function numerosDelVuelo(v: VueloPDF): { ida: string | null; regreso: string | null; sinAsignar: string | null } {
  const regreso = tieneRegreso(v)
  if (v.numeros && (regreso || !v.numeros.regreso)) return v.numeros
  return numerosDeVuelo(v.numeroVuelo, regreso)
}

export function filasDelVuelo(v: VueloPDF): FilaVuelo[] {
  const regreso = tieneRegreso(v)
  const numeros = numerosDelVuelo(v)
  // `escalas === 0` es la ÚNICA forma de afirmar «directo»: un `escalaIda` vacío puede ser
  // un vuelo directo o una pantalla que no mostró el recorrido, y son cosas distintas.
  const escala = (e: string | null) => (e ? `Escala en ${lugarLegible(e)}` : v.escalas === 0 ? 'Vuelo directo' : null)
  const filas: FilaVuelo[] = [{
    vuelo: v,
    desde: lugarLegible(v.origen),
    hasta: lugarLegible(v.destino),
    escala: escala(v.escalaIda),
    fecha: v.fechaSalida,
    salida: v.horaSalida,
    llegada: v.horaLlegada,
    numero: numeros.ida,
  }]
  // El regreso existe cuando la captura leyó ALGO suyo, y su ruta es la de la ida al revés.
  if (regreso) {
    filas.push({
      vuelo: v,
      desde: lugarLegible(v.destino),
      hasta: lugarLegible(v.origen),
      escala: escala(v.escalaRegreso),
      fecha: v.fechaRegreso,
      salida: v.horaSalidaRegreso,
      llegada: v.horaLlegadaRegreso,
      numero: numeros.regreso,
    })
  }
  return filas
}

