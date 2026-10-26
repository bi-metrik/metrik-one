// ============================================================
// Arnés de audios — la corrida con Gemini (spec 2026-10-26, §4.6)
// ------------------------------------------------------------
// Uso (desde la raíz de metrik-one):
//   GEMINI_API_KEY_PRUEBAS=… deno run -A --node-modules-dir=none supabase/functions/_shared/agente/arnes/audios/correr.ts --salida <dir>
//   Opciones: [--k 3] [--modelos gemini-2.5-flash-lite,gemini-3.5-flash-lite] [--paralelo 2] [--solo imp-01,lau-02]
//             [--fuente auto|reales|sinteticos]   auto (por defecto): la nota real si existe, si no la sintética
//   En seco, sin red ni llave ni audios: … correr.ts --seco --salida <dir>
//             (la «transcripción» es la referencia, con una pista colada a propósito en la mitad de las de «con pistas»:
//             prueba el pipeline y el reporte, no mide a nadie)
//
// La llave entra SOLO por `GEMINI_API_KEY_PRUEBAS` (nunca la de producción, nunca de un archivo); sin ella no corre.
// Modelos por defecto: el de ONE hasta el 2026-10-26 (`MODELO_AUDIO_ONE_ANTERIOR`), el de ONE hoy (`MODELO_AUDIO_ONE`,
// wa-transcribe.ts) y el que configura público para audios (`CONFIG_PUBLICO_POR_DEFECTO.audio.modelo`, publico/config.ts),
// sin repetir. Deja `resultado.json` (cada intento con su
// transcripción y su medida, más los agregados) y `tabla.txt`.
// Las notas: `audios/reales/<id>.ogg` (GRABAR.md) o `audios/sinteticos/<id>.sintetico.ogg` (generar.ts).
// ============================================================

import { MODELO_AUDIO_ONE, MODELO_AUDIO_ONE_ANTERIOR, textoDeRespuesta } from '../../../transcripcion.ts';
import { CONFIG_PUBLICO_POR_DEFECTO } from '../../publico/config.ts';
import { correr, pedidoDe, reporte } from './corrida.ts';
import type { Trabajo } from './corrida.ts';
import { BASES, GUIONES, referencia } from './guiones.ts';
import type { Guion } from './guiones.ts';

const args = Deno.args;
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const seco = args.includes('--seco');
const DIR = new URL('./', import.meta.url).pathname;

function tachar(s: string, llave: string): string {
  return llave ? s.split(llave).join('***') : s;
}

function aBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, Math.min(i + 8192, b.length)));
  return btoa(s);
}

async function existe(p: string): Promise<boolean> {
  try { await Deno.stat(p); return true; } catch { return false; }
}

/** La nota de un guion según la fuente; `null` si no está. */
async function notaDe(g: Guion, fuente: string): Promise<{ archivo: string; sintetico: boolean } | null> {
  const real = `${DIR}reales/${g.id}.ogg`;
  const sint = `${DIR}sinteticos/${g.id}.sintetico.ogg`;
  if (fuente !== 'sinteticos' && await existe(real)) return { archivo: real, sintetico: false };
  if (fuente !== 'reales' && await existe(sint)) return { archivo: sint, sintetico: true };
  return null;
}

/** En seco: la referencia; con pistas, la mitad de las veces se cuela el primer nombre de la base (para ver la inserción en el reporte). */
function transcriptorSeco(t: Trabajo): Promise<{ texto: string; ms: number }> {
  const ref = referencia(t.guion);
  const b = BASES[t.guion.workspace].base;
  const colado = t.conPistas && t.repeticion % 2 === 1 ? ` ${b.equipo[0] ?? ''}` : '';
  return Promise.resolve({ texto: ref + colado, ms: 0 });
}

