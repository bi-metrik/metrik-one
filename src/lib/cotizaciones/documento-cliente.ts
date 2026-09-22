/**
 * El texto del documento del cliente que REDACTA ONE y CORRIGE el equipo (Trappvel).
 *
 * Decisión de Mauricio (2026-09-22): ONE escribe un titular comercial, una intro corta, la
 * lista de lo que el plan incluye y un recuadro «Antes de viajar»; el equipo lo lee, lo
 * corrige y lo guarda. Vive en `cotizaciones.documento_cliente` (una columna jsonb por
 * cotización: lo que el plan incluye depende de las líneas de ESA cotización).
 *
 * Puro a propósito: aquí están las reglas que deciden qué ve el cliente y qué ve el
 * modelo, y se prueban sin base, sin red y sin renderizar.
 *
 * ## Las tres reglas que sostienen todo
 *
 * 1. **El cliente solo ve texto revisado** (`textoImprimible`). Un borrador del modelo,
 *    aunque esté guardado, no sale en el PDF hasta que una persona lo guarda.
 * 2. **El modelo solo ve datos del viaje** (`viajeParaRedactar`). Ni el nombre del
 *    cliente ni un precio llegan al prompt: la entrada se arma campo por campo, nunca
 *    pasando objetos enteros, y el texto libre (nombres de líneas escritos por el equipo)
 *    se limpia de cifras y de los nombres del cliente antes de salir.
 * 3. **Un texto sabe con qué líneas se escribió** (`huellaDeViaje`). Si las líneas
 *    cambian, la huella deja de coincidir y el editor avisa que el texto puede estar
 *    desactualizado. La huella se calcula sobre la MISMA entrada que ve el modelo.
 */

import type { ViajePDF } from '@/lib/pdf/cotizacion-props'
import type { Composicion } from './tarifa-pasajero'
import {
  cargosEnDestinoDeItems,
  duracionDelViaje,
  hotelesDeItems,
  ranuraDelItem,
  serviciosDeItems,
  vuelosDeItems,
  type ItemConLectura,
} from './detalle-viaje'

export const MODELO_REDACTOR = 'gemini-2.5-flash'

/** Lo que se imprime. */
export interface TextoCliente {
  titular: string | null
  intro: string | null
  incluye: string[]
  antes_de_viajar: string[]
}

/** Lo que se guarda: el texto y de dónde salió. */
export interface DocumentoCliente extends TextoCliente {
  /** `ia` = lo redactó ONE (aunque después una persona lo corrija); `persona` = nació a mano. */
  origen: 'ia' | 'persona'
  modelo: string | null
  redactado_en: string | null
  /** La huella de la entrada con que se redactó o se revisó. Ver `huellaDeViaje`. */
  fuente_hash: string | null
  /** `staff.id` de quien lo guardó. */
  revisado_por: string | null
  revisado_por_nombre: string | null
  revisado_en: string | null
}

export const LIMITES_TEXTO = {
  titular: 90,
  intro: 400,
  renglon: 180,
  renglones: 8,
} as const

const cadena = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t === '' ? null : t
}

const recortar = (t: string | null, max: number): string | null => (t && t.length > max ? t.slice(0, max).trimEnd() : t)

/**
 * Un renglón de lista va sin punto final: «Antes de viajar» los imprime seguidos con « · » y
 * un punto delante del separador se ve como un error de digitación.
 */
const sinPuntoFinal = (t: string | null): string | null => (t ? cadena(t.replace(/[\s.;,]+$/, '')) : t)

function lista(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const vistos = new Set<string>()
  const out: string[] = []
  for (const x of v) {
    const t = recortar(sinPuntoFinal(cadena(x)), LIMITES_TEXTO.renglon)
    if (!t) continue
    const clave = t.toLowerCase()
    if (vistos.has(clave)) continue
    vistos.add(clave)
    out.push(t)
    if (out.length >= LIMITES_TEXTO.renglones) break
  }
  return out
}

/** El texto limpio: sin espacios sobrantes, sin renglones vacíos ni repetidos, con tope. */
export function normalizarTexto(raw: unknown): TextoCliente {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    titular: recortar(cadena(r.titular), LIMITES_TEXTO.titular),
    intro: recortar(cadena(r.intro), LIMITES_TEXTO.intro),
    incluye: lista(r.incluye),
    antes_de_viajar: lista(r.antes_de_viajar),
  }
}

