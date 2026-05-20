/* eslint-disable */
// Refactor VE SOENA 2026-05-18 — aplicado via supabase-js
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const envFile = readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(line => {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
});

const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5';
const LINEA = '34a0fa6b-9ed3-4652-a419-42601132d1a8';

// Order map: etapaId -> newOrden, (and stageOverride)
const ORDER_MAP = [
  ['649da0e1-dc71-4812-9948-36ab0588420f', 1, null,        'Contacto'],
  ['530bae2a-870c-4722-a3ef-6d077fd6d546', 2, null,        'Validacion'],
  ['0b15beac-02d3-42b1-9c1d-fe24ae02133f', 3, 'venta',     'Inclusion'],
  ['6ab4b78b-2e59-4206-b5a3-8dd2850a3461', 4, null,        'Negociacion'],
  ['fe3f49e0-0116-4540-82f4-96e506cedad1', 5, null,        'Documentacion'],
  ['fd0fcaf3-5547-4a16-85e2-5e0f5845c7c2', 6, null,        'Radicacion'],
  ['f027ee47-4399-4119-a97c-2f4fffb17386', 7, null,        'Certificacion'],
  ['0be50010-a636-4b35-9938-eec26892a108', 8, null,        'Cobro'],
  ['45ebd464-b231-4c2a-9007-d283e623f766', 9, null,        'Devolucion']
];

