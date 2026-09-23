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
import { normalizarTerminos } from './terminos-cotizacion'

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
  /**
   * Lo que el validador de estilo encontró (`revisarEstilo`): en un borrador de ONE, lo que
   * hay que mirar antes de guardarlo; en un texto guardado, lo que la persona decidió dejar.
   * Marca, no corrige: el texto nunca se reescribe en silencio. Ausente en los textos
   * guardados antes del 2026-09-23.
   */
  estilo_por_revisar?: AlertaDeEstilo[]
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
    ...conAlertas(leerAlertasDeEstilo(r.estilo_por_revisar)),
  }
}

/** La clave de las alertas solo si hay alguna: un texto limpio se guarda y se lee como antes. */
export function conAlertas(alertas: AlertaDeEstilo[]): { estilo_por_revisar?: AlertaDeEstilo[] } {
  return alertas.length > 0 ? { estilo_por_revisar: alertas } : {}
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
  /** Los términos guardados en la cotización (`cotizaciones.terminos_condiciones`). */
  terminos: string | null
  /**
   * Las condiciones de siempre de la línea (`config_extra.terminos_base`). El panel las
   * propone en un borrador sin términos (`terminosAlAbrir`); el PDF nunca las lee.
   */
  terminosBase: string | null
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

// ── Lo que declara la línea: términos base y la voz de Trappvel ──────────────

/** Cuántos ejemplos de la voz entran al prompt como máximo (brief C4: de 3 a 5). */
export const MAX_EJEMPLOS_TEXTO = 5

/**
 * La voz de Trappvel mientras su línea no declare otra (`config_extra.ejemplos_texto`).
 *
 * La frase de apertura y una de presentación de tres cotizaciones reales de 2026 (Chile,
 * Perú y Argentina; fuentes en `terminos-base-trappvel.md`), sin los párrafos largos. Los
 * originales tutean; aquí van de «usted», porque el documento trata de usted y un ejemplo
 * que tutea le enseñaría al modelo a tutear.
 */
export const EJEMPLOS_TEXTO_INICIALES: readonly TextoCliente[] = [
  {
    titular: null,
    intro: '¡Prepárese para vivir una experiencia única en Chile! Hemos seleccionado los servicios necesarios para que solo se preocupe por disfrutar.',
    incluye: [],
    antes_de_viajar: [],
  },
  {
    titular: null,
    intro: '¡Déjese sorprender por Perú! Hemos preparado esta propuesta pensando en cada detalle para que disfrute un viaje cómodo y seguro.',
    incluye: [],
    antes_de_viajar: [],
  },
  {
    titular: null,
    intro: 'Glaciares, cataratas, ciudades históricas y buenos vinos: Argentina tiene de todo.',
    incluye: [],
    antes_de_viajar: [],
  },
]

/** Lo que el texto para el cliente lee de `lineas_negocio.config_extra`. */
export interface ConfigTextoDeLinea {
  /** `config_extra.terminos_base`: las condiciones de siempre, para proponerlas. */
  terminosBase: string | null
  /** `config_extra.ejemplos_texto`, ya limpios; los iniciales si la línea no declara nada. */
  ejemplos: TextoCliente[]
}

/**
 * Lee la configuración de la línea sin confiar en su forma.
 *
 * `terminos_base` es un texto (ver `terminos-cotizacion.ts`). `ejemplos_texto` es una lista
 * donde cada ejemplo es un texto suelto (se toma como una presentación) o un objeto con
 * cualquiera de `titular`, `intro`, `incluye` y `antes_de_viajar`.
 *
 * - Sin la clave, o con algo que no es lista: los ejemplos iniciales.
 * - Con una lista: esa y solo esa, hasta 5. Una lista vacía apaga los ejemplos.
 * - Un ejemplo pasa por la misma limpieza que la respuesta del modelo: el renglón que trae
 *   una cifra de dinero se cae, porque un ejemplo con precios le enseña a poner precios.
 */
export function leerConfigTextoDeLinea(configExtra: unknown): ConfigTextoDeLinea {
  const c = configExtra && typeof configExtra === 'object' && !Array.isArray(configExtra)
    ? (configExtra as Record<string, unknown>)
    : {}
  const terminosBase = normalizarTerminos(c.terminos_base)
  if (!Array.isArray(c.ejemplos_texto)) return { terminosBase, ejemplos: EJEMPLOS_TEXTO_INICIALES.map(e => ({ ...e })) }
  const ejemplos: TextoCliente[] = []
  for (const e of c.ejemplos_texto) {
    const t = textoDelModelo(typeof e === 'string' ? { intro: e } : e)
    if (textoVacio(t)) continue
    ejemplos.push(t)
    if (ejemplos.length >= MAX_EJEMPLOS_TEXTO) break
  }
  return { terminosBase, ejemplos }
}

// ── El validador de estilo ───────────────────────────────────────────────────

export type CampoDelTexto = 'titular' | 'intro' | 'incluye' | 'antes_de_viajar'

/**
 * - `vetada`: una fórmula de folleto de la lista del brief C4, en cualquier forma.
 * - `repetida`: las que se permiten en UNA frase entusiasta («experiencia única»,
 *   «déjese sorprender», «prepárese») aparecen en más de una frase, o una se repite.
 * - `exclamaciones`: más de una en todo el texto.
 * - `guion_largo`: un «—».
 * - `emoji`: el PDF de Helvetica no los imprime, y el documento ya pone sus iconos.
 */
export type MotivoDeEstilo = 'vetada' | 'repetida' | 'exclamaciones' | 'guion_largo' | 'emoji'

export interface AlertaDeEstilo {
  motivo: MotivoDeEstilo
  /** Lo encontrado, tal como está escrito («descubra», «—»), o la cuenta («3 exclamaciones»). */
  texto: string
  /** Dónde. `null` cuando la regla es de todo el texto (repetidas, exclamaciones). */
  campo: CampoDelTexto | null
}

const ETIQUETA_CAMPO: Record<CampoDelTexto, string> = {
  titular: 'Titular',
  intro: 'Presentación',
  incluye: 'Incluido en el plan',
  antes_de_viajar: 'Antes de viajar',
}

/**
 * Las fórmulas vetadas, sobre el texto SIN tildes y en minúscula. Cubren el «tú» de la
 * lista del brief y el «usted» que de verdad escribe el modelo («descubra», «no se lo
 * pierda», «le espera»). Las letras de alrededor se miran con `\p{L}`: `\b` de JavaScript
 * es ASCII y cortaría «rincón» en la «ó».
 *
 * «lo espera» NO está: «el conductor lo espera en la salida» es un dato, no un adorno.
 */
const VETADAS: RegExp[] = [
  /sumer[gj]\p{L}*/gu,
  /descubr\p{L}*/gu,
  /paraisos?/gu,
  /experiencias?\s+inolvidables?/gu,
  /escapadas?\s+perfectas?/gu,
  /joyas?/gu,
  /rincon(?:es|cito|citos)?/gu,
  /viv[ae]n?\s+la\s+magia/gu,
  /(?:te|le|les)\s+esperan?/gu,
  /sin\s+igual/gu,
  /magic[oa]s?/gu,
  /de\s+ensueno/gu,
  /aguas?\s+cristalinas?/gu,
  /no\s+(?:te|se)(?:\s+l[oa]s?)?\s+pierdas?n?/gu,
  /ideal(?:es)?\s+para/gu,
]

/**
 * Las que caben en la ÚNICA frase entusiasta del texto (ajuste de Mauricio del 2026-09-23:
 * las cotizaciones reales de Trappvel abren así). Se cuentan por FRASE, no por palabra: la
 * apertura real «¡Prepárese para vivir una experiencia única en Chile!» trae dos y es una
 * sola frase entusiasta. Solo el imperativo: «prepararse para el frío» es un consejo.
 */
const UNA_VEZ: RegExp[] = [
  /experiencias?\s+unicas?/gu,
  /dej(?:ate|ese|ense|arse)\s+sorprender/gu,
  /prepar(?:ate|ese|ense)/gu,
]

const LETRA_ANTES = /\p{L}/u

/** Las apariciones de `re` en `s`, sin tildes ni mayúsculas, devueltas como estaban escritas. */
function apariciones(s: string, re: RegExp): string[] {
  const { n, pos } = comparable(s)
  const out: string[] = []
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(n)) !== null) {
    const i = m.index
    const fin = i + m[0].length
    const antes = i > 0 ? n[i - 1] : ''
    const despues = fin < n.length ? n[fin] : ''
    if ((antes && LETRA_ANTES.test(antes)) || (despues && LETRA_ANTES.test(despues))) continue
    out.push(s.slice(pos[i], pos[fin - 1] + 1))
  }
  return out
}