export function textoVacio(t: TextoCliente): boolean {
  return !t.titular && !t.intro && t.incluye.length === 0 && t.antes_de_viajar.length === 0
}

/**
 * El documento guardado, o `null`. Un jsonb roto se lee como ausente, nunca a medias: un
 * texto sin su marca de revisión no puede pasar por revisado.
 */
export function leerDocumentoCliente(raw: unknown): DocumentoCliente | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const texto = normalizarTexto(r)
  if (textoVacio(texto)) return null
  return {
    ...texto,
    origen: r.origen === 'ia' ? 'ia' : 'persona',
    modelo: cadena(r.modelo),
    redactado_en: cadena(r.redactado_en),
    fuente_hash: cadena(r.fuente_hash),
    revisado_por: cadena(r.revisado_por),
    revisado_por_nombre: cadena(r.revisado_por_nombre),
    revisado_en: cadena(r.revisado_en),
  }
}

/**
 * ⚠️⚠️ Lo que el PDF imprime: SOLO un texto que una persona guardó.
 *
 * Un borrador del modelo puede traer algo que el viaje no tiene; la única garantía de que
 * no le llega al cliente es que el documento no lo imprima hasta que alguien lo haya leído.
 */
export function textoImprimible(doc: DocumentoCliente | null): TextoCliente | null {
  if (!doc || !doc.revisado_en) return null
  const t: TextoCliente = { titular: doc.titular, intro: doc.intro, incluye: doc.incluye, antes_de_viajar: doc.antes_de_viajar }
  return textoVacio(t) ? null : t
}

export type EstadoTexto = 'sin_texto' | 'borrador' | 'revisado'

export function estadoDelTexto(doc: DocumentoCliente | null): EstadoTexto {
  if (!doc) return 'sin_texto'
  return doc.revisado_en ? 'revisado' : 'borrador'
}

/**
 * Las claves que el texto le agrega al viaje del PDF. Vacío (`{}`) si no hay texto
 * REVISADO: sin revisar, el objeto del viaje queda exactamente como antes y el documento
 * no cambia un carácter. Es lo único que la acción del PDF usa para decidirlo.
 */
export function textoParaElViaje(
  doc: DocumentoCliente | null,
): Partial<Pick<ViajePDF, 'titular' | 'intro' | 'incluye' | 'antesDeViajar'>> {
  const t = textoImprimible(doc)
  if (!t) return {}
  return { titular: t.titular, intro: t.intro, incluye: t.incluye, antesDeViajar: t.antes_de_viajar }
}

/** ¿El texto se escribió (o se revisó) con otras líneas? Sin huella de ninguno de los dos lados, no se afirma. */
export function textoDesactualizado(doc: DocumentoCliente | null, huellaActual: string | null): boolean {
  if (!doc || !doc.fuente_hash || !huellaActual) return false
  return doc.fuente_hash !== huellaActual
}

/** El aviso del PDF cuando hay texto que no sale. `null` = nada que avisar. */
export function avisoDelTextoEnPdf(doc: DocumentoCliente | null): string | null {
  if (estadoDelTexto(doc) !== 'borrador') return null
  return 'El texto para el cliente es un borrador de ONE sin revisar: el PDF salió sin él. Revísalo y guárdalo para que se imprima.'
}

/**
 * Lo que el editor necesita para pintar el panel «Texto para el cliente». Lo arma el
 * servidor; el navegador no calcula huellas ni decide si el texto quedó viejo.
 */
export interface PanelTextoCliente {
  /** `false` mientras la migración de `cotizaciones.documento_cliente` no esté aplicada. */
  columnaPresente: boolean
  documento: DocumentoCliente | null
  /** `true` si el texto guardado se escribió (o se revisó) con otras líneas. */
  desactualizado: boolean
  /** Si hay algo que redactar: sin destino ni servicios el modelo inventaría. */
  hayViaje: boolean
  /** Solo un borrador se redacta o se corrige, igual que sus líneas. */
  editable: boolean
}

