/** QA seccional: fija data.seccional en el 010 de un negocio y regenera, imprime snapshot.
 * Uso: npx tsx scripts/qa-seccional.ts <negocioId> <Seccional> */
import { readFileSync } from 'node:fs'; import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { generarFormularioCore } from '../src/lib/actions/formulario-actions'
for (const l of readFileSync(join(process.cwd(), '.env.local'), 'utf8').split('\n')) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if (m&&!process.env[m[1]]) process.env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'') }
const WS='7dea141d-d4da-483d-a78d-b14ef35500c5', PROFILE='8b60b7aa-b62a-4beb-a6b8-d2ba1d96282b'
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as unknown as SupabaseClient
async function main(){
  const [negocioId, seccional]=process.argv.slice(2)
  // 010 de Generación (slug formulario_dian)
  const { data: inst }=await sb.from('negocio_bloques').select('id, data, bloque_configs!inner(slug)').eq('negocio_id', negocioId).eq('bloque_configs.slug','formulario_dian').maybeSingle()
  const it=inst as { id:string; data:Record<string,unknown> }
  await sb.from('negocio_bloques').update({ data: { ...(it.data||{}), seccional } }).eq('id', it.id)
  const r=await generarFormularioCore(sb, WS, PROFILE, it.id, negocioId)
  console.log(`seccional=${seccional} → ${r.success?'✓ v'+r.version_n:'✗ '+r.error}`)
  const { data: v }=await sb.from('formulario_versiones').select('datos_snapshot').eq('negocio_bloque_id', it.id).order('version_n',{ascending:false}).limit(1).maybeSingle()
  const s=(v as {datos_snapshot:Record<string,unknown>}|null)?.datos_snapshot||{}
  for (const k of ['direccion_seccional','tipo_obligacion','concepto_saldo','nombre_documento','razon_social_011','mostrar_razon_social','cod_representacion_1005','organizacion_1006']) console.log(`   ${k}: ${JSON.stringify(s[k])}`)
}
main().catch(e=>{console.error(e);process.exit(1)})
