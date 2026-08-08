/**
 * Diagnóstico de la conexión Siigo de un workspace.
 *
 * Ejercita el MISMO cliente que usa el producto (`siigoRequest`), no una copia
 * del payload: si esto pasa, lo que se despliega funciona. Solo lectura, no
 * crea ni modifica nada en Siigo.
 *
 * Uso:
 *   npx tsx scripts/check-siigo.ts <slug-workspace>
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const slug = process.argv[2];
if (!slug) {
  console.error('Uso: npx tsx scripts/check-siigo.ts <slug-workspace>');
  process.exit(1);
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const { siigoRequest, getSiigoConfig, claveIdempotencia } = await import('../src/lib/siigo/client');

  const one = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data: ws } = await one.from('workspaces').select('id, name').eq('slug', slug).single();
  if (!ws) { console.error(`Workspace "${slug}" no existe`); process.exit(1); }
  const wsId = (ws as { id: string }).id;
  console.log(`\nWorkspace: ${(ws as { name?: string }).name ?? slug}\n`);

  // 1. Configuración guardada
  const cfg = await getSiigoConfig(wsId);
  console.log('Configuración de catálogo:');
  Object.entries(cfg).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  // 2. Autenticación + petición real (el token se mintea dentro del cliente)
  type Doc = { id: number; name: string; electronic_type?: string };
  const docs = await siigoRequest<Doc[]>(wsId, '/v1/document-types?type=FV');
  const doc = docs.find(d => d.id === cfg.facturaDocumentId);
  console.log(`\nComprobante de factura configurado: ${doc ? `"${doc.name}" [${doc.electronic_type}]` : 'NO EXISTE en este Siigo'}`);
  if (!doc) process.exitCode = 1;

  // 3. El producto configurado existe
  type Prod = { code: string; name: string; active: boolean };
  const prods = await siigoRequest<{ results: Prod[] }>(wsId, '/v1/products?page_size=100');
  const prod = prods.results.find(p => p.code === cfg.productoCode);
  console.log(`Producto configurado: ${prod ? `"${prod.name}" (activo=${prod.active})` : 'NO EXISTE en este Siigo'}`);
  if (!prod) process.exitCode = 1;

  // 4. El segundo llamado debe reusar el token cacheado (no re-autenticar)
  const t0 = Date.now();
  await siigoRequest<Doc[]>(wsId, '/v1/document-types?type=RC');
  console.log(`\nSegunda petición (token cacheado): ${Date.now() - t0} ms`);

  // 5. La clave de idempotencia cabe en el tope de Siigo (30 caracteres)
  const k = claveIdempotencia(wsId);
  const k2 = claveIdempotencia(wsId, 2);
  const ok = k.length <= 30 && /^[a-zA-Z0-9]+$/.test(k) && k !== k2;
  console.log(`Clave de idempotencia: "${k}" (${k.length} chars) · con sufijo distinta: ${k !== k2} · válida: ${ok}`);
  if (!ok) process.exitCode = 1;

  // 6. Un error de Siigo tiene que llegar legible, no como "HTTP 400". Se
  //    provoca uno inofensivo (falta un parámetro obligatorio en un GET).
  //    Probar solo el camino feliz deja sin verificar justo lo que el operador
  //    va a leer cuando algo falle.
  try {
    await siigoRequest(wsId, '/v1/payment-types');
    console.log('\n⚠️  Se esperaba un error de Siigo y no llegó: revisar describirError()');
    process.exitCode = 1;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const legible = !/^Siigo respondió HTTP/.test(msg);
    console.log(`\nError de Siigo traducido: "${msg}"`);
    if (!legible) { console.log('⚠️  Llegó el genérico: el cuerpo del error no se está parseando'); process.exitCode = 1; }
  }

  console.log(process.exitCode ? '\nHAY PROBLEMAS (ver arriba)' : '\nConexión OK');
}

main().catch(e => { console.error('\nFALLÓ:', e instanceof Error ? e.message : e); process.exit(1); });
