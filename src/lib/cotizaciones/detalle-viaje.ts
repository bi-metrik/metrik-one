/**
 * El DETALLE del viaje que se imprime en el documento del cliente: vuelos, hoteles y
 * cargos que se pagan en destino.
 *
 * Entrega B del brief `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-17-documento-cliente.md`,
 * §2 de `propuesta-visual.md` (anatomía de los tres itinerarios reales de Trappvel).
 *
 * ## De dónde sale cada dato, y por qué no hay tabla nueva
 *
 * Todo esto YA se lee del pantallazo (`ranuras-pantallazo.ts`) y se guarda en
 * `items.tarifa_pax.casillas.<clave>.campos`. Lo que faltaba no era capturarlo: era
 * imprimirlo. Una tabla nueva para «los datos del vuelo» sería una segunda copia del
 * mismo hecho, que se desincroniza el día que alguien vuelva a leer la captura.
 *
 * ⚠️ `LecturaCasilla.campos` guarda `{ label, valor }` y **no el slug**. La vuelta al
 * slug se hace contra el catálogo de la ranura (`ranuraDeGrupo`), que es donde los dos
 * viven juntos. Hacerlo por el texto del label desde el consumidor sería clavar aquí
 * una copia de las etiquetas: el día que una cambie, la columna se vaciaría **sin que
 * nada falle**, que es el modo de fallo que este producto ya pagó caro.
 *
 * ⚠️ Un valor marcado «(del viaje)» NO salió de la imagen: lo puso el ítem (7.4). Para el
 * cliente el dato vale igual —es su viaje—, así que se imprime, pero sin el marcador, que
 * es vocabulario interno.
 *
 * ## Lo que NO se lee hoy y por eso NO se imprime
 *
 * Las **estrellas del hotel**, el **localizador** y la **hora** de salida y llegada de
 * cada vuelo no están en el contrato de ninguna ranura (medido el 2026-09-21 contra
 * `ranuras-pantallazo.ts` y contra el banco real de capturas). El itinerario de
 * referencia los trae porque es un viaje YA reservado; una cotización todavía no tiene
 * localizador. Los campos existen en el tipo y llegan vacíos: el día que la lectura los
 * traiga, se imprimen solos. Inventarlos sería peor que no tenerlos.
 */

import { leerTarifaPax, type LecturaCasilla } from './tarifa-pasajero'
import { ranuraDeGrupo } from './ranuras-pantallazo'

/** Lo mínimo de una línea para reconstruir su detalle. */
export interface ItemConLectura {
  nombre: string | null
  grupo: string | null
  tarifa_pax?: unknown
  /**
   * Los adicionales de ESTA variante, ya en palabras («Equipaje de bodega adicional ×2»).
   *
   * No salen de la lectura del pantallazo: son datos de `item_adicionales`
   * (`adicionales.ts`) y llegan armados desde el servidor, igual que el nombre de la
   * línea. Ausente o vacío = la ficha no los menciona, que es todo lo que existe hoy.
   */
  adicionales?: string[]
}

export interface VueloPDF {
  /** El nombre de la línea, que es lo que se ve si la lectura no dejó nada. */
  linea: string
  aerolinea: string | null
  origen: string | null
  destino: string | null
  fechaSalida: string | null
  fechaRegreso: string | null
  numeroVuelo: string | null
  escalaIda: string | null
  escalaRegreso: string | null
  /** Cuántas escalas tiene la ida. `null` = la captura no lo decía. */
  escalas: number | null
  tarifa: string | null
  /** Qué equipaje lleva, en palabras. `null` = la captura no mostraba equipaje. */
  equipaje: string | null
  /**
   * Los adicionales de esta variante: la maleta extra, la silla, el seguro.
   *
   * Van DENTRO de la ficha del vuelo, que es literalmente lo que se pidió: *«mantener
   * dentro de cada bloque todo el hilo de variables»*. Sin cifra — el dinero del documento
   * vive en «Inversión» y se imprime una sola vez.
   */
  adicionales: string[]
}

export interface HotelPDF {
  linea: string
  hotel: string | null
  ciudad: string | null
  habitacion: string | null
  regimen: string | null
  checkIn: string | null
  checkOut: string | null
  noches: number | null
  ocupacion: string | null
  cancelacion: string | null
  /** Ver la cabecera: no se lee hoy. */
  estrellas: number | null
  /** Ver la cabecera: una cotización no tiene localizador. */
  localizador: string | null
  /** Ver `VueloPDF.adicionales`: van dentro de la ficha, sin cifra. */
  adicionales: string[]
}

