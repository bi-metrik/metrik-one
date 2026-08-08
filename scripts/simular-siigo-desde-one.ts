/**
 * Simulación: ¿ONE puede reconstruir los documentos que SOENA ya emitió en Siigo?
 *
 * Toma los clientes de Siigo que tienen recibo de caja Y factura, los cruza con
 * los negocios de ONE por número de identificación, y compara lo que ONE
 * ENVIARÍA contra lo que realmente existe en Siigo.
 *
 * NO escribe nada, ni en Siigo ni en ONE. Es una medición.
 *
 * Por qué así: validar el mapeo contra documentos reales ya emitidos es la única
 * forma de saber si el algoritmo sirve ANTES de emitir uno de verdad. Una factura
 * electrónica aceptada por la DIAN no se deshace.
 *
 * Uso:
 *   npx tsx scripts/simular-siigo-desde-one.ts <slug-workspace> [--detalle <cedula>]
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const slug = process.argv[2];
const idxDetalle = process.argv.indexOf('--detalle');
const cedulaDetalle = idxDetalle > -1 ? process.argv[idxDetalle + 1] : null;

if (!slug) {
  console.error('Uso: npx tsx scripts/simular-siigo-desde-one.ts <slug-workspace> [--detalle <cedula>]');
  process.exit(1);
}

const COP = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);

interface SiigoDoc { id: string; name: string; date: string; total?: number; customer?: { identification?: string }; payment?: { value?: number }; observations?: string; items?: Array<{ code?: string; price?: number; quantity?: number }>; stamp?: { status?: string } }

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const { siigoRequest } = await import('../src/lib/siigo/client');

  const one = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data: ws } = await one.from('workspaces').select('id, name').eq('slug', slug).single();
  if (!ws) { console.error(`Workspace "${slug}" no existe`); process.exit(1); }
  const wsId = (ws as { id: string }).id;

  // ── 1. Documentos reales en Siigo ──────────────────────────────────────────
  const facturas: SiigoDoc[] = [];
  for (let page = 1; ; page++) {
    const r = await siigoRequest<{ results: SiigoDoc[]; pagination: { total_results: number } }>(
      wsId, `/v1/invoices?created_start=2020-01-01&page=${page}&page_size=100`);
    facturas.push(...r.results);
    if (facturas.length >= r.pagination.total_results || r.results.length === 0) break;
  }
  const recibos: SiigoDoc[] = [];
  for (let page = 1; ; page++) {
    const r = await siigoRequest<{ results: SiigoDoc[]; pagination: { total_results: number } }>(
      wsId, `/v1/vouchers?page=${page}&page_size=100`);
    recibos.push(...r.results);
    if (recibos.length >= r.pagination.total_results || r.results.length === 0) break;
  }
  console.log(`\nSiigo: ${facturas.length} facturas, ${recibos.length} recibos de caja`);

  const porCedula = new Map<string, { fac: SiigoDoc[]; rec: SiigoDoc[] }>();
  const push = (d: SiigoDoc, k: 'fac' | 'rec') => {
    const id = d.customer?.identification;
    if (!id) return;
    if (!porCedula.has(id)) porCedula.set(id, { fac: [], rec: [] });
    porCedula.get(id)![k].push(d);
  };
  facturas.forEach(f => push(f, 'fac'));
  recibos.forEach(r => push(r, 'rec'));

  const conAmbos = [...porCedula.entries()].filter(([, v]) => v.fac.length > 0 && v.rec.length > 0);
  console.log(`Clientes con AMBOS documentos: ${conAmbos.length}`);
  // El universo con recibo UPME es diminuto (el recaudo por recibo apenas se
  // esta estrenando), asi que el algoritmo de FACTURA se valida contra TODAS
  // las facturas, no solo las de clientes que ademas tienen recibo. Medir el
  // algoritmo sobre 1 caso no valida nada.
  const conFactura = [...porCedula.entries()].filter(([, v]) => v.fac.length > 0);
  console.log(`Clientes con factura: ${conFactura.length}`);

  // ── 2. Lo que ONE tiene ────────────────────────────────────────────────────
  // Se lee el dato crudo de los bloques, no una función del producto: la
  // comprobación no puede heredar el supuesto del código que se está probando.
  const { data: rows } = await one.rpc('exec_sql_readonly' as never, {} as never).then(
    () => ({ data: null }),
    () => ({ data: null }),
  );
  void rows;

  const { data: negocios } = await one
    .from('negocios')
    .select('id, codigo, nombre, estado, precio_aprobado, etapa_actual_id')
    .eq('workspace_id', wsId);

  const { data: bloques } = await one
    .from('negocio_bloques')
    .select('negocio_id, data, bloque_configs!inner(slug)')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .in('bloque_configs.slug' as any, ['rut', 'confirmar_tarifa_upme', 'tarifa_a_pagar']);

  type Bl = { negocio_id: string; data: Record<string, unknown> | null; bloque_configs: { slug: string } };
  const rutPorNegocio = new Map<string, Record<string, string>>();
  const tarifaPorNegocio = new Map<string, number>();

  for (const b of ((bloques ?? []) as unknown as Bl[])) {
    const slugB = b.bloque_configs?.slug;
    const campos = (b.data?.campos ?? {}) as Record<string, { value?: unknown } | undefined>;
    if (slugB === 'rut') {
      const plano: Record<string, string> = {};
      for (const [k, v] of Object.entries(campos)) {
        if (v?.value != null && v.value !== '') plano[k] = String(v.value);
      }
      if (plano.numero_identificacion) rutPorNegocio.set(b.negocio_id, plano);
    } else {
      // La tarifa puede vivir en data.campos o directo en data según el bloque.
      const d = (b.data ?? {}) as Record<string, unknown>;
      const cand = [campos.tarifa_upme?.value, campos.valor_tarifa?.value, campos.tarifa?.value,
                    d.tarifa_upme, d.valor_tarifa, d.tarifa]
        .find(v => v != null && v !== '');
      const n = Number(String(cand ?? '').replace(/[^\d.-]/g, ''));
      if (Number.isFinite(n) && n > 0) tarifaPorNegocio.set(b.negocio_id, n);
    }
  }

  const negPorCedula = new Map<string, { id: string; codigo: string; nombre: string; precio: number | null; rut: Record<string, string> }>();
  for (const n of ((negocios ?? []) as Array<{ id: string; codigo: string; nombre: string; precio_aprobado: number | null }>)) {
    const rut = rutPorNegocio.get(n.id);
    if (!rut) continue;
    negPorCedula.set(rut.numero_identificacion, {
      id: n.id, codigo: n.codigo, nombre: n.nombre, precio: n.precio_aprobado, rut,
    });
  }
  console.log(`ONE: ${negPorCedula.size} negocios con RUT extraído\n`);

  // ── 3. Comparación ─────────────────────────────────────────────────────────
  let cruzados = 0, precioOk = 0, precioConIva = 0, precioDistinto = 0;
  let tarifaOk = 0, tarifaDistinta = 0, sinTarifa = 0;
  const problemasCiudad: string[] = [];

  for (const [ced, docs] of conFactura) {
    const neg = negPorCedula.get(ced);
    if (!neg) continue;
    cruzados++;

    const totalFactura = docs.fac.reduce((s, f) => s + (f.total ?? 0), 0);
    const valorRecibo = docs.rec.reduce((s, r) => s + (r.payment?.value ?? 0), 0);
    const precio = neg.precio ?? 0;

    // ¿precio_aprobado de ONE es el total CON IVA de la factura, o la base?
    if (Math.abs(precio - totalFactura) <= 1) precioOk++;
    else if (Math.abs(precio * 1.19 - totalFactura) <= 2) precioConIva++;
    else precioDistinto++;

    const tarifa = tarifaPorNegocio.get(neg.id);
    if (tarifa == null) sinTarifa++;
    else if (Math.abs(tarifa - valorRecibo) <= 1) tarifaOk++;
    else tarifaDistinta++;

    if (cedulaDetalle && ced === cedulaDetalle) {
      console.log(`--- DETALLE ${ced} · ${neg.codigo} ${neg.nombre} ---`);
      console.log(`  ONE precio_aprobado: ${COP(precio)}   |  Siigo factura(s): ${COP(totalFactura)} (${docs.fac.map(f => f.name).join(', ')})`);
      console.log(`  ONE tarifa UPME:     ${COP(tarifa)}   |  Siigo recibo(s):  ${COP(valorRecibo)} (${docs.rec.map(r => r.name).join(', ')})`);
      console.log('  RUT en ONE:');
      Object.entries(neg.rut).sort().forEach(([k, v]) => console.log(`    ${k}: ${v}`));
      const cli = await siigoRequest<{ results: unknown[] }>(wsId, `/v1/customers?identification=${ced}`);
      console.log('  Cliente en Siigo:');
      console.log('   ', JSON.stringify(cli.results?.[0] ?? null).slice(0, 900));
      console.log();
    }

    // Señal de ciudad: el RUT trae codigo_departamento con el código de PAÍS
    if (neg.rut.codigo_departamento === neg.rut.codigo_pais) problemasCiudad.push(ced);
  }

  console.log('=== RESULTADO DE LA SIMULACIÓN ===');
  console.log(`Clientes con factura en Siigo:              ${conFactura.length}`);
  console.log(`  de esos, cruzados con un negocio de ONE:   ${cruzados}`);
  console.log(`  sin negocio en ONE:                        ${conFactura.length - cruzados}`);
  console.log(`(clientes que ademas tienen recibo de caja:  ${conAmbos.length})`);
  console.log('\nprecio_aprobado (ONE) vs total factura (Siigo):');
  console.log(`  coincide exacto (precio ya trae IVA):      ${precioOk}`);
  console.log(`  coincide si se le suma IVA (precio = base):${precioConIva}`);
  console.log(`  no coincide de ninguna forma:              ${precioDistinto}`);
  console.log('\ntarifa UPME (ONE) vs recibo de caja (Siigo):');
  console.log(`  coincide:                                  ${tarifaOk}`);
  console.log(`  distinta:                                  ${tarifaDistinta}`);
  console.log(`  ONE no tiene tarifa registrada:            ${sinTarifa}`);
  console.log(`\nRUT con codigo_departamento = codigo_pais (dato inservible para Siigo): ${problemasCiudad.length} de ${cruzados}`);
}

main().catch(e => { console.error('\nFALLÓ:', e instanceof Error ? e.message : e); process.exit(1); });
