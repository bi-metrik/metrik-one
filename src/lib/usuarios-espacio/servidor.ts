import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { asuntoInvitacion, htmlInvitacion } from './correo'
import {
  ROL_PLATAFORMA,
  accionesSobreUsuario,
  etiquetaRol,
  normalizarCorreo,
  type RolAsignable,
  type UsuarioDelEspacio,
} from './reglas'

/**
 * Gestión de usuarios de un espacio, del lado del servidor. Construida de cero (la invitación vieja
 * de ONE —`team_invitations` + `/accept-invite`— está cerrada por el middleware y el callback de
 * Auth manda a `/sin-espacio` a quien no tiene perfil): aquí el acceso queda COMPLETO en el momento
 * de invitar.
 *
 *   invitar  → usuario en Auth (correo confirmado) + `profiles` en el espacio + `staff` activo, y un
 *              correo que dice cómo entrar por el login del subdominio (ver `correo.ts`).
 *   retirar  → fila en `usuarios_espacio_retiros` (libera la licencia al instante), staff inactivo y
 *              la cuenta suspendida en Auth (no puede volver a iniciar sesión ni renovar la que tiene).
 *   reenviar → el mismo correo, a quien nunca ha entrado.
 *
 * Nada aquí decide QUIÉN puede: la acción exige el contexto (dueño, administrador o persona
 * designada) y pasa `actorId`. Las reglas sobre CADA usuario (no retirarse a sí mismo, no tocar a la
 * designada ni al dueño) se vuelven a aplicar aquí con `accionesSobreUsuario`, no solo en pantalla.
 *
 * Todo con el cliente de servicio: `profiles` de otros y `auth.users` no se leen con la sesión. Cada
 * consulta filtra por el `workspaceId` que resolvió el servidor, nunca por uno que mande el navegador.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Svc = any

const ROLES_QUE_NO_CUENTAN = new Set(['contador'])

interface FilaPerfil {
  id: string
  full_name: string | null
  role: string
  platform_admin: boolean | null
  workspace_id: string
}

async function retiradosDelEspacio(svc: Svc, workspaceId: string): Promise<Set<string> | 'error'> {
  const r = await svc.from('usuarios_espacio_retiros').select('profile_id').eq('workspace_id', workspaceId).is('reincorporado_at', null)
  if (r.error) {
    console.error('[usuarios] retiros:', r.error.message)
    return 'error'
  }
  return new Set(((r.data ?? []) as { profile_id: string }[]).map((x) => x.profile_id))
}

/**
 * Las personas con acceso al espacio. Sin el soporte de MeTRIK (platform admin, que entra a cualquier
 * espacio y no ocupa licencia del cliente), sin los retirados y sin el contador (no ocupa licencia,
 * igual que en la regla vieja de ONE).
 */
export async function listarUsuarios(workspaceId: string): Promise<UsuarioDelEspacio[] | 'error'> {
  const svc: Svc = createServiceClient()
  const [perfiles, retirados] = await Promise.all([
    svc.from('profiles').select('id, full_name, role, platform_admin, workspace_id').eq('workspace_id', workspaceId),
    retiradosDelEspacio(svc, workspaceId),
  ])
  if (perfiles.error || retirados === 'error') {
    if (perfiles.error) console.error('[usuarios] perfiles:', perfiles.error.message)
    return 'error'
  }
  const filas = ((perfiles.data ?? []) as FilaPerfil[]).filter(
    (p) => p.platform_admin !== true && !retirados.has(p.id) && !ROLES_QUE_NO_CUENTAN.has(p.role),
  )
  const usuarios = await Promise.all(
    filas.map(async (p): Promise<UsuarioDelEspacio> => {
      const a = await svc.auth.admin.getUserById(p.id)
      const u = a.data?.user as { email?: string; last_sign_in_at?: string } | undefined
      return {
        id: p.id,
        nombre: p.full_name?.trim() || u?.email || 'Sin nombre',
        correo: u?.email ?? null,
        role: p.role,
        ultimoIngreso: u?.last_sign_in_at ?? null,
      }
    }),
  )
  return usuarios.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

async function datosDelEspacio(svc: Svc, workspaceId: string): Promise<{ slug: string; nombre: string } | null> {
  const r = await svc.from('workspaces').select('slug, name').eq('id', workspaceId).maybeSingle()
  if (r.error || !r.data) return null
  return { slug: r.data.slug as string, nombre: r.data.name as string }
}

function urlIngreso(slug: string): string {
  if (process.env.NODE_ENV === 'development') return 'http://localhost:3000/login'
  const base = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim()
  return `https://${slug}.${base}/login`
}

async function enviarCorreo(p: {
  correo: string
  nombre: string
  invitadoPor: string | null
  espacioNombre: string
  slug: string
  rol: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, error: 'RESEND_API_KEY no configurada' }
  const datos = {
    nombre: p.nombre,
    invitadoPor: p.invitadoPor,
    espacioNombre: p.espacioNombre,
    rolEtiqueta: etiquetaRol(p.rol).toLowerCase(),
    urlIngreso: urlIngreso(p.slug),
    correo: p.correo,
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'MéTRIK ONE <noreply@metrikone.co>',
      to: [p.correo],
      subject: asuntoInvitacion(datos),
      html: htmlInvitacion(datos),
    }),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string }
    return { ok: false, error: `Resend ${res.status}: ${err.message ?? res.statusText}` }
  }
  return { ok: true }
}

