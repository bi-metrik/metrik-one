/**
 * Copia el `field_data` del lead de Meta desde `contacto_interacciones.payload`
 * hacia `negocios.metadata`, que es de donde lo lee el bloque "Datos del lead (Meta)".
 *
 *   npx tsx scripts/backfill-field-data-lead-meta.ts <workspace_slug>            # dry run
 *   npx tsx scripts/backfill-field-data-lead-meta.ts <workspace_slug> --commit   # escribe
 *
 * Por qué: el bloque resuelve su contenido con `config_extra.data_desde_metadata`, que
 * lee `negocios.metadata[source]` (source = 'field_data'). La conversión del lead nunca
 * copió ese arreglo al negocio, así que el bloque salía vacío aunque el dato estuviera
 * completo en la interacción. Medido en SOENA el 2026-08-18: 35 negocios de origen `meta`
 * sin `field_data`, y los 35 con el bloque instanciado. El camino hacia adelante queda
 * arreglado en `crearNegocioDesdeInteraccion`; este script cubre lo ya creado.
 *
 * Dos vías de resolución, y la segunda queda marcada porque es una inferencia:
 *   1. `metadata.interaccion_id` → la interacción exacta que originó el negocio. Certera.
 *   2. Sin ese puente: la ÚNICA interacción del contacto que traiga `field_data`. Si el
 *      contacto tiene dos o más, se salta y se reporta — adivinar cuál es el lead de este
 *      negocio es exactamente el error que este backfill existe para no cometer.
 * La vía 2 deja `field_data_origen: 'contacto_unico'` + `field_data_interaccion_id` en el
 * metadata, para que la inferencia se pueda auditar y revertir después.
 *
 * NO escribe `atribucion` (campaña, adset, anuncio): ese dato está caído desde el 1-ago
 * (#77, acceso del System User a la cuenta publicitaria) y se repone por otra vía, contra
 * el Graph API. Mezclarlo aquí escondería cuánto se recuperó de verdad.
 *
 * Idempotente: nunca pisa un `field_data` existente, así que correrlo dos veces no cambia
 * nada la segunda. No toca `contacto_interacciones`.
 *
 * Corre con service_role (bypasea RLS).
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const COMMIT = process.argv.includes('--commit')
const SLUG = process.argv[2]
if (!SLUG || SLUG.startsWith('--')) {
  console.error('Uso: npx tsx scripts/backfill-field-data-lead-meta.ts <workspace_slug> [--commit]')
  process.exit(1)
}

const env: Record<string, string> = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

type FieldDatum = { name?: string; values?: string[] }
type NegocioRow = {
  id: string
  codigo: string | null
  contacto_id: string | null
  metadata: Record<string, unknown> | null
}
type InteraccionRow = {
  id: string
  contacto_id: string | null
  payload: Record<string, unknown> | null
}

const esFieldData = (v: unknown): v is FieldDatum[] => Array.isArray(v) && v.length > 0

async function main() {
  const { data: ws, error: wsErr } = await supabase
    .from('workspaces')
    .select('id, nombre')
    .eq('slug', SLUG)
    .maybeSingle()
  if (wsErr || !ws) {
    console.error(`Workspace '${SLUG}' no encontrado`)
    process.exit(1)
  }
  const workspaceId = (ws as { id: string }).id

  const { data: negociosRaw, error: negErr } = await supabase
    .from('negocios')
    .select('id, codigo, contacto_id, metadata')
    .eq('workspace_id', workspaceId)
    .eq('origen', 'meta')
  if (negErr) throw negErr
  const negocios = (negociosRaw ?? []) as NegocioRow[]
  const pendientes = negocios.filter((n) => !esFieldData((n.metadata ?? {}).field_data))

  const { data: interRaw, error: interErr } = await supabase
    .from('contacto_interacciones')
    .select('id, contacto_id, payload')
    .eq('workspace_id', workspaceId)
  if (interErr) throw interErr
  const interacciones = ((interRaw ?? []) as InteraccionRow[]).filter((i) =>
    esFieldData((i.payload ?? {}).field_data),
  )

  const porId = new Map(interacciones.map((i) => [i.id, i]))
  const porContacto = new Map<string, InteraccionRow[]>()
  for (const i of interacciones) {
    if (!i.contacto_id) continue
    const lista = porContacto.get(i.contacto_id) ?? []
    lista.push(i)
    porContacto.set(i.contacto_id, lista)
  }

  const plan: Array<{ negocio: NegocioRow; inter: InteraccionRow; via: 'interaccion_id' | 'contacto_unico' }> = []
  const saltados: Array<{ codigo: string | null; motivo: string }> = []

  for (const n of pendientes) {
    const interId = (n.metadata ?? {}).interaccion_id
    if (typeof interId === 'string' && interId) {
      const inter = porId.get(interId)
      if (inter) {
        plan.push({ negocio: n, inter, via: 'interaccion_id' })
      } else {
        saltados.push({ codigo: n.codigo, motivo: 'la interacción enlazada no trae field_data' })
      }
      continue
    }
    const candidatas = n.contacto_id ? (porContacto.get(n.contacto_id) ?? []) : []
    if (candidatas.length === 1) {
      plan.push({ negocio: n, inter: candidatas[0], via: 'contacto_unico' })
    } else if (candidatas.length > 1) {
      saltados.push({ codigo: n.codigo, motivo: `${candidatas.length} interacciones del contacto: ambiguo` })
    } else {
      saltados.push({ codigo: n.codigo, motivo: 'el contacto no tiene ninguna interacción con field_data' })
    }
  }

  console.log(`\nWorkspace: ${SLUG} (${workspaceId})`)
  console.log(`Negocios origen 'meta': ${negocios.length} · sin field_data: ${pendientes.length}`)
  console.log(`Recuperables: ${plan.length}`)
  console.log(`  por interaccion_id: ${plan.filter((p) => p.via === 'interaccion_id').length}`)
  console.log(`  por contacto único (inferencia): ${plan.filter((p) => p.via === 'contacto_unico').length}`)
  console.log(`Sin fuente: ${saltados.length}`)
  for (const s of saltados) console.log(`  - ${s.codigo}: ${s.motivo}`)

  if (!COMMIT) {
    console.log('\nDRY RUN. Nada se escribió. Repetir con --commit para aplicar.\n')
    for (const p of plan) {
      const campos = ((p.inter.payload ?? {}).field_data as FieldDatum[]).map((f) => f.name).join(', ')
      console.log(`  ${p.negocio.codigo} ← ${p.via} · ${campos}`)
    }
    return
  }

  let ok = 0
  for (const p of plan) {
    const fieldData = (p.inter.payload ?? {}).field_data as FieldDatum[]
    const metadata: Record<string, unknown> = {
      ...(p.negocio.metadata ?? {}),
      field_data: fieldData,
      ...(p.via === 'contacto_unico'
        ? { field_data_origen: 'contacto_unico', field_data_interaccion_id: p.inter.id }
        : {}),
    }
    const { error } = await supabase
      .from('negocios')
      .update({ metadata })
      .eq('id', p.negocio.id)
      .eq('workspace_id', workspaceId)
    if (error) {
      console.error(`  ✗ ${p.negocio.codigo}: ${error.message}`)
      continue
    }
    ok++
    console.log(`  ✓ ${p.negocio.codigo} (${p.via})`)
  }
  console.log(`\nEscritos: ${ok}/${plan.length}\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