// ── La entrada del modelo ─────────────────────────────────────────────────────

/** Lo único que el modelo ve del viaje. Cada campo se copia a mano: nada entra por arrastre. */
export interface ViajeParaRedactar {
  destino: string | null
  fechaSalida: string | null
  fechaRegreso: string | null
  duracion: string | null
  viajeros: { adultos: number; ninos: number; infantes: number } | null
  vuelos: {
    aerolinea: string | null
    desde: string | null
    hasta: string | null
    fechaIda: string | null
    fechaRegreso: string | null
    escalaIda: string | null
    escalaRegreso: string | null
    directo: boolean | null
    tarifa: string | null
    equipaje: string | null
    adicionales: string[]
  }[]
  hoteles: {
    nombre: string | null
    ciudad: string | null
    estrellas: number | null
    entrada: string | null
    salida: string | null
    noches: number | null
    regimen: string | null
    habitacion: string | null
    adicionales: string[]
  }[]
  traslados: string[]
  actividades: string[]
  /** Otras líneas del precio sin ranura (un seguro, una tarjeta de turismo), por su nombre limpio. */
  otrosServicios: string[]
  /** Lo que se paga allá, sin el monto. */
  cargosEnDestino: { concepto: string; ciudad: string | null }[]
}

export interface ItemParaRedactar extends ItemConLectura {
  es_ajuste?: boolean | null
}

export interface EntradaRedactor {
  /** Las líneas que el documento DESCRIBE (las mismas que imprime el PDF). */
  items: ItemParaRedactar[]
  destino: string | null
  fechas: { inicio: string | null; fin: string | null }
  composicion: Composicion | null
  /**
   * Los nombres del cliente (empresa, contacto). No van al modelo: se usan para BORRARLOS
   * del texto libre que sí va, por si alguien los escribió en el nombre de una línea.
   */
  nombresDelCliente: string[]
}

/** Texto sin tildes y en minúscula, con el mapa de vuelta a las posiciones originales. */
function comparable(s: string): { n: string; pos: number[] } {
  let n = ''
  const pos: number[] = []
  for (let i = 0; i < s.length; i++) {
    const d = s[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    for (const ch of d) {
      n += ch
      pos.push(i)
    }
  }
  return { n, pos }
}

/** Quita de `s` cada aparición de `nombre`, sin distinguir tildes ni mayúsculas. */
function sinNombre(s: string, nombre: string): string {
  const aguja = comparable(nombre.replace(/\s+/g, ' ').trim()).n
  if (aguja.length < 3) return s
  let out = s
  for (;;) {
    const { n, pos } = comparable(out)
    const i = n.indexOf(aguja)
    if (i === -1) return out
    out = out.slice(0, pos[i]) + out.slice(pos[i + aguja.length - 1] + 1)
  }
}

/**
 * Cifras que parecen dinero: con signo o moneda (`$ 1.200`, `COP 350000`, `USD 90`), con
 * separador de miles (`7.303.878`) o de cinco dígitos o más (`6208296`). Los números de
 * vuelo (4 dígitos) y las fechas ISO no caen aquí.
 */
const DINERO = [
  /(?:US\$|\$|€|\b(?:COP|USD|EUR|MXN)\b)\s?\d[\d.,]*/gi,
  /\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?\b/g,
  /\b\d{5,}\b/g,
]

/**
 * El texto libre que sale hacia el modelo: sin cifras de dinero y sin los nombres del
 * cliente. `null` si no queda nada que diga algo.
 */
export function limpiarTextoLibre(s: string | null | undefined, nombresDelCliente: string[]): string | null {
  let t = (s ?? '').trim()
  if (!t) return null
  for (const nombre of nombresDelCliente) if (nombre) t = sinNombre(t, nombre)
  for (const re of DINERO) t = t.replace(re, ' ')
  t = t.replace(/\s+([,.;:)])/g, '$1').replace(/\(\s*\)/g, ' ').replace(/[\s\-–—·,:;/|]+$/g, '').replace(/^[\s\-–—·,:;/|]+/g, '').replace(/\s+/g, ' ').trim()
  return /[\p{L}]/u.test(t) ? t : null
}