/** El id de Auth de un correo que ya existe. Recorre las páginas: `auth.admin` no busca por correo. */
async function idDeCorreo(svc: Svc, correo: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const r = await svc.auth.admin.listUsers({ page, perPage: 1000 })
    if (r.error) return null
    const users = (r.data?.users ?? []) as { id: string; email?: string }[]
    const u = users.find((x) => (x.email ?? '').toLowerCase() === correo)
    if (u) return u.id
    if (users.length < 1000) return null
  }
  return null
}

export type ResultadoInvitar =
  | { ok: true; usuarioId: string; correoEnviado: boolean }
  | { ok: false; error: string }

export async function invitarUsuario(p: {
  workspaceId: string
  actorId: string
  actorNombre: string | null
  correo: string
  nombre: string
  rol: RolAsignable
  /** Cuántas personas puede tener el espacio. Se vuelve a contar después de crear. */
  licencias: number
}): Promise<ResultadoInvitar> {
  const svc: Svc = createServiceClient()
  const correo = normalizarCorreo(p.correo)
  const nombre = p.nombre.trim()
  const espacio = await datosDelEspacio(svc, p.workspaceId)
  if (!espacio) return { ok: false, error: 'No se pudo leer tu espacio. Intenta de nuevo.' }

  // 1. La cuenta en Auth: se crea, o se reutiliza si el correo ya existe.
  let usuarioId: string | null = null
  let creadoAqui = false
  const creado = await svc.auth.admin.createUser({ email: correo, email_confirm: true, user_metadata: { full_name: nombre } })
  if (creado.error) {
    const yaExiste = /already been registered|email_exists|already exists/i.test(`${creado.error.message} ${creado.error.code ?? ''}`)
    if (!yaExiste) {
      console.error('[usuarios] createUser:', creado.error.message)
      return { ok: false, error: 'No se pudo crear el acceso. Intenta de nuevo en un momento.' }
    }
    usuarioId = await idDeCorreo(svc, correo)
    if (!usuarioId) return { ok: false, error: 'No se pudo verificar ese correo. Intenta de nuevo en un momento.' }
  } else {
    usuarioId = creado.data.user.id as string
    creadoAqui = true
  }

  const deshacer = async () => {
    if (creadoAqui && usuarioId) await svc.auth.admin.deleteUser(usuarioId).catch(() => undefined)
  }

  // 2. El perfil: uno por persona en toda la base (`profiles.workspace_id` es uno solo).
  const perfil = await svc.from('profiles').select('id, workspace_id, platform_admin').eq('id', usuarioId).maybeSingle()
  if (perfil.error) {
    await deshacer()
    return { ok: false, error: 'No se pudo crear el acceso. Intenta de nuevo en un momento.' }
  }
  let reincorporado = false
  const perfilNuevo = !perfil.data
  if (perfil.data) {
    if (perfil.data.workspace_id !== p.workspaceId || perfil.data.platform_admin === true) {
      return { ok: false, error: 'Ese correo ya tiene acceso a otro espacio de MéTRIK ONE. Escríbenos para revisarlo.' }
    }
    const retiro = await svc
      .from('usuarios_espacio_retiros')
      .select('id')
      .eq('profile_id', usuarioId)
      .eq('workspace_id', p.workspaceId)
      .is('reincorporado_at', null)
      .maybeSingle()
    if (retiro.error) return { ok: false, error: 'No se pudo crear el acceso. Intenta de nuevo en un momento.' }
    if (!retiro.data) return { ok: false, error: 'Esa persona ya tiene acceso a este espacio.' }
    reincorporado = true
  }

  // 3. El staff: `staff.profile_id` es único en toda la base.
  const staffPrevio = await svc.from('staff').select('id, workspace_id').eq('profile_id', usuarioId).maybeSingle()
  if (staffPrevio.error || (staffPrevio.data && staffPrevio.data.workspace_id !== p.workspaceId)) {
    await deshacer()
    return {
      ok: false,
      error: staffPrevio.error
        ? 'No se pudo crear el acceso. Intenta de nuevo en un momento.'
        : 'Ese correo ya tiene acceso a otro espacio de MéTRIK ONE. Escríbenos para revisarlo.',
    }
  }

  const perfilEsc = await svc.from('profiles').upsert(
    { id: usuarioId, workspace_id: p.workspaceId, home_workspace_id: p.workspaceId, full_name: nombre, role: p.rol },
    { onConflict: 'id' },
  )
  if (perfilEsc.error) {
    console.error('[usuarios] perfil:', perfilEsc.error.message)
    await deshacer()
    return { ok: false, error: 'No se pudo crear el acceso. Intenta de nuevo en un momento.' }
  }
  const staffEsc = staffPrevio.data
    ? await svc
        .from('staff')
        .update({ full_name: nombre, rol_plataforma: ROL_PLATAFORMA[p.rol], is_active: true, tipo_acceso: 'app' })
        .eq('id', staffPrevio.data.id)
    : await svc.from('staff').insert({
        workspace_id: p.workspaceId,
        profile_id: usuarioId,
        full_name: nombre,
        rol_plataforma: ROL_PLATAFORMA[p.rol],
        tipo_acceso: 'app',
        is_active: true,
      })
  if (staffEsc.error) {
    console.error('[usuarios] staff:', staffEsc.error.message)
    if (perfilNuevo) await svc.from('profiles').delete().eq('id', usuarioId)
    await deshacer()
    return { ok: false, error: 'No se pudo crear el acceso. Intenta de nuevo en un momento.' }
  }

  if (reincorporado) {
    await svc
      .from('usuarios_espacio_retiros')
      .update({ reincorporado_at: new Date().toISOString(), reincorporado_por: p.actorId })
      .eq('profile_id', usuarioId)
      .is('reincorporado_at', null)
    await svc.auth.admin.updateUserById(usuarioId, { ban_duration: 'none' })
  }

  // 4. Dos personas invitando a la vez no pasan el límite: se vuelve a contar.
  const despues = await listarUsuarios(p.workspaceId)
  if (despues !== 'error' && despues.length > p.licencias) {
    if (perfilNuevo) {
      // Recién creado: se borra entero, como si no hubiera pasado.
      await svc.from('staff').delete().eq('profile_id', usuarioId)
      await svc.from('profiles').delete().eq('id', usuarioId)
      await deshacer()
    } else {
      // Era un retirado que se iba a reincorporar: vuelve a quedar retirado.
      await retirarSinReglas(svc, p.workspaceId, usuarioId, p.actorId)
    }
    return { ok: false, error: 'No hay cupos de usuario libres. Agrega un usuario adicional para invitar a otra persona.' }
  }

  const envio = await enviarCorreo({
    correo,
    nombre,
    invitadoPor: p.actorNombre,
    espacioNombre: espacio.nombre,
    slug: espacio.slug,
    rol: p.rol,
  })
  if (!envio.ok) console.error('[usuarios] correo de invitación:', envio.error)
  return { ok: true, usuarioId, correoEnviado: envio.ok }
}

