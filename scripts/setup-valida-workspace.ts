/**
 * Setup de cliente Valida para un workspace ONE.
 *
 * Crea cliente_api + api_key en metrik-valida, y persiste la api_key plana
 * en workspaces.config_extra.valida_api_key del workspace en metrik-one.
 *
 * Uso:
 *   npx tsx scripts/setup-valida-workspace.ts <slug-workspace> "<nombre descriptivo>"
 *
 * Requiere en .env.local:
 *   - NEXT_PUBLIC_SUPABASE_URL              (proyecto ONE)
 *   - SUPABASE_SERVICE_ROLE_KEY             (proyecto ONE)
 *   - VALIDA_SUPABASE_URL                   (proyecto metrik-valida)
 *   - VALIDA_SUPABASE_SERVICE_ROLE_KEY      (proyecto metrik-valida)
 */

import { createClient } from '@supabase/supabase-js';
import { randomBytes, createHash } from 'crypto';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const slug = process.argv[2];
const nombre = process.argv[3];

if (!slug || !nombre) {
  console.error('Uso: npx tsx scripts/setup-valida-workspace.ts <slug-workspace> "<nombre descriptivo>"');
  process.exit(1);
}

const ONE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ONE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const VALIDA_URL = process.env.VALIDA_SUPABASE_URL!;
const VALIDA_KEY = process.env.VALIDA_SUPABASE_SERVICE_ROLE_KEY!;

if (!ONE_URL || !ONE_KEY || !VALIDA_URL || !VALIDA_KEY) {
  console.error('Faltan env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VALIDA_SUPABASE_URL, VALIDA_SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const one = createClient(ONE_URL, ONE_KEY, { auth: { persistSession: false } });
const valida = createClient(VALIDA_URL, VALIDA_KEY, { auth: { persistSession: false } });

async function main() {
  console.log(`\n→ Buscando workspace "${slug}" en ONE...`);
  const { data: ws, error: errWs } = await one
    .from('workspaces')
    .select('id, slug, name, config_extra')
    .eq('slug', slug)
    .single();

  if (errWs || !ws) {
    console.error(`Workspace ${slug} no encontrado: ${errWs?.message}`);
    process.exit(1);
  }
  console.log(`  workspace_id = ${ws.id}`);

  const existingKey = (ws.config_extra as Record<string, unknown> | null)?.valida_api_key;
  if (existingKey) {
    console.log(`\n[ATENCION] El workspace ya tiene valida_api_key configurada.`);
    console.log(`  Si quieres rotarla, primero revoca la actual en metrik-valida y vuelve a correr.`);
    process.exit(0);
  }

  console.log(`\n→ Creando cliente_api en metrik-valida...`);
  const { data: cliente, error: errCli } = await valida
    .from('clientes_api')
    .insert({
      tipo: 'workspace_one',
      nombre,
      workspace_one_id: ws.id,
      activo: true,
    })
    .select('cliente_id')
    .single();

  if (errCli || !cliente) {
    console.error(`Fallo creando cliente_api: ${errCli?.message}`);
    process.exit(1);
  }
  console.log(`  cliente_id = ${cliente.cliente_id}`);

  console.log(`\n→ Generando api_key...`);
  const plain = `vk_${randomBytes(32).toString('hex')}`;
  const hash = createHash('sha256').update(plain).digest('hex');
  const prefix = plain.slice(0, 12);

  const { error: errKey } = await valida.from('api_keys').insert({
    cliente_id: cliente.cliente_id,
    key_hash: hash,
    key_prefix: prefix,
    nombre_descriptivo: `${slug} via ONE`,
    activa: true,
  });

  if (errKey) {
    console.error(`Fallo creando api_key: ${errKey.message}`);
    process.exit(1);
  }
  console.log(`  prefix = ${prefix}...`);

  console.log(`\n→ Persistiendo api_key en workspace.${slug}.config_extra...`);
  const newConfig = {
    ...((ws.config_extra as Record<string, unknown> | null) ?? {}),
    valida_api_key: plain,
    valida_cliente_id: cliente.cliente_id,
  };
  const { error: errUpd } = await one
    .from('workspaces')
    .update({ config_extra: newConfig })
    .eq('id', ws.id);

  if (errUpd) {
    console.error(`Fallo actualizando workspace: ${errUpd.message}`);
    process.exit(1);
  }

  console.log(`\nLISTO. API key emitida y persistida en workspace ${slug}.`);
  console.log(`\nEntregar a Kaori para que la guarde en .credentials.md (seccion Valida — workspace ${slug}):`);
  console.log(`\n  api_key: ${plain}`);
  console.log(`  cliente_id: ${cliente.cliente_id}`);
  console.log(`  prefix: ${prefix}`);
  console.log(`\nLa key plana queda en server-only via workspaces.config_extra. NUNCA exponer al cliente.\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