function fechaIso(v: string | null): string | null {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null
}

/**
 * La entrada del modelo, armada campo por campo desde las líneas y el viaje del negocio.
 *
 * ⚠️ `linea` (el nombre de la línea de un vuelo o un hotel) NO se copia: es el nombre con
 * que el equipo cotiza («AVIANCA BOG - ADZ») y lo que el cliente recibe no se describe con
 * él. Las líneas sin ranura sí aportan su nombre, limpio, porque es todo lo que dicen.
 */
export function viajeParaRedactar(e: EntradaRedactor): ViajeParaRedactar {
  const nombres = e.nombresDelCliente.filter(Boolean)
  const limpio = (s: string | null | undefined) => limpiarTextoLibre(s, nombres)
  const limpios = (xs: string[]) => xs.map(limpio).filter((x): x is string => x !== null)
  const items = e.items.filter(i => !i.es_ajuste)

  const vuelosPdf = vuelosDeItems(items)
  const vuelos = vuelosPdf.map(v => ({
    aerolinea: limpio(v.aerolinea),
    desde: limpio(v.origen),
    hasta: limpio(v.destino),
    fechaIda: v.fechaSalida,
    fechaRegreso: v.fechaRegreso,
    escalaIda: limpio(v.escalaIda),
    escalaRegreso: limpio(v.escalaRegreso),
    directo: v.escalas === null ? null : v.escalas === 0,
    tarifa: limpio(v.tarifa),
    equipaje: v.equipaje,
    adicionales: limpios(v.adicionales),
  }))
  const hoteles = hotelesDeItems(items).map(h => ({
    nombre: limpio(h.hotel),
    ciudad: limpio(h.ciudad),
    estrellas: h.estrellas,
    entrada: h.checkIn,
    salida: h.checkOut,
    noches: h.noches,
    regimen: limpio(h.regimen),
    habitacion: limpio(h.habitacion),
    adicionales: limpios(h.adicionales),
  }))
  const servicios = serviciosDeItems(items)
  const conFecha = (s: { descripcion: string; fecha: string | null }) => {
    const d = limpio(s.descripcion)
    return d && s.fecha ? `${d} (${s.fecha})` : d
  }
  // Un vuelo reconocido por su nombre ya está en `vuelos`: no se repite como «otro».
  const esVueloPorNombre = new Set(vuelosPdf.map(v => v.linea))
  const otrosServicios = limpios(
    items
      .filter(i => ranuraDelItem(i) === null && !esVueloPorNombre.has((i.nombre ?? '').trim()))
      .map(i => i.nombre ?? ''),
  )
  const c = e.composicion
  return {
    destino: limpio(e.destino),
    fechaSalida: fechaIso(e.fechas.inicio),
    fechaRegreso: fechaIso(e.fechas.fin),
    duracion: duracionDelViaje(e.fechas.inicio, e.fechas.fin),
    viajeros: c ? { adultos: c.adultos, ninos: c.ninos, infantes: c.infantes } : null,
    vuelos,
    hoteles,
    traslados: servicios.filter(s => s.tipo === 'traslado').map(conFecha).filter((x): x is string => x !== null),
    actividades: servicios.filter(s => s.tipo === 'actividad').map(conFecha).filter((x): x is string => x !== null),
    otrosServicios,
    cargosEnDestino: cargosEnDestinoDeItems(items).map(g => ({ concepto: g.concepto, ciudad: limpio(g.ciudad) })),
  }
}

/**
 * La huella de una entrada: 16 caracteres hexadecimales, estable para la misma entrada.
 *
 * cyrb53 sobre el JSON: no es criptográfica y no lo necesita; solo dice «¿es la misma
 * entrada?». Corre igual en el servidor y en el navegador.
 */
