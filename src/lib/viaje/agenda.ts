/**
 * La Agenda (reemplaza a «Mis pendientes» cuando la línea enciende `config_extra.hitos.activo`):
 * una sola lista por día con los hitos de gestión y, al lado, lo que ya existía (cuotas, pagos,
 * paquete, encuesta, aprobaciones). Diseño de Noor §3.1 y regla 3 del brief del 2026-10-22.
 *
 * Puro: lo usan la página (servidor), el componente (navegador), el motor (resumen diario y
 * escalamiento) y las pruebas.
 *
 *   · Selector de días: Hoy · los días siguientes · Fin de semana · Próx. semana.
 *   · Secciones: Vencido · Hoy · Mañana (o los días del rango escogido).
 *   · Orden dentro del día: fijos por hora, luego móviles, luego lo demás y al final lo de plata.
 *   · La asesora ve solo lo suyo. La dirección ve «Todo el equipo» (o una persona, o «Solo lo mío»),
 *     con la inicial de la responsable y un contador por persona que filtra al tocarlo.
 *   · Vacía: «Nada para hoy. Lo próximo: …». Nunca en blanco.
 */

import { esDiaHabil, siguienteDiaHabil, diaSemanaISO } from '@/lib/dates/dias-habiles'
import { sumarDias } from '@/lib/recordatorios/reglas'
import { fechaEnPalabras } from './fechas-servicio'
import { DEFINICIONES, cuandoEnPalabras, type Hito } from './hitos'
import type { Pendiente } from './mis-pendientes'

export type SeleccionDia = 'hoy' | 'finde' | 'semana' | `dia:${string}`

export interface OpcionDia {
  clave: SeleccionDia
  etiqueta: string
}