/**
 * Lo que el viajero paga EN DESTINO y no está en el total (§2.8 de la propuesta visual).
 *
 * Sale del par `impuestos_destino_valor` / `impuestos_destino_moneda` de la ranura de
 * hotel, en la moneda local tal como la mostró la captura. **No se convierte a pesos**:
 * la tasa del día del viaje no la sabe nadie, y un número convertido se leería como una
 * promesa de cuánto va a costar.
 */
export interface CargoEnDestinoPDF {
  ciudad: string | null
  concepto: string
  monto: string
  observacion: string
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/**
 * Una fecha leída, en corto: «23 oct 2026», o «23 oct» cuando la captura no mostraba el
 * año (la lectura lo devuelve como `--MM-DD` justamente para no inventarlo).
 */
export function fechaCorta(iso: string | null | undefined): string | null {
  if (!iso) return null
  const completa = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (completa) {
    const mes = MESES_CORTOS[Number(completa[2]) - 1]
    if (!mes) return null
    return `${Number(completa[3])} ${mes} ${completa[1]}`
  }
  const sinAnio = /^--(\d{2})-(\d{2})$/.exec(iso.trim())
  if (sinAnio) {
    const mes = MESES_CORTOS[Number(sinAnio[1]) - 1]
    if (!mes) return null
    return `${Number(sinAnio[2])} ${mes}`
  }
  return null
}

/** El rango que se imprime en la ficha de portada. `null` si no hay ni una fecha. */
export function rangoDeFechas(inicio: string | null, fin: string | null): string | null {
  const a = fechaCorta(inicio)
  const b = fechaCorta(fin)
  if (a && b) return `${a} – ${b}`
  return a ?? b ?? null
}

/**
 * «7 días / 6 noches», derivado de las dos fechas.
 *
 * Solo con fechas COMPLETAS: con `--MM-DD` no se puede saber si el regreso es del año
 * siguiente, y una duración negativa o de 300 días en la portada es peor que un hueco.
 */
export function duracionDelViaje(inicio: string | null, fin: string | null): string | null {
  const a = /^\d{4}-\d{2}-\d{2}$/.test((inicio ?? '').trim()) ? new Date(`${inicio}T00:00:00Z`) : null
  const b = /^\d{4}-\d{2}-\d{2}$/.test((fin ?? '').trim()) ? new Date(`${fin}T00:00:00Z`) : null
  if (!a || !b || Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
  const noches = Math.round((b.getTime() - a.getTime()) / 86_400_000)
  if (noches < 0) return null
  if (noches === 0) return '1 día'
  return `${noches + 1} días / ${noches} ${noches === 1 ? 'noche' : 'noches'}`
}

/** Le quita a un valor el marcador interno «(del viaje)». Ver la cabecera. */
function sinMarcador(valor: string): string {
  return valor.replace(/\s*\(del viaje\)\s*$/i, '').trim()
}

/**
 * Los campos de la lectura, de vuelta a sus slugs.
 *
 * `{}` cuando el grupo no resuelve a ninguna ranura o cuando no hay lectura: es la
 * respuesta correcta para una línea escrita a mano («+ Otro»), que no tiene captura.
 */
export function detalleDeLectura(
  grupo: string | null | undefined,
  campos: { label: string; valor: string }[] | undefined,
): Record<string, string> {
  const ranura = ranuraDeGrupo(grupo)
  if (!ranura || !campos || campos.length === 0) return {}
  const slugPorLabel = new Map(ranura.campos.map(c => [c.label, c.slug]))
  const out: Record<string, string> = {}
  for (const c of campos) {
    const slug = slugPorLabel.get(c.label)
    if (!slug) continue
    const valor = sinMarcador(c.valor ?? '')
    if (valor !== '') out[slug] = valor
  }
  return out
}

/** La casilla de la que sale el detalle: la del grupo completo, o la primera que haya. */
function casillaDelItem(item: ItemConLectura): LecturaCasilla | null {
  const { casillas } = leerTarifaPax(item.tarifa_pax)
  return casillas?.grupo_completo ?? casillas?.sin_infantes ?? casillas?.solo_adultos ?? null
}

function detalleDelItem(item: ItemConLectura): Record<string, string> {
  return detalleDeLectura(item.grupo, casillaDelItem(item)?.campos)
}

const texto = (d: Record<string, string>, slug: string): string | null => d[slug] ?? null

function numero(d: Record<string, string>, slug: string): number | null {
  const v = d[slug]
  if (v === undefined) return null
  const n = Number(String(v).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function booleano(d: Record<string, string>, slug: string): boolean | null {
  const v = (d[slug] ?? '').trim().toLowerCase()
  if (v === 'true' || v === 'sí' || v === 'si') return true
  if (v === 'false' || v === 'no') return false
  return null
}

/**
 * El equipaje en palabras, a partir de los tres booleanos del icono resaltado.
 *
 * `null` cuando los tres vienen vacíos: la captura no mostraba equipaje y decir «sin
 * equipaje» sería afirmar algo que nadie leyó. Es el mismo criterio con el que la lectura
 * los deja vacíos cuando el cruce de evidencia no cuadra (#792).
 */
export function equipajeEnPalabras(d: Record<string, string>): string | null {
  const personal = booleano(d, 'equipaje_personal')
  const mano = booleano(d, 'equipaje_mano')
  const bodega = booleano(d, 'equipaje_bodega')
  if (personal === null && mano === null && bodega === null) return null
  const lleva: string[] = []
  if (personal) lleva.push('artículo personal')
  if (mano) lleva.push('equipaje de mano')
  if (bodega) lleva.push('equipaje de bodega')
  return lleva.length === 0 ? 'Sin equipaje incluido' : lleva.join(' + ')
}

/** Los vuelos del documento, en el orden en que vienen las líneas. */
export function vuelosDeItems(items: ItemConLectura[]): VueloPDF[] {
  const out: VueloPDF[] = []
  for (const item of items) {
    if (ranuraDeGrupo(item.grupo)?.slug !== 'vuelo_detalle') continue
    const d = detalleDelItem(item)
    out.push({
      linea: (item.nombre ?? '').trim(),
      aerolinea: texto(d, 'aerolinea'),
      origen: texto(d, 'origen'),
      destino: texto(d, 'destino'),
      fechaSalida: fechaCorta(texto(d, 'fecha_salida')),
      fechaRegreso: fechaCorta(texto(d, 'fecha_regreso')),
      numeroVuelo: texto(d, 'numero_vuelo'),
      escalaIda: texto(d, 'escala_ida'),
      escalaRegreso: texto(d, 'escala_regreso'),
      escalas: numero(d, 'escalas'),
      tarifa: texto(d, 'familia_tarifa'),
      equipaje: equipajeEnPalabras(d),
      adicionales: item.adicionales ?? [],
    })
  }
  return out
}

/** Las noches: las que dijo la captura, y si no las dijo, las que dan las dos fechas. */
function nochesDe(d: Record<string, string>): number | null {
  const leidas = numero(d, 'noches')
  if (leidas !== null && leidas > 0) return leidas
  const entrada = (d['check_in'] ?? '').trim()
  const salida = (d['check_out'] ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada) || !/^\d{4}-\d{2}-\d{2}$/.test(salida)) return null
  const n = Math.round(
    (new Date(`${salida}T00:00:00Z`).getTime() - new Date(`${entrada}T00:00:00Z`).getTime()) / 86_400_000,
  )
  return n > 0 ? n : null
}

/** Los hoteles del documento, uno por línea de alojamiento. */
export function hotelesDeItems(items: ItemConLectura[]): HotelPDF[] {
  const out: HotelPDF[] = []
  for (const item of items) {
    if (ranuraDeGrupo(item.grupo)?.slug !== 'hotel_detalle') continue
    const d = detalleDelItem(item)
    out.push({
      linea: (item.nombre ?? '').trim(),
      hotel: texto(d, 'hotel'),
      ciudad: texto(d, 'ciudad'),
      habitacion: texto(d, 'tipo_habitacion'),
      regimen: texto(d, 'regimen'),
      checkIn: fechaCorta(texto(d, 'check_in')),
      checkOut: fechaCorta(texto(d, 'check_out')),
      noches: nochesDe(d),
      ocupacion: texto(d, 'ocupacion'),
      cancelacion: texto(d, 'politica_cancelacion'),
      estrellas: null,
      localizador: null,
      adicionales: item.adicionales ?? [],
    })
  }
  return out
}

/** Los cargos que se pagan en destino, en su moneda local. */
export function cargosEnDestinoDeItems(items: ItemConLectura[]): CargoEnDestinoPDF[] {
  const out: CargoEnDestinoPDF[] = []
  for (const item of items) {
    const d = detalleDelItem(item)
    const valor = numero(d, 'impuestos_destino_valor')
    if (valor === null || valor <= 0) continue
    const moneda = (texto(d, 'impuestos_destino_moneda') ?? '').toUpperCase()
    out.push({
      ciudad: texto(d, 'ciudad'),
      concepto: 'Impuestos y tasas de hospedaje',
      monto: `${valor.toLocaleString('es-CO', { maximumFractionDigits: 2 })}${moneda ? ` ${moneda}` : ''}`,
      observacion: 'Se paga en el hotel. No está incluido en el precio.',
    })
  }
  return out
}

/**
 * El destino que se imprime en la portada cuando el negocio no lo declaró.
 *
 * Se arma con las ciudades del propio itinerario —la del hotel y la de llegada del
 * vuelo—, sin repetir y en el orden en que aparecen. `null` si no hay ninguna: la ficha
 * no se pinta en vez de decir «Destino: —».
 */
export function destinoDeItinerario(vuelos: VueloPDF[], hoteles: HotelPDF[]): string | null {
  const ciudades: string[] = []
  for (const h of hoteles) if (h.ciudad) ciudades.push(h.ciudad)
  for (const v of vuelos) if (v.destino) ciudades.push(v.destino)
  const unicas = [...new Set(ciudades.map(c => c.trim()).filter(Boolean))]
  return unicas.length === 0 ? null : unicas.join(' · ')
}

// ── Nivel de detalle del documento (§4.6 de la propuesta visual) ─────────────

/**
 * Los tres formatos que pidieron Alejandra y Daniela el 2026-09-16: *«muy detallada,
 * normal y muy general»*.
 *
 * ⚠️ El vocabulario NO es el del bloque `formato_cotizacion` que hay hoy en la línea
 * («por total», «por persona», «por componente», «tres opciones»): ese describe cómo se
 * arma el PRECIO, no cuánto detalle lleva el documento. Traducir uno al otro —«por total»
 * → «general»— sería inventar una equivalencia que nadie declaró. Por eso el campo es
 * nuevo (`nivel_detalle`) y, mientras nadie lo declare, el documento sale `normal`.
 */
export const NIVELES_DETALLE = ['muy_detallada', 'normal', 'general'] as const
export type NivelDetalle = (typeof NIVELES_DETALLE)[number]
export const NIVEL_DETALLE_POR_DEFECTO: NivelDetalle = 'normal'

/** El nivel declarado, o el de por defecto si el valor no es uno de los tres. */
export function nivelDetalleDesde(valor: unknown): NivelDetalle {
  const v = typeof valor === 'string' ? valor.trim() : ''
  return (NIVELES_DETALLE as readonly string[]).includes(v) ? (v as NivelDetalle) : NIVEL_DETALLE_POR_DEFECTO
}

// ── Pie y firma del documento ───────────────────────────────────────────────

export interface ConfigDocumentoViaje {
  /** El pie de marca, tal cual se imprime. `null` = se arma con los datos del vendedor. */
  pie: string | null
  /** Quién firma. `null` = firma quien generó el documento. */
  firma: { nombre: string; cargo: string | null; contacto: string | null } | null
}

/**
 * El pie y la firma declarados en `workspaces.config_extra.documento_viaje`.
 *
 * ⚠️ Viven en configuración y NO en el código a propósito: quién firma un documento que
 * va al cliente, y con qué correo, es una decisión del cliente. Clavar «Edgar Javier
 * Alarcón S., Director Comercial» aquí obligaría a un despliegue para cambiar un cargo, y
 * dejaría el nombre de una persona dentro del producto de todos.
 *
 * ⚠️ El correo del pie tampoco se elige aquí: los itinerarios de Trappvel alternan
 * `contacto@` y `comercial@` (§2.10), y cuál es el bueno lo dice Trappvel, no el código.
 *
 * Sin configuración devuelve los dos en `null`, que es lo que hace caer al pie del
 * vendedor y a la firma de quien generó. Un jsonb roto se lee igual: `null`, nunca a
 * medias.
 */
export function leerConfigDocumentoViaje(raw: unknown): ConfigDocumentoViaje {
  const vacio: ConfigDocumentoViaje = { pie: null, firma: null }
  if (!raw || typeof raw !== 'object') return vacio
  const cfg = (raw as Record<string, unknown>).documento_viaje
  if (!cfg || typeof cfg !== 'object') return vacio
  const c = cfg as Record<string, unknown>
  const pie = typeof c.pie === 'string' && c.pie.trim() !== '' ? c.pie.trim() : null
  const f = c.firma && typeof c.firma === 'object' ? (c.firma as Record<string, unknown>) : null
  const nombre = f && typeof f.nombre === 'string' && f.nombre.trim() !== '' ? f.nombre.trim() : null
  return {
    pie,
    // Una firma sin nombre no es una firma: se descarta entera y firma quien generó.
    firma: nombre
      ? {
          nombre,
          cargo: typeof f?.cargo === 'string' && f.cargo.trim() !== '' ? f.cargo.trim() : null,
          contacto: typeof f?.contacto === 'string' && f.contacto.trim() !== '' ? f.contacto.trim() : null,
        }
      : null,
  }
}
