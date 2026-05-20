import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
const envFile = readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(line => {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
});
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const LINEA = '34a0fa6b-9ed3-4652-a419-42601132d1a8';
const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5';

console.log('=== 5.1 Etapas orden + stage final ===');
const { data: etapas } = await svc.from('etapas_negocio')
  .select('orden,nombre,stage,id,config_extra')
  .eq('linea_id', LINEA)
  .order('orden');
for (const e of etapas) {
  console.log(`  ${e.orden}. ${e.nombre.padEnd(15)} stage=${e.stage}  id=${e.id}`);
  if (e.config_extra && Object.keys(e.config_extra).length) {
    console.log('     config_extra:', JSON.stringify(e.config_extra));
  }
}

console.log('\n=== 5.2 Routing Validacion ===');
const { data: val } = await svc.from('etapas_negocio').select('nombre,config_extra').eq('id', '530bae2a-870c-4722-a3ef-6d077fd6d546').single();
console.log(JSON.stringify(val, null, 2));

console.log('\n=== 5.2b Routing Cobro ===');
const { data: cob } = await svc.from('etapas_negocio').select('nombre,config_extra').eq('id', '0be50010-a636-4b35-9938-eec26892a108').single();
console.log(JSON.stringify(cob, null, 2));

console.log('\n=== 5.3 Buscar source_etapa_orden=2 residuales (espero solo readonly Devolucion IVA = NO, deben estar en 4) ===');
const ids = ['649da0e1-dc71-4812-9948-36ab0588420f','530bae2a-870c-4722-a3ef-6d077fd6d546','0b15beac-02d3-42b1-9c1d-fe24ae02133f','6ab4b78b-2e59-4206-b5a3-8dd2850a3461','fe3f49e0-0116-4540-82f4-96e506cedad1','fd0fcaf3-5547-4a16-85e2-5e0f5845c7c2','f027ee47-4399-4119-a97c-2f4fffb17386','0be50010-a636-4b35-9938-eec26892a108','45ebd464-b231-4c2a-9007-d283e623f766'];
const { data: bcs } = await svc.from('bloque_configs').select('id,etapa_id,nombre,orden,config_extra').in('etapa_id', ids);
const idToEtapa = Object.fromEntries(etapas.map(e => [e.id, `${e.orden}.${e.nombre}`]));

function walk(obj, path, cb) {
  if (obj && typeof obj === 'object') {
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => walk(v, `${path}[${i}]`, cb));
    } else {
      for (const k of Object.keys(obj)) {
        if (k === 'source_etapa_orden' || k === 'etapa_orden') {
          cb(`${path}.${k}`, obj[k]);
        }
        walk(obj[k], `${path}.${k}`, cb);
      }
    }
  }
}

const findings = {};
for (const bc of bcs) {
  const ce = bc.config_extra || {};
  walk(ce, '', (p, v) => {
    if (typeof v === 'number') {
      const key = `etapa=${idToEtapa[bc.etapa_id]} block=${bc.id.slice(0,8)}-${bc.nombre || '?'} path=${p} val=${v}`;
      (findings[v] = findings[v] || []).push(key);
    }
  });
}

console.log('Distribucion de referencias etapa_orden / source_etapa_orden por valor:');
for (const v of Object.keys(findings).sort()) {
  console.log(`\n--- valor=${v} (${findings[v].length} refs) ---`);
  for (const f of findings[v]) console.log('  ' + f);
}

console.log('\n=== 5.4 Bloques Devolucion (etapa 9) campos_fuente verificacion ===');
const devIds = ['e0e92bdb-b6f3-48db-b9f8-26044be02b67','f2878f39-5f3a-4067-abe2-3d15ba1a1c03','123b34e1-11bf-4965-9bff-b1ed29013782'];
const { data: devBc } = await svc.from('bloque_configs').select('id,nombre,config_extra').in('id', devIds);
for (const b of devBc) {
  const ords = new Set();
  for (const cf of (b.config_extra.campos_fuente || [])) {
    if (cf.source?.etapa_orden) ords.add(cf.source.etapa_orden);
  }
  console.log(`  ${b.id.slice(0,8)} ${b.config_extra.label || b.nombre}: etapa_orden refs = [${[...ords].sort().join(',')}]`);
}
