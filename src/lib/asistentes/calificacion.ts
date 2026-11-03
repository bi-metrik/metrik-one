/**
 * Calificación diaria de las conversaciones de los asistentes (spec 2026-10-26, §4.4).
 *
 * Cada mañana (cron `calificar-asistentes`, 6:30 de Bogotá) un juez lee cada conversación del día anterior y la marca
 * contra la lista FIJA de fallas (`fallas.ts`). Guarda una fila por conversación y día en `asistente_calificaciones`
 * (llave única `workspace_id, fecha, conversacion`), con las fallas (turno y evidencia corta), si se resolvió, una nota
 * de 1 a 5 y `juez` = el modelo que respondió, la versión de la lista y los tokens que gastó.
 *
 * QUIÉN ENTRA CON TEXTO. Solo los workspaces que lo autorizaron por contrato (Sabor, cláusulas 3.6 y 5.6), con el
 * interruptor `config_extra.bot_conversacional.calificacion.con_texto = true`, apagado por defecto. Sin él no se arma
 * el texto, no se llama al juez y no se escribe fila: el workspace aparece en el resumen solo con las métricas de sus
 * trazas. Por qué ahí y no en `asistente_funciones_empresa`: es un permiso del contrato sobre los datos del cliente,
 * no una capacidad del asistente; una función prendida viajaría al componedor y al modelo, y el catálogo de funciones
 * solo admite `equipo.*`, `recolector.*` y `clientes.*`.
 *
 * QUÉ RECIBE EL JUEZ. Una sola conversación de un solo workspace por llamado: sus mensajes, las trazas de sus turnos
 * (herramientas, propuestas, ejecuciones, candados) y la ficha del rol publicada. Todo el texto pasa por
 * `seudonimizar` antes de salir: sin teléfonos, sin correos y con los nombres de los clientes finales en alias. La
 * conversación se nombra por su alias (nunca el teléfono) y los turnos por T1, T2…: el juez nunca ve un id.
 *
 * EL COSTO. Los tokens quedan en `juez` («claude-haiku-5-5 · fallas-v1 · tokens 1200/180») porque la tabla no tiene
 * columna de uso y esta pieza no lleva migración; el resumen los lee con `leerJuez` y los cobra con
 * `bot_modelo_precios`. Ningún precio está escrito aquí.
 *
 * Un reintento del cron no duplica ni vuelve a pagar: las conversaciones ya calificadas del día se saltan, y si dos
 * corridas se cruzan la llave única deja una sola fila.
 */
import { sumarUso, type PrecioModelo } from '../../../supabase/functions/_shared/agente/uso.ts'
import { FALLAS, VERSION_FALLAS, esTipoFalla, type TipoFalla } from './fallas'
import {
  agruparConversaciones,
  horaBogota,
  limitesDiaBogota,
  type Conversacion,
  type FilaChatwoot,
  type FilaWa,
  type TrazaLeida,
} from './conversaciones'
import { nombresDeTexto, nombresDeTraza, nombresVacios, seudonimizar, type Nombres } from './seudonimizar'

// ── El interruptor ──────────────────────────────────────────────────────────

/** ¿El workspace autorizó que el texto de sus conversaciones vaya al juez? Apagado por defecto. Pura. */
export function calificaConTexto(configExtra: unknown): boolean {
  const c = configExtra as { bot_conversacional?: { calificacion?: { con_texto?: unknown } } } | null | undefined
  return c?.bot_conversacional?.calificacion?.con_texto === true
}

// ── El juez ─────────────────────────────────────────────────────────────────

export interface FichaLeida {
  clave?: string
  tipo?: string
  cuando?: string | null
  hacer?: string
}

export type RespuestaJuez =
  | { ok: true; texto: string; modelo: string; entrada: number; salida: number }
  | { ok: false; error: string }

export type Juez = (p: { sistema: string; usuario: string }) => Promise<RespuestaJuez>

export interface FallaCalificada {
  tipo: TipoFalla
  /** El `turno_id` del turno (o null si el juez no lo ubicó). */
  turno: string | null
  evidencia: string
}

export interface FilaCalificacion {
  workspace_id: string
  rol_clave: string
  fecha: string
  conversacion: string
  fallas: FallaCalificada[]
  resuelta: boolean | null
  nota: number | null
  juez: string
}