/** Cuántos días siguientes ofrece el selector después de «Hoy». */
export const DIAS_SIGUIENTES = 4

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const diaCorto = (f: string) => {
  const d = new Date(`${f}T12:00:00Z`)
  const t = `${DIAS[d.getUTCDay()]} ${d.getUTCDate()}`
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function opcionesDeDias(hoy: string): OpcionDia[] {
  const out: OpcionDia[] = [{ clave: 'hoy', etiqueta: `Hoy ${diaCorto(hoy).toLowerCase()}` }]
  for (let i = 1; i <= DIAS_SIGUIENTES; i++) {
    const f = sumarDias(hoy, i)
    out.push({ clave: `dia:${f}`, etiqueta: diaCorto(f) })
  }
  out.push({ clave: 'finde', etiqueta: 'Fin de semana' }, { clave: 'semana', etiqueta: 'Próx. semana' })
  return out
}

/** El rango de días de una selección (inclusive). */
export function rangoDe(sel: SeleccionDia, hoy: string): { desde: string; hasta: string } {
  if (sel === 'hoy') return { desde: hoy, hasta: sumarDias(hoy, 1) }
  if (sel.startsWith('dia:')) {
    const f = sel.slice(4)
    return /^\d{4}-\d{2}-\d{2}$/.test(f) ? { desde: f, hasta: sumarDias(f, 1) } : { desde: hoy, hasta: sumarDias(hoy, 1) }
  }
  if (sel === 'semana') {
    const dow = diaSemanaISO(hoy)
    const lunes = sumarDias(hoy, 8 - dow)
    return { desde: lunes, hasta: sumarDias(lunes, 6) }
  }
  // Fin de semana: el próximo sábado (o hoy si ya es fin de semana), con el viernes festivo antes y
  // el lunes festivo después (puente).
  const dow = diaSemanaISO(hoy)
  let desde = dow >= 6 ? hoy : sumarDias(hoy, 6 - dow)
  while (sumarDias(desde, -1) > hoy && !esDiaHabil(sumarDias(desde, -1))) desde = sumarDias(desde, -1)
  let hasta = desde
  while (!esDiaHabil(sumarDias(hasta, 1))) hasta = sumarDias(hasta, 1)
  return { desde, hasta }
}

function diasDe(r: { desde: string; hasta: string }): string[] {
  const out: string[] = []
  for (let f = r.desde; f <= r.hasta && out.length < 14; f = sumarDias(f, 1)) out.push(f)
  return out
}

export type LineaAgenda =
  | { clase: 'hito'; clave: string; hito: Hito }
  | { clase: 'pendiente'; clave: string; pendiente: Pendiente }

export interface SeccionAgenda {
  clave: string
  titulo: string
  vencido: boolean
  lineas: LineaAgenda[]
}

export interface ContadorPersona {
  staffId: string | null
  nombre: string
  n: number
}

export interface Agenda {
  secciones: SeccionAgenda[]
  /** Hitos sin fecha o sin plazo: «Falta la fecha de …». Solo en «Hoy». */
  faltan: Hito[]
  /** Solo la dirección en modo equipo: pendientes por persona en lo que se ve. */
  contador: ContadorPersona[]
  vencidos: number
  /** Solo la dirección: «No se hizo a tiempo» (los últimos 30 días). */
  noSeHizo: Hito[]
  proximo: { texto: string; fecha: string } | null
  vacia: boolean
}

/** 'equipo' (solo dirección) · 'mio' · el staff id de una persona · 'sin' (sin responsable). */
export type Alcance = string

export interface PersonaAgenda {
  staffId: string | null
  esDireccion: boolean
}

const esDe = (h: Hito, staffId: string | null) => !!staffId && h.responsables.includes(staffId)

/** ¿Qué hitos le llegan a esta persona? (lo decide el servidor: a la asesora no le viajan los de otra). */
export function hitosVisibles(hitos: readonly Hito[], persona: PersonaAgenda, aprobadoresPorNegocio?: ReadonlyMap<string, readonly string[]>): Hito[] {
  return hitos.filter(h => {
    // Viaje de prueba: solo a quien lo lleva o lo aprueba (como el motor).
    if (h.esPrueba) {
      const aprueba = !!persona.staffId && (aprobadoresPorNegocio?.get(h.negocioId) ?? []).includes(persona.staffId)
      if (!esDe(h, persona.staffId) && !aprueba) return false
    }
    return persona.esDireccion || esDe(h, persona.staffId)
  })
}

function filtrar(hitos: readonly Hito[], persona: PersonaAgenda, alcance: Alcance): Hito[] {
  if (!persona.esDireccion || alcance === 'mio') return hitos.filter(h => esDe(h, persona.staffId))
  if (alcance === 'equipo') return [...hitos]
  if (alcance === 'sin') return hitos.filter(h => h.responsables.length === 0)
  return hitos.filter(h => h.responsables.includes(alcance))
}

function ordenHito(h: Hito): string {
  // Fijos por hora (sin hora al final), luego móviles.
  return h.clase === 'fijo' ? `0|${h.horaObjetivo ?? '99:99'}` : `1|${h.titulo}`
}

export function armarAgenda(p: {
  hitos: readonly Hito[]
  pendientes: readonly Pendiente[]
  hoy: string
  seleccion: SeleccionDia
  alcance: Alcance
  persona: PersonaAgenda
  nombres: Readonly<Record<string, string>>
  proximoRespaldo?: { texto: string; fecha: string } | null
}): Agenda {
  const { hoy } = p
  const rango = rangoDe(p.seleccion, hoy)
  const dias = diasDe(rango)
  const enEquipo = p.persona.esDireccion && p.alcance === 'equipo'
  const hitos = filtrar(p.hitos, p.persona, p.alcance)
  // Los pendientes que ya existían son de quien mira: a otra persona no se le ven.
  const conPendientes = !p.persona.esDireccion || p.alcance === 'equipo' || p.alcance === 'mio'
  const pendientes = conPendientes ? p.pendientes : []

  const vencidos: LineaAgenda[] = []
  const porDia = new Map<string, LineaAgenda[]>(dias.map(d => [d, []]))
  const enRango: Hito[] = []
  for (const h of hitos) {
    if (h.estado !== 'pendiente' || !h.fechaAviso) continue
    if (h.vencido) { vencidos.push({ clase: 'hito', clave: h.llave, hito: h }); enRango.push(h); continue }
    const lista = porDia.get(h.fechaAviso)
    if (lista) { lista.push({ clase: 'hito', clave: h.llave, hito: h }); enRango.push(h) }
  }
  for (const pe of pendientes) {
    if (pe.grupo === 'vencido') { vencidos.push({ clase: 'pendiente', clave: pe.id, pendiente: pe }); continue }
    const dia = pe.fechaAgenda ?? (pe.fecha >= hoy ? pe.fecha : hoy)
    porDia.get(dia)?.push({ clase: 'pendiente', clave: pe.id, pendiente: pe })
  }

  const ordenar = (ls: LineaAgenda[]) => ls.sort((a, b) => {
    const k = (l: LineaAgenda) => l.clase === 'hito'
      ? `0|${l.hito.vencido ? l.hito.fechaAviso : ''}|${ordenHito(l.hito)}`
      : `${l.pendiente.plata ? 2 : 1}|${l.pendiente.fecha}`
    return k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0
  })

  const secciones: SeccionAgenda[] = []
  if (vencidos.length > 0) secciones.push({ clave: 'vencido', titulo: 'Vencido', vencido: true, lineas: ordenar(vencidos) })
  for (const d of dias) {
    const ls = porDia.get(d) ?? []
    if (ls.length === 0) continue
    const titulo = d === hoy ? 'Hoy' : d === sumarDias(hoy, 1) ? 'Mañana' : diaCorto(d)
    secciones.push({ clave: d, titulo, vencido: false, lineas: ordenar(ls) })
  }

  const contador: ContadorPersona[] = []
  if (enEquipo) {
    const n = new Map<string | null, number>()
    for (const h of enRango) {
      const quien = h.responsables.length === 0 ? [null] : h.responsables
      for (const r of quien) n.set(r, (n.get(r) ?? 0) + 1)
    }
    for (const [staffId, c] of n) contador.push({ staffId, nombre: staffId ? p.nombres[staffId] ?? 'Sin nombre' : 'Sin responsable', n: c })
    contador.sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre, 'es'))
  }

  const faltan = p.seleccion === 'hoy'
    ? hitos.filter(h => h.estado === 'falta_fecha' || h.estado === 'falta_plazo')
    : []
  const noSeHizo = p.persona.esDireccion
    ? hitos.filter(h => h.estado === 'no_se_hizo' && (h.limite ?? hoy) >= sumarDias(hoy, -30))
    : []

  const vacia = secciones.length === 0
  let proximo: Agenda['proximo'] = null
  if (vacia) {
    const sig = hitos
      .filter(h => h.estado === 'pendiente' && h.fechaAviso && h.fechaAviso > rango.hasta)
      .sort((a, b) => (a.fechaAviso! < b.fechaAviso! ? -1 : 1))[0]
    if (sig) {
      const quien = sig.cliente.trim().split(/\s+/)[0]
      proximo = { texto: `${DEFINICIONES[sig.hitoId].corto} de ${quien}`, fecha: sig.fechaAviso! }
    } else proximo = p.proximoRespaldo ?? null
  }
  return { secciones, faltan, contador, vencidos: vencidos.filter(l => l.clase === 'hito').length, noSeHizo, proximo, vacia }
}

