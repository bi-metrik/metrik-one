/**
 * Las tarifas extraídas del tarifario de un proveedor, OFRECIDAS en la línea de la cotización
 * (Mauricio, 2026-10-19: «ONE ofrece las tarifas y la persona elige»; nunca elige solo). PURO.
 *
 *   · `ofrecerTarifas`: de las filas usables (`tarifasParaCotizar`), cuáles sirven para ESTE viaje.
 *     Filtra solo lo que sabe con certeza (temporada sin noches en las fechas del viaje, tipo de
 *     pasajero que no viaja, escalón de pax que no cubre al grupo ni contando ni sin contar a los
 *     infantes). Lo filtrado NO desaparece: lleva `fueraPor` y la pantalla deja quitar el filtro.
 *   · `calcularEleccion`: lo que la persona eligió (una o varias filas, con cuántos y cuántas
 *     noches) pasa a costo con la base de precio de cada fila:
 *       por_persona_noche    precio × noches × pasajeros de su tipo
 *       por_habitacion_noche precio × noches × habitaciones
 *       por_persona(_paquete) precio × pasajeros de su tipo
 *       por_vehiculo_trayecto precio × vehículos
 *       por_grupo / por_trayecto_total  precio, una vez
 *     Después quita el IVA si el precio lo trae (el costo se guarda SIN IVA: la casilla «Calcular
 *     con IVA» lo vuelve a sumar) y, si la tarifa es comisionable, deja aparte lo que paga la
 *     agencia (`aPagarAgencia`), que es la misma convención de margen de un pantallazo con los dos
 *     precios (`margen-proveedor.ts`).
 *   · `lecturaDeTarifa`: el resultado como la lectura de la casilla 1 (`origen: 'tarifario'`), para
 *     que la confirmación de siempre (`confirmarTarifaPorPasajero`) la convierta en rubros, con la
 *     tasa si no es COP. Sin TRM: la tasa la escribe la persona (`costo-manual.ts`, R-P5).
 *
 * El reparto por pasajero de una tarifa por habitación, vehículo o grupo es solo para la tabla por
 * pasajero (el costo de la línea no cambia): se reparte entre adultos y niños por partes iguales,
 * el infante en cero. Es la regla del traslado por grupo (`trasladoPorGrupo`).
 */
import {
  describirOcupacion,
  formatoMonto,
  NOMBRE_TIPO,
  repartirProporcional,
  TIPOS_PASAJERO,
  type Composicion,
  type FilaTipo,
  type LecturaCasilla,
  type TipoPasajero,
} from '@/lib/cotizaciones/tarifa-pasajero'
import type { DefinicionRanura } from '@/lib/cotizaciones/ranuras-pantallazo'
import type { TarifaCanal } from './tipos'
import type { TarifaUsable } from './tarifas-extraidas'
import { capitalizacionNormal, incluyeDeFila, nombreDeServicio, textoIncluye } from './nombre-de-tarifa'

export { leerOrigenTarifaExtraida, origenVigente, type OrigenTarifaExtraida } from '@/lib/cotizaciones/origen-tarifa'

type Obj = Record<string, unknown>
const esObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const texto = (v: unknown, n = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
const entero = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null)
const dos = (v: number) => Math.round(v * 100) / 100

// ── Base de precio ───────────────────────────────────────────────────────────

export const BASES_PRECIO = ['por_persona_noche', 'por_habitacion_noche', 'por_persona', 'por_persona_paquete', 'por_vehiculo_trayecto', 'por_trayecto_total', 'por_grupo'] as const
export type BasePrecio = (typeof BASES_PRECIO)[number]
export const esBasePrecio = (b: unknown): b is BasePrecio => typeof b === 'string' && (BASES_PRECIO as readonly string[]).includes(b)

export const TEXTO_BASE: Record<BasePrecio, string> = {
  por_persona_noche: 'por persona, por noche',
  por_habitacion_noche: 'por habitación, por noche',
  por_persona: 'por persona',
  por_persona_paquete: 'por persona, el paquete completo',
  por_vehiculo_trayecto: 'por vehículo, el trayecto',
  por_trayecto_total: 'por el trayecto completo, una vez',
  por_grupo: 'por el grupo, una vez',
}

export type UnidadDeBase = 'persona' | 'habitacion' | 'vehiculo' | 'grupo'

export function unidadDeBase(b: BasePrecio): UnidadDeBase {
  if (b === 'por_persona_noche' || b === 'por_persona' || b === 'por_persona_paquete') return 'persona'
  if (b === 'por_habitacion_noche') return 'habitacion'
  if (b === 'por_vehiculo_trayecto') return 'vehiculo'
  return 'grupo'
}

export const esPorNoche = (b: BasePrecio) => b === 'por_persona_noche' || b === 'por_habitacion_noche'

const PALABRA_UNIDAD: Record<UnidadDeBase, [string, string]> = {
  persona: ['persona', 'personas'],
  habitacion: ['habitación', 'habitaciones'],
  vehiculo: ['vehículo', 'vehículos'],
  grupo: ['grupo', 'grupos'],
}

/** El tipo de pasajero de ONE para la fila del tarifario. `null` = la fila no lo dice. */
export function tipoDeFila(t: unknown): TipoPasajero | null {
  if (t === 'nino') return 'nino'
  if (t === 'infante') return 'infante'
  if (t === 'adulto' || t === 'adulto_adicional' || t === 'adulto_mayor') return 'adulto'
  return null
}

