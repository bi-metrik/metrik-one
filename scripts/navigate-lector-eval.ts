// Eval del LECTOR de Navigate (la unica puerta del modelo) contra el golden set, con un
// modelo VIVO. No corre en CI: cuesta, tarda y no es determinista. Lo que si corre en CI es
// `golden-lector.test.ts`, que fija la forma del set y la capa determinista.
//
//   node --experimental-strip-types scripts/navigate-lector-eval.ts [--proveedor gemini|claude] [--modelo <id>] [--solo T-01,D-15] [--json ruta]
//
// Corre los MISMOS adaptadores que produccion (`_shared/cardumen/model.ts`): no hay copia del
// cliente aqui, asi que lo que mide es el lector desplegado, no un proxy. El lector de
// produccion es Gemini (`geminiFlashLite`, secreto GEMINI_API_KEY del edge function); por
// defecto se evalua ese modelo (`GEMINI_LECTOR_MODELO`). `--modelo` permite comparar otro
// Gemini con precio registrado (ej. `gemini-3.1-flash-lite`); `--proveedor claude` corre el
// Haiku de R1/R2 como referencia. Las llaves se leen del entorno o de `.env.local` a memoria
// y nunca se imprimen.
//
// Metrica que importa: FALSAS UBICACIONES — casos donde el esperado era "no leido" y el lector
// devolvio una ubicacion (dominante/segundo, ancla, o una etiqueta de peso). Objetivo: cero.
// Se reportan aparte las "lecturas equivocadas" (leyo, pero otra cosa) y las "no lecturas"
// (debia leer y no leyo: el caso enterrado en un parrafo largo tiene que leerse).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIADAS, TRIADAS } from '../supabase/functions/_shared/cardumen/navigate/instrumento.ts';
import { interpreteConModelo } from '../supabase/functions/_shared/cardumen/navigate/interprete.ts';
import { GEMINI_LECTOR_MODELO, claudeHaiku, geminiFlashLite } from '../supabase/functions/_shared/cardumen/model.ts';
import type { ModelAdapter, ModelCallOpts, ModelResult } from '../supabase/functions/_shared/cardumen/types.ts';

