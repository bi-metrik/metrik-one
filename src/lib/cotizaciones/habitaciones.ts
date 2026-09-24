/**
 * R8 · varias habitaciones en una opción de hotel (Mauricio, 2026-09-24).
 *
 * Diseño: `proyectos/trappvel/clarity/docs/diseno/reunion-edgar-alejandra-2026-09-23.md`,
 * sección «R8 resuelto». Caso real: COT-2026-0013, grupo de 6 adultos, 1 niño y 1 infante
 * cotizado en tres capturas por hotel (2A+1N, 2A+1I, 2A).
 *
 *  · **Opción de hotel = hotel + entrada + salida.** Cada captura con el mismo hotel y las
 *    mismas fechas es una habitación de esa opción, nunca otra opción ni otra ranura.
 *  · **Sumar:** mientras la suma de las ocupaciones no pase del grupo, cada captura es una
 *    habitación.
 *  · **Restar:** del mismo tipo de habitación, la captura con menor menos la de solo adultos
 *    da el precio del menor. Una misma captura puede ser habitación y referencia.
 *  · **Solo para restar:** la captura de solo adultos que haría pasar el total del grupo.
 *    Se decide al LEER, así que se reclasifica sola si después entra otra captura.
 *  · Una persona puede fijar el papel con un toque (`rolManual`), y eso manda.
 *
 * Puro: el grupo del negocio entra por parámetro.
 */

import {
  describirOcupacion,
  composicionDeLectura,
  formatoMonto,
  montoDeCosto,
  mismoTexto,
  normalizarComposicion,
  claveDeHabitacion,
  repartirConManuales,
  repartirProporcional,
  resolverTarifa,
  totalPasajeros,
  TIPOS_PASAJERO,
  cantidadDeTipo,
  type Composicion,
  type CostoDeHabitacion,
  type CostoPorTipo,
  type EstadoTarifa,
  type Habitacion,
  type LecturaCasilla,
  type PreciosAMano,
  type RolHabitacion,
  type TarifaPax,
  type TipoPasajero,
} from './tarifa-pasajero'

/** El id con que se nombra la habitación de una opción de siempre (su pantallazo 1). */
export const ID_HABITACION_UNICA = 'grupo_completo'

/**
 * Las habitaciones de una opción. Una opción anterior a R8 es UNA habitación: la de su
 * pantallazo 1. Sin lectura, ninguna.
 */
export function habitacionesDeTarifa(tarifa: TarifaPax): Habitacion[] {
  if (tarifa.habitaciones && tarifa.habitaciones.length > 0) return tarifa.habitaciones
  const l = tarifa.casillas?.grupo_completo
  return l ? [{ id: ID_HABITACION_UNICA, lectura: l }] : []
}

/** ¿La opción ya lleva habitaciones propias (R8)? Sin ellas se cotiza como siempre. */
export function conHabitaciones(tarifa: TarifaPax): boolean {
  return (tarifa.habitaciones?.length ?? 0) > 0
}

// ── Qué opción es ────────────────────────────────────────────────────────────

export interface ClaveOpcionHotel {
  hotel: string
  entrada: string
  salida: string
}

/** Hotel, entrada y salida de una lectura. `null` si falta cualquiera de los tres. */
export function claveOpcionHotel(l: LecturaCasilla): ClaveOpcionHotel | null {
  const hotel = (l.identidad.hotel ?? '').trim()
  const entrada = (l.identidad.check_in ?? '').trim()
  const salida = (l.identidad.check_out ?? '').trim()
  if (!hotel || !entrada || !salida) return null
  return { hotel, entrada, salida }
}

/** ¿Mismo hotel y mismas fechas? Sin los tres datos en las dos, no se afirma. */
export function mismaOpcionHotel(a: LecturaCasilla, b: LecturaCasilla): boolean {
  const ka = claveOpcionHotel(a)
  const kb = claveOpcionHotel(b)
  if (!ka || !kb) return false
  return ka.entrada === kb.entrada && ka.salida === kb.salida && mismoTexto(ka.hotel, kb.hotel)
}