const PASAJERO_FILA: Record<string, string> = {
  adulto: 'adulto',
  adulto_adicional: 'adulto adicional',
  adulto_mayor: 'adulto mayor',
  nino: 'niño',
  infante: 'infante',
}

const contar = (c: Composicion, t: TipoPasajero) => (t === 'adulto' ? c.adultos : t === 'nino' ? c.ninos : c.infantes)

// ── Las fechas del viaje contra las temporadas del tarifario ─────────────────

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const diaUTC = (f: string) => Date.parse(`${f}T00:00:00Z`)
function fechaValida(v: unknown): string | null {
  if (typeof v !== 'string' || !FECHA.test(v.trim())) return null
  const s = v.trim()
  const t = diaUTC(s)
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s ? null : s
}

/**
 * Los días que cuentan para la temporada: cada noche de la estadía (de la entrada al día antes de la
 * salida) o, sin salida, el día de la entrada (una actividad, un traslado). Vacío sin fechas.
 */
export function diasDelViaje(entrada: string | null | undefined, salida: string | null | undefined): string[] {
  const a = fechaValida(entrada)
  if (!a) return []
  const b = fechaValida(salida)
  if (!b || diaUTC(b) <= diaUTC(a)) return [a]
  const dias: string[] = []
  for (let t = diaUTC(a); t < diaUTC(b) && dias.length < 400; t += 86_400_000) dias.push(new Date(t).toISOString().slice(0, 10))
  return dias
}

export interface TemporadaDelViaje {
  id: string
  nombre: string
  /** Días del viaje dentro de la temporada. `null` = la temporada no trae fechas (o el viaje tampoco). */
  dias: number | null
}

export interface CalendarioDelViaje {
  /** Noches de la estadía (0 si no hay entrada y salida). */
  noches: number
  /** El viaje tiene fechas: se puede cruzar con las temporadas. */
  conFechas: boolean
  temporadas: Record<string, TemporadaDelViaje>
  /** Las temporadas con días en el viaje, si son dos o más: el viaje las cruza. */
  cruza: string[]
}

export function calendarioDelViaje(tarifario: Obj | null | undefined, entrada: string | null | undefined, salida: string | null | undefined): CalendarioDelViaje {
  const dias = diasDelViaje(entrada, salida)
  const a = fechaValida(entrada)
  const b = fechaValida(salida)
  const noches = a && b && diaUTC(b) > diaUTC(a) ? Math.round((diaUTC(b) - diaUTC(a)) / 86_400_000) : 0
  const temporadas: Record<string, TemporadaDelViaje> = {}
  for (const s of lista(tarifario?.temporadas)) {
    if (!esObj(s)) continue
    const id = texto(s.id) ?? texto(s.nombre)
    if (!id) continue
    const rangos = lista(s.rangos)
      .filter(esObj)
      .map((r) => ({ desde: fechaValida(r.desde), hasta: fechaValida(r.hasta) }))
      .filter((r): r is { desde: string; hasta: string } => !!r.desde && !!r.hasta)
    const conFechas = rangos.length > 0 && dias.length > 0
    temporadas[id] = {
      id,
      nombre: texto(s.nombre) ?? id,
      dias: conFechas ? dias.filter((d) => rangos.some((r) => r.desde <= d && d <= r.hasta)).length : null,
    }
  }
  const conDias = Object.values(temporadas).filter((t) => (t.dias ?? 0) > 0).map((t) => t.id)
  return { noches, conFechas: dias.length > 0, temporadas, cruza: conDias.length >= 2 ? conDias : [] }
}

// ── Lo que se ofrece ─────────────────────────────────────────────────────────

export type MotivoFuera = 'temporada' | 'pasajero' | 'pax'

export const TEXTO_FUERA: Record<MotivoFuera, string> = {
  temporada: 'Su temporada no cae en las fechas del viaje',
  pasajero: 'Ese tipo de pasajero no viaja en esta línea',
  pax: 'Su escalón de pasajeros no es el del grupo',
}

export interface OpcionTarifa {
  /** Posición de la fila en `tarifario.tarifas` (el origen que se guarda). */
  indice: number
  precio: number
  moneda: string
  base: BasePrecio | null
  /** La base en llano; «sin base de precio» si el tarifario no la dice. */
  baseTexto: string
  unidad: UnidadDeBase | null
  porNoche: boolean
  establecimiento: string | null
  categoria: string | null
  plan: string | null
  /** «privado», «compartido» (tours y traslados). */
  modalidad: string | null
  /**
   * El nombre completo del servicio, como lo lee el cliente: categoría, plan y modalidad, sin todo
   * en mayúscula («Playa Blanca con almuerzo»). `null` si la fila no dice nada.
   */
  servicio: string | null
  /** Lo que incluye la fila (su plan, la propia fila o su nota «Incluye …»). */
  incluye: string[]
  /** La fecha de salida que trae la fila (un tour con fecha fija), `AAAA-MM-DD`. */
  fechaSalida: string | null
  ocupacion: string | null
  /** Como lo dice el tarifario («adulto adicional»); `null` si no lo dice. */
  pasajero: string | null
  /** El tipo de ONE al que va su costo. `null` = no lo dice (se toma adulto si es por persona). */
  tipo: TipoPasajero | null
  /** «2 a 4 pax», «6 pax», «desde 1 pax», «hasta 4 pax»: completo, sin «…» que parezca cortado. */
  pax: string | null
  temporada: TemporadaDelViaje | null
  /** El precio de qué canal es, según la fila (neto, público, comisionable…). */
  precioTipo: string | null
  impuestosIncluidos: boolean | null
  archivo: string | null
  pagina: number | null
  cita: string | null
  nota: string | null
  /** Por qué la oculta el filtro (vacío = sirve). Nunca se esconde sin decirlo. */
  fueraPor: MotivoFuera[]
}

