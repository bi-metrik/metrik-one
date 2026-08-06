/**
 * Setup de credenciales Siigo para un workspace ONE.
 *
 * Autentica contra Siigo para COMPROBAR que las credenciales sirven, resuelve
 * los ids de catálogo de ESA empresa (comprobantes, vendedor, IVA, formas de
 * pago) y los persiste en workspaces.config_extra.
 *
 * Por qué un script y no una pantalla: el Access Key es una credencial fiscal.
 * Vive en config_extra (server-only) y se carga con revisión explícita, nunca
 * desde una server action del producto. Mismo criterio que Valida y Drive.
 *
 * Uso:
 *   npx tsx scripts/setup-siigo-workspace.ts <slug-workspace>
 *
 * Las credenciales se piden por stdin (no como argumento) para que no queden
 * en el historial del shell.
 *
 * Requiere en .env.local:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';
import { createInterface } from 'readline';

config({ path: resolve(process.cwd(), '.env.local') });

const SIIGO_BASE = 'https://api.siigo.com';
const slug = process.argv[2];

if (!slug) {
  console.error('Uso: npx tsx scripts/setup-siigo-workspace.ts <slug-workspace>');
  process.exit(1);
}

const ONE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ONE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!ONE_URL || !ONE_KEY) {
  console.error('Faltan env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const one = createClient(ONE_URL, ONE_KEY, { auth: { persistSession: false } });

// El script se usa a mano, pero tambien se automatiza con una tuberia. Los dos
// modos necesitan tratos distintos:
//   - TTY: una UNICA interfaz readline (crear una por pregunta rompe el stream).
//   - Tuberia: readline se cierra sola al llegar el EOF, que ocurre ANTES de la
//     primera pregunta porque main() hace consultas asincronas primero. Por eso
//     se lee stdin completo de entrada y se responde desde una cola.
let cola: string[] | null = null;
let rl: ReturnType<typeof createInterface> | null = null;

async function prepararEntrada(): Promise<void> {
  if (process.stdin.isTTY) {
    rl = createInterface({ input: process.stdin, output: process.stdout });
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  cola = Buffer.concat(chunks).toString('utf8').split('\n');
}

function preguntar(texto: string): Promise<string> {
  if (cola) {
    // Se imprime la pregunta pero NUNCA la respuesta: por aqui pasa el Access Key.
    console.log(texto);
    return Promise.resolve((cola.shift() ?? '').trim());
  }
  return new Promise(res => rl!.question(texto, ans => res(ans.trim())));
}

async function siigoGet<T>(token: string, partnerId: string, path: string): Promise<T> {
  const r = await fetch(`${SIIGO_BASE}${path}`, {
    headers: { Authorization: token, 'Partner-Id': partnerId },
  });
  if (!r.ok) throw new Error(`GET ${path} → HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T;
}

async function main() {
  await prepararEntrada();

  const { data: ws, error } = await one
    .from('workspaces')
    .select('id, slug, name, config_extra')
    .eq('slug', slug)
    .single();

  if (error || !ws) {
    // Mostrar el error real: "no se encontró" ocultaba un fallo de consulta
    // (una columna mal nombrada se ve igual que un workspace inexistente).
    console.error(`No se pudo leer el workspace "${slug}"${error ? `: ${error.message}` : ' (no existe)'}`);
    process.exit(1);
  }

  console.log(`\nWorkspace: ${(ws as { name?: string }).name ?? slug} (${(ws as { id: string }).id})\n`);

  const username = await preguntar('Usuario API de Siigo: ');
  const accessKey = await preguntar('Access Key (no queda en el historial): ');
  const partnerId = await preguntar('Partner-Id: ');

  // 1. Comprobar que las credenciales sirven ANTES de guardarlas. Guardar sin
  //    comprobar deja al workspace con una credencial muerta que solo se
  //    descubre cuando alguien intenta facturar.
  process.stdout.write('\nAutenticando contra Siigo... ');
  const authRes = await fetch(`${SIIGO_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Partner-Id': partnerId },
    body: JSON.stringify({ username, access_key: accessKey }),
  });
  if (!authRes.ok) {
    console.error(`FALLÓ (HTTP ${authRes.status}). No se guardó nada.`);
    process.exit(1);
  }
  const { access_token: token, expires_in } = (await authRes.json()) as {
    access_token: string; expires_in: number;
  };
  console.log(`OK (token válido ${expires_in}s)\n`);

  // 2. Resolver el catálogo de ESTA empresa. Los ids son distintos en cada
  //    Siigo: hardcodearlos es garantía de facturar con el comprobante ajeno.
  type Doc = { id: number; name: string; active: boolean; electronic_type?: string };
  type Tax = { id: number; name: string; type: string; percentage: number; active: boolean };
  type Pay = { id: number; name: string; active: boolean };
  type User = { id: number; username: string; identification: string; active: boolean };

  const [docsFV, docsRC, taxes, paysFV, paysRC, users] = await Promise.all([
    siigoGet<Doc[]>(token, partnerId, '/v1/document-types?type=FV'),
    siigoGet<Doc[]>(token, partnerId, '/v1/document-types?type=RC'),
    siigoGet<Tax[]>(token, partnerId, '/v1/taxes'),
    siigoGet<Pay[]>(token, partnerId, '/v1/payment-types?document_type=FV'),
    siigoGet<Pay[]>(token, partnerId, '/v1/payment-types?document_type=RC'),
    siigoGet<{ results: User[] }>(token, partnerId, '/v1/users'),
  ]);

  console.log('Comprobantes de venta (FV):');
  docsFV.forEach(d => console.log(`  id=${d.id}  ${d.name}  [${d.electronic_type}]  activo=${d.active}`));
  console.log('\nComprobantes de recibo (RC):');
  docsRC.forEach(d => console.log(`  id=${d.id}  ${d.name}  activo=${d.active}`));
  console.log('\nImpuestos IVA:');
  taxes.filter(t => t.type === 'IVA').forEach(t => console.log(`  id=${t.id}  ${t.name}  ${t.percentage}%`));
  console.log('\nFormas de pago (factura):');
  paysFV.forEach(p => console.log(`  id=${p.id}  ${p.name}`));
  console.log('\nFormas de pago (recibo):');
  paysRC.forEach(p => console.log(`  id=${p.id}  ${p.name}`));
  console.log('\nVendedores:');
  users.results.forEach(u => console.log(`  id=${u.id}  ${u.username}  NIT=${u.identification}`));

  console.log('\n--- Elige los ids que va a usar ONE ---');
  const facturaDocumentId = Number(await preguntar('  Comprobante de FACTURA (id): '));
  const reciboDocumentId = Number(await preguntar('  Comprobante de RECIBO DE CAJA (id): '));
  const sellerId = Number(await preguntar('  Vendedor (id): '));
  const ivaId = Number(await preguntar('  IVA (id): '));
  const facturaPaymentId = Number(await preguntar('  Forma de pago de la FACTURA (id): '));
  const reciboPaymentId = Number(await preguntar('  Forma de pago del RECIBO (id): '));
  const productoCode = await preguntar('  Código del PRODUCTO a facturar: ');

  const siigo_config = {
    facturaDocumentId, reciboDocumentId, sellerId, ivaId,
    facturaPaymentId, reciboPaymentId, productoCode,
  };

  if (Object.entries(siigo_config).some(([, v]) => v === '' || (typeof v === 'number' && !Number.isFinite(v)))) {
    console.error('\nAlgún valor quedó vacío o no es numérico. No se guardó nada.');
    process.exit(1);
  }

  // 3. Persistir preservando el resto de config_extra. Un update del objeto
  //    completo borraría las credenciales de Drive del mismo workspace.
  const prev = ((ws as { config_extra?: Record<string, unknown> }).config_extra ?? {}) as Record<string, unknown>;
  const { error: upErr } = await one
    .from('workspaces')
    .update({
      config_extra: {
        ...prev,
        siigo_username: username,
        siigo_access_key: accessKey,
        siigo_partner_id: partnerId,
        siigo_config,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .eq('id', (ws as { id: string }).id);

  if (upErr) {
    console.error('\nNo se pudo guardar:', upErr.message);
    process.exit(1);
  }

  console.log('\nListo. Credenciales y catálogo guardados en config_extra.');
  console.log('Recordatorio: si el Access Key circuló por chat o correo, restablécelo en Siigo y vuelve a correr este script.');
  rl?.close();
}

main().catch(e => { console.error('\n', e instanceof Error ? e.message : e); process.exit(1); });