/** Retira sin revisar reglas (solo para deshacer una invitación que se pasó del límite). */
async function retirarSinReglas(svc: Svc, workspaceId: string, usuarioId: string, actorId: string) {
  await svc.from('usuarios_espacio_retiros').insert({ workspace_id: workspaceId, profile_id: usuarioId, retirado_por: actorId })
  await svc.from('staff').update({ is_active: false }).eq('profile_id', usuarioId).eq('workspace_id', workspaceId)
  await svc.auth.admin.updateUserById(usuarioId, { ban_duration: '876000h' })
}

async function usuarioDelEspacio(workspaceId: string, usuarioId: string): Promise<UsuarioDelEspacio | null | 'error'> {
  const lista = await listarUsuarios(workspaceId)
  if (lista === 'error') return 'error'
  return lista.find((u) => u.id === usuarioId) ?? null
}

export async function retirarUsuario(p: {
  workspaceId: string
  actorId: string
  designadoId: string | null
  usuarioId: string
}): Promise<{ ok: true; sesionCerrada: boolean } | { ok: false; error: string }> {
  const objetivo = await usuarioDelEspacio(p.workspaceId, p.usuarioId)
  if (objetivo === 'error') return { ok: false, error: 'No se pudieron leer los usuarios. Intenta de nuevo.' }
  if (!objetivo) return { ok: false, error: 'Esa persona no está en este espacio.' }
  const acciones = accionesSobreUsuario({ actorId: p.actorId, objetivo, designadoId: p.designadoId })
  if (!acciones.puedeRetirar) return { ok: false, error: `No se puede retirar: ${acciones.nota?.toLowerCase() ?? 'no permitido'}.` }

  const svc: Svc = createServiceClient()
  const ins = await svc
    .from('usuarios_espacio_retiros')
    .insert({ workspace_id: p.workspaceId, profile_id: p.usuarioId, retirado_por: p.actorId })
  if (ins.error) {
    console.error('[usuarios] retiro:', ins.error.message)
    return { ok: false, error: 'No se pudo retirar. Intenta de nuevo en un momento.' }
  }
  await svc.from('staff').update({ is_active: false }).eq('profile_id', p.usuarioId).eq('workspace_id', p.workspaceId)
  const ban = await svc.auth.admin.updateUserById(p.usuarioId, { ban_duration: '876000h' })
  if (ban.error) console.error('[usuarios] suspender cuenta:', ban.error.message)
  return { ok: true, sesionCerrada: !ban.error }
}