if (import.meta.main) {
  const salida = arg('--salida');
  if (!salida) { console.error('falta --salida <dir>'); Deno.exit(2); }
  const llave = Deno.env.get('GEMINI_API_KEY_PRUEBAS') ?? '';
  if (!seco && llave.length < 20) {
    console.error('Falta GEMINI_API_KEY_PRUEBAS (la llave de pruebas, nunca la de producción). Para probar sin red: --seco');
    Deno.exit(2);
  }
  const k = Number(arg('--k') ?? 3);
  const modelos = [...new Set((arg('--modelos') ?? `${MODELO_AUDIO_ONE_ANTERIOR},${MODELO_AUDIO_ONE},${CONFIG_PUBLICO_POR_DEFECTO.audio.modelo}`).split(',').filter(Boolean))];
  const paralelo = Number(arg('--paralelo') ?? 2);
  const fuente = arg('--fuente') ?? 'auto';
  const solo = arg('--solo')?.split(',');
  const guiones = GUIONES.filter((g) => !solo || solo.includes(g.id));

  const notas = new Map<string, { archivo: string; sintetico: boolean; base64: string }>();
  if (!seco) {
    for (const g of guiones) {
      const n = await notaDe(g, fuente);
      if (!n) { console.error(`${g.id}: no hay nota (${fuente}); genera las sintéticas con generar.ts o pon la real en audios/reales/`); Deno.exit(2); }
      notas.set(g.id, { ...n, base64: aBase64(await Deno.readFile(n.archivo)) });
    }
  }

  const transcribir = async (t: Trabajo) => {
    if (seco) return transcriptorSeco(t);
    const n = notas.get(t.guion.id)!;
    const { url, init } = pedidoDe(t, { mime: 'audio/ogg', base64: n.base64 }, llave);
    for (let intento = 1; ; intento++) {
      const t0 = performance.now();
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) }).catch((e) => e as Error);
      const ms = Math.round(performance.now() - t0);
      if (res instanceof Error) {
        if (intento < 4) { await new Promise((r) => setTimeout(r, 1500 * 2 ** intento)); continue; }
        return { texto: null, error: `RED: ${tachar(String(res), llave).slice(0, 150)}`, ms };
      }
      if ((res.status === 429 || res.status >= 500) && intento < 4) {
        await res.body?.cancel();
        await new Promise((r) => setTimeout(r, 2000 * 2 ** intento));
        continue;
      }
      if (!res.ok) return { texto: null, error: `GEMINI_HTTP_${res.status}: ${tachar((await res.text()).slice(0, 150), llave)}`, ms };
      const r = textoDeRespuesta(await res.json());
      return 'texto' in r ? { texto: r.texto, ms } : { texto: null, error: r.error, ms };
    }
  };

  const r = await correr({
    guiones, modelos, k, paralelo, transcribir,
    alAvanzar: (h, total) => { if (h % 20 === 0 || h === total) console.error(`${h}/${total}`); },
  });
  const sinteticas = [...notas.values()].filter((n) => n.sintetico).length;
  const encabezado = [
    `Arnés de audios (§4.6) · ${new Date().toISOString()} · ${seco ? 'EN SECO (sin red: no mide a ningún modelo)' : 'Gemini, llave de pruebas'}`,
    `modelos: ${modelos.join(', ')} · k=${k} · notas: ${guiones.length}${seco ? '' : ` (${sinteticas} sintéticas, ${guiones.length - sinteticas} reales)`}`,
    sinteticas ? 'OJO: hay notas SINTÉTICAS. Sirven para probar el arnés; la decisión de prender las pistas se toma con notas reales.' : '',
    'Regla para adoptar pistas: nombres y códigos no bajan y al menos uno sube, sin subir la inserción falsa ni los fallos.',
  ].filter(Boolean).join('\n');
  const texto = reporte(r, encabezado);
  await Deno.mkdir(salida, { recursive: true });
  await Deno.writeTextFile(`${salida}/resultado.json`, JSON.stringify({
    fecha: new Date().toISOString(), seco, modelos, k,
    notas: Object.fromEntries([...notas].map(([id, n]) => [id, { archivo: n.archivo, sintetico: n.sintetico }])),
    agregados: r.agregados, porWorkspace: r.porWorkspace, intentos: r.intentos,
  }, null, 2) + '\n');
  await Deno.writeTextFile(`${salida}/tabla.txt`, texto + '\n');
  console.log(texto);
  console.log(`\n${salida}/resultado.json · ${salida}/tabla.txt`);
}
