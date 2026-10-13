/**
 * A DÓNDE VA un pantallazo leído, dicho ANTES de aceptar (cotización por pasos, C5; decisiones 1
 * y 2 de Noor; criterios M1–M3 y V6 de Vera).
 *
 * La fila de la bandeja dice una de cuatro frases, siempre tocable:
 *  · «Suma aparte: Hotel en San Andrés»            → servicio nuevo;
 *  · «Otra opción de: Hotel en Providencia»         → compite;
 *  · «Otra habitación de: Posada Enilda»            → solo hotel, suma dentro de la opción;
 *  · «Completa SATENA: precio del niño»             → no crea nada: trae el precio que faltaba.
 *
 * ## Quién decide
 *
 * Las REGLAS de siempre (`ubicarLectura`) dan la frase base, sin esperar a nadie. Si la pieza
 * `modelo_destino` está encendida, la lectura le pregunta además al modelo (con corte de 2,5 s,
 * `decidir-destino.ts`) y su respuesta pasa por `conDecisionDelModelo`, que es donde viven las
 * guardas que no dependen de lo bien que razone el modelo:
 *  · M3: una opción es siempre del mismo tipo que su servicio. Un destino de otro tipo, o que ya
 *    no está en la cotización, se descarta y queda la regla.
 *  · M2: ante la duda, suma aparte (decisión 1). El modelo no puede volver opción algo que las
 *    reglas dejan aparte sin decirlo con su razón; sin razón, queda la regla.
 *  · «Completa» no la inventa el modelo: solo vale si el precio que falta existe de verdad
 *    (`completaDe`).
 *
 * «Aceptar» usa lo que ya dice la fila y NUNCA llama al modelo (V6).
 *
 * Puro: sin red y sin base.
 */

import { normalizarGrupo } from './itinerarios'
import { listaDeTipos, tiposSinPrecio } from './precio-que-falta'
import { definicionDeTipo, type TipoRanura } from './ranuras-cotizacion'
import { etiquetaDeRanura, ranuraDeGrupo } from './ranuras-pantallazo'
import {
  composicionDeLectura,
  composicionDeLinea,
  leerTarifaPax,
  mismaComposicion,
  mismoTexto,
  type Composicion,
  type LecturaCasilla,
  type TipoPasajero,
} from './tarifa-pasajero'
import { ubicarLectura, type LineaParaUbicar } from './ubicar-lectura'

export type ComoPorPasos = 'nueva' | 'hermana' | 'habitacion' | 'completa'

export type FuenteDeDestino = 'reglas' | 'modelo' | 'asesora'

export interface DestinoPorPasos {
  como: ComoPorPasos
  /**
   * `hermana`: una opción del servicio con el que compite (de ella sale el grupo). `habitacion` y
   * `completa`: la opción que la recibe. `nueva`: `null`.
   */
  itemId: string | null
  /** El grupo del servicio, para nombrarlo. `nueva`: `null`. */
  grupo: string | null
  /** `completa`: los tipos de pasajero que trae y el costo c/u de cada uno. */
  tipos?: TipoPasajero[] | null
  precios?: Partial<Record<TipoPasajero, number>> | null
  /** La razón en una línea, en gris (o en ámbar si `duda`). */
  razon: string | null
  /** ONE no está seguro: queda aparte para que no se pierda (decisión 1). */
  duda: boolean
  fuente: FuenteDeDestino
}

type Linea = LineaParaUbicar & { entra_al_precio?: boolean | null }

const RANURAS_QUE_COMPLETAN = new Set(['vuelo_detalle', 'actividad_detalle'])

const vivas = (lineas: readonly Linea[]) => lineas.filter(l => l.es_ajuste !== true)

const slugDeTipo = (tipo: TipoRanura) => definicionDeTipo(tipo).slug

/** ¿La línea es del mismo tipo que la captura? (M3) */
export function mismoTipo(linea: Pick<Linea, 'grupo'>, tipo: TipoRanura): boolean {
  return ranuraDeGrupo(linea.grupo ?? null)?.slug === slugDeTipo(tipo)
}

/** El nombre corto de una opción: el que leyó ONE, o el del servicio. */
function nombreDeLinea(l: Linea): string {
  return (l.nombre ?? '').trim() || etiquetaDeRanura(l.grupo ?? null)
}