function camposDelTexto(t: TextoCliente): [CampoDelTexto, string][] {
  const out: [CampoDelTexto, string][] = []
  if (t.titular) out.push(['titular', t.titular])
  if (t.intro) out.push(['intro', t.intro])
  for (const r of t.incluye) out.push(['incluye', r])
  for (const r of t.antes_de_viajar) out.push(['antes_de_viajar', r])
  return out
}

const EMOJI = /\p{Extended_Pictographic}/gu

/**
 * Lo que suena a folleto o a texto de IA, según el brief C4 con el ajuste de Mauricio del
 * 2026-09-23. MARCA, no corrige: quien revisa decide, y el texto nunca se reescribe en
 * silencio. Lista vacía = nada que mirar.
 *
 * Lo que no se puede medir con una regla (tres adjetivos seguidos, una pregunta retórica,
 * el entusiasmo repetido con otras palabras) lo pide el prompt y lo ve la persona.
 */
export function revisarEstilo(t: TextoCliente): AlertaDeEstilo[] {
  const alertas: AlertaDeEstilo[] = []
  const vistas = new Set<string>()
  const agregar = (a: AlertaDeEstilo) => {
    const clave = `${a.motivo}|${a.campo ?? ''}|${a.texto.toLowerCase()}`
    if (vistas.has(clave)) return
    vistas.add(clave)
    alertas.push(a)
  }

  const campos = camposDelTexto(t)
  const unaVez: string[] = []
  let frasesEntusiastas = 0
  let exclamaciones = 0
  for (const [campo, s] of campos) {
    for (const re of VETADAS) for (const hallado of apariciones(s, re)) agregar({ motivo: 'vetada', texto: hallado, campo })
    for (const frase of s.split(/(?<=[.!?])\s+/)) {
      const halladas = UNA_VEZ.flatMap(re => apariciones(frase, re))
      if (halladas.length > 0) frasesEntusiastas++
      unaVez.push(...halladas)
    }
    if (s.includes('—')) agregar({ motivo: 'guion_largo', texto: '—', campo })
    for (const e of s.match(EMOJI) ?? []) agregar({ motivo: 'emoji', texto: e, campo })
    // «¡Qué bien!» es UNA exclamación: se cuentan los signos de cierre, o los de apertura si
    // alguien escribió solo esos.
    exclamaciones += Math.max((s.match(/!/g) ?? []).length, (s.match(/¡/g) ?? []).length)
  }
  const repetida = new Set(unaVez.map(x => comparable(x).n.replace(/\s+/g, ' '))).size < unaVez.length
  if (frasesEntusiastas > 1 || repetida) {
    agregar({ motivo: 'repetida', texto: unaVez.join(', '), campo: null })
  }
  if (exclamaciones > 1) {
    agregar({ motivo: 'exclamaciones', texto: `${exclamaciones} exclamaciones`, campo: null })
  }
  return alertas
}