export interface OfertaDeTarifas {
  opciones: OpcionTarifa[]
  calendario: CalendarioDelViaje
  /** Lo que la persona tiene que saber del filtro, en llano. */
  avisos: string[]
}

/**
 * El escalón de pasajeros de la fila, completo (prueba del #1229, punto c: «1–… pax» se leía como
 * un texto cortado). Abierto arriba = «desde N pax».
 */
export function textoPax(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null
  if (min !== null && min === max) return `${min} pax`
  if (max === null) return `desde ${min} pax`
  if (min === null) return `hasta ${max} pax`
  return `${min} a ${max} pax`
}

function fueraDeEscalon(min: number | null, max: number | null, n: number): boolean {
  return (min !== null && n < min) || (max !== null && n > max)
}

/**
 * Las filas usables de la extracción, cruzadas con la línea. `entrada`/`salida` son las fechas de la
 * línea (las del hotel o, sin ellas, las del viaje).
 */
export function ofrecerTarifas(args: {
  usables: readonly TarifaUsable[]
  tarifario: Obj | null
  composicion: Composicion | null
  entrada: string | null
  salida: string | null
}): OfertaDeTarifas {
  const calendario = calendarioDelViaje(args.tarifario, args.entrada, args.salida)
  const c = args.composicion
  const avisos: string[] = []
  let temporadaSinFechas = false
  const opciones = args.usables.map((u): OpcionTarifa => {
    const f = u.fila
    const base = esBasePrecio(f.base_precio) ? f.base_precio : null
    const min = entero(f.pax_min)
    const max = entero(f.pax_max)
    const idT = texto(f.temporada_id)
    const temporada = idT ? calendario.temporadas[idT] ?? { id: idT, nombre: idT, dias: null } : null
    if (temporada && temporada.dias === null) temporadaSinFechas = true
    const tipo = tipoDeFila(f.tipo_pasajero)
    const fueraPor: MotivoFuera[] = []
    if (temporada && temporada.dias === 0) fueraPor.push('temporada')
    if (c && tipo && tipo !== 'adulto' && contar(c, tipo) === 0) fueraPor.push('pasajero')
    // El escalón de pax es del grupo: con certeza solo si no lo cubre NI contando NI sin contar a
    // los infantes. Un adulto adicional y una habitación se miden por habitación: no se filtran.
    if (c && base && unidadDeBase(base) !== 'habitacion' && f.tipo_pasajero !== 'adulto_adicional') {
      const conInfantes = c.adultos + c.ninos + c.infantes
      const sinInfantes = c.adultos + c.ninos
      if (fueraDeEscalon(min, max, conInfantes) && fueraDeEscalon(min, max, sinInfantes)) fueraPor.push('pax')
    }
    const fuente = esObj(f.fuente) ? f.fuente : {}
    return {
      indice: u.indice,
      precio: u.precio,
      moneda: u.moneda,
      base,
      baseTexto: base ? TEXTO_BASE[base] : 'sin base de precio',
      unidad: base ? unidadDeBase(base) : null,
      porNoche: base ? esPorNoche(base) : false,
      establecimiento: u.establecimiento,
      categoria: texto(f.categoria),
      plan: texto(f.plan),
      modalidad: texto(f.modalidad, 40),
      servicio: nombreDeServicio({ categoria: texto(f.categoria), plan: texto(f.plan), modalidad: texto(f.modalidad, 40) }),
      incluye: incluyeDeFila(f, args.tarifario),
      fechaSalida: fechaValida(f.fecha_salida),
      ocupacion: texto(f.ocupacion, 40),
      pasajero: typeof f.tipo_pasajero === 'string' ? PASAJERO_FILA[f.tipo_pasajero] ?? texto(f.tipo_pasajero, 40) : null,
      tipo,
      pax: textoPax(min, max),
      temporada,
      precioTipo: texto(f.precio_tipo, 40),
      impuestosIncluidos: typeof f.impuestos_incluidos === 'boolean' ? f.impuestos_incluidos : null,
      archivo: texto(f.archivo, 300),
      pagina: entero(fuente.pagina),
      cita: texto(fuente.texto, 300),
      nota: texto(f.nota, 300),
      fueraPor,
    }
  })
  if (!calendario.conFechas) avisos.push('La línea no tiene fechas: no se filtra por temporada. Elige tú la tarifa de la temporada del viaje.')
  if (calendario.cruza.length >= 2) {
    // De noches se habla solo si alguna tarifa se cobra por noche (brief del 2026-10-20, punto 3).
    const porNoche = opciones.some((o) => o.porNoche)
    const unidad = (n: number | null) => (porNoche ? (n === 1 ? 'noche' : 'noches') : n === 1 ? 'día' : 'días')
    const partes = calendario.cruza.map((id) => calendario.temporadas[id]).map((t) => `${t.nombre} (${t.dias} ${unidad(t.dias)})`)
    avisos.push(`El viaje cruza ${partes.length} temporadas: ${partes.join(' y ')}. Elige una tarifa por temporada${porNoche ? '; cada una cuenta sus noches' : ''}.`)
  }
  if (temporadaSinFechas) avisos.push('Temporada sin fechas en el tarifario: elige tú la que corresponde al viaje.')
  return { opciones, calendario, avisos }
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
/** «15 nov». */
function diaYMes(f: string): string {
  return `${Number(f.slice(8, 10))} ${MESES_CORTOS[Number(f.slice(5, 7)) - 1]}`
}

/**
 * Lo que la opción dice de su temporada (brief del 2026-10-20, punto 3). De noches se habla SOLO en
 * las bases por noche (`*_noche`): una actividad por persona de un día no tiene «1 noche del viaje».
 *
 *   · por noche: «temporada Alta (3 noches del viaje)»;
 *   · lo demás, un solo día: «temporada Alta · aplica el 15 nov»; con varios días (las fechas del
 *     viaje, una actividad sin fecha propia): «temporada Alta»;
 *   · la temporada sin fechas en el tarifario: «temporada Alta (sin fechas: elige tú)».
 *
 * `null` = la fila no trae temporada. `entrada`/`salida` son las fechas con que se filtró la línea.
 */
export function textoTemporada(o: Pick<OpcionTarifa, 'temporada' | 'porNoche'>, fechas: { entrada: string | null; salida: string | null }): string | null {
  const t = o.temporada
  if (!t) return null
  const base = `temporada ${t.nombre}`
  if (t.dias === null) return `${base} (sin fechas: elige tú)`
  if (t.dias === 0) return base
  if (o.porNoche) return `${base} (${t.dias} ${t.dias === 1 ? 'noche' : 'noches'} del viaje)`
  const dias = diasDelViaje(fechas.entrada, fechas.salida)
  return dias.length === 1 ? `${base} · aplica el ${diaYMes(dias[0])}` : base
}

// ── Canal e IVA ──────────────────────────────────────────────────────────────

export type CanalCosto = 'neta' | 'comisionable' | 'publica' | 'sin_dato'

export const TEXTO_CANAL: Record<CanalCosto, string> = {
  neta: 'Neta: el precio es el costo de la agencia',
  comisionable: 'Comisionable: al precio se le descuenta la comisión',
  publica: 'Precio al público: el costo de la agencia es menor (pide el neto)',
  sin_dato: 'El tarifario no dice si es neta o comisionable',
}

export interface AjustesDeCosto {
  canal: CanalCosto
  /** % de comisión, solo con canal comisionable. */
  comisionPct: number | null
  /** El precio ya trae el IVA: se le quita para guardar el costo sin IVA. */
  ivaIncluido: boolean
  /**
   * El IVA del proveedor. `null` = nadie lo declara (ni el tarifario ni la ficha): no se inventa
   * un 19 (prueba del #1229, punto 3), y «Calcular con IVA» no le suma nada a la línea.
   */
  ivaPct: number | null
}

export const IVA_POR_DEFECTO = 19

function canalDeTexto(v: unknown): CanalCosto | null {
  const t = typeof v === 'string' ? v.toLowerCase() : ''
  if (t.startsWith('neta') || t === 'neto') return 'neta'
  if (t.startsWith('comision')) return 'comisionable'
  if (t === 'publica' || t === 'publico' || t === 'rack') return 'publica'
  return null
}

const pctValido = (v: unknown, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < max ? v : null)

/**
 * Canal e IVA con que nace la elección. Manda lo más específico: la fila elegida (su `precio_tipo`
 * y `impuestos_incluidos`), después la ficha (lo que una persona anotó) y al final el tarifario.
 *
 * El % de IVA (prueba del #1229, punto 3): el que escribe el tarifario; si no lo escribe, el 19
 * general SOLO con respaldo (el tarifario o la ficha dicen que cobra IVA, o el precio ya lo trae y
 * hay que quitárselo). Sin respaldo queda `null`: un tarifario que no dice nada no cobra un IVA
 * inventado. Una ficha que dice «no cobra IVA» manda sobre el tarifario.
 */
export function ajustesPorDefecto(args: {
  fila?: Pick<OpcionTarifa, 'precioTipo' | 'impuestosIncluidos'> | null
  ficha: { tarifaCanal: TarifaCanal | null; ivaIncluido: boolean | null; ivaDeclarado?: boolean | null }
  tarifario: Obj | null
}): AjustesDeCosto {
  const t = args.tarifario ?? {}
  const imp = esObj(t.impuestos) ? t.impuestos : {}
  const canal = canalDeTexto(args.fila?.precioTipo) ?? args.ficha.tarifaCanal ?? canalDeTexto(t.canal) ?? 'sin_dato'
  const ivaIncluido = (args.fila?.impuestosIncluidos ?? args.ficha.ivaIncluido ?? (imp.iva_incluido === true)) === true
  const declarado = args.ficha.ivaDeclarado ?? (imp.iva_declarado === true || pctValido(imp.iva_pct, 100) !== null ? true : null)
  const ivaPct = ivaIncluido ? pctValido(imp.iva_pct, 100) ?? IVA_POR_DEFECTO : declarado === true ? pctValido(imp.iva_pct, 100) ?? IVA_POR_DEFECTO : null
  return {
    canal,
    comisionPct: canal === 'comisionable' ? pctValido(t.comision_pct, 100) : null,
    ivaIncluido,
    ivaPct,
  }
}

/** Los ajustes como llegan del navegador, revisados. */
export function revisarAjustes(entrada: unknown, defecto: AjustesDeCosto): { ok: true; ajustes: AjustesDeCosto } | { ok: false; error: string } {
  if (entrada === null || entrada === undefined) return { ok: true, ajustes: defecto }
  if (!esObj(entrada)) return { ok: false, error: 'El canal y el IVA no tienen la forma esperada.' }
  const canal = entrada.canal === undefined ? defecto.canal : entrada.canal
  if (canal !== 'neta' && canal !== 'comisionable' && canal !== 'publica' && canal !== 'sin_dato') return { ok: false, error: 'Elige si la tarifa es neta, comisionable o al público.' }
  const comisionPct = entrada.comisionPct === undefined ? defecto.comisionPct : entrada.comisionPct === null ? null : Number(entrada.comisionPct)
  if (comisionPct !== null && !(Number.isFinite(comisionPct) && comisionPct > 0 && comisionPct < 100)) return { ok: false, error: 'La comisión va entre 0 y 100 %.' }
  const ivaIncluido = entrada.ivaIncluido === undefined ? defecto.ivaIncluido : entrada.ivaIncluido === true
  // `null` llega cuando nadie declaró IVA; marcar «el precio ya trae IVA» exige un %: el general.
  const pedido = entrada.ivaPct === undefined ? defecto.ivaPct : entrada.ivaPct === null ? null : Number(entrada.ivaPct)
  const ivaPct = pedido === null && ivaIncluido ? defecto.ivaPct ?? IVA_POR_DEFECTO : pedido
  if (ivaPct !== null && !(Number.isFinite(ivaPct) && ivaPct > 0 && ivaPct < 100)) return { ok: false, error: 'El IVA va entre 0 y 100 %.' }
  return { ok: true, ajustes: { canal, comisionPct: canal === 'comisionable' ? comisionPct : null, ivaIncluido, ivaPct } }
}

// ── Lo que eligió la persona, a costo ────────────────────────────────────────

export interface FilaElegida {
  indice: number
  /** Cuántos: pasajeros (por persona), habitaciones o vehículos. Ausente = lo que propone ONE. */
  cantidad?: number | null
  /** Noches que cuenta esta tarifa (solo las por noche). Ausente = las de su temporada o las del viaje. */
  noches?: number | null
  /** A qué tipo de pasajero va (solo las por persona). Ausente = el de la fila, o adulto. */
  tipo?: TipoPasajero | null
}

export interface Eleccion {
  filas: FilaElegida[]
  /** Los tipos de pasajero que no pagan en este proveedor (lo confirma la persona). */
  noPagan?: TipoPasajero[]
}

export interface FilaCalculada {
  indice: number
  unidad: UnidadDeBase
  tipo: TipoPasajero | null
  cantidad: number
  noches: number | null
  precio: number
  subtotal: number
  /** «2 adultos × 3 noches × $250.000 = $1.500.000». */
  texto: string
}

export interface CalculoDeTarifa {
  moneda: string
  /** Lo que suman las filas, como las cobra el proveedor (con IVA si lo traían). */
  bruto: number
  /** El precio sin IVA: el `total` de la lectura. */
  total: number
  /** Lo que paga la agencia (comisionable); `null` = el total es el costo. */
  aPagarAgencia: number | null
  /** El costo de cada tipo de pasajero que viaja (suma exacta = total). */
  porTipo: FilaTipo[]
  filas: FilaCalculada[]
  /** Cómo sale el costo: por pasajero, o un total de habitación/vehículo/grupo repartido. */
  modo: 'por_pasajero' | 'repartido'
  ajustes: AjustesDeCosto
  avisos: string[]
}

const MAX_FILAS_ELEGIDAS = 20

/** Las habitaciones que propone ONE para una fila por habitación: las que hacen falta según su ocupación. */
export function habitacionesPorOcupacion(ocupacion: string | null, c: Composicion | null): number {
  const cupo: Record<string, number> = { sencilla: 1, doble: 2, triple: 3, cuadruple: 4 }
  const n = ocupacion ? cupo[ocupacion] : undefined
  if (!n || !c) return 1
  return Math.max(1, Math.ceil((c.adultos + c.ninos) / n))
}

function nochesPropuestas(o: OpcionTarifa, cal: CalendarioDelViaje): number | null {
  if (o.temporada && (o.temporada.dias ?? 0) > 0 && cal.cruza.length >= 2) return o.temporada.dias
  return cal.noches > 0 ? cal.noches : null
}

/** Lo que ONE propone para una fila antes de que la persona lo cambie (la pantalla lo muestra). */
export function propuestaDeFila(o: OpcionTarifa, c: Composicion | null, cal: CalendarioDelViaje): { cantidad: number; noches: number | null; tipo: TipoPasajero | null } {
  const unidad = o.unidad ?? 'grupo'
  const tipo: TipoPasajero | null = unidad === 'persona' ? o.tipo ?? 'adulto' : null
  const cantidad = unidad === 'persona' ? (c && tipo ? Math.max(1, contar(c, tipo)) : 1) : unidad === 'habitacion' ? habitacionesPorOcupacion(o.ocupacion, c) : 1
  return { cantidad, noches: o.porNoche ? nochesPropuestas(o, cal) : null, tipo }
}

function palabraTipo(t: TipoPasajero, n: number): string {
  const p: Record<TipoPasajero, [string, string]> = { adulto: ['adulto', 'adultos'], nino: ['niño', 'niños'], infante: ['infante', 'infantes'] }
  return p[t][n === 1 ? 0 : 1]
}

/**
 * La elección a costo. `opciones` son las de `ofrecerTarifas` (el servidor las recalcula: el precio
 * NUNCA llega del navegador). `ranuraSlug` decide solo el texto de los avisos.
 */
export function calcularEleccion(args: {
  opciones: readonly OpcionTarifa[]
  eleccion: Eleccion
  composicion: Composicion
  calendario: CalendarioDelViaje
  ajustes: AjustesDeCosto
}): { ok: true; calculo: CalculoDeTarifa } | { ok: false; error: string } {
  const { opciones, eleccion, composicion: c, calendario: cal, ajustes } = args
  const pedidas = Array.isArray(eleccion?.filas) ? eleccion.filas : []
  if (pedidas.length === 0) return { ok: false, error: 'Elige al menos una tarifa.' }
  if (pedidas.length > MAX_FILAS_ELEGIDAS) return { ok: false, error: `Elige como mucho ${MAX_FILAS_ELEGIDAS} tarifas.` }
  const porIndice = new Map(opciones.map((o) => [o.indice, o]))
  const vistos = new Set<number>()
  const filas: FilaCalculada[] = []
  let moneda: string | null = null
  for (const p of pedidas) {
    const o = esObj(p) && typeof p.indice === 'number' ? porIndice.get(p.indice) : undefined
    if (!o) return { ok: false, error: 'Una de las tarifas elegidas ya no está en el tarifario. Vuelve a abrir las tarifas.' }
    if (vistos.has(o.indice)) return { ok: false, error: 'Elegiste la misma tarifa dos veces.' }
    vistos.add(o.indice)
    if (!o.base || !o.unidad) return { ok: false, error: `La tarifa «${o.categoria ?? `fila ${o.indice + 1}`}» no dice su base de precio: escribe ese costo a mano.` }
    if (moneda !== null && o.moneda !== moneda) return { ok: false, error: `Las tarifas elegidas están en ${moneda} y ${o.moneda}: elige tarifas de una sola moneda.` }
    moneda = o.moneda
    const propuesta = propuestaDeFila(o, c, cal)
    let tipo: TipoPasajero | null = null
    let cantidad = 1
    if (o.unidad === 'persona') {
      tipo = p.tipo === undefined || p.tipo === null ? propuesta.tipo ?? 'adulto' : p.tipo
      if (!TIPOS_PASAJERO.includes(tipo)) return { ok: false, error: 'Elige a qué pasajero va la tarifa: adulto, niño o infante.' }
      if (contar(c, tipo) === 0) return { ok: false, error: `En esta línea no viajan ${palabraTipo(tipo, 2)}: esa tarifa no aplica.` }
      cantidad = p.cantidad === undefined || p.cantidad === null ? propuesta.cantidad : Number(p.cantidad)
      if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > contar(c, tipo)) return { ok: false, error: `Viajan ${contar(c, tipo)} ${palabraTipo(tipo, contar(c, tipo))}: la tarifa puede ir a 1 hasta ${contar(c, tipo)}.` }
    } else if (o.unidad !== 'grupo') {
      cantidad = p.cantidad === undefined || p.cantidad === null ? propuesta.cantidad : Number(p.cantidad)
      if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 50) return { ok: false, error: `Escribe cuántas ${PALABRA_UNIDAD[o.unidad][1]} (de 1 a 50).` }
    }
    let noches: number | null = null
    if (o.porNoche) {
      noches = p.noches === undefined || p.noches === null ? nochesPropuestas(o, cal) : Number(p.noches)
      if (noches === null || !Number.isInteger(noches) || noches < 1 || noches > 365) return { ok: false, error: 'Escribe cuántas noches cuenta la tarifa: la línea no tiene entrada y salida.' }
    }
    const subtotal = dos(o.precio * cantidad * (noches ?? 1))
    const quien = o.unidad === 'persona' && tipo ? `${cantidad} ${palabraTipo(tipo, cantidad)}` : o.unidad === 'grupo' ? 'el grupo' : `${cantidad} ${PALABRA_UNIDAD[o.unidad][cantidad === 1 ? 0 : 1]}`
    const nochesTxt = noches !== null ? ` × ${noches} ${noches === 1 ? 'noche' : 'noches'}` : ''
    filas.push({
      indice: o.indice,
      unidad: o.unidad,
      tipo,
      cantidad,
      noches,
      precio: o.precio,
      subtotal,
      texto: `${quien}${nochesTxt} × ${formatoMonto(o.precio, o.moneda)} = ${formatoMonto(subtotal, o.moneda)}`,
    })
  }

  const presentes = TIPOS_PASAJERO.filter((t) => contar(c, t) > 0)
  const noPagan = new Set((Array.isArray(eleccion.noPagan) ? eleccion.noPagan : []).filter((t): t is TipoPasajero => TIPOS_PASAJERO.includes(t)))
  const porPersona = filas.filter((f) => f.unidad === 'persona')
  const repartido = filas.some((f) => f.unidad !== 'persona')
  const sumaTipo = (t: TipoPasajero) => porPersona.filter((f) => f.tipo === t).reduce((a, f) => a + f.subtotal, 0)
  const avisos: string[] = []
  let subtotales: number[]

  if (!repartido) {
    for (const t of presentes) {
      const n = contar(c, t)
      const conTarifa = porPersona.filter((f) => f.tipo === t).reduce((a, f) => a + f.cantidad, 0)
      if (noPagan.has(t)) {
        if (conTarifa > 0) return { ok: false, error: `Marcaste que ${n === 1 ? 'el' : 'los'} ${palabraTipo(t, n)} no ${n === 1 ? 'paga' : 'pagan'} y le elegiste tarifa: quita una de las dos.` }
        continue
      }
      if (conTarifa < n) {
        const faltan = n - conTarifa
        return { ok: false, error: `Falta la tarifa de ${faltan} ${palabraTipo(t, faltan)}: elige una o marca que no ${faltan === 1 ? 'paga' : 'pagan'}.` }
      }
      // Dos tarifas para el mismo pasajero solo si son las dos temporadas de su estadía (se suman,
      // cada una con sus noches). Si el viaje no cruza temporadas, sobra una.
      if (conTarifa > n && cal.cruza.length < 2) {
        return { ok: false, error: `Viajan ${n} ${palabraTipo(t, n)} y elegiste tarifa para ${conTarifa}: quita una.` }
      }
    }
    subtotales = presentes.map((t) => dos(sumaTipo(t)))
  } else {
    // Habitación, vehículo o grupo: el total se reparte entre adultos y niños (el infante en cero);
    // las tarifas por persona que acompañan (adulto adicional, niño) van a su tipo.
    const deGrupo = filas.filter((f) => f.unidad !== 'persona').reduce((a, f) => a + f.subtotal, 0)
    const pesos = presentes.map((t) => (t === 'infante' ? 0 : contar(c, t)))
    const partes = repartirProporcional(dos(deGrupo), pesos)
    subtotales = presentes.map((t, i) => dos(partes[i] + sumaTipo(t)))
    avisos.push('La tarifa no es por persona: el reparto por pasajero es solo para la tabla; el costo de la línea es el total.')
  }

  const bruto = dos(subtotales.reduce((a, s) => a + s, 0))
  let total = bruto
  if (ajustes.ivaIncluido) {
    const pct = ajustes.ivaPct ?? IVA_POR_DEFECTO
    total = dos(bruto / (1 + pct / 100))
    subtotales = repartirProporcional(total, subtotales)
    avisos.push(`El precio traía IVA (${pct} %): se guarda sin IVA, ${formatoMonto(total, moneda as string)}.`)
  }
  let aPagarAgencia: number | null = null
  if (ajustes.canal === 'comisionable') {
    if (ajustes.comisionPct === null) return { ok: false, error: 'La tarifa es comisionable: escribe el % de comisión (o márcala neta).' }
    aPagarAgencia = dos(total * (1 - ajustes.comisionPct / 100))
  } else if (ajustes.canal === 'publica') {
    avisos.push('Es precio al público: se usa como costo hasta tener el neto o la comisión. Pídelos al proveedor.')
  } else if (ajustes.canal === 'sin_dato') {
    avisos.push('El tarifario no dice si la tarifa es neta o comisionable: confírmalo antes de enviar.')
  }

  return {
    ok: true,
    calculo: {
      moneda: moneda as string,
      bruto,
      total,
      aPagarAgencia,
      porTipo: presentes.map((t, i) => ({ tipo: t, cantidad: contar(c, t), subtotal: subtotales[i] })),
      filas,
      modo: repartido ? 'repartido' : 'por_pasajero',
      ajustes,
      avisos,
    },
  }
}