/** Lo que completa un pantallazo: la opción, los tipos que le faltaban y el costo c/u de cada uno. */
export interface Completa {
  itemId: string
  grupo: string
  nombre: string
  tipos: TipoPasajero[]
  /** Costo c/u por tipo, en la moneda de la opción, sacado del pantallazo nuevo. */
  precios: Partial<Record<TipoPasajero, number>>
}

/**
 * ¿Este pantallazo COMPLETA el precio que le falta a una opción que ya está? (V4, P12)
 *
 * Misma identidad (aerolínea, ruta y fechas; o la misma actividad y fecha) que una opción de vuelo
 * o de actividad a la que le falta el precio del niño o del infante, leída con OTROS pasajeros
 * (la búsqueda «6 adultos y 1 niño»). El precio que falta sale del pantallazo nuevo: de su fila por
 * tipo, o restándole a su total lo de los adultos al precio que ya tiene la opción. `null` si no
 * completa nada.
 */
export function completaDe(
  tipo: TipoRanura,
  lectura: LecturaCasilla,
  lineas: readonly Linea[],
  composicionViaje: Composicion | null,
): Completa | null {
  const slug = slugDeTipo(tipo)
  if (!RANURAS_QUE_COMPLETAN.has(slug)) return null
  const ocupacion = composicionDeLectura(lectura)
  if (!ocupacion) return null
  for (const l of vivas(lineas)) {
    if (!mismoTipo(l, tipo)) continue
    const faltan = tiposSinPrecio({ grupo: l.grupo ?? null, tarifa_pax: l.tarifa_pax ?? null }, composicionViaje)
    if (faltan.length === 0) continue
    const tarifa = leerTarifaPax(l.tarifa_pax)
    const primera = tarifa.casillas?.grupo_completo
    const c = composicionDeLinea(tarifa, composicionViaje)
    if (!primera || !c) continue
    // Otra búsqueda (no la misma ocupación de la opción) de la misma tarifa, en la misma moneda.
    if (mismaComposicion(c, ocupacion)) continue
    if ((lectura.moneda ?? '').toUpperCase() !== (primera.moneda ?? '').toUpperCase()) continue
    if (!mismaIdentidad(primera.identidad, lectura.identidad)) continue
    const precios = preciosQueTrae(lectura, ocupacion, faltan, unitarioDe(primera, 'adulto'))
    const tipos = faltan.filter(t => typeof precios[t] === 'number')
    if (tipos.length === 0) continue
    return { itemId: l.id, grupo: normalizarGrupo(l.grupo ?? null) ?? (l.grupo as string), nombre: nombreDeLinea(l), tipos, precios }
  }
  return null
}

/** El costo c/u de un tipo en una lectura con fila por tipo. `null` si no la trae. */
function unitarioDe(l: LecturaCasilla, tipo: TipoPasajero): number | null {
  const f = (l.porTipo ?? []).find(x => x.tipo === tipo && x.cantidad > 0)
  return f ? f.subtotal / f.cantidad : null
}

/**
 * Los precios que trae un pantallazo de los tipos que faltan: de su fila por tipo, o (si viene un
 * solo total) restándole lo de los adultos, cuando además de adultos lleva UN solo tipo que falta.
 */
function preciosQueTrae(
  l: LecturaCasilla,
  ocupacion: Composicion,
  faltan: readonly TipoPasajero[],
  adulto: number | null,
): Partial<Record<TipoPasajero, number>> {
  const out: Partial<Record<TipoPasajero, number>> = {}
  for (const t of faltan) {
    const u = unitarioDe(l, t)
    if (u !== null && u >= 0) out[t] = Math.round(u)
  }
  if (Object.keys(out).length > 0) return out
  const presentes = faltan.filter(t => (t === 'nino' ? ocupacion.ninos : ocupacion.infantes) > 0)
  const otros = (['nino', 'infante'] as const).filter(t => !faltan.includes(t) && (t === 'nino' ? ocupacion.ninos : ocupacion.infantes) > 0)
  if (presentes.length !== 1 || otros.length > 0 || adulto === null || !(l.total > 0)) return out
  const t = presentes[0]
  const cantidad = t === 'nino' ? ocupacion.ninos : ocupacion.infantes
  const resto = l.total - adulto * ocupacion.adultos
  if (resto >= 0) out[t] = Math.round(resto / cantidad)
  return out
}