export function huellaDeViaje(v: ViajeParaRedactar): string {
  const s = JSON.stringify(v)
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return ((h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0'))
}

/** ¿Hay algo que redactar? Sin vuelos, hoteles, servicios ni destino, el modelo inventaría. */
export function hayViajeQueRedactar(v: ViajeParaRedactar): boolean {
  return Boolean(v.destino)
    || v.vuelos.length > 0
    || v.hoteles.length > 0
    || v.traslados.length > 0
    || v.actividades.length > 0
}

// ── El prompt ────────────────────────────────────────────────────────────────

/**
 * Las instrucciones del modelo. La entrada va aparte, como JSON (`contenidoDelRedactor`).
 *
 * ⚠️ Lo que más se le pide es NO INVENTAR: el documento sale a un cliente con un precio y
 * cualquier servicio que el texto prometa y el viaje no tenga es una promesa comercial
 * falsa. Por eso cada regla de «incluye» ata el renglón a un campo de la entrada.
 */
export function promptDelRedactor(): string {
  return `Eres redactor comercial de Trappvel, una agencia de viajes colombiana. Escribes el texto que acompaña una cotización de viaje que se le envía a un cliente.

Recibirás un JSON con los datos del viaje (destino, fechas, viajeros, vuelos, hoteles, traslados, actividades, otros servicios y cargos que se pagan en destino). Es TODO lo que sabes del viaje.

Produce:
1. "titular": una frase comercial corta (máximo 70 caracteres) que nombre el destino y dé ganas de viajar. Sin precios, sin nombres de personas, sin signos de exclamación en exceso.
2. "intro": una o dos frases (máximo 260 caracteres) que presenten el viaje: a dónde, cuántos días y qué lo hace atractivo. Puedes describir el destino con lo que es de conocimiento general (paisaje, mar, cultura), pero sin prometer servicios.
3. "incluye": de 3 a 8 renglones con lo que el cliente RECIBE, cada uno descrito como servicio y con sus detalles útiles. Ejemplos de forma: "Tiquetes aéreos Bogotá – San Andrés – Bogotá con Avianca, con equipaje de mano y de bodega", "5 noches en el Hotel X con desayuno", "Traslado aeropuerto – hotel – aeropuerto".
4. "antes_de_viajar": de 2 a 5 recomendaciones prácticas y breves para este viaje.

REGLAS (obligatorias):
- No inventes nada que no esté en el JSON: ni hoteles, ni alimentación, ni traslados, ni actividades, ni seguros, ni equipaje, ni horarios. Si un dato no está (por ejemplo, el régimen de alimentación), no lo menciones.
- Cada renglón de "incluye" tiene que corresponder a un elemento del JSON (un vuelo, un hotel, un traslado, una actividad o un otro servicio). Nunca copies el nombre interno de una línea ni códigos de reserva; describe el servicio.
- Los cargos que se pagan en destino NO van en "incluye": si existen, recuérdalos en "antes_de_viajar" diciendo que se pagan allá, sin montos.
- En "antes_de_viajar" puedes incluir recomendaciones generales y conocidas del destino y del tipo de viaje (documentos de identidad, anticipación en el aeropuerto, requisitos de ingreso del destino, clima), sin cifras, sin precios y sin horarios que no estén en el JSON.
- Nada de precios, montos ni monedas en ningún campo.
- No uses nombres de personas.
- Español de Colombia, tono cálido y profesional, sin exageraciones. Si te diriges al cliente, trátalo de usted; nunca lo tutees.
- Ortografía del español: después de dos puntos va minúscula, y nada de mayúsculas de título en frases.
- Responde SOLO con JSON válido, siguiendo exactamente el esquema pedido.`
}

/** La entrada del modelo tal como viaja: solo el JSON del viaje. */
export function contenidoDelRedactor(v: ViajeParaRedactar): string {
  return JSON.stringify(v, null, 2)
}

/**
 * Lo que el modelo devolvió, ya limpio. Además de normalizar, descarta los renglones que
 * traigan una cifra de dinero: la regla está en el prompt, y aquí se hace cumplir.
 */
export function textoDelModelo(raw: unknown): TextoCliente {
  const t = normalizarTexto(raw)
  const sinDinero = (s: string) => !DINERO.some(re => { re.lastIndex = 0; return re.test(s) })
  return {
    titular: t.titular && sinDinero(t.titular) ? t.titular : null,
    intro: t.intro && sinDinero(t.intro) ? t.intro : null,
    incluye: t.incluye.filter(sinDinero),
    antes_de_viajar: t.antes_de_viajar.filter(sinDinero),
  }
}
