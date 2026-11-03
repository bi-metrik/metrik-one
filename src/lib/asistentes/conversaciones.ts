/**
 * Las conversaciones de los asistentes en un día de Bogotá, leídas de `wa_conversacion` (ONE y la bandeja) y de
 * `chatwoot_conversacion` (público), agrupadas por conversación. Lo usan la calificación (§4.4) y el resumen (§4.3).
 *
 * La conversación se nombra por ALIAS, nunca por el teléfono, y es el mismo alias que usan el correo de caída (§4.1,
 * `caida.ts`) y `asistente_escalamientos` (#1287): en WhatsApp `wa-` + 10 hex del sha-256 de `workspace:teléfono`; en
 * Chatwoot `cw:<cuenta>:<conversación>`. Así los tres se cruzan sin que el teléfono salga de la tabla.
 *
 * El rol del turno: `traza.rol.clave` cuando lo trae (lo agrega el componedor, #1285) y, si no, `traza.bot`.
 */
const DIA_MS = 24 * 3600 * 1000
const BOGOTA_MS = 5 * 3600 * 1000

/** El día de Bogotá anterior a `ahora` («2026-10-25»). Colombia no tiene horario de verano. Pura. */
export function fechaAyerBogota(ahora: Date): string {
  return new Date(ahora.getTime() - BOGOTA_MS - DIA_MS).toISOString().slice(0, 10)
}

/** [desde, hasta) en UTC del día de Bogotá `fecha`. Pura. */
export function limitesDiaBogota(fecha: string): { desde: string; hasta: string } {
  const inicio = Date.parse(`${fecha}T00:00:00.000Z`) + BOGOTA_MS
  return { desde: new Date(inicio).toISOString(), hasta: new Date(inicio + DIA_MS).toISOString() }
}

/**
 * El alias de una conversación de WhatsApp: «wa-» + 10 hex del sha-256 de `workspace:teléfono` (solo dígitos). Es
 * copia de `aliasConversacionWa` (`_shared/agente/caida.ts`), que no se importa porque arrastra al chequeo de tipos de
 * Next un módulo del edge que usa `Deno`. La prueba `_shared/agente/alias-paridad.test.ts` exige que den lo mismo.
 */