/** El texto de la columna `juez`: modelo, versión de la lista y tokens. Pura. */
export function textoJuez(modelo: string, entrada: number, salida: number): string {
  return `${modelo} · ${VERSION_FALLAS} · tokens ${Math.max(0, Math.round(entrada))}/${Math.max(0, Math.round(salida))}`
}

/** Lee la columna `juez`. Una calificación sin tokens (vieja o escrita a mano) da 0/0. Pura. */
export function leerJuez(juez: string): { modelo: string; version: string | null; entrada: number; salida: number } {
  const partes = juez.split(' · ')
  const tokens = juez.match(/tokens (\d+)\/(\d+)/)
  return {
    modelo: partes[0]?.trim() || juez,
    version: partes[1]?.trim() || null,
    entrada: tokens ? Number(tokens[1]) : 0,
    salida: tokens ? Number(tokens[2]) : 0,
  }
}

/** Lo que cuesta el juez con los precios de `bot_modelo_precios` (null si el modelo no tiene precio). Pura. */
export function costoJuez(jueces: string[], precios: PrecioModelo[]): { costo_usd: number | null; sin_precio: string[] } {
  const trazas = jueces.map((j) => {
    const u = leerJuez(j)
    return { tipo: 'modelo' as const, bot: 'juez', uso: [{ modelo: u.modelo, entrada: u.entrada, salida: u.salida, razonamiento: 0, cache: 0, ms: 0, ok: true }] }
  })
  const u = sumarUso(trazas, precios)
  return { costo_usd: u.costo_usd, sin_precio: u.sin_precio }
}

export const SISTEMA_JUEZ = [
  'Eres el calificador de calidad de un asistente conversacional de MéTRIK. Lees UNA conversación de un día y la',
  'marcas contra una lista FIJA de fallas. No inventes tipos fuera de la lista. Marca una falla solo si la conversación',
  'o las trazas la muestran; ante la duda, no la marques.',
  '',
  'La lista de fallas:',
  ...FALLAS.map((f) => `- ${f.tipo} (${f.nombre}): ${f.cuando}`),
  '',
  'Cómo leer lo que recibes:',
  '- «Ficha del rol»: lo que el asistente puede y debe hacer. Úsala para decidir si un «no puedo» era falso o si se salió de tema.',
  '- «Conversación»: cada línea trae el turno (T1, T2…) y quién habla. Los nombres de clientes vienen como «Persona N»',
  '  y los números largos como [número]: es a propósito, no es una falla.',
  '- «Trazas»: lo que hizo el asistente en cada turno (herramientas, propuestas, ejecuciones, candados que atajaron algo).',
  '  Un candado que atajó algo NO es una falla dañina: la evitó.',
  '',
  'Devuelve solo el JSON pedido:',
  '- fallas: una entrada por falla, con su tipo, el turno donde ocurre (T1, T2…) y una evidencia de máximo 160 caracteres',
  '  citada de la conversación o de la traza, con los alias tal como vienen.',
  '- resuelta: true si la persona obtuvo lo que pedía (o fue pasada a una persona cuando correspondía); false si no.',
  '- nota: de 1 a 5. 5 = sin fallas y resuelta; 1 = no resuelta y con una falla dañina (D1-D3) o varias graves.',
].join('\n')

export const ESQUEMA_JUEZ = {
  type: 'OBJECT',
  properties: {
    fallas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          tipo: { type: 'STRING', enum: FALLAS.map((f) => f.tipo) },
          turno: { type: 'STRING' },
          evidencia: { type: 'STRING' },
        },
        required: ['tipo', 'turno', 'evidencia'],
      },
    },
    resuelta: { type: 'BOOLEAN' },
    nota: { type: 'INTEGER' },
  },
  required: ['fallas', 'resuelta', 'nota'],
}

// ── El texto para el juez ───────────────────────────────────────────────────

const TOPE_LINEA = 600
const TOPE_FICHA = 8000
const TOPE_CONVERSACION = 40000

function corto(s: unknown, tope = TOPE_LINEA): string {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : ''
  return t.length > tope ? `${t.slice(0, tope - 1)}…` : t
}

function quienHabla(c: Conversacion, direccion: string): string {
  if (direccion === 'saliente') return 'Asistente'
  return c.canal === 'chatwoot' ? 'Cliente' : 'Persona del equipo'
}

