/**
 * Resumen diario de los asistentes por correo (spec 2026-10-26, §4.3).
 *
 * Cada mañana (cron `resumen-asistentes`, 7:00 de Bogotá, media hora después de la calificación) sale UN correo a
 * MéTRIK con todos los workspaces, por workspace y rol: conversaciones, registros confirmados, bloqueos («no pude» y
 * candados), escalamientos hechos y debidos, fallas por tipo, costo del día y la lección del día. Arriba, lo que pide
 * acción. Si no hubo conversaciones sale igual con «sin actividad»: que no llegue es la señal de que el cron se cayó.
 *
 * DE DÓNDE SALE CADA CIFRA.
 * - Conversaciones, registros, «no pude», candados, notas de voz y costo del modelo: las trazas del día
 *   (`wa_conversacion`, `chatwoot_conversacion`). Registro confirmado = `ejecucion.resultado = 'ejecutada'`. «No pude» =
 *   turno con `error`, ejecución con `error` o la respuesta fija de modelo caído.
 * - Escalamientos hechos: `asistente_escalamientos` del día. Debidos: conversaciones con F9 del calificador sin fila de
 *   escalamiento.
 * - Fallas: `asistente_calificaciones` de la fecha (solo los workspaces con la calificación con texto).
 * - Costo: modelo (trazas) y juez (tokens de la columna `juez`) con `bot_modelo_precios`. La transcripción no deja su
 *   uso en la traza (solo el tiempo): se cuentan las notas de voz y el costo queda «sin medir».
 *
 * DATOS. El correo no lee el texto de ninguna conversación. Lo que podría traer un dato de un cliente final, la
 * evidencia del calificador, ya viene seudonimizada desde la calificación; además, al final se tapan como `[cliente]`
 * los nombres que traen las trazas y las presentaciones del día. Del escalamiento se muestra el motivo y el modo, no su
 * resumen. La conversación va por alias y la traza se ubica por `turno_id`. Los nombres del equipo sí pueden ir: son
 * usuarios de ONE.
 */
import { sumarUso, type PrecioModelo } from '../../../supabase/functions/_shared/agente/uso.ts'
import { costoJuez } from './calificacion'
import {
  agruparConversaciones,
  limitesDiaBogota,
  type Conversacion,
  type FilaChatwoot,
  type FilaWa,
  type TrazaLeida,
} from './conversaciones'
import { FALLAS, definicionFalla, type TipoFalla } from './fallas'
import { nombresDeTexto, nombresDeTraza, nombresVacios, seudonimizar } from './seudonimizar'

export const PARA_RESUMEN = 'mauricio.moreno@metrik.com.co'

export interface EscalamientoLeido {
  workspace_id: string
  rol_clave: string
  conversacion: string
  motivo: string
  modo: string
}

export interface CalificacionLeida {
  workspace_id: string
  rol_clave: string
  conversacion: string
  fallas: Array<{ tipo: string; turno: string | null; evidencia: string }>
  resuelta: boolean | null
  nota: number | null
  juez: string
}

export interface WorkspaceLeido {
  nombre: string
  conTexto: boolean
}

export interface PuertoResumen {
  filasDelDia(desde: string, hasta: string): Promise<{ wa: FilaWa[]; chatwoot: FilaChatwoot[] }>
  escalamientos(desde: string, hasta: string): Promise<EscalamientoLeido[]>
  calificaciones(fecha: string): Promise<CalificacionLeida[]>
  workspaces(ids: string[]): Promise<Map<string, WorkspaceLeido>>
  precios(): Promise<PrecioModelo[]>
}

// ── Las cifras ──────────────────────────────────────────────────────────────

export interface CasoFalla {
  conversacion: string
  turno: string | null
  evidencia: string
}