export async function cambiarRolUsuario(p: {
  workspaceId: string
  actorId: string
  designadoId: string | null
  usuarioId: string
  rol: RolAsignable
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const objetivo = await usuarioDelEspacio(p.workspaceId, p.usuarioId)
  if (objetivo === 'error') return { ok: false, error: 'No se pudieron leer los usuarios. Intenta de nuevo.' }
  if (!objetivo) return { ok: false, error: 'Esa persona no está en este espacio.' }
  const acciones = accionesSobreUsuario({ actorId: p.actorId, objetivo, designadoId: p.designadoId })
  if (!acciones.puedeCambiarRol) return { ok: false, error: `No se puede cambiar el rol: ${acciones.nota?.toLowerCase() ?? 'no permitido'}.` }
  if (objetivo.role === p.rol) return { ok: true }

  const svc: Svc = createServiceClient()
  // Los dos: el trigger `trg_sync_staff_role` espeja staff → profiles, pero sin staff no hay espejo.
  const [a, b] = await Promise.all([
    svc.from('staff').update({ rol_plataforma: ROL_PLATAFORMA[p.rol] }).eq('profile_id', p.usuarioId).eq('workspace_id', p.workspaceId),
    svc.from('profiles').update({ role: p.rol }).eq('id', p.usuarioId).eq('workspace_id', p.workspaceId),
  ])
  if (a.error || b.error) {
    console.error('[usuarios] rol:', a.error?.message ?? b.error?.message)
    return { ok: false, error: 'No se pudo cambiar el rol. Intenta de nuevo en un momento.' }
  }
  return { ok: true }
}

export async function reenviarInvitacion(p: {
  workspaceId: string
  actorNombre: string | null
  usuarioId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const objetivo = await usuarioDelEspacio(p.workspaceId, p.usuarioId)
  if (objetivo === 'error') return { ok: false, error: 'No se pudieron leer los usuarios. Intenta de nuevo.' }
  if (!objetivo || !objetivo.correo) return { ok: false, error: 'Esa persona no está en este espacio.' }
  if (objetivo.ultimoIngreso !== null) return { ok: false, error: 'Esa persona ya entró a ONE: no hace falta reenviar la invitación.' }
  const svc: Svc = createServiceClient()
  const espacio = await datosDelEspacio(svc, p.workspaceId)
  if (!espacio) return { ok: false, error: 'No se pudo leer tu espacio. Intenta de nuevo.' }
  const r = await enviarCorreo({
    correo: objetivo.correo,
    nombre: objetivo.nombre,
    invitadoPor: p.actorNombre,
    espacioNombre: espacio.nombre,
    slug: espacio.slug,
    rol: objetivo.role,
  })
  if (!r.ok) {
    console.error('[usuarios] reenviar:', r.error)
    return { ok: false, error: 'No se pudo enviar el correo. Intenta de nuevo en un momento.' }
  }
  return { ok: true }
}