/** Una alerta en una frase, para el panel. */
export function describirAlertaDeEstilo(a: AlertaDeEstilo): string {
  const donde = a.campo ? ` (${ETIQUETA_CAMPO[a.campo]})` : ''
  switch (a.motivo) {
    case 'vetada':
      return `«${a.texto}»${donde}: suena a folleto.`
    case 'repetida':
      return `${a.texto.split(', ').map(x => `«${x}»`).join(', ')}: caben en una sola frase entusiasta en todo el texto.`
    case 'exclamaciones':
      return `${a.texto}: se permite una en todo el texto.`
    case 'guion_largo':
      return `Guion largo «—»${donde}: mejor coma o punto.`
    case 'emoji':
      return `Emoji ${a.texto}${donde}: el PDF no lo imprime.`
  }
}

const MOTIVOS = new Set<MotivoDeEstilo>(['vetada', 'repetida', 'exclamaciones', 'guion_largo', 'emoji'])
const CAMPOS = new Set<CampoDelTexto>(['titular', 'intro', 'incluye', 'antes_de_viajar'])

/** Las alertas guardadas en el jsonb, sin confiar en su forma. */
function leerAlertasDeEstilo(raw: unknown): AlertaDeEstilo[] {
  if (!Array.isArray(raw)) return []
  const out: AlertaDeEstilo[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const r = x as Record<string, unknown>
    const texto = cadena(r.texto)
    if (!texto || !MOTIVOS.has(r.motivo as MotivoDeEstilo)) continue
    const campo = CAMPOS.has(r.campo as CampoDelTexto) ? (r.campo as CampoDelTexto) : null
    out.push({ motivo: r.motivo as MotivoDeEstilo, texto, campo })
  }
  return out
}