// ── Campana: resumen diario por persona y escalamiento único ─────────────────

function conteo(hs: readonly Hito[]): string {
  const n = new Map<string, number>()
  for (const h of hs) n.set(DEFINICIONES[h.hitoId].corto, (n.get(DEFINICIONES[h.hitoId].corto) ?? 0) + 1)
  const partes = [...n.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${c} ${k}`)
  return partes.length <= 1 ? partes.join('') : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

/**
 * El resumen del día de una persona: «Hoy tienes 3 gestiones: 2 check-in y 1 tour.» y, el último
 * hábil antes de uno o más no hábiles, «Este fin de semana tienes …» con lo que cae en esos días (el
 * cron no corre en no hábil: así nada se pierde). `null` si no hay nada.
 */
export function resumenDelDia(hitos: readonly Hito[], staffId: string, hoy: string): { texto: string; hoy: number; noHabiles: number } | null {
  const suyos = hitos.filter(h => h.estado === 'pendiente' && h.fechaAviso && h.responsables.includes(staffId))
  const deHoy = suyos.filter(h => h.fechaAviso === hoy)
  const manana = sumarDias(hoy, 1)
  const noHabiles = esDiaHabil(manana)
    ? []
    : suyos.filter(h => h.fechaAviso! > hoy && h.fechaAviso! < siguienteDiaHabil(manana)).sort((a, b) =>
        `${a.fechaAviso}|${a.horaObjetivo ?? '99'}` < `${b.fechaAviso}|${b.horaObjetivo ?? '99'}` ? -1 : 1)
  if (deHoy.length === 0 && noHabiles.length === 0) return null
  const partes: string[] = []
  if (deHoy.length > 0) partes.push(`Hoy tienes ${deHoy.length} ${deHoy.length === 1 ? 'gestión' : 'gestiones'}: ${conteo(deHoy)}.`)
  if (noHabiles.length > 0) {
    const finde = noHabiles.some(h => diaSemanaISO(h.fechaAviso!) >= 6) ? 'Este fin de semana' : 'En el festivo'
    const detalle = noHabiles.slice(0, 3).map(h => {
      const quien = h.cliente.trim().split(/\s+/)[0]
      const cuando = cuandoEnPalabras(h, hoy)
      return `${fechaEnPalabras(h.fechaAviso!)}${h.horaObjetivo ? ` ${h.horaObjetivo}` : ''} · ${DEFINICIONES[h.hitoId].corto}${h.detalle ? ` ${h.detalle}` : ''} de ${quien}${cuando ? ` (${cuando})` : ''}`
    })
    const mas = noHabiles.length > 3 ? ` y ${noHabiles.length - 3} más` : ''
    partes.push(`${finde} tienes ${noHabiles.length}: ${detalle.join('; ')}${mas}.`)
  }
  return { texto: partes.join(' '), hoy: deHoy.length, noHabiles: noHabiles.length }
}

/** Cuántos días atrás se escala un hito vencido que no se escaló (cron caído, interruptor nuevo). */
export const VENTANA_ESCALAMIENTO_DIAS = 4

/**
 * Hitos que hoy se escalan a la dirección: pendientes cuyo día de aviso ya pasó (o que ya no
 * tienen remedio y nadie cerró), sin hechos, sin «No aplica», sin «No va» ni viajes cancelados (no
 * llegan aquí). Un solo aviso por hito lo garantiza el log del motor, no esta función.
 */
export function escalablesHoy(hitos: readonly Hito[], hoy: string): Hito[] {
  const desde = sumarDias(hoy, -VENTANA_ESCALAMIENTO_DIAS)
  return hitos.filter(h =>
    !h.marca && !!h.fechaAviso && h.fechaAviso < hoy && !!h.fechaAncla
    && (h.estado === 'pendiente' || h.estado === 'no_se_hizo')
    && (h.limite ?? h.fechaAncla) >= desde,
  )
}

/** «Daniela no ha hecho el check-in y pasabordo · vuelo de regreso de Carolina (sale mañana 06:10).» */
export function textoEscalamiento(h: Hito, quien: string | null, hoy: string): string {
  const cliente = h.cliente.trim() || 'el cliente'
  const que = `${h.titulo.charAt(0).toLowerCase()}${h.titulo.slice(1)}`
  const cuando = cuandoEnPalabras(h, hoy)
  const extra = `${h.detalle && h.detalle !== h.servicioNombre ? ` · ${h.detalle}` : ''}${cuando ? `, ${cuando}` : ''}`
  if (h.estado === 'no_se_hizo') return `No se hizo a tiempo: ${que} de ${cliente}${extra}. Lo tenía ${quien ?? 'nadie (sin responsable)'}.`
  return `${quien ?? 'Nadie (sin responsable)'} no ha hecho: ${que} de ${cliente}${extra}.`
}
