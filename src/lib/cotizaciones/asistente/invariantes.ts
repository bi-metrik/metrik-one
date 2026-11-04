import { VERSIONES, type BorradorCotizacion, type HotelBorrador, type Version } from './borrador'

/**
 * Las invariantes del borrador (piloto 2026-11-03). Aquí no hay reglas de negocio de un cliente:
 * solo lo que tiene que ser cierto para que el documento no mienta (los totales cuadran al peso, las
 * fechas son coherentes, la gente cabe en las habitaciones, cada versión tiene un hotel). El total
 * que va al cliente lo calcula el código, no el modelo.
 */

export interface Hallazgo {
  nivel: 'error' | 'aviso'
  campo: string
  mensaje: string
}

export interface Viajeros {
  adultos: number
  ninos: { edad: number }[]
}

export interface Validado {
  hallazgos: Hallazgo[]
  /** Total por versión, recalculado. */
  totales: Partial<Record<Version, number>>
  noches: number | null
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/
/** Códigos del operador que no van en lo que lee el cliente: «(FULL)», «(P.A.M.)», «ATN 1988-P». */
const CODIGO_OPERADOR = /\([A-Z.]{2,}\)|\bATN\b/

function dias(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** Costo = Σ precio por persona × personas + Σ precio de niño × niños. `null` si falta un precio. */
export function totalDelHotel(h: HotelBorrador): number | null {
  let total = 0
  for (const d of h.distribucion) {
    const p = h.precios.find(x => x.acomodacion.toLowerCase() === d.acomodacion.toLowerCase())
    if (!p) return null
    total += p.precioPorPersona * d.personasPorHabitacion * d.habitaciones
  }
  for (const n of h.ninosAsignados) {
    const p = h.ninos.find(x => x.rango === n.rango)
    if (!p) return null
    total += p.precio * n.cantidad
  }
  return total
}

export function validarBorrador(b: BorradorCotizacion, viajeros: Viajeros): Validado {
  const hallazgos: Hallazgo[] = []
  const error = (campo: string, mensaje: string) => hallazgos.push({ nivel: 'error', campo, mensaje })
  const aviso = (campo: string, mensaje: string) => hallazgos.push({ nivel: 'aviso', campo, mensaje })

  // Vuelo: ida y regreso, fechas y horas bien formadas, el regreso después de la ida.
  let noches: number | null = null
  if (b.vuelos.length < 2) error('vuelos', `Se esperaban ida y regreso; llegaron ${b.vuelos.length} tramos.`)
  b.vuelos.forEach((v, i) => {
    if (!FECHA.test(v.fecha)) error(`vuelos[${i}].fecha`, `Fecha mal formada: «${v.fecha}».`)
    if (!HORA.test(v.salida) || !HORA.test(v.llegada)) error(`vuelos[${i}]`, `Hora mal formada: ${v.salida} → ${v.llegada}.`)
    if (!/^[A-Z0-9]{2}\d{1,4}$/.test(v.numero)) aviso(`vuelos[${i}].numero`, `Número de vuelo raro: «${v.numero}».`)
  })
  if (b.vuelos.length >= 2) {
    const ida = b.vuelos[0], regreso = b.vuelos[b.vuelos.length - 1]
    if (FECHA.test(ida.fecha) && FECHA.test(regreso.fecha)) {
      noches = dias(ida.fecha, regreso.fecha)
      if (noches <= 0) error('vuelos', `El regreso (${regreso.fecha}) no es después de la ida (${ida.fecha}).`)
    }
    if (ida.origenIata !== regreso.destinoIata || ida.destinoIata !== regreso.origenIata) {
      aviso('vuelos', `La ruta no es ida y vuelta: ${ida.origenIata}→${ida.destinoIata}, ${regreso.origenIata}→${regreso.destinoIata}.`)
    }
  }

  // Hoteles: uno por versión, noches = las del vuelo, la gente cabe, el total cuadra.
  const totales: Partial<Record<Version, number>> = {}
  const vistas = new Set<Version>()
  const adultos = viajeros.adultos, ninos = viajeros.ninos.length
  for (const h of b.hoteles) {
    const c = `hotel «${h.nombre}»`
    if (vistas.has(h.version)) error(c, `Dos hoteles en la versión ${h.version}.`)
    vistas.add(h.version)
    if (noches !== null && h.noches !== noches) error(c, `El hotel dice ${h.noches} noches y el vuelo da ${noches}.`)
    const personas = h.distribucion.reduce((s, d) => s + d.habitaciones * d.personasPorHabitacion, 0)
    const ninosEnHotel = h.ninosAsignados.reduce((s, n) => s + n.cantidad, 0)
    if (personas !== adultos) error(c, `La distribución acomoda ${personas} adultos y la solicitud trae ${adultos}.`)
    if (ninosEnHotel !== ninos) error(c, `La distribución lleva ${ninosEnHotel} niños y la solicitud trae ${ninos}.`)
    for (const d of h.distribucion) {
      const p = h.precios.find(x => x.acomodacion.toLowerCase() === d.acomodacion.toLowerCase())
      if (!p) error(c, `La acomodación «${d.acomodacion}» no está en la tabla de precios del pantallazo.`)
      else if (p.personasPorHabitacion !== d.personasPorHabitacion) error(c, `«${d.acomodacion}» es de ${p.personasPorHabitacion} personas, no de ${d.personasPorHabitacion}.`)
    }
    for (const p of h.precios) {
      if (!Number.isInteger(p.precioPorPersona) || p.precioPorPersona <= 0) error(c, `Precio por persona inválido en ${p.acomodacion}: ${p.precioPorPersona}.`)
    }
    // Lo que lee el cliente no lleva códigos del operador («(FULL)», «(P.A.M.)», «ATN 1988-P»).
    for (const [k, t] of [['habitacion', h.habitacion], ['regimen', h.regimen], ['zona', h.zona ?? ''], ['incluye', h.incluye]] as const) {
      if (CODIGO_OPERADOR.test(t)) error(`${c}.${k}`, `Lleva un código del operador: «${t}».`)
    }
    const total = totalDelHotel(h)
    if (total === null || total <= 0) {
      error(c, 'No se pudo calcular el total: falta un precio.')
      continue
    }
    totales[h.version] = total
    if (h.totalCalculadoPorElModelo !== total) {
      aviso(c, `El modelo sumó ${h.totalCalculadoPorElModelo} y el total es ${total}: manda el del código.`)
    }
    if (h.tipoTarifa === 'desconocida' && !b.dudas.some(d => /tarifa|margen|neta|p[uú]blica/i.test(`${d.campo} ${d.pregunta}`))) {
      error(c, 'No se sabe si la tarifa es pública o neta y no hay pregunta abierta.')
    }
  }
  if (!vistas.has('Recomendada')) error('versiones', 'No hay versión Recomendada.')

  // Lo mismo en el texto general: Haiku 5.5 escribió «El plan (FULL) …» en «antes de viajar».
  const textos: [string, string][] = [['titular', b.titular], ['intro', b.intro],
    ...b.incluye.map((t, i): [string, string] => [`incluye[${i}]`, t]),
    ...b.antesDeViajar.map((t, i): [string, string] => [`antesDeViajar[${i}]`, t])]
  for (const [k, t] of textos) if (CODIGO_OPERADOR.test(t)) error(k, `Lleva un código del operador: «${t}».`)

  // El orden de las versiones sigue al precio. No se reordena solo: el piloto (2026-11-03) mostró que
  // el modelo puede cruzar dos hoteles entre versiones con los totales bien sumados, y así el PDF sale
  // con la Recomendada más barata que la Económica. Frena el PDF hasta que la asesora lo corrija.
  const conTotal = VERSIONES.filter(v => totales[v] !== undefined)
  conTotal.forEach((v, i) => {
    const anterior = conTotal[i - 1]
    if (anterior && (totales[v] as number) < (totales[anterior] as number)) {
      error('versiones', `La ${v} (${totales[v]}) cuesta menos que la ${anterior} (${totales[anterior]}): las versiones parecen cruzadas.`)
    }
  })

  for (const d of b.dudas) if (!d.queSePusoMientras?.trim()) aviso(`duda «${d.campo}»`, 'La duda no dice qué se puso mientras tanto.')

  return { hallazgos, totales, noches }
}
