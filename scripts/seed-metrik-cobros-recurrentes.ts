/**
 * Seed inicial del flujo de cobros recurrentes en workspace `metrik`.
 *
 * Acciones (idempotentes — seguro re-ejecutar):
 *   1. Crea carpetas Drive faltantes para 5 negocios sin carpeta_url
 *   2. Dentro de cada carpeta, crea 5 subcarpetas estandar (Legal, Documentos
 *      del cliente, Entregables, Cuentas de cobro, Soportes de pago)
 *   3. Actualiza negocios.carpeta_url con la URL del folder padre
 *   4. Inserta 3 planes_cobro vigentes (SOENA, ALMA, AFI Clarity Express)
 *
 * Uso:
 *   cd metrik-one
 *   npx tsx scripts/seed-metrik-cobros-recurrentes.ts
 *
 * Requiere en .env.local:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - GOOGLE_DRIVE_CLIENT_ID
 *   - GOOGLE_DRIVE_CLIENT_SECRET
 *   - GOOGLE_DRIVE_REFRESH_TOKEN
 *
 * Refs:
 *   - cerebro/conceptos/cobros-recurrentes-metrik.md
 *   - proyectos/metrik/cobros-recurrentes/CONTEXT.md
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

// ── Config ─────────────────────────────────────────────────────────
const WS_METRIK_ID = 'a21bfc88-1a60-48c3-afcd-144226aa2392'
const SUBCARPETAS = [
  '1. Legal',
  '2. Documentos del cliente',
  '3. Entregables',
  '4. Cuentas de cobro',
  '5. Soportes de pago',
]

// Codigos de negocios target (los 5 sin carpeta_url en workspace metrik)
const NEGOCIOS_TARGET_CODIGOS = ['A1 26 1', 'A1 26 2', 'D1 26 2', 'S1 26 1', 'S1 26 2']

// Planes de cobro a insertar (3 — el plan ONE AFI desde agosto lo crea Mauricio via UI)
const PLANES_COBRO_SEED = [
  {
    negocio_codigo: 'S1 26 2',
    monto: 1_750_000,
    total_cuotas: 5,
    fecha_inicio: '2026-05-15',
    fecha_fin: '2026-09-15',
    notas: 'Diferido del saldo $8.75M del Contrato Integral SOENA rev v3 firmado 2026-05-12. 5 cuotas iguales mayo-sep 2026.',
  },
  {
    negocio_codigo: 'A1 26 1',
    monto: 400_000,
    total_cuotas: 12,
    fecha_inicio: '2026-05-15',
    fecha_fin: '2027-04-15',
    notas: 'Otrosi 1 + Anexo C ALMA (canal AFI). $4.8M/año = 12 cuotas $400K mayo 2026 - abril 2027.',
  },
  {
    negocio_codigo: 'A1 26 2',
    monto: 416_667,
    total_cuotas: 12,
    fecha_inicio: '2026-05-15',
    fecha_fin: '2027-04-15',
    notas: 'Contrato Integral MeTRIK-AFI Fase 1. $5M / 12 cuotas iguales. Cronograma corrido a mayo-abril 2027 de facto (decision 2026-05-15 Opcion 3, sin otrosi).',
  },
]

// ── Setup ──────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── Google Drive helpers (autonomos, no dependen de @/lib/supabase) ─
async function getAccessToken(): Promise<string> {
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_DRIVE_* env vars (CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN)')
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    throw new Error(`OAuth refresh failed: ${res.status} ${await res.text()}`)
  }

  const data = await res.json() as { access_token: string }
  return data.access_token
}

async function createFolder(name: string, parentId: string, token: string): Promise<string> {
  // Idempotente: busca existente por nombre + parent antes de crear
  const query = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const searchParams = new URLSearchParams({
    q: query,
    fields: 'files(id)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'allDrives',
  })

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?${searchParams.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  if (searchRes.ok) {
    const data = await searchRes.json() as { files?: { id: string }[] }
    if (data.files && data.files.length > 0) {
      return data.files[0].id
    }
  }

  const createRes = await fetch(
    'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
    },
  )

  if (!createRes.ok) {
    throw new Error(`Drive folder create failed (${createRes.status}): ${await createRes.text()}`)
  }

  const folder = await createRes.json() as { id: string }
  return folder.id
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log('▶ Seed cobros recurrentes — workspace metrik\n')

  // 1. Resolver workspace drive_folder_id
  const { data: ws, error: wsErr } = await sb
    .from('workspaces')
    .select('drive_folder_id')
    .eq('id', WS_METRIK_ID)
    .single()

  if (wsErr || !ws?.drive_folder_id) {
    console.error('Workspace metrik no tiene drive_folder_id:', wsErr)
    process.exit(1)
  }

  const rootFolderId = ws.drive_folder_id as string
  console.log(`✓ Drive root workspace metrik: ${rootFolderId}\n`)

  // 2. Resolver negocios target
  const { data: negocios, error: negErr } = await sb
    .from('negocios')
    .select('id, codigo, nombre, carpeta_url, empresa_id, empresas(nombre)')
    .eq('workspace_id', WS_METRIK_ID)
    .in('codigo', NEGOCIOS_TARGET_CODIGOS)

  if (negErr || !negocios) {
    console.error('Error leyendo negocios:', negErr)
    process.exit(1)
  }

  console.log(`✓ ${negocios.length} negocios target encontrados:\n`)

  // 3. OAuth token
  const token = await getAccessToken()
  console.log('✓ Drive OAuth token obtenido\n')

  // 4. Por cada negocio: crear carpeta + subcarpetas + update DB
  const negocioMap = new Map<string, { id: string; folder_id: string }>()

  for (const neg of negocios) {
    const empresaNombre =
      (neg.empresas as unknown as { nombre: string } | null)?.nombre ?? 'Sin empresa'
    const folderName = `${neg.codigo} - ${empresaNombre} - ${neg.nombre}`

    console.log(`  → ${folderName}`)

    // Skip si ya tiene carpeta_url
    if (neg.carpeta_url) {
      console.log(`    ⊙ Ya tiene carpeta_url: ${neg.carpeta_url}`)
      continue
    }

    // Crear folder padre (idempotente)
    const parentFolderId = await createFolder(folderName, rootFolderId, token)
    const parentFolderUrl = `https://drive.google.com/drive/folders/${parentFolderId}`

    // Crear 5 subcarpetas en paralelo
    await Promise.all(
      SUBCARPETAS.map(sub => createFolder(sub, parentFolderId, token))
    )

    // Update DB
    const { error: updErr } = await sb
      .from('negocios')
      .update({ carpeta_url: parentFolderUrl })
      .eq('id', neg.id)

    if (updErr) {
      console.error(`    ✗ Error update DB:`, updErr)
      continue
    }

    negocioMap.set(neg.codigo, { id: neg.id, folder_id: parentFolderId })
    console.log(`    ✓ Carpeta + 5 subcarpetas creadas. URL guardada.`)
  }

  console.log(`\n✓ ${negocioMap.size} carpetas creadas\n`)

  // 5. Insertar planes_cobro (idempotente — verifica si ya existe por negocio + fecha_inicio)
  console.log('▶ Insertando planes_cobro...\n')

  for (const plan of PLANES_COBRO_SEED) {
    // Resolver negocio_id por codigo
    const { data: neg } = await sb
      .from('negocios')
      .select('id')
      .eq('workspace_id', WS_METRIK_ID)
      .eq('codigo', plan.negocio_codigo)
      .single()

    if (!neg) {
      console.error(`  ✗ Negocio ${plan.negocio_codigo} no encontrado`)
      continue
    }

    // Verificar si ya existe plan para este negocio + fecha_inicio
    const { data: existing } = await sb
      .from('planes_cobro')
      .select('id')
      .eq('negocio_id', (neg as { id: string }).id)
      .eq('fecha_inicio', plan.fecha_inicio)
      .maybeSingle()

    if (existing) {
      console.log(`  ⊙ Plan ya existe para ${plan.negocio_codigo} con fecha_inicio ${plan.fecha_inicio}`)
      continue
    }

    const { error: insErr } = await sb.from('planes_cobro').insert({
      workspace_id: WS_METRIK_ID,
      negocio_id: (neg as { id: string }).id,
      monto: plan.monto,
      frecuencia: 'mensual',
      fecha_inicio: plan.fecha_inicio,
      fecha_fin: plan.fecha_fin,
      total_cuotas: plan.total_cuotas,
      pasarela: 'manual',
      auto_renovar: false,
      activo: true,
      notas: plan.notas,
    })

    if (insErr) {
      console.error(`  ✗ Error insertando plan ${plan.negocio_codigo}:`, insErr)
      continue
    }

    console.log(`  ✓ Plan creado: ${plan.negocio_codigo} — ${plan.total_cuotas} cuotas $${plan.monto.toLocaleString('es-CO')}`)
  }

  console.log('\n✅ Seed completado.\n')
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