/** ¿Mismas fechas? Es lo que decide si dos hoteles compiten en la misma ranura. */
export function mismasFechasHotel(a: LecturaCasilla, b: LecturaCasilla): boolean {
  const ka = claveOpcionHotel(a)
  const kb = claveOpcionHotel(b)
  return !!ka && !!kb && ka.entrada === kb.entrada && ka.salida === kb.salida
}

// ── El reparto ───────────────────────────────────────────────────────────────

export interface HabitacionRepartida {
  id: string
  /** «Habitación N». `null` cuando es solo para restar. */
  numero: number | null
  rol: RolHabitacion
  /** Una persona fijó el papel. */
  manual: boolean
  /** Es la de solo adultos contra la que se resta el menor de otra habitación. */
  sirveParaRestar: boolean
  ocupacion: Composicion | null
  tipoHabitacion: string | null
  total: number
  moneda: string
  lectura: LecturaCasilla
}

export interface RepartoHabitaciones {
  habitaciones: HabitacionRepartida[]
  grupo: Composicion | null
  /** Lo que cubren las habitaciones (no las de restar). */
  cubiertos: Composicion
  faltan: Composicion | null
  sobran: Composicion | null
  costoTotal: number
}

const CERO: Composicion = { adultos: 0, ninos: 0, infantes: 0 }
const sumar = (a: Composicion, b: Composicion): Composicion => ({
  adultos: a.adultos + b.adultos,
  ninos: a.ninos + b.ninos,
  infantes: a.infantes + b.infantes,
})
const soloAdultos = (c: Composicion | null) => !!c && c.ninos === 0 && c.infantes === 0

/**
 * La ocupación de una habitación. Un menor de menos de 2 años cuenta como infante aunque la
 * lectura vieja lo haya contado como niño (`menoresDeDosAnios`).
 */
export function ocupacionDeHabitacion(l: LecturaCasilla): Composicion | null {
  const c = composicionDeLectura(l)
  if (!c) return null
  const texto = l.campos.find(x => /ocupaci/i.test(x.label))?.valor ?? null
  const bebes = Math.min(c.ninos, menoresDeDosAnios(texto))
  return bebes > 0 ? { adultos: c.adultos, ninos: c.ninos - bebes, infantes: c.infantes + bebes } : c
}

/** ¿La habitación `a` (solo adultos) sirve para restarle el menor a `r`? */
function esPar(a: HabitacionRepartida, r: HabitacionRepartida): boolean {
  if (a.id === r.id || !soloAdultos(a.ocupacion) || !r.ocupacion || soloAdultos(r.ocupacion)) return false
  if (a.ocupacion!.adultos !== r.ocupacion.adultos) return false
  if (!a.tipoHabitacion || !r.tipoHabitacion) return false
  return mismoTexto(a.tipoHabitacion, r.tipoHabitacion)
}

/**
 * Qué hace cada captura de la opción, contra el grupo del negocio.
 *
 * ⚠️ «Solo para restar» se decide aquí y no se guarda: con otra captura, o con otro grupo,
 * el reparto cambia solo. Lo que se guarda es lo que fijó una persona.
 */