/**
 * Dos identidades nombran el mismo producto: todo campo que las dos traen coincide, y al menos
 * uno coincide. Un campo que una de las dos no leyó no cuenta ni a favor ni en contra.
 */
function mismaIdentidad(a: Record<string, string | null> | undefined, b: Record<string, string | null> | undefined): boolean {
  if (!a || !b) return false
  let comunes = 0
  for (const [k, va] of Object.entries(a)) {
    const vb = b[k]
    if (!va || !vb) continue
    if (!mismoTexto(va, vb)) return false
    comunes += 1
  }
  return comunes > 0
}

/** La frase de las reglas, sin esperar a nadie. */
export function destinoDeReglas(args: {
  tipo: TipoRanura
  lectura: LecturaCasilla
  pistas: { lugar: string | null; origen: string | null; destino: string | null }
  lineas: readonly Linea[]
  grupoViaje: Composicion | null
}): DestinoPorPasos {
  const completa = completaDe(args.tipo, args.lectura, args.lineas, args.grupoViaje)
  if (completa) {
    return {
      como: 'completa',
      itemId: completa.itemId,
      grupo: completa.grupo,
      tipos: completa.tipos,
      precios: completa.precios,
      razon: `Misma ${args.tipo === 'vuelo' ? 'aerolínea, ruta, fechas y tarifa' : 'actividad y fecha'} que ${completa.nombre}, con otros pasajeros: trae el precio del ${listaDeTipos(completa.tipos)} que faltaba.`,
      duda: false,
      fuente: 'reglas',
    }
  }
  const d = ubicarLectura({ tipo: args.tipo, lectura: args.lectura, pistas: args.pistas, lineas: args.lineas, grupoViaje: args.grupoViaje })
  if (d.como === 'habitacion') {
    return { como: 'habitacion', itemId: d.itemId, grupo: d.grupo, razon: 'Mismo hotel y mismas fechas: suma dentro de la opción.', duda: false, fuente: 'reglas' }
  }
  if (d.como === 'hermana') {
    const primera = vivas(args.lineas).find(l => normalizarGrupo(l.grupo ?? null) === normalizarGrupo(d.grupo))
    return {
      como: 'hermana',
      itemId: primera?.id ?? null,
      grupo: d.grupo,
      razon: `Mismo tipo, lugar y fechas que ${etiquetaDeRanura(d.grupo)}: compite con él.`,
      duda: false,
      fuente: 'reglas',
    }
  }
  return { como: 'nueva', itemId: null, grupo: null, razon: null, duda: false, fuente: 'reglas' }
}

// ── La decisión del modelo ──────────────────────────────────────────────────

/** Lo que devuelve el modelo, ya normalizado (`decidir-destino.ts`). */
export interface DecisionDelModelo {
  como: ComoPorPasos
  /** El id de la opción que nombró (de la lista que se le mandó). `nueva`: `null`. */
  itemId: string | null
  razon: string | null
  duda: boolean
}

/** «No es claro si reemplaza a Cayo Cangrejo: lo dejo aparte para que no se pierda.» */
export function razonDeDuda(contra: string | null): string {
  return contra
    ? `No es claro si reemplaza a ${contra}: lo dejo aparte para que no se pierda.`
    : 'No es claro a dónde va: lo dejo aparte para que no se pierda.'
}

/**
 * La decisión del modelo, pasada por las guardas (M2, M3). Lo que no las pasa deja la frase de las
 * reglas. `modelo === null` (apagado, lento o caído) = las reglas, sin esperar (V6).
 */
