import 'server-only'
import { after } from 'next/server'
import { createHash } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { buscarIdDeAuthPorCorreo } from '@/lib/espacio-pruebas/auth'
import type { CorreoSaliente, ResultadoEnvio } from '@/lib/cobros/enlace-automatico-servidor'
import { correoBienvenidaValida, correoRecuperarEspacio } from './textos'
import { urlDelEspacio, urlLoginGeneral } from './direcciones'

/**
 * Volver a entrar al espacio: el correo con la dirección de los espacios de una persona (quien la
 * olvidó, desde `metrikone.co/login`) y el correo de bienvenida del alta autogestionada de Valida.
 * Los textos están en `textos.ts`.
 *
 * Ninguna de las dos cosas puede tumbar lo que la persona estaba haciendo: nada de aquí lanza. Un
 * envío fallido queda en el log con `[acceso-espacio]` y sigue.
 */

const FROM = 'MéTRIK ONE <noreply@metrikone.co>'

/** Ventana de la llave de idempotencia del correo con la dirección: un mensaje por correo y ventana. */
export const VENTANA_RECUPERAR_MS = 10 * 60_000

/** Más espacios que esto en un correo no ayuda a nadie; en la práctica son uno o dos. */
const MAX_ESPACIOS = 10

async function enviarPorResend(m: CorreoSaliente): Promise<ResultadoEnvio> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, error: 'sin_resend_api_key' }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': m.idempotencyKey },
    body: JSON.stringify({ from: FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
  })
  if (!res.ok) return { ok: false, error: `resend_${res.status}` }
  const body = (await res.json().catch(() => ({}))) as { id?: string }
  return { ok: true, id: body.id ?? null }
}

/**
 * Corre `tarea` después de responder (`after()` de Next). Fuera de un request (pruebas, scripts)
 * `after()` lanza: ahí se corre en línea y se espera. La tarea nunca rechaza: su error va al log.
 */
export function enSegundoPlano(etiqueta: string, tarea: () => Promise<void>): Promise<void> {
  const protegida = async () => {
    try {
      await tarea()
    } catch (e) {
      console.error(`[acceso-espacio] ${etiqueta}:`, (e as Error)?.message ?? e)
    }
  }
  try {
    after(protegida)
    return Promise.resolve()
  } catch {
    return protegida()
  }
}

/** El correo escrito en la pantalla, normalizado. `null` si no parece un correo. */
export function correoSolicitado(texto: unknown): string | null {
  if (typeof texto !== 'string') return null
  const c = texto.trim().toLowerCase()
  if (c.length < 6 || c.length > 254) return null
  if (!/^[^\s@,;<>()]+@[^\s@,;<>()]+\.[a-z]{2,}$/.test(c)) return null
  return c
}

// ── La dirección de los espacios de una persona ──────────────────────────────

interface EspacioDeUsuario {
  slug: string
  nombre: string
}

export interface DepsRecuperar {
  /** El id de Auth del correo, o `null` si no tiene cuenta. */
  buscarUsuario: (correo: string) => Promise<string | null>
  /** Los espacios a los que esa persona puede entrar. */
  espaciosDe: (usuarioId: string) => Promise<EspacioDeUsuario[]>
  enviar: (m: CorreoSaliente) => Promise<ResultadoEnvio>
  urlLogin: (slug: string) => string
  ahoraMs: number
}

export type ResultadoRecuperar = 'enviado' | 'sin_cuenta' | 'sin_espacios' | 'error'

/**
 * Busca los espacios del correo y, si hay, le envía sus direcciones. El resultado es SOLO para el log
 * y las pruebas: la pantalla responde lo mismo en todos los casos (`TEXTOS_LOGIN.respuestaNeutra`).
 *
 * La llave de idempotencia es el correo (en huella, no en claro) y la ventana de 10 minutos: Resend no
 * manda dos veces la misma llave en 24 h, así que el mismo correo recibe a lo más un mensaje por
 * ventana aunque las solicitudes caigan en instancias distintas de Vercel.
 */