export function repartirHabitaciones(
  habitaciones: readonly Habitacion[],
  grupo: Composicion | null,
): RepartoHabitaciones {
  const filas: HabitacionRepartida[] = habitaciones.map(h => ({
    id: h.id,
    numero: null,
    rol: h.rolManual?.valor ?? 'habitacion',
    manual: !!h.rolManual,
    sirveParaRestar: false,
    // Lo que corrigió una persona manda sobre lo leído (`Habitacion.correccion`).
    ocupacion: h.correccion?.ocupacion ?? ocupacionDeHabitacion(h.lectura),
    tipoHabitacion: (h.lectura.identidad.tipo_habitacion ?? '').trim() || null,
    total: h.correccion?.total ?? montoDeCosto(h.lectura),
    moneda: (h.lectura.moneda || 'COP').toUpperCase(),
    lectura: h.lectura,
  }))

  const cubren = () => filas
    .filter(f => f.rol === 'habitacion' && f.ocupacion)
    .reduce((a, f) => sumar(a, f.ocupacion!), CERO)

  // Solo para restar: la de solo adultos que hace pasar el total del grupo. Primero las que
  // tienen un par con menor (son justo las de referencia), y de esas la última que llegó.
  if (grupo) {
    for (;;) {
      const suma = cubren()
      if (suma.adultos <= grupo.adultos) break
      const candidatas = filas.filter(f => !f.manual && f.rol === 'habitacion' && soloAdultos(f.ocupacion))
      if (candidatas.length === 0) break
      const conPar = candidatas.filter(a => filas.some(r => esPar(a, r)))
      const elegida = (conPar.length > 0 ? conPar : candidatas)[(conPar.length > 0 ? conPar : candidatas).length - 1]
      elegida.rol = 'referencia'
    }
  }

  let n = 0
  for (const f of filas) {
    if (f.rol === 'habitacion') f.numero = ++n
    f.sirveParaRestar = filas.some(r => r.rol === 'habitacion' && esPar(f, r))
  }

  const cubiertos = cubren()
  const faltan = grupo
    ? {
        adultos: Math.max(0, grupo.adultos - cubiertos.adultos),
        ninos: Math.max(0, grupo.ninos - cubiertos.ninos),
        infantes: Math.max(0, grupo.infantes - cubiertos.infantes),
      }
    : null
  const sobran = grupo
    ? {
        adultos: Math.max(0, cubiertos.adultos - grupo.adultos),
        ninos: Math.max(0, cubiertos.ninos - grupo.ninos),
        infantes: Math.max(0, cubiertos.infantes - grupo.infantes),
      }
    : null
  return {
    habitaciones: filas,
    grupo,
    cubiertos,
    faltan: faltan && totalPasajeros(faltan) > 0 ? faltan : null,
    sobran: sobran && totalPasajeros(sobran) > 0 ? sobran : null,
    costoTotal: filas.filter(f => f.rol === 'habitacion').reduce((a, f) => a + f.total, 0),
  }
}

// ── Lo que se muestra ────────────────────────────────────────────────────────

const PALABRAS: Record<TipoPasajero, [string, string]> = {
  adulto: ['adulto', 'adultos'],
  nino: ['niño', 'niños'],
  infante: ['infante', 'infantes'],
}

/** «6/6 adultos · 1/1 niño · 0/1 infante». Sin grupo, solo lo cubierto. */
export function textoDeCupos(r: RepartoHabitaciones): string {
  const g = r.grupo
  return TIPOS_PASAJERO
    .filter(t => cantidadDeTipo(r.cubiertos, t) > 0 || (g ? cantidadDeTipo(g, t) > 0 : false))
    .map(t => {
      const cubre = cantidadDeTipo(r.cubiertos, t)
      if (!g) return `${cubre} ${PALABRAS[t][cubre === 1 ? 0 : 1]}`
      const total = cantidadDeTipo(g, t)
      return `${cubre}/${total} ${PALABRAS[t][Math.max(cubre, total) === 1 ? 0 : 1]}`
    })
    .join(' · ')
}

/** Lo que falta y lo que sobra, en una frase. `null` si el grupo quedó exacto. */
export function textoDeFaltantes(r: RepartoHabitaciones): string | null {
  const partes: string[] = []
  if (r.faltan) partes.push(`Falta cotizar ${describirOcupacion(r.faltan, 'y')}`)
  if (r.sobran) partes.push(`Sobra${totalPasajeros(r.sobran) === 1 ? '' : 'n'} ${describirOcupacion(r.sobran, 'y')}`)
  return partes.length > 0 ? `${partes.join('. ')}.` : null
}

// ── El costo ─────────────────────────────────────────────────────────────────

/**
 * El costo por tipo de pasajero, o `null` si no se puede partir.
 *
 * Se parte cuando cada habitación con menores tiene su par de solo adultos del mismo tipo de
 * habitación y un solo tipo de menor: el menor cuesta la diferencia y los adultos lo del par.
 * Sin par, el precio va por habitación (regla 8): repartirlo sería inventar cuánto cuesta cada uno.
 */