const CLASE: Record<string, string> = {
  toque: 'tocó un botón',
  audio: 'nota de voz, transcrita',
  imagen: 'imagen',
  reenvio: 'reenvió',
  ubicacion: 'ubicación',
  otro: 'adjunto',
}

/** Las etiquetas T1, T2… de los turnos, en orden. Pura. */
export function etiquetasDeTurnos(c: Conversacion): Map<string, string> {
  const m = new Map<string, string>()
  for (const t of c.turnos) if (t.turno_id && !m.has(t.turno_id)) m.set(t.turno_id, `T${m.size + 1}`)
  for (const x of c.mensajes) if (x.turno_id && !m.has(x.turno_id)) m.set(x.turno_id, `T${m.size + 1}`)
  return m
}

/** Una línea por turno con lo que hizo el asistente. Solo nombres de herramientas y resultados, nunca sus datos. */
export function lineaDeTraza(etiqueta: string, t: TrazaLeida): string {
  const partes: string[] = [`${etiqueta} [${corto(t.tipo, 40) || '?'}]`]
  if (t.tema) partes.push(`tema: ${corto(t.tema, 60)}`)
  const herramientas = Array.isArray(t.herramientas) ? t.herramientas : []
  if (herramientas.length) {
    partes.push(`herramientas: ${herramientas.map((h: TrazaLeida) => `${corto(h?.nombre, 60)}(${h?.ok ? 'ok' : `error: ${corto(h?.error, 160)}`})`).join(', ')}`)
  }
  if (t.propuesta) partes.push(`propuesta: ${corto(t.propuesta.accion, 60)} «${corto(t.propuesta.resumen, 300)}»`)
  if (t.ejecucion) partes.push(`ejecución: ${corto(t.ejecucion.accion, 60) || 'acción'} → ${corto(t.ejecucion.resultado, 30)}`)
  if (t.tras_toque) partes.push(`tras toque: ${corto(t.tras_toque.resultado, 30)}`)
  const candados = Array.isArray(t.candados) ? t.candados : []
  if (candados.length) partes.push(`candados que atajaron: ${candados.map((c: TrazaLeida) => `${corto(c?.candado, 60)} (${corto(c?.detalle, 160)})`).join('; ')}`)
  const verificador = Array.isArray(t.verificador) ? t.verificador : []
  if (verificador.length) partes.push(`verificador: ${verificador.map((v: TrazaLeida) => corto(v?.motivo, 80)).join('; ')}`)
  if (t.respuesta_fija) partes.push(`respuesta fija: ${corto(t.respuesta_fija, 60)}`)
  if (t.persona) partes.push(`paso a persona: ${corto(t.persona.motivo, 40)}`)
  if (t.error) partes.push(`error: ${corto(t.error, 200)}`)
  return partes.join(' · ')
}

/** Los nombres de clientes de la conversación: los de sus trazas y los que alguien dijo de sí mismo. Pura. */
export function nombresDeConversacion(c: Conversacion): Nombres {
  const n = nombresVacios()
  for (const t of c.turnos) nombresDeTraza(t.traza, n)
  for (const m of c.mensajes) if (m.direccion === 'entrante') nombresDeTexto(m.texto, n)
  return n
}

/**
 * Lo que se le manda al juez, ya seudonimizado. `fichas` es la ficha del rol publicada (puede venir vacía). Pura.
 */