export function conDecisionDelModelo(args: {
  tipo: TipoRanura
  reglas: DestinoPorPasos
  modelo: DecisionDelModelo | null
  lineas: readonly Linea[]
}): DestinoPorPasos {
  const { tipo, reglas, modelo } = args
  if (!modelo) return reglas
  const razon = (modelo.razon ?? '').trim().slice(0, 200) || null
  // Decisión 1: ante la duda, suma aparte, y se dice.
  if (modelo.duda) {
    const contra = modelo.itemId ? vivas(args.lineas).find(l => l.id === modelo.itemId) : null
    return { como: 'nueva', itemId: null, grupo: null, razon: razon ?? razonDeDuda(contra ? nombreDeLinea(contra) : null), duda: true, fuente: 'modelo' }
  }
  if (modelo.como === 'nueva') {
    return { como: 'nueva', itemId: null, grupo: null, razon, duda: false, fuente: 'modelo' }
  }
  // «Completa» no la inventa el modelo: solo si el precio que falta es de verdad de esa opción.
  if (modelo.como === 'completa') {
    return reglas.como === 'completa' && reglas.itemId === modelo.itemId ? { ...reglas, fuente: 'modelo', razon: razon ?? reglas.razon } : reglas
  }
  const linea = modelo.itemId ? vivas(args.lineas).find(l => l.id === modelo.itemId) : null
  // M3: del mismo tipo y todavía en la cotización.
  if (!linea || !mismoTipo(linea, tipo)) return reglas
  if (modelo.como === 'habitacion' && tipo !== 'hotel') return reglas
  // M2: volver opción (o habitación) lo que las reglas dejan aparte exige decir por qué.
  if (reglas.como === 'nueva' && !razon) return reglas
  const grupo = normalizarGrupo(linea.grupo ?? null) ?? (linea.grupo as string)
  return { como: modelo.como, itemId: linea.id, grupo, razon, duda: false, fuente: 'modelo' }
}

// ── La frase y el menú ──────────────────────────────────────────────────────

/** «Suma aparte: Hotel en San Andrés», «Otra opción de: Hotel en Providencia»… */
export function fraseDeDestino(d: DestinoPorPasos, nombreNuevo: string, lineas: readonly Linea[]): string {
  if (d.como === 'nueva') return `Suma aparte: ${nombreNuevo}`
  if (d.como === 'hermana') return `Otra opción de: ${etiquetaDeRanura(d.grupo)}`
  const linea = vivas(lineas).find(l => l.id === d.itemId)
  const nombre = linea ? nombreDeLinea(linea) : etiquetaDeRanura(d.grupo)
  if (d.como === 'habitacion') return `Otra habitación de: ${nombre}`
  return `Completa ${nombre}: precio del ${listaDeTipos(d.tipos ?? [])}`
}

/**
 * El menú de la frase (M3): «Suma aparte (servicio nuevo)» y «Otra opción de: …» solo con
 * servicios DEL MISMO TIPO. Uno por servicio, con la primera de sus opciones.
 */
export function serviciosDelMismoTipo(tipo: TipoRanura, lineas: readonly Linea[]): { grupo: string; itemId: string; etiqueta: string }[] {
  const vistos = new Set<string>()
  const out: { grupo: string; itemId: string; etiqueta: string }[] = []
  for (const l of vivas(lineas)) {
    if (!mismoTipo(l, tipo)) continue
    const g = normalizarGrupo(l.grupo ?? null)
    if (!g || vistos.has(g)) continue
    vistos.add(g)
    out.push({ grupo: g, itemId: l.id, etiqueta: etiquetaDeRanura(g) })
  }
  return out
}

/**
 * Lo que «Aceptar» le manda al servidor. La frase de las REGLAS viaja como `auto`: el servidor la
 * vuelve a decidir contra la cotización de ese momento (en un lote, la segunda habitación se une
 * al hotel que creó la primera). La del modelo o la que eligió la asesora viaja tal cual.
 */
export function decisionParaAceptar(d: DestinoPorPasos): { decision: 'auto' | 'nueva' | 'hermana' | 'habitacion' | 'completa'; destinoId: string | null } {
  if (d.como === 'completa') return { decision: 'completa', destinoId: d.itemId }
  if (d.fuente === 'reglas') return { decision: 'auto', destinoId: null }
  if (d.como === 'nueva') return { decision: 'nueva', destinoId: null }
  return { decision: d.como, destinoId: d.itemId }
}

// ── P11: Incluido u Opcional por defecto ─────────────────────────────────────

/**
 * Lo que dice que el SERVICIO es opcional, en cualquier texto leído. «No incluido» suelto no está
 * aquí: «almuerzo no incluido» habla de una parte del tour, no del tour.
 */