export interface ResumenRol {
  workspace_id: string
  rol: string
  conversaciones: number
  turnos: number
  registros: number
  no_pude: number
  candados: Map<string, number>
  notas_de_voz: number
  escalamientos: Map<string, number>
  /** Conversaciones con F9 sin escalamiento. */
  debidos: string[]
  calificadas: number
  /** Conversaciones del rol que debían calificarse (workspace con texto) y no tienen fila. */
  sin_calificar: number
  resueltas: number
  fallas: Map<TipoFalla, CasoFalla[]>
  costo_modelo_usd: number | null
  costo_juez_usd: number | null
  sin_precio: string[]
}

export interface ResumenDia {
  fecha: string
  workspaces: Array<{ workspace_id: string; nombre: string; conTexto: boolean; roles: ResumenRol[] }>
  conversaciones: number
  acciones: string[]
  sin_precio: string[]
}

function noPudo(t: TrazaLeida): boolean {
  return !!t.error || t.ejecucion?.resultado === 'error' || t.respuesta_fija === 'rf.modelo_caido'
}

function canalDeAlias(alias: string): string {
  return alias.startsWith('cw:') ? 'chatwoot_conversacion' : 'wa_conversacion'
}

/** Junta todo lo del día por workspace y rol. Pura. */
export function armarResumen(p: {
  fecha: string
  conversaciones: Conversacion[]
  escalamientos: EscalamientoLeido[]
  calificaciones: CalificacionLeida[]
  workspaces: Map<string, WorkspaceLeido>
  precios: PrecioModelo[]
}): ResumenDia {
  const roles = new Map<string, ResumenRol>()
  const tomar = (ws: string, rol: string) => {
    const k = `${ws}|${rol}`
    let r = roles.get(k)
    if (!r) {
      r = {
        workspace_id: ws, rol, conversaciones: 0, turnos: 0, registros: 0, no_pude: 0, candados: new Map(), notas_de_voz: 0,
        escalamientos: new Map(), debidos: [], calificadas: 0, sin_calificar: 0, resueltas: 0, fallas: new Map(),
        costo_modelo_usd: 0, costo_juez_usd: 0, sin_precio: [],
      }
      roles.set(k, r)
    }
    return r
  }
  const trazasPorRol = new Map<string, TrazaLeida[]>()
  for (const c of p.conversaciones) {
    const r = tomar(c.workspace_id, c.rol_clave)
    r.conversaciones++
    r.notas_de_voz += c.mensajes.filter((m) => m.direccion === 'entrante' && m.clase === 'audio').length
    for (const { traza } of c.turnos) {
      r.turnos++
      if (traza.ejecucion?.resultado === 'ejecutada') r.registros++
      if (noPudo(traza)) r.no_pude++
      for (const cd of Array.isArray(traza.candados) ? traza.candados : []) {
        const nombre = typeof cd?.candado === 'string' && cd.candado ? cd.candado : 'candado'
        r.candados.set(nombre, (r.candados.get(nombre) ?? 0) + 1)
      }
    }
    const k = `${c.workspace_id}|${c.rol_clave}`
    trazasPorRol.set(k, [...(trazasPorRol.get(k) ?? []), ...c.turnos.map((t) => t.traza)])
  }
  const escaladas = new Set(p.escalamientos.map((e) => `${e.workspace_id}|${e.conversacion}`))
  for (const e of p.escalamientos) {
    const r = tomar(e.workspace_id, e.rol_clave)
    r.escalamientos.set(e.modo, (r.escalamientos.get(e.modo) ?? 0) + 1)
  }
  const juecesPorRol = new Map<string, string[]>()
  const calificadas = new Set<string>()
  for (const c of p.calificaciones) {
    const r = tomar(c.workspace_id, c.rol_clave)
    calificadas.add(`${c.workspace_id}|${c.conversacion}`)
    r.calificadas++
    if (c.resuelta) r.resueltas++
    const k = `${c.workspace_id}|${c.rol_clave}`
    juecesPorRol.set(k, [...(juecesPorRol.get(k) ?? []), c.juez])
    const tipos = new Set<string>()
    for (const f of Array.isArray(c.fallas) ? c.fallas : []) {
      const d = definicionFalla(f?.tipo)
      if (!d) continue
      tipos.add(d.tipo)
      r.fallas.set(d.tipo, [...(r.fallas.get(d.tipo) ?? []), { conversacion: c.conversacion, turno: f.turno ?? null, evidencia: String(f.evidencia ?? '') }])
    }
    if (tipos.has('F9') && !escaladas.has(`${c.workspace_id}|${c.conversacion}`)) r.debidos.push(c.conversacion)
  }
  for (const c of p.conversaciones) {
    if (p.workspaces.get(c.workspace_id)?.conTexto && !calificadas.has(`${c.workspace_id}|${c.conversacion}`)) {
      tomar(c.workspace_id, c.rol_clave).sin_calificar++
    }
  }
  const sinPrecio = new Set<string>()
  for (const [k, r] of roles) {
    const uso = sumarUso((trazasPorRol.get(k) ?? []) as unknown as Parameters<typeof sumarUso>[0], p.precios)
    r.costo_modelo_usd = uso.costo_usd
    const juez = costoJuez(juecesPorRol.get(k) ?? [], p.precios)
    r.costo_juez_usd = juez.costo_usd
    r.sin_precio = [...new Set([...uso.sin_precio, ...juez.sin_precio])]
    r.sin_precio.forEach((m) => sinPrecio.add(m))
  }

  const porWs = new Map<string, ResumenRol[]>()
  for (const r of roles.values()) porWs.set(r.workspace_id, [...(porWs.get(r.workspace_id) ?? []), r])
  const workspaces = [...porWs].map(([id, rs]) => ({
    workspace_id: id,
    nombre: p.workspaces.get(id)?.nombre ?? id,
    conTexto: p.workspaces.get(id)?.conTexto ?? false,
    roles: rs.sort((a, b) => b.conversaciones - a.conversaciones || a.rol.localeCompare(b.rol)),
  })).sort((a, b) => a.nombre.localeCompare(b.nombre))

  const resumen: ResumenDia = { fecha: p.fecha, workspaces, conversaciones: p.conversaciones.length, acciones: [], sin_precio: [...sinPrecio].sort() }
  resumen.acciones = accionesDe(resumen)
  return resumen
}