// ── El prompt ────────────────────────────────────────────────────────────────

/** Un ejemplo, tal como lo ve el modelo: solo los campos que trae. */
function ejemploParaElPrompt(e: TextoCliente): string {
  const o: Record<string, unknown> = {}
  if (e.titular) o.titular = e.titular
  if (e.intro) o.intro = e.intro
  if (e.incluye.length > 0) o.incluye = e.incluye
  if (e.antes_de_viajar.length > 0) o.antes_de_viajar = e.antes_de_viajar
  return JSON.stringify(o, null, 2)
}

/**
 * Las instrucciones del modelo. La entrada va aparte, como JSON (`contenidoDelRedactor`).
 *
 * ⚠️ Lo que más se le pide es NO INVENTAR: el documento sale a un cliente con un precio y
 * cualquier servicio que el texto prometa y el viaje no tenga es una promesa comercial
 * falsa. Por eso cada regla de «incluye» ata el renglón a un campo de la entrada.
 *
 * El estilo (brief C4, con el ajuste de Mauricio del 2026-09-23) es el de Trappvel sin
 * exagerar: una frase entusiasta y una exclamación como mucho, lo demás dato. Lo que se
 * puede medir de eso lo vuelve a mirar `revisarEstilo` sobre la respuesta.
 *
 * `ejemplos` es la voz de la agencia (few-shot): imita el tono, nunca los datos.
 */
