// Eval del LECTOR de Navigate (la unica puerta del modelo) contra el golden set, con un
// modelo VIVO. No corre en CI: cuesta, tarda y no es determinista. Lo que si corre en CI es
// `golden-lector.test.ts`, que fija la forma del set y la capa determinista.
//
//   node --experimental-strip-types scripts/navigate-lector-eval.ts [--proveedor claude|gemini] [--solo T-01,D-15] [--json ruta]
//
// El lector de PRODUCCION es Claude Haiku 4.5 (`_shared/cardumen/model.ts`, secreto
// ANTHROPIC_API_KEY del edge function). Si esa llave no esta en el entorno ni en `.env.local`,
// el script cae a Gemini como PROXY y lo dice en el encabezado: mide la robustez del PROMPT
// con otro modelo, no el comportamiento del lector desplegado. Las llaves se leen a memoria y
// nunca se imprimen.
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

// ---- Adaptadores (mismo contrato que `_shared/cardumen/model.ts`) ---------------------------

function claude(key: string): ModelAdapter {
  const modelId = 'claude-haiku-4-5';
  return {
    id: modelId,
    pricing: { in: 1.0, out: 5.0 },
    async call(opts: ModelCallOpts): Promise<ModelResult> {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: modelId,
          max_tokens: opts.maxTokens ?? 1024,
          temperature: opts.temperature ?? 0.7,
          system: opts.system,
          messages: opts.messages.map((m) => ({ role: m.role === 'system' ? 'user' : m.role, content: m.content })),
        }),
      });
      if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const text = data?.content?.map((c: { text?: string }) => c.text ?? '').join('') ?? '';
      return { text, usage: { in: data?.usage?.input_tokens ?? 0, out: data?.usage?.output_tokens ?? 0 } };
    },
  };
}

function gemini(key: string): ModelAdapter {
  const modelId = 'gemini-2.5-flash-lite';
  return {
    id: modelId,
    pricing: { in: 0.1, out: 0.4 },
    async call(opts: ModelCallOpts): Promise<ModelResult> {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: opts.system }] },
          contents: opts.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { temperature: opts.temperature ?? 0, maxOutputTokens: opts.maxTokens ?? 300 },
        }),
      });
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
      const u = data?.usageMetadata ?? {};
      return { text, usage: { in: u.promptTokenCount ?? 0, out: u.candidatesTokenCount ?? 0 } };
    },
  };
}

function elegirModelo(): { modelo: ModelAdapter; proxy: boolean } {
  const pedido = arg('proveedor');
  const kAnt = llave('ANTHROPIC_API_KEY');
  const kGem = llave('GEMINI_API_KEY');
  if (pedido === 'claude' || (!pedido && kAnt)) {
    if (!kAnt) throw new Error('No hay ANTHROPIC_API_KEY en el entorno ni en .env.local');
    return { modelo: claude(kAnt), proxy: false };
  }
  if (!kGem) throw new Error('No hay ANTHROPIC_API_KEY ni GEMINI_API_KEY: no se puede correr el lector con modelo vivo');
  return { modelo: gemini(kGem), proxy: true };
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
  const { modelo, proxy } = elegirModelo();
  const lector = interpreteConModelo(modelo);

  console.log(`# Eval del lector de Navigate — ${casos.length} casos — modelo: ${modelo.id}${proxy ? ' (PROXY: el lector de produccion es claude-haiku-4-5)' : ''}\n`);

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

  const salida = arg('json');
  if (salida) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(salida, JSON.stringify({ modelo: modelo.id, proxy, fecha: new Date().toISOString(), filas }, null, 2));
    console.log(`\nJSON en ${salida}`);
  }
  process.exit(falsas.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(2);
});