// ── Lo que pide acción ──────────────────────────────────────────────────────

function dondeTraza(alias: string, turno: string | null): string {
  return turno ? `${canalDeAlias(alias)}.turno_id = ${turno}` : `conversación ${alias}`
}

/** Lo que va arriba del correo, en orden de gravedad. Pura. */
export function accionesDe(r: ResumenDia): string[] {
  const danino: string[] = []
  const resto: string[] = []
  for (const w of r.workspaces) {
    for (const rol of w.roles) {
      const quien = `${w.nombre} · ${rol.rol}`
      for (const f of FALLAS.filter((x) => x.danina)) {
        for (const c of rol.fallas.get(f.tipo) ?? []) {
          danino.push(`DAÑINA ${f.tipo} (${f.nombre}) en ${quien}: ${c.conversacion} — «${c.evidencia}» (${dondeTraza(c.conversacion, c.turno)})`)
        }
      }
      if (rol.debidos.length) resto.push(`${quien}: ${rol.debidos.length} conversación(es) debieron pasar a una persona y no pasaron (F9): ${rol.debidos.join(', ')}`)
      if (rol.no_pude) resto.push(`${quien}: ${rol.no_pude} turno(s) con «no pude» (error o modelo caído)`)
      if (rol.sin_calificar) {
        resto.push(rol.calificadas
          ? `${quien}: ${rol.sin_calificar} conversación(es) sin calificar (el juez falló o se acabó el tiempo; correr calificar-asistentes con ?forzar=1)`
          : `${quien}: la calificación no dejó ninguna fila (${rol.sin_calificar} conversación(es)): revisar el cron calificar-asistentes`)
      }
    }
  }
  if (r.sin_precio.length) resto.push(`Modelos sin precio en bot_modelo_precios (el costo queda incompleto): ${r.sin_precio.join(', ')}`)
  return [...danino, ...resto]
}