export function promptDelRedactor(ejemplos: readonly TextoCliente[] = []): string {
  const partes = [
    `Eres redactor comercial de Trappvel, una agencia de viajes colombiana. Escribes el texto que acompaña una cotización de viaje que se le envía a un cliente.

Recibirás un JSON con los datos del viaje (destino, fechas, viajeros, vuelos, hoteles, traslados, actividades, otros servicios y cargos que se pagan en destino). Es TODO lo que sabes del viaje.

Produce:
1. "titular": una frase corta (máximo 70 caracteres) que nombre el destino. Sin precios ni nombres de personas.
2. "intro": una o dos frases (máximo 260 caracteres) que presenten el viaje. Primero el dato (a dónde, cuántas noches, qué hotel) y después UN atributo real del destino, de conocimiento general (el mar, una zona arqueológica, el clima), sin prometer servicios.
3. "incluye": de 3 a 8 renglones con lo que el cliente RECIBE, cada uno descrito como servicio y con sus detalles útiles. Ejemplos de forma: "Tiquetes aéreos Bogotá – San Andrés – Bogotá con Avianca, con equipaje de mano y de bodega", "5 noches en el Hotel X con desayuno", "Traslado aeropuerto – hotel – aeropuerto".
4. "antes_de_viajar": de 2 a 5 consejos prácticos para el viajero de este viaje: documentos, clima, llegar con anticipación al aeropuerto, cargos que se pagan en destino. Tono de consejo.

REGLAS (obligatorias):
- No inventes nada que no esté en el JSON: ni hoteles, ni alimentación, ni traslados, ni actividades, ni seguros, ni equipaje, ni horarios. Si un dato no está (por ejemplo, el régimen de alimentación), no lo menciones.
- Cada renglón de "incluye" tiene que corresponder a un elemento del JSON (un vuelo, un hotel, un traslado, una actividad o un otro servicio). Nunca copies el nombre interno de una línea ni códigos de reserva; describe el servicio.
- Los cargos que se pagan en destino NO van en "incluye": si existen, recuérdalos en "antes_de_viajar" diciendo que se pagan allá, sin montos.
- "antes_de_viajar" son consejos para el viajero, no condiciones de la reserva: nunca incluye validez de tarifas, disponibilidad, cambios, cancelaciones, penalidades ni formas de pago. Eso va en los términos y condiciones, que tú no escribes.
- En "antes_de_viajar" puedes incluir recomendaciones generales y conocidas del destino y del tipo de viaje (documentos de identidad, anticipación en el aeropuerto, requisitos de ingreso del destino, clima), sin cifras, sin precios y sin horarios que no estén en el JSON.
- Nada de precios, montos ni monedas en ningún campo.
- No uses nombres de personas.
- Español de Colombia. Si te diriges al cliente, trátalo de usted; nunca lo tutees.
- Ortografía del español: después de dos puntos va minúscula, y nada de mayúsculas de título en frases.

ESTILO (obligatorio): el de Trappvel, cálido y sin exagerar. Lo firma una agencia real, no un folleto.
- Se permite UNA sola frase entusiasta en todo el texto, en el titular o al abrir la presentación (por ejemplo: "¡Prepárese para vivir una experiencia única en Chile!"), y UNA sola exclamación en todo el texto. Lo demás es dato concreto: destino, noches, hotel, qué incluye.
- "Experiencia única", "déjese sorprender" y "prepárese" solo caben en esa única frase entusiasta; fuera de ella no se usan, y ninguna se repite.
- Prohibido, en cualquier forma (de usted o de tú, en singular o en plural): "sumérgete", "descubre", "paraíso", "experiencia inolvidable", "escapada perfecta", "joya", "rincón", "vive la magia", "te espera", "sin igual", "mágico", "de ensueño", "no te pierdas", "ideal para". "Aguas cristalinas" solo si es literal y útil.
- No encadenes adjetivos (nunca tres seguidos) ni repitas el entusiasmo: nada de sumar "magia", "encanto", "increíble" o "lleno de momentos especiales" a otra frase entusiasta.
- Frases cortas y concretas. Mejor "Cinco noches en Cancún, en un hotel todo incluido frente al mar" que "Descubre el paraíso caribeño en una experiencia inolvidable".
- Nada de guion largo (—): usa coma o punto. Nada de preguntas retóricas. Nada de emojis.`,
  ]

  const usados = ejemplos.slice(0, MAX_EJEMPLOS_TEXTO)
  if (usados.length > 0) {
    partes.push(`EJEMPLOS DE LA VOZ DE TRAPPVEL
Textos que la agencia ya les envió a sus clientes. Imita su tono, su largo y su manera de decir las cosas. NUNCA copies sus datos (destinos, hoteles, fechas, servicios): los datos de este viaje salen solo del JSON. Si un ejemplo choca con una regla de arriba, manda la regla.

${usados.map((e, i) => `Ejemplo ${i + 1}:\n${ejemploParaElPrompt(e)}`).join('\n\n')}`)
  }

  partes.push('Responde SOLO con JSON válido, siguiendo exactamente el esquema pedido.')
  return partes.join('\n\n')
}

/** La entrada del modelo tal como viaja: solo el JSON del viaje. */
export function contenidoDelRedactor(v: ViajeParaRedactar): string {
  return JSON.stringify(v, null, 2)
}

const conDinero = (s: string) => DINERO.some(re => { re.lastIndex = 0; return re.test(s) })

/**
 * Lo que el modelo devolvió, ya limpio. Además de normalizar, descarta los renglones que
 * traigan una cifra de dinero: la regla está en el prompt, y aquí se hace cumplir.
 */
export function textoDelModelo(raw: unknown): TextoCliente {
  const t = normalizarTexto(raw)
  const sinDinero = (s: string) => !conDinero(s)
  return {
    titular: t.titular && sinDinero(t.titular) ? t.titular : null,
    intro: t.intro && sinDinero(t.intro) ? t.intro : null,
    incluye: t.incluye.filter(sinDinero),
    antes_de_viajar: t.antes_de_viajar.filter(sinDinero),
  }
}
