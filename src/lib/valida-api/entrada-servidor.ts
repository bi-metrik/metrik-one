import 'server-only'
import { cache } from 'react'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { createServiceClient } from '@/lib/supabase/server'
import { contextoValidaApi, type ContextoValidaApi } from './contexto'
import { evaluarEntrada, type AceptacionUsuarioRegistrada, type EstadoEntrada } from './entrada'
import { documentosDelCliente, perfilReal } from './terminos-servidor'

/**
 * La puerta del módulo Valida API, del lado del servidor. Las reglas viven en `entrada.ts`; aquí
 * solo se juntan los datos, y cada lectura dice si falló en vez de devolver una lista vacía (un
 * `?? []` convertiría «no pude leer» en «no hay nada que aceptar», y eso abriría el módulo).
 *
 * La usan la página (que decide si pinta la entrada o las pestañas), CADA acción del servidor y
 * la ruta de descarga de archivos: lo que la pantalla no muestra también se niega por POST.
 */

/** Las constancias del usuario REAL de la sesión. `null` si la lectura falla. */
export async function leerAceptacionesUsuario(usuarioId: string): Promise<AceptacionUsuarioRegistrada[] | null> {
  const { data, error } = await createServiceClient()
    // La tabla nace en la migración de C2; no está en `database.ts`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('documentos_aceptaciones_usuario' as any)
    .select('documento_slug, documento_version, documento_sha256, aceptada_at')
    .eq('usuario_id', usuarioId)
  if (error) {
    console.error('[valida-api] no se pudieron leer las aceptaciones del usuario:', error.message)
    return null
  }
  return (data ?? []) as unknown as AceptacionUsuarioRegistrada[]
}

export type EntradaServidor =
  | { tipo: 'sin_contexto'; ctx: Exclude<ContextoValidaApi, { tipo: 'ok' }> }
  | { tipo: 'ok'; ctx: Extract<ContextoValidaApi, { tipo: 'ok' }>; estado: EstadoEntrada; hoy: string }

async function resolverEntrada(): Promise<EntradaServidor> {
  const ctx = await contextoValidaApi()
  if (ctx.tipo !== 'ok') return { tipo: 'sin_contexto', ctx }

  // El usuario REAL de la sesión: la aprobación es de quien está operando, no del impersonado.
  const usuarioId = ctx.actor.usuario_id
  const [docs, aceptaciones, perfil] = await Promise.all([
    documentosDelCliente(),
    leerAceptacionesUsuario(usuarioId),
    perfilReal(usuarioId),
  ])
  const hoy = todayBogotaISO()
  const estado = evaluarEntrada({
    documentos: docs.ok ? docs.documentos : null,
    hoy,
    aceptacionesUsuario: aceptaciones,
    perfil,
    workspaceId: ctx.workspaceId,
  })
  return { tipo: 'ok', ctx, estado, hoy }
}

/** Una sola evaluación por request aunque la pidan la página y varias acciones. */
export const entradaDelUsuario = cache(resolverEntrada)

/** ¿La persona de la sesión ya hizo la aprobación completa? Cualquier duda, `false`. */
export async function entradaAprobada(): Promise<boolean> {
  const e = await entradaDelUsuario()
  return e.tipo === 'ok' && e.estado.estado === 'aprobada'
}