// ── La lección del día ──────────────────────────────────────────────────────

/** La falla más repetida del rol (a igual cuenta, primero las dañinas y luego por el orden de la lista). Pura. */
export function leccionDe(rol: ResumenRol, fecha: string): string[] | null {
  let mejor: { tipo: TipoFalla; casos: CasoFalla[] } | null = null
  for (const f of [...FALLAS].sort((a, b) => Number(b.danina) - Number(a.danina))) {
    const casos = rol.fallas.get(f.tipo) ?? []
    if (casos.length && (!mejor || casos.length > mejor.casos.length)) mejor = { tipo: f.tipo, casos }
  }
  if (!mejor) return null
  const d = definicionFalla(mejor.tipo)!
  const caso = mejor.casos.find((c) => c.turno && c.evidencia) ?? mejor.casos[0]
  return [
    `Lección del día: ${d.tipo} ${d.nombre} (${mejor.casos.length} vez/veces).`,
    `  Caso: ${caso.conversacion} — «${caso.evidencia}» (${dondeTraza(caso.conversacion, caso.turno)})`,
    `  Caso propuesto para el arnés de ${rol.rol}: «${rol.rol}-${d.tipo.toLowerCase()}-${fecha}». Reactuar la conversación ${caso.conversacion}` +
      `${caso.turno ? ` hasta el turno ${caso.turno}` : ''}, seudonimizada y con los datos cambiados. Esperado: ${d.esperado}`,
  ]
}

// ── El correo ───────────────────────────────────────────────────────────────

function usd(v: number | null): string {
  return v == null ? 'sin precio' : `USD ${v.toFixed(v < 1 ? 4 : 2)}`
}

function lista(m: Map<string, number>): string {
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')
}

/** El texto del correo. Pura. */
export function textoResumen(r: ResumenDia): { asunto: string; texto: string } {
  if (!r.conversaciones && !r.workspaces.length) {
    return {
      asunto: `Asistentes · ${r.fecha} · sin actividad`,
      texto: [
        `Resumen de los asistentes del ${r.fecha} (día de Bogotá).`,
        '',
        'Sin actividad: ningún asistente tuvo conversaciones ayer.',
        '',
        'Este correo sale todos los días aunque no haya nada: si un día no llega, se cayó el cron resumen-asistentes.',
      ].join('\n'),
    }
  }
  const l: string[] = [`Resumen de los asistentes del ${r.fecha} (día de Bogotá): ${r.conversaciones} conversación(es).`, '']
  l.push('PIDE ACCIÓN')
  l.push(...(r.acciones.length ? r.acciones.map((a) => `- ${a}`) : ['- Nada pide acción hoy.']))
  for (const w of r.workspaces) {
    l.push('', `== ${w.nombre}${w.conTexto ? '' : ' (solo métricas de trazas: sin calificación con texto)'} ==`)
    for (const rol of w.roles) {
      const escal = lista(rol.escalamientos)
      const fallas = FALLAS.filter((f) => rol.fallas.get(f.tipo)?.length).map((f) => `${f.tipo} ${rol.fallas.get(f.tipo)!.length}`).join(', ')
      l.push(
        '',
        `-- Rol ${rol.rol} --`,
        `Conversaciones: ${rol.conversaciones} (${rol.turnos} turnos)`,
        `Registros confirmados: ${rol.registros}`,
        `Bloqueos: «no pude» ${rol.no_pude}; candados ${rol.candados.size ? lista(rol.candados) : '0'}`,
        `Escalamientos hechos: ${escal || '0'}; debidos según el calificador: ${rol.debidos.length}`,
      )
      if (w.conTexto) {
        l.push(
          `Calificadas: ${rol.calificadas}${rol.sin_calificar ? ` (${rol.sin_calificar} sin calificar)` : ''}; resueltas: ${rol.resueltas}`,
          `Fallas por tipo: ${fallas || 'ninguna'}`,
        )
      }
      l.push(
        `Costo del día: modelo ${usd(rol.costo_modelo_usd)}; juez ${rol.calificadas ? usd(rol.costo_juez_usd) : 'USD 0'}; transcripción sin medir (${rol.notas_de_voz} nota(s) de voz)`,
      )
      const leccion = leccionDe(rol, r.fecha)
      if (leccion) l.push(...leccion)
    }
  }
  l.push('', 'La traza de un caso se busca por su turno_id en la tabla indicada; las conversaciones van por alias, nunca por teléfono.')
  const n = r.acciones.length
  return {
    asunto: `Asistentes · ${r.fecha} · ${r.conversaciones} conversación(es)${n ? ` · ${n} por revisar` : ''}`,
    texto: l.join('\n'),
  }
}

function escaparHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function htmlResumen(texto: string): string {
  return `<!doctype html><html><body style="font-family:Montserrat,Arial,sans-serif;color:#1A1A1A">` +
    `<pre style="white-space:pre-wrap;font-family:inherit;font-size:14px;line-height:1.5">${escaparHtml(texto)}</pre></body></html>`
}

// ── La corrida ──────────────────────────────────────────────────────────────

export interface CorreoResumen {
  to: string
  subject: string
  html: string
  text: string
  idempotencyKey: string
}

export type EnvioResumen = (m: CorreoResumen) => Promise<{ ok: true } | { ok: false; error: string }>

/** La llave de idempotencia del día: un reintento del cron manda la MISMA y Resend no repite el correo. Pura. */
export function llaveResumen(fecha: string): string {
  return `resumen-asistentes:${fecha}`
}

export async function enviarResumenDia(
  fecha: string,
  d: { puerto: PuertoResumen; enviar: EnvioResumen },
): Promise<{ ok: boolean; fecha: string; conversaciones: number; acciones: number; error?: string }> {
  const { desde, hasta } = limitesDiaBogota(fecha)
  const [filas, escalamientos, calificaciones, precios] = await Promise.all([
    d.puerto.filasDelDia(desde, hasta),
    d.puerto.escalamientos(desde, hasta),
    d.puerto.calificaciones(fecha),
    d.puerto.precios(),
  ])
  const conversaciones = await agruparConversaciones(filas.wa, filas.chatwoot)
  const ids = [...new Set([...conversaciones, ...escalamientos, ...calificaciones].map((x) => x.workspace_id))]
  const workspaces = ids.length ? await d.puerto.workspaces(ids) : new Map<string, WorkspaceLeido>()
  const resumen = armarResumen({ fecha, conversaciones, escalamientos, calificaciones, workspaces, precios })
  const { asunto, texto } = textoResumen(resumen)

  // Última guarda: los nombres de clientes que traen las trazas y las presentaciones del día no salen en el correo.
  const nombres = nombresVacios()
  for (const c of conversaciones) {
    for (const t of c.turnos) nombresDeTraza(t.traza, nombres)
    for (const m of c.mensajes) if (m.direccion === 'entrante') nombresDeTexto(m.texto, nombres)
  }
  // Solo los de persona: los genéricos (`nombre`, `empresa`) pueden ser el del propio workspace o una experiencia.
  const limpio = seudonimizar(texto, { personas: nombres.personas, completos: new Set() }, { etiqueta: '[cliente]', soloNombres: true })

  const res = await d.enviar({
    to: PARA_RESUMEN,
    subject: asunto,
    html: htmlResumen(limpio),
    text: limpio,
    idempotencyKey: llaveResumen(fecha),
  })
  return {
    ok: res.ok,
    fecha,
    conversaciones: resumen.conversaciones,
    acciones: resumen.acciones.length,
    ...(res.ok ? {} : { error: res.error }),
  }
}