export function costoPorTipoDeHabitaciones(r: RepartoHabitaciones): CostoPorTipo[] | null {
  const totales: Record<TipoPasajero, number> = { adulto: 0, nino: 0, infante: 0 }
  const cantidades: Record<TipoPasajero, number> = { adulto: 0, nino: 0, infante: 0 }
  const origen: Record<TipoPasajero, string[]> = { adulto: [], nino: [], infante: [] }
  for (const h of r.habitaciones.filter(x => x.rol === 'habitacion')) {
    const o = h.ocupacion
    if (!o) return null
    if (soloAdultos(o)) {
      totales.adulto += h.total
      cantidades.adulto += o.adultos
      origen.adulto.push(`Habitación ${h.numero}`)
      continue
    }
    const menores = (['nino', 'infante'] as TipoPasajero[]).filter(t => cantidadDeTipo(o, t) > 0)
    if (menores.length !== 1) return null
    const par = r.habitaciones.find(a => esPar(a, h))
    if (!par) return null
    const diferencia = h.total - par.total
    if (diferencia < 0) return null
    const menor = menores[0]
    totales.adulto += par.total
    cantidades.adulto += o.adultos
    origen.adulto.push(`Habitación ${h.numero}`)
    totales[menor] += diferencia
    cantidades[menor] += cantidadDeTipo(o, menor)
    origen[menor].push(`Habitación ${h.numero} menos ${par.numero ? `la Habitación ${par.numero}` : 'la captura de solo adultos'}`)
  }
  const moneda = r.habitaciones[0]?.moneda ?? 'COP'
  return TIPOS_PASAJERO
    .filter(t => cantidades[t] > 0)
    .map(t => ({
      tipo: t,
      cantidad: cantidades[t],
      total: Math.round(totales[t] * 100) / 100,
      unitario: Math.round((totales[t] / cantidades[t]) * 100) / 100,
      deDonde: `${origen[t].join('; ')} (${formatoMonto(totales[t], moneda)})`,
    }))
}

/**
 * El estado de la tarifa de una opción con habitaciones: la misma forma que
 * `resolverTarifa`, para que la confirmación y la pantalla no cambien de camino.
 */
export function resolverHabitaciones(
  tarifa: TarifaPax,
  grupo: Composicion | null,
  opciones: { moneda?: string | null } = {},
): EstadoTarifa {
  const r = repartirHabitaciones(habitacionesDeTarifa(tarifa), grupo)
  const cuentan = r.habitaciones.filter(h => h.rol === 'habitacion')
  if (cuentan.length === 0) {
    return { estado: 'inconsistente', mensaje: 'Ninguna captura quedó como habitación: toca «Usar como habitación» en la que va.' }
  }
  const sinOcupacion = cuentan.find(h => !h.ocupacion)
  if (sinOcupacion) {
    return { estado: 'inconsistente', mensaje: `La Habitación ${sinOcupacion.numero} no dice a cuántos cubre: pega un pantallazo que muestre la ocupación.` }
  }
  const monedas = new Set(r.habitaciones.map(h => h.moneda))
  if (monedas.size > 1) {
    return { estado: 'inconsistente', mensaje: `Las capturas vienen en monedas distintas (${[...monedas].join(', ')}): cotiza todas las habitaciones en la misma.` }
  }
  const moneda = (opciones.moneda || [...monedas][0] || 'COP').toUpperCase()
  const porTipo = costoPorTipoDeHabitaciones(r)
  const porHabitacion: CostoDeHabitacion[] = cuentan.map(h => ({ numero: h.numero!, ocupacion: h.ocupacion!, total: h.total }))
  const cuantas = cuentan.length === 1 ? '1 habitación' : `${cuentan.length} habitaciones`
  // Lo que falta del grupo se dice, pero no frena: el lector puede leer mal una edad y la
  // opción quedaría sin poderse confirmar nunca. La pantalla lo pone en rojo arriba.
  const faltantes = textoDeFaltantes(r)
  return {
    estado: 'resuelta',
    costos: porTipo ?? [],
    moneda,
    costoTotal: Math.round(r.costoTotal * 100) / 100,
    origen: 'habitaciones',
    mensaje: (faltantes ? `${faltantes} ` : '') + (porTipo
      ? `${cuantas}: el precio de cada menor sale de restar la de solo adultos del mismo tipo.`
      : `${cuantas}. Sin una de solo adultos del mismo tipo para restar, el precio va por habitación.`),
    ...(porTipo ? {} : { porHabitacion }),
  }
}

