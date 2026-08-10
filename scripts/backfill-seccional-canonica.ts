/**
 * Lleva `negocios.metadata.seccional` al nombre canónico del catálogo DIAN.
 *
 *   npx tsx scripts/backfill-seccional-canonica.ts <workspace_slug>            # dry run
 *   npx tsx scripts/backfill-seccional-canonica.ts <workspace_slug> --commit   # escribe
 *
 * Por qué: el campo se escribía desde tres caminos con tres vocabularios distintos
 * (label del catálogo, clave de preset del 010, texto del Excel de cargue) y todo lo
 * que lo lee compara por texto. Medido en SOENA el 2026-08-10, sobre negocios abiertos:
 * Bogotá partida en tres variantes (90 + 16 + 6) y Medellín en dos (11 + 11).
 *
 * ⚠️ El criterio de canonización NO se reimplementa aquí ni en SQL: se importa de
 * `src/lib/dian/seccionales.ts`, que es el catálogo canónico. Una lista paralela ya se
 * intentó una vez para este mismo dato (migración `20260728_s6_precarga_requiere_cita_dian`)
 * y se revirtió: el criterio de la DIAN cambió tres veces y duplicarlo garantiza que el
 * flujo de trabajo y el documento que recibe el cliente terminen contradiciéndose.
 *
 * Idempotente: canonizar lo ya canónico no lo cambia (hay test). No toca los valores que
 * no reconoce — los reporta para decidirlos a mano, en vez de degradarlos a un genérico.
 *
 * NO toca `proceso_snapshots`: esas filas son el registro de lo que se midió cada día y
 * el tablero ya las funde al leer. Reescribirlas cambiaría un histórico sin necesidad.
 *
 * Corre con service_role (bypasea RLS).
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { canonizarSeccional } from '../src/lib/dian/seccionales'

const COMMIT = process.argv.includes('--commit')
const SLUG = process.argv[2]
if (!SLUG || SLUG.startsWith('--')) {
  console.error('Uso: npx tsx scripts/backfill-seccional-canonica.ts <workspace_slug> [--commit]')
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

type Negocio = {
  id: string
  codigo: string | null
  estado: string | null
  metadata: Record<string, unknown> | null
}

async function main() {
  const { data: ws, error: wsErr } = await supabase
    .from('workspaces')
    .select('id, name')
    .eq('slug', SLUG)
    .maybeSingle()
  if (wsErr) throw new Error(`workspace: ${wsErr.message}`)
  if (!ws) throw new Error(`No existe el workspace "${SLUG}"`)
  const workspaceId = (ws as { id: string }).id

  // Se recorren TODOS los negocios, no solo los abiertos: un caso cerrado sigue
  // alimentando el histórico y sus documentos se pueden regenerar.
  const { data, error } = await supabase
    .from('negocios')
    .select('id, codigo, estado, metadata')
    .eq('workspace_id', workspaceId)
  if (error) throw new Error(`negocios: ${error.message}`)

  const filas = (data ?? []) as unknown as Negocio[]

  const cambios: Array<{ id: string; codigo: string | null; de: string; a: string }> = []
  const noReconocidos = new Map<string, string[]>()
  let yaCanonicos = 0
  let sinSeccional = 0

  for (const n of filas) {
    const crudo = (n.metadata?.seccional as string | undefined)?.trim()
    if (!crudo) {
      sinSeccional++
      continue
    }
    const canonico = canonizarSeccional(crudo)
    if (!canonico) {
      noReconocidos.set(crudo, [...(noReconocidos.get(crudo) ?? []), n.codigo ?? n.id])
      continue
    }
    if (canonico === crudo) {
      yaCanonicos++
      continue
    }
    cambios.push({ id: n.id, codigo: n.codigo, de: crudo, a: canonico })
  }

  // Resumen por variante: es lo que se compara contra el tablero después de aplicar.
  const porVariante = new Map<string, { a: string; n: number }>()
  for (const c of cambios) {
    const k = `${c.de} → ${c.a}`
    porVariante.set(k, { a: c.a, n: (porVariante.get(k)?.n ?? 0) + 1 })
  }

  console.log(`\nWorkspace: ${(ws as { name: string }).name} (${SLUG})`)
  console.log(`Negocios revisados: ${filas.length}`)
  console.log(`  sin seccional registrada: ${sinSeccional}`)
  console.log(`  ya canónicos: ${yaCanonicos}`)
  console.log(`  por corregir: ${cambios.length}`)

  if (porVariante.size > 0) {
    console.log('\nCambios por variante:')
    for (const [k, v] of [...porVariante.entries()].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`  ${String(v.n).padStart(4)}  ${k}`)
    }
  }

  if (noReconocidos.size > 0) {
    console.log('\n⚠️  NO reconocidos (no se tocan, decidir a mano):')
    for (const [texto, codigos] of noReconocidos) {
      const muestra = codigos.slice(0, 8).join(', ')
      const resto = codigos.length > 8 ? `, +${codigos.length - 8}` : ''
      console.log(`  "${texto}" — ${codigos.length} caso(s): ${muestra}${resto}`)
    }
  }

  if (!COMMIT) {
    console.log('\nDRY RUN. Nada se escribió. Volver a correr con --commit para aplicar.\n')
    return
  }

  let ok = 0
  for (const c of cambios) {
    const fila = filas.find(f => f.id === c.id)!
    const metadata = { ...(fila.metadata ?? {}), seccional: c.a }
    const { error: upErr } = await supabase.from('negocios').update({ metadata }).eq('id', c.id)
    if (upErr) {
      console.error(`  ✗ ${c.codigo ?? c.id}: ${upErr.message}`)
      continue
    }
    ok++
  }
  console.log(`\n${ok} de ${cambios.length} actualizados.\n`)
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
