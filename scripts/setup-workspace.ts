/**
 * Crea (o reusa) un workspace de ONE hasta el punto en que se le puede cargar
 * una linea de negocio: fila en `workspaces` + carpeta padre en Google Drive.
 *
 * Es el paso 0 que faltaba. Hasta ahora la cadena de provisioning empezaba en
 * `setup-drive-workspace.ts`, que exige que el workspace YA exista y sale con
 * error si no lo encuentra; la fila se creaba a mano o copiando un bloque de
 * `setup-regat-workspace.ts`, que ademas provisiona usuarios de demo. Este
 * script cubre solo el paso 0 y no toca usuarios.
 *
 * Por que la carpeta de Drive va aqui y no despues: un workspace sin
 * `drive_folder_id` deja los negocios sin carpeta, y una cuenta sin carpeta se
 * emite sin PDF y el emisor la descarta en silencio. Ya paso con la primera
 * cuenta de Trappvel. La fila y la carpeta nacen juntas.
 *
 * Idempotente: reusa el workspace por slug y las carpetas por nombre
 * (`createDriveFolder` es find-or-create). Correrlo dos veces no duplica nada.
 *
 * SIMULACION POR DEFECTO. Sin `--apply` no escribe ni en la base ni en Drive:
 * imprime lo que haria. Es escritura en produccion, asi que el modo destructivo
 * se pide explicito.
 *
 * Uso:
 *   npx tsx scripts/setup-workspace.ts <slug> --nombre "<Nombre visible>" [opciones]
 *
 * Opciones:
 *   --nombre <texto>        Nombre visible. Obligatorio al crear.
 *   --tipo <clarity|nativo> Default: clarity (todo workspace de cliente).
 *   --grupo <clave>         Encabezado del selector del platform admin
 *                           (`config_extra.grupo`). Una de las claves de
 *                           `src/lib/workspace/grupo.ts`. Sin esto el workspace
 *                           nace en "Sin clasificar" y alguien se acuerda despues.
 *   --seats <n>             max_seats. Default: 10.
 *   --equipo <n>            equipo_declarado. Default: 1.
 *   --color <#RRGGBB>       color_primario. Default: el de MeTRIK.
 *   --modules <a,b,c>       Modulos en true. Default: business.
 *   --drive-parent <id>     Carpeta padre en Drive. Default: env
 *                           WS_DRIVE_PARENT_ID, y si tampoco esta, la carpeta
 *                           "MéTRIK" de la unidad compartida.
 *   --sin-drive             No toca Drive (workspace sin carpeta: los negocios
 *                           naceran sin carpeta hasta que se corra de nuevo).
 *   --apply                 Escribe de verdad.
 *
 * Requiere en .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * y para Drive GOOGLE_DRIVE_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN.
 *
 * Despues de correrlo:
 *   1. npx tsx scripts/preflight-workspace.ts <slug>
 *   2. Cargar la linea de negocio (migracion del proyecto).
 *   3. Solo si el cliente pone su propio Drive:
 *      npx tsx scripts/setup-drive-workspace.ts <slug> <folder_id>
 *      con las WS_DRIVE_* del cliente. Sin eso, el workspace usa las
 *      credenciales globales de MeTRIK, que es el caso por defecto.
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

import { createDriveFolder } from '@/lib/google-drive'
import { RESERVED_SLUGS } from '@/lib/tenant/extract-slug'
import { GRUPOS_DE_WORKSPACE, grupoDeWorkspace } from '@/lib/workspace/grupo'

config({ path: resolve(process.cwd(), '.env.local') })

// Carpeta "MéTRIK" dentro de la unidad compartida. Es donde ya cuelga
// "Negocios" del workspace metrik. No es secreto: es el nodo raiz de la
// operacion, y se puede sobreescribir con --drive-parent.
const DRIVE_PARENT_METRIK = '13pW-oRImuFxKgutd7QmJaVC2Cmj_iYMW'

// ── Argumentos ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)

function flag(nombre: string): string | undefined {
  const i = argv.indexOf(`--${nombre}`)
  if (i === -1) return undefined
  const valor = argv[i + 1]
  if (!valor || valor.startsWith('--')) {
    console.error(`--${nombre} necesita un valor`)
    process.exit(1)
  }
  return valor
}

const slug = argv[0]
const APPLY = argv.includes('--apply')
const SIN_DRIVE = argv.includes('--sin-drive')

if (!slug || slug.startsWith('--')) {
  console.error('Uso: npx tsx scripts/setup-workspace.ts <slug> --nombre "<Nombre>" [--apply]')
  process.exit(1)
}

// El slug es el subdominio: <slug>.metrikone.co. Si no es valido como host, el
// workspace existe en la base y no se puede abrir.
if (!/^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])?$/.test(slug)) {
  console.error(
    `Slug invalido: "${slug}". Solo minusculas, digitos y guion medio interno, ` +
      'de 2 a 30 caracteres. Es el subdominio del workspace.',
  )
  process.exit(1)
}
if (RESERVED_SLUGS.includes(slug)) {
  console.error(`Slug reservado: "${slug}". El middleware no lo resuelve como tenant.`)
  process.exit(1)
}

const nombre = flag('nombre')
const tipo = flag('tipo') ?? 'clarity'
const seats = Number(flag('seats') ?? 10)
const equipo = Number(flag('equipo') ?? 1)
const color = flag('color') ?? '#10B981'
const modulos = (flag('modules') ?? 'business').split(',').map(m => m.trim()).filter(Boolean)
const driveParent = flag('drive-parent') ?? process.env.WS_DRIVE_PARENT_ID ?? DRIVE_PARENT_METRIK
const grupo = flag('grupo')

// El grupo se valida contra las claves conocidas y NO se normaliza en silencio: un
// "SECOP" en mayuscula cae en "Sin clasificar" (grupo.ts es estricto a proposito), asi
// que aceptarlo aqui crearia el workspace con una marca que el selector ignora.
if (grupo !== undefined && grupoDeWorkspace(grupo) !== grupo) {
  const claves = GRUPOS_DE_WORKSPACE.map(g => g.clave).filter(c => c !== 'sin_clasificar')
  console.error(`--grupo invalido: "${grupo}". Claves validas: ${claves.join(', ')}.`)
  process.exit(1)
}
if (tipo !== 'clarity' && tipo !== 'nativo') {
  console.error(`--tipo invalido: "${tipo}". La base solo acepta clarity o nativo.`)
  process.exit(1)
}
if (!Number.isInteger(seats) || seats < 1 || !Number.isInteger(equipo) || equipo < 1) {
  console.error('--seats y --equipo tienen que ser enteros mayores que cero.')
  process.exit(1)
}
if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
  console.error(`--color invalido: "${color}". Formato #RRGGBB.`)
  process.exit(1)
}

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY_SB = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_SB || !KEY_SB) {
  console.error('Faltan env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const sb = createClient(URL_SB, KEY_SB, { auth: { persistSession: false } })

const paso = (texto: string) => console.log(`${APPLY ? '  ' : '  [simulacion] '}${texto}`)

// ── Ejecucion ───────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${APPLY ? 'Provisionando' : 'SIMULACION de'} workspace "${slug}"\n`)

  // ── 1. Fila en workspaces ─────────────────────────────────────────────────
  const { data: existente, error: eBusca } = await sb
    .from('workspaces')
    .select('id, name, tipo, drive_folder_id, modules')
    .eq('slug', slug)
    .maybeSingle()
  if (eBusca) throw eBusca

  let workspaceId: string
  let driveFolderActual: string | null = null

  if (existente) {
    workspaceId = existente.id as string
    driveFolderActual = (existente.drive_folder_id as string | null) ?? null
    console.log(`  workspace ya existe → ${workspaceId} ("${existente.name}", tipo ${existente.tipo})`)
    console.log(`  drive_folder_id actual: ${driveFolderActual ?? '(null)'}`)
    // No se sobreescribe nada del workspace existente: un rerun no puede
    // pisarle los modulos, el nombre ni el grupo a un workspace vivo.
    if (grupo) {
      console.log(`  --grupo ${grupo} IGNORADO: el workspace ya existe. Cambiar el grupo de uno vivo`)
      console.log('  es un UPDATE aparte sobre config_extra, con su propia decision.')
    }
  } else {
    if (!nombre) {
      console.error('\nEl workspace no existe y falta --nombre "<Nombre visible>".')
      process.exit(1)
    }
    const fila = {
      slug,
      name: nombre,
      tipo,
      subscription_status: 'trial',
      onboarding_completed: true,
      max_seats: seats,
      equipo_declarado: equipo,
      color_primario: color,
      modules: Object.fromEntries(modulos.map(m => [m, true])),
      // `grupo` solo decide el encabezado del selector del platform admin; `tipo` decide
      // comportamiento del producto. Ejes distintos (ver grupo.ts).
      ...(grupo ? { config_extra: { grupo } } : {}),
    }
    paso(`crear fila: ${JSON.stringify(fila)}`)
    if (APPLY) {
      const { data: creado, error } = await sb.from('workspaces').insert(fila).select('id').single()
      if (error) throw error
      workspaceId = creado!.id as string
      console.log(`  workspace creado → ${workspaceId}`)
    } else {
      workspaceId = '(pendiente)'
    }
  }

  // ── 2. Carpeta padre en Drive ─────────────────────────────────────────────
  if (SIN_DRIVE) {
    console.log('\n  Drive omitido (--sin-drive). Los negocios naceran sin carpeta.')
  } else if (driveFolderActual) {
    console.log(`\n  Drive ya configurado (${driveFolderActual}). No se toca.`)
  } else {
    const nombreCarpeta = nombre ?? (existente?.name as string)
    console.log(`\n  Drive: ${nombreCarpeta} / Negocios  (bajo ${driveParent})`)
    paso('crear (o reusar) las dos carpetas y guardar drive_folder_id')
    if (APPLY) {
      // createDriveFolder es find-or-create por nombre dentro del padre, asi que
      // un rerun reusa las carpetas en vez de duplicarlas.
      const raiz = await createDriveFolder(nombreCarpeta, driveParent, workspaceId)
      const negocios = await createDriveFolder('Negocios', raiz, workspaceId)
      const { error } = await sb
        .from('workspaces')
        .update({ drive_folder_id: negocios })
        .eq('id', workspaceId)
      if (error) throw error
      console.log(`  carpeta raiz     → ${raiz}`)
      console.log(`  carpeta Negocios → ${negocios}  (drive_folder_id)`)
    }
  }

  // ── 3. Cierre ─────────────────────────────────────────────────────────────
  console.log(`\n${APPLY ? '✓ Listo' : 'Nada se escribio. Repetir con --apply para ejecutar.'}`)
  console.log(`\nworkspace_id: ${workspaceId}`)
  console.log(`URL:          https://${slug}.metrikone.co`)
  console.log('\nSigue:')
  console.log(`  1. npx tsx scripts/preflight-workspace.ts ${slug}`)
  console.log('  2. Cargar la linea de negocio (migracion del proyecto).')
  console.log('  3. Crear los usuarios del cliente.')
  console.log(
    '\nOjo: el workspace nace en `trial` y sin usuarios. Con credenciales de Drive\n' +
      'de MeTRIK, los documentos del cliente caen en el Drive de MeTRIK: eso sirve\n' +
      'para pruebas, no para produccion sin acuerdo escrito de encargo.',
  )
}

main().catch(e => {
  console.error('\n✗ ERROR:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