// ── Escribir ─────────────────────────────────────────────────────────────────

/**
 * La tarifa con las habitaciones dadas, en su forma guardada.
 *
 * El pantallazo 1 (`casillas.grupo_completo`) queda como la primera habitación: de ahí leen
 * el nombre, la descripción, la moneda y la ficha de la opción. Su `paraComposicion` y la
 * composición de la línea son lo que cubren las habitaciones: así nada de lo que compara
 * contra la composición la da por vieja.
 */
export function tarifaConHabitaciones(
  actual: TarifaPax,
  habitaciones: Habitacion[],
  grupo: Composicion | null,
): TarifaPax {
  if (habitaciones.length === 0) {
    const { habitaciones: _fuera, ...resto } = actual
    void _fuera
    return { ...resto, casillas: {}, composicion: null }
  }
  const r = repartirHabitaciones(habitaciones, grupo)
  const composicion = normalizarComposicion(r.cubiertos)
  const primera = habitaciones[0].lectura
  return {
    ...actual,
    habitaciones,
    composicion,
    casillas: {
      grupo_completo: composicion ? { ...primera, paraComposicion: composicion } : primera,
    },
  }
}

/** Agrega una habitación a la opción (una opción de siempre pasa a tener dos). */
export function agregarHabitacion(
  actual: TarifaPax,
  nueva: Habitacion,
  grupo: Composicion | null,
): TarifaPax {
  return tarifaConHabitaciones(actual, [...habitacionesDeTarifa(actual), nueva], grupo)
}

/**
 * P10 para hoteles · ¿la captura sobra? Solo cuando los cupos del grupo ya están completos,
 * y NO si es la de solo adultos que le falta a una habitación con menor para restar.
 * Dos habitaciones iguales no son repetidas: un grupo de 4 adultos son dos dobles iguales.
 */
export function sobraLaCaptura(
  habitaciones: readonly Habitacion[],
  nueva: LecturaCasilla,
  grupo: Composicion | null,
): boolean {
  if (!grupo) return false
  const r = repartirHabitaciones(habitaciones, grupo)
  if (r.faltan) return false
  const prueba = repartirHabitaciones([...habitaciones, { id: '__nueva__', lectura: nueva }], grupo)
  const fila = prueba.habitaciones.find(h => h.id === '__nueva__')
  return !fila?.sirveParaRestar
}

// ── A qué opción se une una captura ─────────────────────────────────────────

export interface CandidataHotel {
  id: string
  tarifa: TarifaPax
}

/**
 * ¿Esta opción puede recibir habitaciones? Las que ya las tienen, y las de siempre que solo
 * traen el pantallazo 1: una opción vieja con capturas para restar (`sin_infantes`,
 * `solo_adultos`) se cotiza por su camino y no se mezcla.
 */
export function recibeHabitaciones(tarifa: TarifaPax): boolean {
  if (conHabitaciones(tarifa)) return true
  const c = tarifa.casillas ?? {}
  return !!c.grupo_completo && !c.sin_infantes && !c.solo_adultos
}

/**
 * La opción del mismo hotel y las mismas fechas a la que se une la captura (regla 1), o `null`.
 * Con varias, la que más habitaciones tiene; empatadas, la primera de la lista (el orden de la
 * cotización). Sin hotel o sin fechas en la captura no se afirma nada.
 */
export function opcionDelMismoHotel(
  propia: LecturaCasilla,
  candidatas: readonly CandidataHotel[],
): CandidataHotel | null {
  if (!claveOpcionHotel(propia)) return null
  let mejor: CandidataHotel | null = null
  let mejorN = 0
  for (const c of candidatas) {
    if (!recibeHabitaciones(c.tarifa)) continue
    const habs = habitacionesDeTarifa(c.tarifa)
    if (habs.length === 0 || !mismaOpcionHotel(habs[0].lectura, propia)) continue
    if (habs.length > mejorN) {
      mejor = c
      mejorN = habs.length
    }
  }
  return mejor
}

/** ¿Alguna habitación de la opción salió de esta misma imagen? (P10, regla 6) */
export function mismaImagenEnHabitaciones(habitaciones: readonly Habitacion[], huella: string | null | undefined): boolean {
  return !!huella && habitaciones.some(h => h.lectura.huellaImagen === huella)
}