export async function enviarDireccionesDeEspacio(correo: string, deps: DepsRecuperar): Promise<ResultadoRecuperar> {
  try {
    const usuarioId = await deps.buscarUsuario(correo)
    if (!usuarioId) return 'sin_cuenta'
    const espacios = await deps.espaciosDe(usuarioId)
    if (espacios.length === 0) return 'sin_espacios'
    const armado = correoRecuperarEspacio({
      correo,
      espacios: espacios.slice(0, MAX_ESPACIOS).map((e) => ({ nombre: e.nombre, url: deps.urlLogin(e.slug) })),
    })
    const huella = createHash('sha256').update(correo, 'utf8').digest('hex').slice(0, 32)
    const ventana = Math.floor(deps.ahoraMs / VENTANA_RECUPERAR_MS)
    const envio = await deps.enviar({ to: correo, ...armado, idempotencyKey: `recuperar-espacio-${huella}-${ventana}` })
    if (!envio.ok) {
      console.error('[acceso-espacio] correo con la dirección no enviado:', envio.error)
      return 'error'
    }
    return 'enviado'
  } catch (e) {
    console.error('[acceso-espacio] buscar espacios:', (e as Error)?.message ?? e)
    return 'error'
  }
}

/**
 * Los espacios de una persona: los de sus filas de `staff` activas, más el de su perfil
 * (`profiles.workspace_id` y `home_workspace_id`), que cubre a los dueños de espacios viejos sin fila
 * de `staff`. Se descarta el espacio donde su fila de `staff` está DESACTIVADA: ahí la sacaron.
 */
export function idsDeEspacios(
  perfil: { workspace_id: string | null; home_workspace_id: string | null } | null,
  staff: { workspace_id: string; is_active: boolean | null }[],
): string[] {
  const desactivados = new Set(staff.filter((s) => s.is_active === false).map((s) => s.workspace_id))
  const activos = staff.filter((s) => s.is_active !== false).map((s) => s.workspace_id)
  const ids = new Set<string>(activos)
  for (const id of [perfil?.workspace_id, perfil?.home_workspace_id]) {
    if (id && !desactivados.has(id)) ids.add(id)
  }
  return [...ids]
}

async function espaciosDeUsuario(usuarioId: string): Promise<EspacioDeUsuario[]> {
  const svc = createServiceClient()
  const [perfil, staff] = await Promise.all([
    svc.from('profiles').select('workspace_id, home_workspace_id').eq('id', usuarioId).maybeSingle(),
    svc.from('staff').select('workspace_id, is_active').eq('profile_id', usuarioId),
  ])
  if (perfil.error) throw new Error(`perfil: ${perfil.error.message}`)
  if (staff.error) throw new Error(`staff: ${staff.error.message}`)
  const ids = idsDeEspacios(
    perfil.data as { workspace_id: string | null; home_workspace_id: string | null } | null,
    (staff.data ?? []) as { workspace_id: string; is_active: boolean | null }[],
  )
  if (ids.length === 0) return []
  const ws = await svc.from('workspaces').select('slug, name').in('id', ids)
  if (ws.error) throw new Error(`espacios: ${ws.error.message}`)
  return ((ws.data ?? []) as { slug: string | null; name: string | null }[])
    .filter((w): w is { slug: string; name: string | null } => !!w.slug)
    .map((w) => ({ slug: w.slug, nombre: w.name || w.slug }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/** Las dependencias reales: Auth por filtro de correo, la base con service role y Resend. */
export function depsRecuperarReales(ahoraMs: number = Date.now()): DepsRecuperar {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const llave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  return {
    buscarUsuario: (correo) => buscarIdDeAuthPorCorreo(url, llave, correo),
    espaciosDe: espaciosDeUsuario,
    enviar: enviarPorResend,
    urlLogin: (slug) => urlDelEspacio(slug, '/login'),
    ahoraMs,
  }
}

// ── Bienvenida del alta autogestionada de Valida ─────────────────────────────

/**
 * El correo de bienvenida al crear el espacio de Valida. NUNCA lanza ni devuelve error: si el envío
 * falla, el registro sigue y queda en el log. La llave de idempotencia es el registro: un reintento
 * del mismo envío no sale dos veces.
 */
export async function enviarBienvenidaValida(
  p: { correo: string; razonSocial: string; slug: string; registroId: string },
  enviar: (m: CorreoSaliente) => Promise<ResultadoEnvio> = enviarPorResend,
): Promise<void> {
  try {
    const armado = correoBienvenidaValida({
      razonSocial: p.razonSocial,
      correo: p.correo,
      urlValida: urlDelEspacio(p.slug, '/valida'),
      urlLoginGeneral: urlLoginGeneral(),
    })
    const envio = await enviar({ to: p.correo, ...armado, idempotencyKey: `valida-bienvenida-${p.registroId}` })
    if (!envio.ok) console.error('[acceso-espacio] bienvenida de Valida no enviada:', envio.error)
  } catch (e) {
    console.error('[acceso-espacio] bienvenida de Valida:', (e as Error)?.message ?? e)
  }
}