async function run() {
  console.log('=== PASO 1: bumpear ordenes a +100 (anti UNIQUE) ===');
  for (const [id, , , name] of ORDER_MAP) {
    const { data: cur } = await svc.from('etapas_negocio').select('orden').eq('id', id).single();
    const newOrden = cur.orden + 100;
    const { error } = await svc.from('etapas_negocio').update({ orden: newOrden }).eq('id', id);
    if (error) throw new Error(`bump ${name}: ${error.message}`);
    console.log(`  ${name}: orden ${cur.orden} -> ${newOrden}`);
  }

  console.log('\n=== PASO 1b: asentar ordenes finales ===');
  for (const [id, newOrden, stage, name] of ORDER_MAP) {
    const patch = { orden: newOrden };
    if (stage) patch.stage = stage;
    const { error } = await svc.from('etapas_negocio').update(patch).eq('id', id);
    if (error) throw new Error(`set ${name}: ${error.message}`);
    console.log(`  ${name}: orden=${newOrden}${stage ? ` stage=${stage}` : ''}`);
  }

  console.log('\n=== PASO 2: routing UPME en Validacion (orden 2) ===');
  const validacionConfig = {
    routing: {
      conditional: [
        { condition: { field: 'cargado_upme', value: 'no' }, etapa_orden: 3 }
      ],
      default_etapa_orden: 4
    }
  };
  {
    const { error } = await svc.from('etapas_negocio')
      .update({ config_extra: validacionConfig })
      .eq('id', '530bae2a-870c-4722-a3ef-6d077fd6d546');
    if (error) throw new Error(`validacion routing: ${error.message}`);
    console.log('  OK');
  }

  console.log('\n=== PASO 3: routing condicional Devolucion IVA en Cobro (orden 8) ===');
  const cobroConfig = {
    gates: ['saldo_cero'],
    routing: {
      source_etapa_orden: 4,
      conditional: [
        { condition: { field: 'requiere_devolucion_iva', value: 'true' }, etapa_orden: 9 }
      ],
      default_etapa_orden: 8
    }
  };
  {
    const { error } = await svc.from('etapas_negocio')
      .update({ config_extra: cobroConfig })
      .eq('id', '0be50010-a636-4b35-9938-eec26892a108');
    if (error) throw new Error(`cobro routing: ${error.message}`);
    console.log('  OK');
  }

  // Helper: patch bloque_config config_extra by reading current then writing merged jsonb
  async function patchBloque(id, mutator, label) {
    const { data, error } = await svc.from('bloque_configs').select('config_extra').eq('id', id).single();
    if (error) throw new Error(`read ${id} (${label}): ${error.message}`);
    const newCE = mutator(structuredClone(data.config_extra));
    const { error: uerr } = await svc.from('bloque_configs').update({ config_extra: newCE }).eq('id', id);
    if (uerr) throw new Error(`write ${id} (${label}): ${uerr.message}`);
    console.log(`  ${label}: OK`);
  }

  console.log('\n=== PASO 4: source_etapa_orden=3 -> 2 (referencias a Validacion) ===');
  await patchBloque('a65c7a01-44b2-46a8-8790-d2a5dc9cfa24', ce => { ce.source_etapa_orden = 2; return ce; }, 'a65c7a01 Inclusion: Factura venta heredada');
  await patchBloque('cd648fdf-f8fe-4bc8-a5e0-2a78d8871597', ce => { ce.source_etapa_orden = 2; return ce; }, 'cd648fdf Radicacion: Factura venta heredada');
  await patchBloque('417976a3-8750-4e55-8455-f6ebef4e2ed4', ce => { ce.source_etapa_orden = 2; return ce; }, '417976a3 Documentacion: Factura venta heredada');
  await patchBloque('ab39f31b-a05e-46e8-9294-cf4e1b68b18b', ce => { ce.source_etapa_orden = 2; ce.condition.source_etapa_orden = 2; return ce; }, 'ab39f31b Inclusion: Ficha tecnica heredada');
  await patchBloque('61523f3b-3987-482d-937e-3d1a9ceaa89f', ce => { ce.source_etapa_orden = 2; ce.condition.source_etapa_orden = 2; return ce; }, '61523f3b Inclusion: Certificado emisiones heredado');
  await patchBloque('4821f586-742c-4f05-a463-1c9fe0a4c19a', ce => { ce.condition.source_etapa_orden = 2; return ce; }, '4821f586 Validacion: Ficha tecnica (autoref)');
  await patchBloque('c730288e-a974-4bd4-a075-b5467df6f92e', ce => { ce.condition.source_etapa_orden = 2; return ce; }, 'c730288e Validacion: Certificado emisiones (autoref)');

  console.log('\n=== PASO 5: auto_fill source_etapa_orden=3 -> 2 (Vehiculo a reemplazar) ===');
  await patchBloque('4693f275-1289-4a0d-8e3d-db1bf757d753', ce => {
    ce.fields[1].auto_fill.source_etapa_orden = 2;
    ce.fields[2].auto_fill.source_etapa_orden = 2;
    return ce;
  }, '4693f275 Documentacion: Vehiculo a reemplazar editable');
  await patchBloque('327e62c9-3984-4354-9426-17b7ad71c9dd', ce => {
    ce.fields[1].auto_fill.source_etapa_orden = 2;
    ce.fields[2].auto_fill.source_etapa_orden = 2;
    return ce;
  }, '327e62c9 Radicacion: Vehiculo a reemplazar heredado');

  console.log('\n=== PASO 6: radicado inclusion heredado source=4->3, condition=3->2 ===');
  await patchBloque('6f553add-b2eb-45be-b1a2-7bd2dd89be05', ce => {
    ce.source_etapa_orden = 3;
    ce.condition.source_etapa_orden = 2;
    return ce;
  }, '6f553add Certificacion: Radicado inclusion heredado');
  await patchBloque('7713f66f-24aa-4261-839c-09ab3cb4ab2e', ce => {
    ce.source_etapa_orden = 3;
    ce.condition.source_etapa_orden = 2;
    return ce;
  }, '7713f66f Radicacion: Radicado inclusion heredado');

  console.log('\n=== PASO 7: readonly Devolucion IVA source=2 -> 4 ===');
  const devIvaIds = [
    '476bd808-f03c-41bc-a7b9-2f032687d18f',
    '81e3e343-11b4-43a2-9d72-8a3049ef5b32',
    '8f73a9f0-2506-4954-adab-7343c9ca6160',
    '0120cd03-3fa9-467b-8860-e192ec5238bc',
    '56bf2b2b-1b80-42be-a29a-693ec5dae468',
    '027cc8f9-93a7-4ed4-bc5d-4b4c953c3dcd',
    '5d45bae1-3973-4ec3-9f29-6ae613d6d0e1'
  ];
  for (const id of devIvaIds) {
    await patchBloque(id, ce => { ce.source_etapa_orden = 4; return ce; }, `${id.slice(0,8)} readonly Devolucion IVA`);
  }
  await patchBloque('5d744172-172f-406b-8da6-4a126eb70ed3', ce => {
    ce.condition.source_etapa_orden = 4;
    return ce;
  }, '5d744172 Documentacion: Certificado bancario condition');

  console.log('\n=== PASO 8: campos_fuente.etapa_orden=3 -> 2 en bloques Devolucion ===');
  const devBlockIds = [
    'e0e92bdb-b6f3-48db-b9f8-26044be02b67',
    'f2878f39-5f3a-4067-abe2-3d15ba1a1c03',
    '123b34e1-11bf-4965-9bff-b1ed29013782'
  ];
  for (const id of devBlockIds) {
    await patchBloque(id, ce => {
      const cf = ce.campos_fuente || [];
      for (const item of cf) {
        if (item.source && item.source.etapa_orden === 3) {
          item.source.etapa_orden = 2;
        }
      }
      ce.campos_fuente = cf;
      return ce;
    }, `${id.slice(0,8)} Devolucion: campos_fuente etapa_orden`);
  }

  console.log('\n=== HECHO ===');
}

run().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
