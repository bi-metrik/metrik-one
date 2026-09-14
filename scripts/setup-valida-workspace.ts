/**
 * Setup de cliente Valida para un workspace ONE.
 *
 * Crea cliente_api + api_key en metrik-valida, y persiste la api_key plana
 * en Supabase Vault del proyecto ONE (`ws:<workspace_id>:valida_api_key`, via
 * `guardar_secreto_workspace`). `valida_cliente_id` (no secreto) sigue en
 * workspaces.config_extra.
 *
 * La api_key NO va en config_extra: esa columna la lee cualquier miembro del
 * workspace por REST (frente de seguridad del 2026-09-14).
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
    .select('id, slug, name, config_extra, modules')
    .eq('slug', slug)
    .single();

  if (errWs || !ws) {
    console.error(`Workspace ${slug} no encontrado: ${errWs?.message}`);
    process.exit(1);
  }
  console.log(`  workspace_id = ${ws.id}`);

  // Vault se consulta ANTES de crear nada en metrik-valida: si la migracion no esta
  // aplicada, fallar despues dejaria un cliente_api huerfano con una llave perdida.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: vault, error: errVault } = await (one as any).rpc('leer_secretos_workspace', {
    p_workspace_id: ws.id,
  });
  if (errVault) {
    console.error(
      `No se pudo leer Vault: ${errVault.message}` +
        (errVault.code === 'PGRST202' ? ' (falta aplicar la migracion 20260915010000_secretos_workspace_vault)' : ''),
    );
    process.exit(1);
  }
  const existingKey =
    (vault as Record<string, unknown> | null)?.valida_api_key ??
    (ws.config_extra as Record<string, unknown> | null)?.valida_api_key;
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

  console.log(`\n→ Persistiendo api_key en Vault (ws:${ws.id}:valida_api_key)...`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errSec } = await (one as any).rpc('guardar_secreto_workspace', {
    p_workspace_id: ws.id,
    p_clave: 'valida_api_key',
    p_valor: plain,
  });
  if (errSec) {
    console.error(`Fallo guardando la api_key en Vault: ${errSec.message}`);
    console.error(`  La llave YA existe en metrik-valida (cliente ${cliente.cliente_id}): revocala o guardala a mano.`);
    process.exit(1);
  }

  console.log(`\n→ Persistiendo valida_cliente_id en workspace.${slug}.config_extra...`);
  const newConfig = {
    ...((ws.config_extra as Record<string, unknown> | null) ?? {}),
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

  console.log(`\n→ Activando flag modules.valida_consulta en workspace ${slug}...`);
  const currentModules = ((ws as { modules?: Record<string, boolean> }).modules ?? {}) as Record<string, boolean>;
  const newModules = { ...currentModules, valida_consulta: true };
  const { error: errMod } = await one
    .from('workspaces')
    .update({ modules: newModules })
    .eq('id', ws.id);

  if (errMod) {
    console.error(`Fallo activando modules.valida_consulta: ${errMod.message}`);
    process.exit(1);
  }
  console.log(`  modules.valida_consulta = true`);

  console.log(`\nLISTO. Workspace ${slug} habilitado para Valida:`);
  console.log(`  1. api_key emitida y persistida en Vault`);
  console.log(`  2. modules.valida_consulta = true (sidebar muestra item Valida)`);
  console.log(`  3. Tutorial in-app auto-arrancara al primer ingreso de cada usuario`);
  console.log(`\nEntregar a Kaori para que guarde la api_key en .credentials.md (seccion Valida — workspace ${slug}):`);
  console.log(`\n  api_key: ${plain}`);
  console.log(`  cliente_id: ${cliente.cliente_id}`);
  console.log(`  prefix: ${prefix}`);
  console.log(`\nLa key plana queda en server-only via workspaces.config_extra. NUNCA exponer al cliente.\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
