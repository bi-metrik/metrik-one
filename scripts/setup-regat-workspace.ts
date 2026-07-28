/**
 * Provisiona el workspace demo `regat` y sus tres usuarios para la muestra de
 * calidad de llamadas.
 *
 * Se hace server-side a proposito: la invitacion por UI esta rota para usuarios
 * nuevos en ONE, asi que el camino confiable es
 *   auth.admin.createUser (email_confirm) → profiles(role) → staff(profile_id) → staff_areas.
 *
 * Idempotente: se puede correr las veces que haga falta. Reusa el workspace por
 * slug y los usuarios por email.
 *
 * Workspace DESECHABLE. Si Regat no cierra, se borra; si cierra, se provisiona
 * el real limpio. Borrar un workspace en ONE son tres capas (relacional con FKs
 * NO ACTION, Storage y cuentas de auth) — ver la nota al final del archivo.
 *
 * Uso:
 *   npx tsx scripts/setup-regat-workspace.ts
 *
 * Requiere en .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!URL || !KEY) {
  console.error('Faltan env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const svc = createClient(URL, KEY, { auth: { persistSession: false } })

const SLUG = 'regat'
const NOMBRE = 'Regat SAS'

/** Los tres correos son alias controlados por MéTRIK: la demo no depende de que
 *  el cliente reciba un magic link en vivo, y no necesitamos su correo real. */
const USUARIOS = [
  {
    email: 'mauricio.moreno+regat-owner@metrik.com.co',
    fullName: 'Brayan Ronderos',
    role: 'owner',
    rolPlataforma: 'dueno',
    position: 'Owner',
    areas: ['direccion'],
  },
  {
    email: 'mauricio.moreno+regat-super@metrik.com.co',
    fullName: 'Marcela Ospina',
    role: 'supervisor',
    rolPlataforma: 'supervisor',
    position: 'Supervisora de calidad',
    areas: ['comercial'],
  },
  {
    email: 'mauricio.moreno+regat-felipe@metrik.com.co',
    fullName: 'Felipe Sandoval',
    role: 'operator',
    rolPlataforma: 'ejecutor',
    position: 'Asesor comercial',
    areas: ['comercial'],
  },
] as const