/**
 * El estado de la tarifa de CUALQUIER opción: con habitaciones, contra el grupo del negocio;
 * sin ellas, como siempre. Es la única puerta: la pantalla, la lectura y la confirmación
 * preguntan aquí para no decidir por su cuenta qué camino toma una opción.
 */
export function resolverTarifaDeOpcion(
  tarifa: TarifaPax,
  composicionLinea: Composicion | null,
  grupo: Composicion | null,
  ranuraSlug: string,
  opciones: { moneda?: string | null } = {},
): EstadoTarifa | null {
  if (conHabitaciones(tarifa)) return resolverHabitaciones(tarifa, grupo ?? composicionLinea, opciones)
  if (!composicionLinea) return null
  return resolverTarifa(composicionLinea, tarifa.casillas ?? {}, ranuraSlug, opciones)
}

// ── El precio por habitación (regla 8) ───────────────────────────────────────

export interface PrecioPorHabitacion {
  numero: number
  /** El precio lo escribió una persona en la tarjeta. */
  aMano?: boolean
  ocupacion: Composicion
  /** Precio de venta de la habitación, en pesos, redondeado al peso. */
  precio: number
}

/**
 * Reparte el precio de la línea entre sus habitaciones, en proporción a su costo (el mismo
 * criterio que el precio por pasajero). Al peso y SUMANDO EXACTO el precio de la línea: los
 * pesos que deja el redondeo van a las de mayor fracción, así el documento no dice un total
 * y unas habitaciones que suman otro.
 */
export function precioPorHabitacion(
  porHabitacion: readonly { numero: number; ocupacion: Composicion; totalCOP: number }[],
  precioLinea: number,
  /** Los precios escritos a mano en la tarjeta (`hab:N`): esas habitaciones se quedan con el suyo. */
  aMano?: PreciosAMano | null,
): PrecioPorHabitacion[] {
  if (porHabitacion.length === 0) return []
  if (porHabitacion.some(h => aMano?.[claveDeHabitacion(h.numero)])) {
    const unitarios = repartirConManuales(
      porHabitacion.map(h => ({ clave: claveDeHabitacion(h.numero), cantidad: 1, peso: h.totalCOP })),
      Number(precioLinea) || 0,
      aMano ?? {},
    )
    return porHabitacion.map(h => ({
      numero: h.numero,
      ocupacion: h.ocupacion,
      precio: unitarios.get(claveDeHabitacion(h.numero)) ?? 0,
      ...(aMano?.[claveDeHabitacion(h.numero)] ? { aMano: true } : {}),
    }))
  }
  const total = Math.round(Number(precioLinea) || 0)
  const repartido = repartirProporcional(total, porHabitacion.map(h => h.totalCOP))
  const pisos = repartido.map(v => Math.floor(v))
  let faltan = total - pisos.reduce((a, v) => a + v, 0)
  const porFraccion = repartido
    .map((v, i) => ({ i, fraccion: v - Math.floor(v) }))
    .sort((a, b) => b.fraccion - a.fraccion || a.i - b.i)
  for (const { i } of porFraccion) {
    if (faltan <= 0) break
    pisos[i]++
    faltan--
  }
  return porHabitacion.map((h, i) => ({ numero: h.numero, ocupacion: h.ocupacion, precio: pisos[i] }))
}

// ── La edad ──────────────────────────────────────────────────────────────────

/**
 * Cuántos menores de 2 años nombra el texto de ocupación de la captura: «1 niño (0 años)»,
 * «2 niños (1 y 5 años)», «1 child (1 year)». Menos de 2 años es infante (R8, regla 7).
 */
export function menoresDeDosAnios(texto: string | null | undefined): number {
  if (!texto) return 0
  const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  let n = 0
  const grupos = t.matchAll(/(?:ninos?|menor(?:es)?|child(?:ren)?|kids?)\s*\(([^)]*)\)/g)
  for (const g of grupos) {
    for (const edad of g[1].matchAll(/\d+/g)) {
      if (Number(edad[0]) < 2) n++
    }
  }
  return n
}