// ── La elección como lectura de la casilla 1 ─────────────────────────────────

/**
 * La elección como la lectura de la casilla 1. Los campos van con las etiquetas de la ranura (así
 * la ficha de la línea, el día a día y el PDF los leen como los de un pantallazo) y el nombre y la
 * ciudad del hotel son los de la ficha: la tarjeta vuelve a encontrar la misma ficha por nombre.
 */
export function lecturaDeTarifa(args: {
  ranura: DefinicionRanura
  calculo: CalculoDeTarifa
  elegidas: readonly OpcionTarifa[]
  proveedor: { nombre: string; ciudad: string | null }
  composicion: Composicion
  entrada: string | null
  salida: string | null
  leidaEn: string
}): LecturaCasilla {
  const { ranura, calculo, elegidas, proveedor, composicion: c } = args
  const etiqueta = (slug: string) => ranura.campos.find((x) => x.slug === slug)?.label ?? null
  const campos: { label: string; valor: string }[] = []
  const identidad: Record<string, string | null> = {}
  const poner = (slug: string, valor: string | null | undefined, enIdentidad = false) => {
    const l = etiqueta(slug)
    const v = (valor ?? '').trim()
    if (!l || !v) return
    campos.push({ label: l, valor: v })
    if (enIdentidad) identidad[slug] = v
  }
  const unico = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].join(' / ') || null
  // Lo que lee el cliente va sin TODO en mayúscula y con el nombre completo de la fila (prueba del
  // #1229, punto 2): «Playa Blanca con almuerzo», no «PLAYA BLANCA».
  const categorias = unico(elegidas.map((o) => (o.categoria ? capitalizacionNormal(o.categoria) : null)))
  const planes = unico(elegidas.map((o) => (o.plan ? capitalizacionNormal(o.plan, 'oracion') : null)))
  const servicios = unico(elegidas.map((o) => o.servicio))
  const incluye = textoIncluye([...new Set(elegidas.flatMap((o) => o.incluye))])
  const pax = String(c.adultos + c.ninos + c.infantes)
  if (ranura.slug === 'hotel_detalle') {
    poner('hotel', proveedor.nombre, true)
    poner('ciudad', proveedor.ciudad)
    poner('tipo_habitacion', categorias, true)
    poner('regimen', planes, true)
    poner('check_in', args.entrada, true)
    poner('check_out', args.salida, true)
    poner('ocupacion', describirOcupacion(c))
  } else if (ranura.slug === 'actividad_detalle') {
    poner('proveedor', proveedor.nombre)
    poner('nombre', servicios ?? proveedor.nombre, true)
    poner('ciudad', proveedor.ciudad)
    poner('fecha', args.entrada, true)
    poner('pax', pax)
  } else if (ranura.slug === 'traslado_detalle') {
    poner('proveedor', proveedor.nombre)
    poner('trayecto', servicios ?? proveedor.nombre, true)
    poner('fecha_hora', args.entrada, true)
    poner('pax', pax)
  } else if (ranura.slug === 'vuelo_detalle') {
    poner('aerolinea', proveedor.nombre, true)
  } else {
    poner('nombre', servicios ?? proveedor.nombre, true)
    poner('proveedor', proveedor.nombre)
    poner('pax', pax)
  }
  // Lo que no es de la ranura también se ve «a un clic»: de dónde salió el precio.
  const archivos = unico(elegidas.map((o) => o.archivo))
  campos.push({ label: 'Origen del precio', valor: `Tarifa del proveedor ${proveedor.nombre}, elegida en la cotización` })
  if (archivos) campos.push({ label: 'Archivo', valor: archivos })
  for (const f of calculo.filas) {
    const o = elegidas.find((x) => x.indice === f.indice)
    const que = [o?.categoria, o?.plan, o?.temporada?.nombre, o?.baseTexto].filter(Boolean).join(' · ')
    campos.push({ label: `Fila ${f.indice + 1}`, valor: `${que}: ${f.texto}` })
  }
  if (calculo.ajustes.canal === 'comisionable' && calculo.aPagarAgencia !== null) {
    campos.push({ label: 'Comisión', valor: `${calculo.ajustes.comisionPct} %: la agencia paga ${formatoMonto(calculo.aPagarAgencia, calculo.moneda)}` })
  }
  if (incluye) campos.push({ label: 'Incluye', valor: incluye.replace(/^Incluye: /, '').replace(/\.$/, '') })
  const nombre = ranura.slug === 'hotel_detalle' ? proveedor.nombre : servicios ?? proveedor.nombre
  return {
    moneda: calculo.moneda,
    total: calculo.total,
    aPagarAgencia: calculo.aPagarAgencia,
    costoAgenciaOrigen: calculo.aPagarAgencia !== null ? 'derivado_comision' : null,
    porTipo: calculo.porTipo,
    ocupacion: { adultos: c.adultos, ninos: c.ninos, infantes: c.infantes, total: c.adultos + c.ninos + c.infantes },
    ocupacionDelItem: true,
    identidad,
    // También como nota: con una corrección en la ficha la descripción se rearma desde los campos
    // de la ranura (`descripcionDeLinea`) y las notas son lo que sobrevive.
    notasCliente: incluye ? [incluye] : [],
    alertas: calculo.avisos,
    campos,
    nombre,
    // Lo que incluye la fila llega al documento del cliente (`descripcionDeLinea`).
    descripcion: incluye,
    leidaEn: args.leidaEn,
    paraComposicion: c,
    origen: 'tarifario',
  }
}

/** «Adulto», «Niño»: para la pantalla. */
export const nombreTipo = (t: TipoPasajero) => NOMBRE_TIPO[t]

/**
 * El día con que nace una actividad desde la tarifa (prueba del #1229, punto e: «Día del viaje:
 * Sin día» obligaba a un clic de más). La fecha de salida de la fila, si las elegidas traen una
 * sola; si no, un viaje de UN día (entrada = salida) cae ese día. En otro caso `null`: queda «Sin
 * día» y la tarjeta lo pide. Es una propuesta: la tarjeta lo deja cambiar.
 */
export function fechaDeActividadNueva(elegidas: readonly Pick<OpcionTarifa, 'fechaSalida'>[], viaje: { entrada: string | null; salida: string | null }): string | null {
  const propias = [...new Set(elegidas.map((o) => o.fechaSalida).filter((f): f is string => !!f))]
  if (propias.length === 1) return propias[0]
  if (propias.length > 1) return null
  const a = fechaValida(viaje.entrada)
  return a && fechaValida(viaje.salida) === a ? a : null
}