async function main() {
  // ── 1. Workspace ──────────────────────────────────────────────────────────
  const { data: existente } = await svc
    .from('workspaces')
    .select('id, config_extra, modules')
    .eq('slug', SLUG)
    .maybeSingle()

  let workspaceId: string

  if (existente) {
    workspaceId = existente.id as string
    console.log(`workspace  ${SLUG} ya existe → ${workspaceId}`)
  } else {
    const { data: creado, error } = await svc
      .from('workspaces')
      .insert({
        slug: SLUG,
        name: NOMBRE,
        tipo: 'clarity',
        subscription_status: 'trial',
        onboarding_completed: true,
        max_seats: 10,
        equipo_declarado: 7,
      })
      .select('id')
      .single()
    if (error) throw error
    workspaceId = creado!.id as string
    console.log(`workspace  ${SLUG} creado → ${workspaceId}`)
  }

  // Modulos: SOLO calidad_llamadas. `business` apagado a proposito — la muestra
  // no vende negocios ni numeros, y un sidebar con modulos vacios distrae.
  //
  // `muro_publico` es el segundo gate del muro proyectable: no basta con tener
  // el modulo, hay que declarar explicitamente que este workspace acepta exponer
  // su muro por enlace sin sesion.
  const previo = (existente?.config_extra as Record<string, unknown>) ?? {}
  const configExtra = {
    ...previo,
    muro_publico: true,
    // Token no adivinable. Se genera una sola vez y se conserva: si cambiara en
    // cada corrida, la URL pegada en el navegador del televisor se rompe.
    muro_token: (previo.muro_token as string | undefined) ?? randomBytes(12).toString('base64url'),
    // Rotulo permanente: todo lo que no sea la llamada real es demostracion.
    calidad_demo: true,
  }
  // modo_vitrina recorta el nav a tres rutas: si quedara puesto, el modulo
  // desapareceria del sidebar sin error visible. Se borra de forma explicita.
  delete (configExtra as Record<string, unknown>).modo_vitrina

  const { error: eUpd } = await svc
    .from('workspaces')
    .update({
      modules: { calidad_llamadas: true },
      config_extra: configExtra,
    })
    .eq('id', workspaceId)
  if (eUpd) throw eUpd
  console.log('modules    { calidad_llamadas: true }  ·  modo_vitrina ausente')

  // ── 2. Usuarios ───────────────────────────────────────────────────────────
  for (const u of USUARIOS) {
    // Idempotencia sin `listUsers`: en esta instancia el endpoint admin de
    // listado esta roto — devuelve "Database error finding users" por un
    // `Scan error on column index 1, name "banned_until": unsupported Scan`
    // (desajuste entre la version de GoTrue y el esquema de auth). Es
    // preexistente y no tiene que ver con este modulo.
    //
    // Se intenta crear; si el correo ya existe, el id se recupera de `profiles`
    // (profiles.id ES auth.users.id) por nombre dentro del workspace. Los tres
    // usuarios de la demo son fijos y su nombre es unico aqui.
    let authUserId: string
    const { data: nuevo, error } = await svc.auth.admin.createUser({
      email: u.email,
      email_confirm: true,
      user_metadata: { full_name: u.fullName },
    })

    if (error) {
      if (!/already been registered/i.test(error.message)) {
        throw new Error(`createUser ${u.email}: ${error.message}`)
      }
      const { data: prev } = await svc
        .from('profiles')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('full_name', u.fullName)
        .maybeSingle()
      if (!prev) {
        throw new Error(
          `${u.email} ya existe en auth pero no tiene profile en ${SLUG}. ` +
            `Resolverlo a mano: buscar el id en auth.users y crear el profile.`,
        )
      }
      authUserId = prev.id as string
    } else {
      authUserId = nuevo.user!.id
    }

    // profiles — el id ES el auth.users.id.
    const { error: eProf } = await svc.from('profiles').upsert(
      {
        id: authUserId,
        workspace_id: workspaceId,
        full_name: u.fullName,
        role: u.role,
        home_workspace_id: workspaceId,
      },
      { onConflict: 'id' },
    )
    if (eProf) throw new Error(`profile ${u.email}: ${eProf.message}`)

    // staff — vinculado por profile_id. OJO: getWorkspace() auto-crea un staff
    // si el usuario no tiene uno, asi que hay que resolver POR profile_id (no
    // por nombre) para no terminar con dos registros y un seed apuntando al
    // que la app no resuelve.
    const { data: staffExistente } = await svc
      .from('staff')
      .select('id')
      .eq('profile_id', authUserId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    let staffId: string
    if (staffExistente) {
      staffId = staffExistente.id as string
      await svc
        .from('staff')
        .update({ full_name: u.fullName, position: u.position, rol_plataforma: u.rolPlataforma, is_active: true })
        .eq('id', staffId)
    } else {
      const { data: staffNuevo, error: eStaff } = await svc
        .from('staff')
        .insert({
          workspace_id: workspaceId,
          profile_id: authUserId,
          full_name: u.fullName,
          position: u.position,
          rol_plataforma: u.rolPlataforma,
          tipo_acceso: 'app',
          is_active: true,
        })
        .select('id')
        .single()
      if (eStaff) throw new Error(`staff ${u.email}: ${eStaff.message}`)
      staffId = staffNuevo!.id as string
    }

    // staff_areas — fuente unica de area (staff.area fue dropeada).
    await svc.from('staff_areas').delete().eq('staff_id', staffId)
    if (u.areas.length > 0) {
      const { error: eAreas } = await svc
        .from('staff_areas')
        .insert(u.areas.map((area) => ({ staff_id: staffId, area })))
      if (eAreas) throw new Error(`staff_areas ${u.email}: ${eAreas.message}`)
    }

    console.log(
      `usuario    ${u.role.padEnd(10)} ${u.fullName.padEnd(18)} auth=${authUserId}  staff=${staffId}`,
    )
  }

  console.log('\nworkspace_id:', workspaceId)
  console.log('URL demo:    https://regat.metrikone.co')
  console.log('Muro:        https://regat.metrikone.co/muro/' + configExtra.muro_token)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

// ── Como se desecha este workspace ──────────────────────────────────────────
//
// No basta con borrar la fila de `workspaces`. Son tres capas:
//   1. Relacional: ~50 FKs son NO ACTION y bloquean el delete. Hay que borrar
//      hoja→raiz en transaccion (aqui: calidad_* → staff_areas → staff →
//      profiles → workspaces).
//   2. Storage: objetos `workspace-logos/{ws_id}/...` requieren la Storage API
//      (el DELETE directo lo bloquea el trigger protect_delete()).
//   3. auth/cuentas: verificar `staff.profile_id` cross-workspace antes de
//      borrar un profile o un auth.user. Aqui los tres alias son exclusivos de
//      regat, asi que se borran sin riesgo.