type Esperado = {
  claro?: boolean; dominante?: number; segundo?: number; solo_uno?: boolean; ninguno?: boolean;
  especial?: string; ancla_en?: number[]; lado?: string | null; etiqueta_en?: Array<string | null>;
};
type Caso = {
  id: string; punto: 'triada' | 'segundo' | 'intensidad' | 'diada'; categoria: string; texto: string;
  esperado: Esperado; dimension?: string; dominante?: number; nota?: string;
};
type Veredicto = 'ok' | 'falsa_ubicacion' | 'lectura_equivocada' | 'no_lectura' | 'error';
type Fila = { caso: Caso; obtenido: unknown; veredicto: Veredicto; detalle: string };

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- Argumentos y llaves ------------------------------------------------------------------

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Lee una variable del entorno o de `.env.local`. Devuelve el valor a memoria; NUNCA lo imprime. */
function llave(nombre: string): string | undefined {
  if (process.env[nombre]) return process.env[nombre];
  try {
    const env = readFileSync(path.join(RAIZ, '.env.local'), 'utf-8');
    const m = env.split('\n').find((l) => l.startsWith(`${nombre}=`));
    return m ? m.slice(nombre.length + 1).trim().replace(/^["']|["']$/g, '') : undefined;
  } catch {
    return undefined;
  }
}

// ---- Adaptadores: los de produccion (`_shared/cardumen/model.ts`) --------------------------

// Los adaptadores leen la llave con `Deno.env.get`. Aqui corre Node, asi que se les da un
// `Deno.env` minimo que devuelve la llave leida a memoria. Nada mas de Deno se usa en esa ruta.
function simularDenoEnv(): void {
  const g = globalThis as unknown as { Deno?: { env: { get(n: string): string | undefined } } };
  g.Deno ??= { env: { get: (n: string) => llave(n) } };
}

/** Envuelve un adaptador para sumar los tokens de todas las llamadas: es lo que permite decir
 *  cuanto cuesta el golden set completo con cada modelo, con precio oficial y no a ojo. */
function conContador(m: ModelAdapter): { modelo: ModelAdapter; total: { in: number; out: number; llamadas: number } } {
  const total = { in: 0, out: 0, llamadas: 0 };
  const modelo: ModelAdapter = {
    id: m.id,
    pricing: m.pricing,
    async call(opts: ModelCallOpts): Promise<ModelResult> {
      const r = await m.call(opts);
      total.llamadas += 1;
      total.in += r.usage?.in ?? 0;
      total.out += r.usage?.out ?? 0;
      return r;
    },
  };
  return { modelo, total };
}

function elegirModelo(): ModelAdapter {
  const proveedor = arg('proveedor') ?? 'gemini';
  const pedido = arg('modelo');
  simularDenoEnv();
  if (proveedor === 'claude') {
    if (!llave('ANTHROPIC_API_KEY')) throw new Error('No hay ANTHROPIC_API_KEY en el entorno ni en .env.local');
    if (pedido) throw new Error('--modelo solo aplica a --proveedor gemini (el Claude de referencia es el de R1/R2)');
    return claudeHaiku();
  }
  if (proveedor !== 'gemini') throw new Error(`--proveedor ${proveedor}: solo gemini o claude`);
  if (!llave('GEMINI_API_KEY')) throw new Error('No hay GEMINI_API_KEY en el entorno ni en .env.local: no se puede correr el lector con modelo vivo');
  return geminiFlashLite(pedido ?? GEMINI_LECTOR_MODELO);
}

// ---- Veredicto por punto --------------------------------------------------------------------

const ETIQUETAS_UBICACION = new Set(['casi_parejos', 'uno_manda_otro_cuenta', 'claramente_el_primero']);

function juzgar(c: Caso, o: Record<string, unknown>): { veredicto: Veredicto; detalle: string } {
  const e = c.esperado;
  if (c.punto === 'intensidad') {
    const et = (o.etiqueta ?? null) as string | null;
    const permitidas = e.etiqueta_en ?? [];
    if (permitidas.includes(et)) return { veredicto: 'ok', detalle: '' };
    const esperabaLectura = permitidas.some((x) => x !== null && ETIQUETAS_UBICACION.has(x));
    if (ETIQUETAS_UBICACION.has(et ?? '')) return { veredicto: esperabaLectura ? 'lectura_equivocada' : 'falsa_ubicacion', detalle: `devolvio ${et}` };
    return { veredicto: esperabaLectura ? 'no_lectura' : 'lectura_equivocada', detalle: `devolvio ${et}` };
  }
  const claro = !!o.claro;
  if (e.claro === false) {
    if (!claro) {
      if ('lado' in e && e.lado !== undefined && (o.lado ?? null) !== e.lado) return { veredicto: 'lectura_equivocada', detalle: `lado ${o.lado} (esperado ${e.lado})` };
      return { veredicto: 'ok', detalle: '' };
    }
    // Leyo donde no habia nada que leer. Un "especial" (no sabe / no aplica) es una lectura
    // equivocada; un dominante/ancla es una UBICACION fabricada.
    const ubico = c.punto === 'triada' ? o.dominante !== null && o.dominante !== undefined
      : c.punto === 'segundo' ? o.segundo !== null && o.segundo !== undefined
      : o.ancla !== null && o.ancla !== undefined;
    return { veredicto: ubico ? 'falsa_ubicacion' : 'lectura_equivocada', detalle: JSON.stringify(o) };
  }
  // Esperaba una lectura.
  if (!claro) return { veredicto: 'no_lectura', detalle: JSON.stringify(o) };
  if (e.especial !== undefined) return o.especial === e.especial ? { veredicto: 'ok', detalle: '' } : { veredicto: 'lectura_equivocada', detalle: JSON.stringify(o) };
  if (c.punto === 'triada') {
    const bien = o.dominante === e.dominante
      && (e.solo_uno ? o.solo_uno === true : true)
      && (e.segundo !== undefined ? o.segundo === e.segundo : true)
      && !o.especial;
    return bien ? { veredicto: 'ok', detalle: '' } : { veredicto: 'lectura_equivocada', detalle: JSON.stringify(o) };
  }
  if (c.punto === 'segundo') {
    const bien = e.ninguno ? o.ninguno === true : o.segundo === e.segundo;
    return bien ? { veredicto: 'ok', detalle: '' } : { veredicto: 'lectura_equivocada', detalle: JSON.stringify(o) };
  }
  const bien = !o.especial || o.especial === 'middle' ? (e.ancla_en ?? []).includes(o.ancla as number) : false;
  return bien ? { veredicto: 'ok', detalle: '' } : { veredicto: 'lectura_equivocada', detalle: JSON.stringify(o) };
}

// ---- Correr --------------------------------------------------------------------------------

async function correr(c: Caso, lector: ReturnType<typeof interpreteConModelo>): Promise<Fila> {
  try {
    let obtenido: Record<string, unknown>;
    if (c.punto === 'triada') obtenido = { ...(await lector.triada(TRIADAS[c.dimension as keyof typeof TRIADAS], c.texto)) };
    else if (c.punto === 'segundo') obtenido = { ...(await lector.segundo(TRIADAS[c.dimension as keyof typeof TRIADAS], c.dominante!, c.texto)) };
    else if (c.punto === 'intensidad') obtenido = { ...(await lector.intensidad(TRIADAS.T1_fuente.polos[1], TRIADAS.T1_fuente.polos[2], c.texto)) };
    else obtenido = { ...(await lector.diada(DIADAS[c.dimension as keyof typeof DIADAS], c.texto)) };
    const j = juzgar(c, obtenido);
    return { caso: c, obtenido, veredicto: j.veredicto, detalle: j.detalle };
  } catch (e) {
    return { caso: c, obtenido: null, veredicto: 'error', detalle: (e as Error).message.slice(0, 200) };
  }
}

async function main(): Promise<void> {
  const golden = JSON.parse(readFileSync(path.join(RAIZ, 'supabase/functions/_shared/cardumen/navigate/golden-lector.json'), 'utf-8')) as { casos: Caso[] };
  const solo = arg('solo')?.split(',').map((s) => s.trim());
  const casos = solo ? golden.casos.filter((c) => solo.includes(c.id)) : golden.casos;
  const { modelo, total } = conContador(elegirModelo());
  const lector = interpreteConModelo(modelo);
  const esElDeProduccion = modelo.id === GEMINI_LECTOR_MODELO;

  console.log(`# Eval del lector de Navigate — ${casos.length} casos — modelo: ${modelo.id}${esElDeProduccion ? ' (el de produccion)' : ` (el de produccion es ${GEMINI_LECTOR_MODELO})`}\n`);

  const filas: Fila[] = [];
  const CONCURRENCIA = 3;
  for (let i = 0; i < casos.length; i += CONCURRENCIA) {
    const lote = await Promise.all(casos.slice(i, i + CONCURRENCIA).map((c) => correr(c, lector)));
    filas.push(...lote);
    process.stderr.write(`\r${Math.min(i + CONCURRENCIA, casos.length)}/${casos.length}`);
  }
  process.stderr.write('\n');

  const marca: Record<Veredicto, string> = { ok: 'ok', falsa_ubicacion: 'FALSA UBICACION', lectura_equivocada: 'equivocada', no_lectura: 'NO LEYO', error: 'ERROR' };
  console.log('| id | categoria | texto | esperado | obtenido | veredicto |');
  console.log('|---|---|---|---|---|---|');
  for (const f of filas) {
    const txt = f.caso.texto.length > 60 ? `${f.caso.texto.slice(0, 57)}...` : f.caso.texto;
    console.log(`| ${f.caso.id} | ${f.caso.categoria} | ${txt.replace(/\|/g, '/')} | \`${JSON.stringify(f.caso.esperado)}\` | \`${JSON.stringify(f.obtenido)}\` | ${marca[f.veredicto]} |`);
  }

  console.log('\n## Resumen por punto\n');
  console.log('| punto | casos | ok | falsas ubicaciones | lecturas equivocadas | no lecturas | errores |');
  console.log('|---|---|---|---|---|---|---|');
  for (const punto of ['triada', 'segundo', 'intensidad', 'diada'] as const) {
    const del = filas.filter((f) => f.caso.punto === punto);
    const n = (v: Veredicto) => del.filter((f) => f.veredicto === v).length;
    console.log(`| ${punto} | ${del.length} | ${n('ok')} | ${n('falsa_ubicacion')} | ${n('lectura_equivocada')} | ${n('no_lectura')} | ${n('error')} |`);
  }
  const falsas = filas.filter((f) => f.veredicto === 'falsa_ubicacion');
  console.log(`\n**Falsas ubicaciones: ${falsas.length}** (objetivo: 0)`);
  for (const f of falsas) console.log(`- ${f.caso.id} [${f.caso.categoria}] "${f.caso.texto}" -> ${JSON.stringify(f.obtenido)}`);
  const noLeyo = filas.filter((f) => f.veredicto === 'no_lectura');
  console.log(`\n**No lecturas sobre casos validos: ${noLeyo.length}**`);
  for (const f of noLeyo) console.log(`- ${f.caso.id} [${f.caso.categoria}] "${f.caso.texto}" -> ${JSON.stringify(f.obtenido)}`);

  // Costo del set completo con precio oficial (USD / 1M tokens, `pricing` del adaptador).
  const usd = (total.in * modelo.pricing.in + total.out * modelo.pricing.out) / 1_000_000;
  console.log(`\n**Tokens:** ${total.llamadas} llamadas, ${total.in} de entrada, ${total.out} de salida — **USD ${usd.toFixed(4)}** por el set (precio USD/1M: ${modelo.pricing.in} entrada / ${modelo.pricing.out} salida)`);

  const salida = arg('json');
  if (salida) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(salida, JSON.stringify({ modelo: modelo.id, lector_produccion: GEMINI_LECTOR_MODELO, fecha: new Date().toISOString(), tokens: total, usd, filas }, null, 2));
    console.log(`\nJSON en ${salida}`);
  }
  process.exit(falsas.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(2);
});