export function textoParaJuez(c: Conversacion, fichas: FichaLeida[]): { usuario: string; etiquetas: Map<string, string>; nombres: Nombres } {
  const etiquetas = etiquetasDeTurnos(c)
  const ficha = fichas
    .filter((f) => f && typeof f.hacer === 'string' && f.tipo !== 'glosario')
    .map((f) => `- ${corto(f.clave, 80)}${f.cuando ? ` (cuando: ${corto(f.cuando, 200)})` : ''}: ${corto(f.hacer, 400)}`)
    .join('\n')
  let conversacion = c.mensajes
    .map((m) => {
      const turno = (m.turno_id && etiquetas.get(m.turno_id)) || '—'
      const hora = horaBogota(Date.parse(m.created_at)).slice(11)
      const clase = m.direccion === 'entrante' && CLASE[m.clase] ? ` (${CLASE[m.clase]})` : ''
      const botones = m.opciones.length ? ` [botones: ${m.opciones.map((o) => corto(o, 40)).join(' | ')}]` : ''
      return `[${turno} ${hora}] ${quienHabla(c, m.direccion)}${clase}: ${corto(m.texto) || '(sin texto)'}${botones}`
    })
    .join('\n')
  if (conversacion.length > TOPE_CONVERSACION) conversacion = `(…recortada al final…)\n${conversacion.slice(-TOPE_CONVERSACION)}`
  const trazas = c.turnos.map((t, i) => lineaDeTraza((t.turno_id && etiquetas.get(t.turno_id)) || `T?${i + 1}`, t.traza)).join('\n')
  const crudo = [
    `Rol: ${c.rol_clave}. Canal: ${c.canal === 'chatwoot' ? 'clientes por Chatwoot' : 'WhatsApp'}.`,
    '',
    '## Ficha del rol',
    (ficha.length > TOPE_FICHA ? `${ficha.slice(0, TOPE_FICHA)}…` : ficha) || '(sin ficha publicada)',
    '',
    '## Conversación',
    conversacion || '(sin mensajes visibles)',
    '',
    '## Trazas',
    trazas,
  ].join('\n')
  const nombres = nombresDeConversacion(c)
  return { usuario: seudonimizar(crudo, nombres), etiquetas, nombres }
}

/** Lee la respuesta del juez. Lo que esté fuera de la lista o mal formado se descarta. Pura. */
export function leerVeredicto(
  texto: string,
  etiquetas: Map<string, string>,
  nombres: Nombres,
): { fallas: FallaCalificada[]; resuelta: boolean | null; nota: number | null } | null {
  let v: unknown
  try {
    v = JSON.parse(texto.trim().replace(/^```[a-z]*\s*|\s*```$/g, ''))
  } catch {
    return null
  }
  if (!v || typeof v !== 'object') return null
  const o = v as { fallas?: unknown; resuelta?: unknown; nota?: unknown }
  const porEtiqueta = new Map([...etiquetas].map(([id, e]) => [e, id]))
  const fallas: FallaCalificada[] = []
  for (const f of Array.isArray(o.fallas) ? o.fallas : []) {
    const x = f as { tipo?: unknown; turno?: unknown; evidencia?: unknown }
    if (!esTipoFalla(x?.tipo)) continue
    const etiqueta = typeof x.turno === 'string' ? x.turno.trim().toUpperCase() : ''
    fallas.push({
      tipo: x.tipo,
      turno: porEtiqueta.get(etiqueta) ?? null,
      evidencia: corto(seudonimizar(typeof x.evidencia === 'string' ? x.evidencia : '', nombres), 200),
    })
  }
  const nota = typeof o.nota === 'number' && Number.isFinite(o.nota) ? Math.min(5, Math.max(1, Math.round(o.nota))) : null
  return { fallas, resuelta: typeof o.resuelta === 'boolean' ? o.resuelta : null, nota }
}

// ── La corrida del día ──────────────────────────────────────────────────────

export interface PuertoCalificacion {
  filasDelDia(desde: string, hasta: string): Promise<{ wa: FilaWa[]; chatwoot: FilaChatwoot[] }>
  /** De los workspaces dados, los que tienen el interruptor prendido. */
  conTexto(workspaceIds: string[]): Promise<Set<string>>
  /** Las fichas de las versiones publicadas, por id de `bot_reglamentos`, de ESE workspace. */
  fichas(workspaceId: string, reglamentoIds: string[]): Promise<Map<string, FichaLeida[]>>
  /** Las conversaciones ya calificadas en la fecha: `workspace|conversacion`. */
  yaCalificadas(fecha: string): Promise<Set<string>>
  guardar(fila: FilaCalificacion): Promise<'guardada' | 'duplicada'>
  precios(): Promise<PrecioModelo[]>
}

export interface ResultadoCalificacion {
  ok: boolean
  fecha: string
  conversaciones: number
  /** Conversaciones de workspaces sin el interruptor: solo métricas, sin juez. */
  solo_metricas: number
  calificadas: number
  ya_estaban: number
  duplicadas: number
  fallidas: number
  /** Se acabó el tiempo de la corrida antes de llegar a estas (las toma un `?forzar=1`). */
  pendientes: number
  costo_juez_usd: number | null
  sin_precio: string[]
  errores: string[]
}

