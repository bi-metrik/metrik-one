/**
 * Provisiona los usuarios de un workspace: auth.users → profiles → staff →
 * staff_areas, que es la cadena completa y en ese orden.
 *
 * Se hace server-side a proposito: la invitacion por UI esta rota para usuarios
 * nuevos en ONE. `setup-regat-workspace.ts` ya resolvia esta cadena, pero con
 * los tres usuarios de esa demo escritos en el codigo; aqui la lista entra por
 * archivo, asi que sirve para cualquier workspace y los datos del cliente no
 * viven en el repo del producto.
 *
 * NO manda correos. Crea la cuenta confirmada; cada persona entra pidiendo su
 * enlace en https://<slug>.metrikone.co/login (el login de ONE es magic link).
 *
 * Idempotente: reusa el usuario de auth si el correo ya existe, y el staff por
 * profile_id. Las areas se reescriben en cada corrida (son la fuente de verdad
 * del archivo).
 *
 * SIMULACION POR DEFECTO. Sin `--apply` no escribe nada.
 *
 * Uso:
 *   npx tsx scripts/setup-workspace-users.ts <slug> --archivo <ruta.json> [--apply]
 *
 * Formato del archivo (array):
 *   [
 *     {
 *       "email": "gerencia@ejemplo.com",
 *       "nombre": "Nombre Apellido",
 *       "role": "owner",              // owner|admin|supervisor|operator|contador|read_only
 *       "rol_plataforma": "dueno",    // dueno|administrador|supervisor|ejecutor|contador|campo
 *       "cargo": "Founder",
 *       "areas": ["direccion"]        // comercial|operaciones|financiera|direccion
 *     }
 *   ]
 *
 * Requiere en .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { readFileSync } from 'fs'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const ROLES = ['owner', 'admin', 'supervisor', 'operator', 'contador', 'read_only']
const ROLES_PLATAFORMA = ['dueno', 'administrador', 'supervisor', 'ejecutor', 'contador', 'campo']
const AREAS = ['comercial', 'operaciones', 'financiera', 'direccion']

interface UsuarioSpec {
  email: string
  nombre: string
  role: string
  rol_plataforma: string
  cargo: string
  areas: string[]
}

const argv = process.argv.slice(2)
const slug = argv[0]
const APPLY = argv.includes('--apply')
const iArchivo = argv.indexOf('--archivo')
const rutaArchivo = iArchivo === -1 ? undefined : argv[iArchivo + 1]

if (!slug || slug.startsWith('--') || !rutaArchivo) {
  console.error('Uso: npx tsx scripts/setup-workspace-users.ts <slug> --archivo <ruta.json> [--apply]')
  process.exit(1)
}

let usuarios: UsuarioSpec[]
try {
  usuarios = JSON.parse(readFileSync(resolve(rutaArchivo), 'utf-8'))
} catch (e) {
  console.error(`No se pudo leer ${rutaArchivo}: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
if (!Array.isArray(usuarios) || usuarios.length === 0) {
  console.error('El archivo tiene que ser un array con al menos un usuario.')
  process.exit(1)
}

// Se valida TODO antes de escribir nada: media lista provisionada y media
// rechazada por un typo es peor que no haber empezado.
for (const [i, u] of usuarios.entries()) {
  const donde = `usuario ${i + 1} (${u?.email ?? 'sin email'})`
  if (!u.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u.email)) throw new Error(`${donde}: email invalido`)
  if (!u.nombre?.trim()) throw new Error(`${donde}: falta nombre`)
  if (!ROLES.includes(u.role)) throw new Error(`${donde}: role "${u.role}" fuera de ${ROLES.join('|')}`)
  if (!ROLES_PLATAFORMA.includes(u.rol_plataforma)) {
    throw new Error(`${donde}: rol_plataforma "${u.rol_plataforma}" fuera de ${ROLES_PLATAFORMA.join('|')}`)
  }
  for (const a of u.areas ?? []) {
    if (!AREAS.includes(a)) throw new Error(`${donde}: area "${a}" fuera de ${AREAS.join('|')}`)
  }
}
const nombres = usuarios.map(u => u.nombre.trim())
if (new Set(nombres).size !== nombres.length) {
  // La idempotencia sobre un correo ya registrado se resuelve por nombre dentro
  // del workspace (ver mas abajo), asi que dos nombres iguales la romperian.
  throw new Error('Hay nombres repetidos en el archivo. Dentro de un workspace tienen que ser unicos.')
}

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY_SB = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_SB || !KEY_SB) {
  console.error('Faltan env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const svc = createClient(URL_SB, KEY_SB, { auth: { persistSession: false } })

async function main() {
  console.log(`\n${APPLY ? 'Provisionando' : 'SIMULACION de'} ${usuarios.length} usuario(s) en "${slug}"\n`)

  const { data: ws, error: eWs } = await svc
    .from('workspaces')
    .select('id, name')
    .eq('slug', slug)
    .maybeSingle()
  if (eWs) throw eWs
  if (!ws) {
    console.error(`Workspace "${slug}" no existe. Crealo con scripts/setup-workspace.ts.`)
    process.exit(1)
  }
  const workspaceId = ws.id as string
  console.log(`  workspace ${ws.name} (${workspaceId})\n`)

  for (const u of usuarios) {
    const nombre = u.nombre.trim()

    if (!APPLY) {
      const { data: yaHay } = await svc
        .from('profiles')
        .select('id, role')
        .eq('workspace_id', workspaceId)
        .eq('full_name', nombre)
        .maybeSingle()
      console.log(
        `  [simulacion] ${yaHay ? 'ya existe' : 'crear  '} ${nombre.padEnd(20)} ` +
          `${u.email.padEnd(32)} ${u.role}/${u.rol_plataforma} areas=[${u.areas.join(', ')}]`,
      )
      continue
    }

    // ── auth.users ──
    // Sin `listUsers` para comprobar antes: en esta instancia el endpoint admin
    // de listado esta roto (Scan error sobre banned_until, desajuste entre la
    // version de GoTrue y el esquema de auth). Se intenta crear y se resuelve
    // por nombre dentro del workspace si el correo ya estaba registrado.
    let authUserId: string
    const { data: nuevo, error: eAuth } = await svc.auth.admin.createUser({
      email: u.email,
      email_confirm: true,
      user_metadata: { full_name: nombre },
    })

    if (eAuth) {
      if (!/already been registered/i.test(eAuth.message)) {
        throw new Error(`createUser ${u.email}: ${eAuth.message}`)
      }
      const { data: prev } = await svc
        .from('profiles')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('full_name', nombre)
        .maybeSingle()
      if (!prev) {
        throw new Error(
          `${u.email} ya existe en auth pero no tiene profile en ${slug}. ` +
            'Resolverlo a mano: buscar el id en auth.users y crear el profile.',
        )
      }
      authUserId = prev.id as string
    } else {
      authUserId = nuevo.user!.id
    }

    // ── profiles (id ES el auth.users.id) ──
    const { error: eProf } = await svc.from('profiles').upsert(
      {
        id: authUserId,
        workspace_id: workspaceId,
        full_name: nombre,
        role: u.role,
        home_workspace_id: workspaceId,
      },
      { onConflict: 'id' },
    )
    if (eProf) throw new Error(`profile ${u.email}: ${eProf.message}`)

    // ── staff ──
    // Se resuelve POR profile_id: getWorkspace() auto-crea un staff si el
    // usuario no tiene uno, y buscar por nombre dejaria dos registros con la
    // app resolviendo el que no es.
    const { data: staffPrevio } = await svc
      .from('staff')
      .select('id')
      .eq('profile_id', authUserId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    let staffId: string
    if (staffPrevio) {
      staffId = staffPrevio.id as string
      const { error } = await svc
        .from('staff')
        .update({ full_name: nombre, position: u.cargo, rol_plataforma: u.rol_plataforma, is_active: true })
        .eq('id', staffId)
      if (error) throw new Error(`staff ${u.email}: ${error.message}`)
    } else {
      const { data: staffNuevo, error } = await svc
        .from('staff')
        .insert({
          workspace_id: workspaceId,
          profile_id: authUserId,
          full_name: nombre,
          position: u.cargo,
          rol_plataforma: u.rol_plataforma,
          tipo_acceso: 'app',
          is_active: true,
        })
        .select('id')
        .single()
      if (error) throw new Error(`staff ${u.email}: ${error.message}`)
      staffId = staffNuevo!.id as string
    }

    // ── staff_areas (fuente unica de area: staff.area fue dropeada) ──
    await svc.from('staff_areas').delete().eq('staff_id', staffId)
    if (u.areas.length > 0) {
      const { error } = await svc
        .from('staff_areas')
        .insert(u.areas.map(area => ({ staff_id: staffId, area })))
      if (error) throw new Error(`staff_areas ${u.email}: ${error.message}`)
    }

    console.log(
      `  ${nombre.padEnd(20)} ${u.email.padEnd(32)} ${u.role}/${u.rol_plataforma}  ` +
        `auth=${authUserId}  staff=${staffId}`,
    )
  }

  console.log(`\n${APPLY ? '✓ Listo' : 'Nada se escribio. Repetir con --apply para ejecutar.'}`)
  console.log(`\nCada persona entra en https://${slug}.metrikone.co/login pidiendo su enlace.`)
  console.log('El script NO manda correos: avisarles es aparte.')
}

main().catch(e => {
  console.error('\n✗ ERROR:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