const DICE_OPCIONAL = /(?:\b(?:tour|actividad|excursi[oó]n|traslado|servicio)\s+opcional\b|\bopcional\s*:|\bse\s+paga(?:n)?\s+(?:aparte|por\s+separado|en\s+destino)\b)/i
/** «No incluido» cuenta solo si es TODO el valor de un campo o lo dice el nombre del servicio. */
const NO_INCLUIDO = /^\s*(?:no\s+incluid[oa]|no\s+est[aá]\s+incluid[oa])\s*\.?\s*$/i
const NOMBRE_NO_INCLUIDO = /\(\s*no\s+incluid[oa]\s*\)|^\s*no\s+incluid[oa]\b/i

/**
 * Decisión M: el servicio llega «Incluido», salvo que el pantallazo diga que es opcional («tour
 * opcional», «no incluido», «se paga aparte»). Devuelve la frase leída que lo dice, para que la
 * fila lo muestre antes de aceptar. Solo traslado y actividad tienen «Opcional».
 */
export function opcionalSegunLectura(tipo: TipoRanura, lectura: LecturaCasilla): string | null {
  if (tipo !== 'traslado' && tipo !== 'actividad') return null
  // Escrito a mano con «Es opcional: el cliente decide (no suma)».
  if (lectura.origen === 'manual' && lectura.manual?.opcional === true) return 'Es opcional: el cliente decide (no suma)'
  const campos = (lectura.campos ?? []).map(c => c.valor).filter((v): v is string => typeof v === 'string')
  const textos = [lectura.nombre, lectura.descripcion, ...(lectura.notasCliente ?? []), ...campos]
  for (const t of textos) {
    if (typeof t !== 'string') continue
    const m = DICE_OPCIONAL.exec(t)
    if (m) return m[0]
  }
  const n = typeof lectura.nombre === 'string' ? NOMBRE_NO_INCLUIDO.exec(lectura.nombre) : null
  if (n) return n[0].replace(/[()]/g, '').trim()
  const c = campos.find(v => NO_INCLUIDO.test(v))
  return c ? c.trim() : null
}

// ── Lo que se le manda al modelo, desde el navegador ────────────────────────

/** Lo que identifica una lectura, en una línea: «Avianca · Bogotá BOG · San Andrés ADZ · 2026-11-23». */
function detalleDeLectura(l: LecturaCasilla | null | undefined): string {
  if (!l) return ''
  return Object.values(l.identidad ?? {}).filter((v): v is string => typeof v === 'string' && v.trim() !== '').join(' · ').slice(0, 240)
}

/**
 * Los servicios del viaje como los recibe el modelo (`decidir-destino.ts`): uno por servicio, con
 * el id de su primera opción y lo que identifica a cada opción. Lo arma el navegador con lo que ya
 * tiene: la lectura no lee la base para esto.
 */
export function serviciosParaElModelo(lineas: readonly Linea[]): { id: string; tipo: string; servicio: string; nombre: string; detalle: string }[] {
  const porGrupo = new Map<string, { id: string; tipo: string; servicio: string; nombres: string[]; detalles: string[] }>()
  for (const l of vivas(lineas)) {
    const g = normalizarGrupo(l.grupo ?? null)
    const def = ranuraDeGrupo(g)
    if (!g || !def) continue
    const actual = porGrupo.get(g) ?? { id: l.id, tipo: def.label.toLowerCase(), servicio: etiquetaDeRanura(g), nombres: [], detalles: [] }
    actual.nombres.push(nombreDeLinea(l))
    const d = detalleDeLectura(leerTarifaPax(l.tarifa_pax).casillas?.grupo_completo)
    if (d) actual.detalles.push(d)
    porGrupo.set(g, actual)
  }
  return [...porGrupo.values()].slice(0, 60).map(s => ({
    id: s.id, tipo: s.tipo, servicio: s.servicio,
    nombre: s.nombres.join(' / ').slice(0, 160),
    detalle: s.detalles.join(' / ').slice(0, 240),
  }))
}

/** Lo leído, en pocas palabras, para el modelo. */
export function lecturaParaDecidir(tipo: TipoRanura, l: LecturaCasilla): { tipo: string; nombre: string; detalle: string; ocupacion: string } {
  const c = composicionDeLectura(l)
  return {
    tipo,
    nombre: (l.nombre ?? '').slice(0, 160),
    detalle: detalleDeLectura(l),
    ocupacion: c ? `${c.adultos} adultos, ${c.ninos} niños, ${c.infantes} infantes` : '',
  }
}