/** El reglamento del rol que atendió la conversación: el de su último turno que lo diga. Pura. */
export function reglamentoDe(c: Conversacion): string | null {
  for (const t of [...c.turnos].reverse()) {
    const id = t.traza?.rol?.reglamento_id ?? t.traza?.reglamento?.id
    if (typeof id === 'string' && id) return id
  }
  return null
}

export async function calificarDia(
  fecha: string,
  d: { puerto: PuertoCalificacion; juez: Juez; reloj?: () => number },
  o: { limiteMs?: number; concurrencia?: number } = {},
): Promise<ResultadoCalificacion> {
  const reloj = d.reloj ?? Date.now
  const inicio = reloj()
  const limiteMs = o.limiteMs ?? 240_000
  const r: ResultadoCalificacion = {
    ok: true, fecha, conversaciones: 0, solo_metricas: 0, calificadas: 0, ya_estaban: 0, duplicadas: 0, fallidas: 0,
    pendientes: 0, costo_juez_usd: 0, sin_precio: [], errores: [],
  }
  const { desde, hasta } = limitesDiaBogota(fecha)
  const filas = await d.puerto.filasDelDia(desde, hasta)
  const conversaciones = await agruparConversaciones(filas.wa, filas.chatwoot)
  r.conversaciones = conversaciones.length
  if (!conversaciones.length) return r

  const conTexto = await d.puerto.conTexto([...new Set(conversaciones.map((c) => c.workspace_id))])
  const aCalificar = conversaciones.filter((c) => conTexto.has(c.workspace_id))
  r.solo_metricas = conversaciones.length - aCalificar.length
  if (!aCalificar.length) return r

  const hechas = await d.puerto.yaCalificadas(fecha)
  const cola = aCalificar.filter((c) => {
    if (!hechas.has(`${c.workspace_id}|${c.conversacion}`)) return true
    r.ya_estaban++
    return false
  })

  const fichasPorWs = new Map<string, Map<string, FichaLeida[]>>()
  for (const ws of new Set(cola.map((c) => c.workspace_id))) {
    const ids = [...new Set(cola.filter((c) => c.workspace_id === ws).map(reglamentoDe).filter((x): x is string => !!x))]
    fichasPorWs.set(ws, ids.length ? await d.puerto.fichas(ws, ids) : new Map())
  }

  const jueces: string[] = []
  const una = async (c: Conversacion) => {
    const reglamento = reglamentoDe(c)
    const fichas = (reglamento && fichasPorWs.get(c.workspace_id)?.get(reglamento)) || []
    const { usuario, etiquetas, nombres } = textoParaJuez(c, fichas)
    const res = await d.juez({ sistema: SISTEMA_JUEZ, usuario })
    if (!res.ok) {
      r.fallidas++
      r.errores.push(`${c.conversacion}: ${res.error.slice(0, 160)}`)
      return
    }
    const juez = textoJuez(res.modelo, res.entrada, res.salida)
    jueces.push(juez)
    const v = leerVeredicto(res.texto, etiquetas, nombres)
    if (!v) {
      r.fallidas++
      r.errores.push(`${c.conversacion}: el juez no devolvió JSON válido`)
      return
    }
    const estado = await d.puerto.guardar({
      workspace_id: c.workspace_id, rol_clave: c.rol_clave, fecha, conversacion: c.conversacion, ...v, juez,
    })
    if (estado === 'duplicada') r.duplicadas++
    else r.calificadas++
  }

  let i = 0
  const trabajador = async () => {
    while (i < cola.length) {
      if (reloj() - inicio > limiteMs) return
      const c = cola[i++]
      try {
        await una(c)
      } catch (e) {
        r.fallidas++
        r.errores.push(`${c.conversacion}: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, o.concurrencia ?? 4) }, trabajador))
  r.pendientes = cola.length - i

  if (jueces.length) {
    const costo = costoJuez(jueces, await d.puerto.precios())
    r.costo_juez_usd = costo.costo_usd
    r.sin_precio = costo.sin_precio
  }
  r.ok = r.fallidas === 0 && r.pendientes === 0
  return r
}