export async function aliasWa(workspaceId: string, phone: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${workspaceId}:${phone.replace(/\D/g, '')}`)))
  return `wa-${[...h.slice(0, 5)].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** La hora de Bogotá («2026-10-26 14:05»). Pura. */
export function horaBogota(ms: number): string {
  return new Date(ms - BOGOTA_MS).toISOString().slice(0, 16).replace('T', ' ')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TrazaLeida = Record<string, any>

/** Una fila de `wa_conversacion` como se lee (solo las columnas que se usan). */
export interface FilaWa {
  workspace_id: string
  phone: string
  direccion: string
  clase: string
  texto: string | null
  opciones: Array<{ id?: string; titulo?: string }> | null
  toque_id: string | null
  turno_id: string | null
  traza: TrazaLeida | null
  created_at: string
}

/** Una fila de `chatwoot_conversacion` como se lee. */
export interface FilaChatwoot {
  workspace_id: string
  cuenta_id: number
  conversacion_id: number
  direccion: string
  clase: string
  texto: string | null
  enmascarado: boolean | null
  opciones: Array<{ id?: string; titulo?: string }> | null
  toque_id: string | null
  turno_id: string | null
  estado: string | null
  traza: TrazaLeida | null
  created_at: string
}

export const COLUMNAS_WA = 'workspace_id, phone, direccion, clase, texto, opciones, toque_id, turno_id, traza, created_at'
export const COLUMNAS_CHATWOOT =
  'workspace_id, cuenta_id, conversacion_id, direccion, clase, texto, enmascarado, opciones, toque_id, turno_id, estado, traza, created_at'

export type CanalConversacion = 'wa' | 'chatwoot'

export interface Mensaje {
  direccion: 'entrante' | 'saliente'
  clase: string
  texto: string | null
  opciones: string[]
  turno_id: string | null
  created_at: string
}

export interface Conversacion {
  workspace_id: string
  canal: CanalConversacion
  /** El alias (nunca el teléfono). */
  conversacion: string
  rol_clave: string
  mensajes: Mensaje[]
  /** Las trazas de los turnos, en orden, con su turno. */
  turnos: Array<{ turno_id: string | null; traza: TrazaLeida; created_at: string }>
}

/** La clave del rol de una traza: `rol.clave` (#1285) o, mientras no esté, `bot`. Pura. */
export function rolDeTraza(t: TrazaLeida | null | undefined): string | null {
  const clave = t?.rol?.clave
  if (typeof clave === 'string' && clave) return clave
  return typeof t?.bot === 'string' && t.bot ? t.bot : null
}

function titulos(o: FilaWa['opciones']): string[] {
  return Array.isArray(o) ? o.map((x) => (typeof x?.titulo === 'string' ? x.titulo : '')).filter(Boolean) : []
}

/**
 * Agrupa las filas del día por conversación. Solo entran las conversaciones con al menos un turno del asistente (una
 * traza): lo que nadie atendió no es una conversación del asistente. El rol es el del ÚLTIMO turno. Las filas de cada
 * conversación quedan en orden de creación. Los salientes de Chatwoot que no se publicaron no cuentan como mensajes
 * (la persona no los vio), pero su traza sí.
 */
export async function agruparConversaciones(wa: FilaWa[], chatwoot: FilaChatwoot[]): Promise<Conversacion[]> {
  const grupos = new Map<string, Conversacion>()
  const tomar = (workspace_id: string, canal: CanalConversacion, alias: string) => {
    const llave = `${workspace_id}|${alias}`
    let g = grupos.get(llave)
    if (!g) {
      g = { workspace_id, canal, conversacion: alias, rol_clave: '', mensajes: [], turnos: [] }
      grupos.set(llave, g)
    }
    return g
  }
  const alias = new Map<string, string>()
  for (const f of wa) {
    const k = `${f.workspace_id}|${f.phone}`
    let a = alias.get(k)
    if (!a) {
      a = await aliasWa(f.workspace_id, f.phone)
      alias.set(k, a)
    }
    const g = tomar(f.workspace_id, 'wa', a)
    g.mensajes.push({
      direccion: f.direccion === 'saliente' ? 'saliente' : 'entrante',
      clase: f.clase,
      texto: f.texto,
      opciones: titulos(f.opciones),
      turno_id: f.turno_id,
      created_at: f.created_at,
    })
    if (f.traza) g.turnos.push({ turno_id: f.turno_id, traza: f.traza, created_at: f.created_at })
  }
  for (const f of chatwoot) {
    const g = tomar(f.workspace_id, 'chatwoot', `cw:${f.cuenta_id}:${f.conversacion_id}`)
    const visto = f.direccion === 'entrante' || f.estado === 'publicado'
    if (visto && f.clase !== 'nota') {
      g.mensajes.push({
        direccion: f.direccion === 'saliente' ? 'saliente' : 'entrante',
        clase: f.clase,
        texto: f.enmascarado ? '[dato de salud enmascarado]' : f.texto,
        opciones: titulos(f.opciones),
        turno_id: f.turno_id,
        created_at: f.created_at,
      })
    }
    if (f.traza) g.turnos.push({ turno_id: f.turno_id, traza: f.traza, created_at: f.created_at })
  }
  const salida: Conversacion[] = []
  for (const g of grupos.values()) {
    if (!g.turnos.length) continue
    g.mensajes.sort((a, b) => a.created_at.localeCompare(b.created_at))
    g.turnos.sort((a, b) => a.created_at.localeCompare(b.created_at))
    g.rol_clave = [...g.turnos].reverse().map((t) => rolDeTraza(t.traza)).find(Boolean) ?? 'sin_rol'
    salida.push(g)
  }
  return salida.sort((a, b) => (a.workspace_id + a.conversacion).localeCompare(b.workspace_id + b.conversacion))
}

/**
 * Lee todas las filas de una tabla en el día, por páginas de 1.000 (el tope de PostgREST). Nunca devuelve una lectura
 * a medias: si una página falla, lanza.
 */
export async function leerPaginado<T>(
  pagina: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const todas: T[] = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await pagina(i, i + 999)
    if (error) throw new Error(error.message)
    todas.push(...(data ?? []))
    if (!data || data.length < 1000) return todas
  }
}
