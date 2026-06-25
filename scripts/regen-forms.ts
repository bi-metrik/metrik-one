/**
 * Regenera TODOS los formularios (Generación + Envío) de un negocio existente,
 * releyendo los bloques fuente actuales. Usar tras corregir datos fuente.
 * Uso: npx tsx scripts/regen-forms.ts <negocioId>
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { generarFormularioCore } from '../src/lib/actions/formulario-actions'

for (const line of readFileSync(join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const PROFILE = '8b60b7aa-b62a-4beb-a6b8-d2ba1d96282b'
const FORM_DEF = 'c137f18e-62c3-4a9f-a2ea-09bee8a8b688' // bloque_definition de formularios
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as unknown as SupabaseClient

async function main() {
  const negocioId = process.argv[2]
  if (!negocioId) { console.error('falta negocioId'); process.exit(1) }
  // todas las instancias de formulario del negocio
  const { data: insts, error } = await supabase
    .from('negocio_bloques')
    .select('id, bloque_configs!inner(slug, bloque_definition_id, etapas_negocio!inner(numero))')
    .eq('negocio_id', negocioId)
    .eq('bloque_configs.bloque_definition_id', FORM_DEF)
  if (error) { console.error(error.message); process.exit(1) }
  for (const it of (insts ?? []) as Array<{ id: string; bloque_configs: { slug: string; etapas_negocio: { numero: number } } }>) {
    const r = await generarFormularioCore(supabase, WS, PROFILE, it.id, negocioId)
    console.log(`E${it.bloque_configs.etapas_negocio.numero} ${it.bloque_configs.slug}: ${r.success ? '✓ v' + r.version_n : '✗ ' + r.error}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
