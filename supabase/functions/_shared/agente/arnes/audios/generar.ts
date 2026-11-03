// ============================================================
// Arnés de audios — genera las 20 notas SINTÉTICAS PROVISIONALES (spec 2026-10-26, §4.6)
// ------------------------------------------------------------
// Uso (desde la raíz de metrik-one):
//   GEMINI_API_KEY_PRUEBAS=… deno run -A --node-modules-dir=none supabase/functions/_shared/agente/arnes/audios/generar.ts
//   Opciones: [--salida <dir>] (por defecto arnes/audios/sinteticos/)  [--solo imp-01,lau-02]  [--modelo gemini-3.8-flash-tts]
//             [--ruidos <dir>]  grabaciones reales de ambiente: calle.ogg, obra.ogg, salon.ogg (si falta una, ruido sintético)
//   En seco, sin red ni llave: … generar.ts --seco --salida /tmp/audios-seco
//             (un tono de 3 s en vez de la voz: prueba ffmpeg, el corte, el ruido, el formato y el manifiesto)
//
// La llave entra SOLO por `GEMINI_API_KEY_PRUEBAS`: no se lee de ningún archivo ni se imprime (los errores la tachan).
// Cada nota sale como `<id>.sintetico.ogg` (OGG/Opus, como WhatsApp) y queda en `manifiesto.json` con `sintetico: true`.
// Necesita ffmpeg con libopus en el PATH.
// ============================================================

import { GUIONES } from './guiones.ts';
import { MODELO_TTS, argsFfmpeg, audioDeRespuesta, entradaManifiesto, nombreSintetico, pedidoTts } from './sintesis.ts';
import type { EntradaManifiesto } from './sintesis.ts';

const args = Deno.args;
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const seco = args.includes('--seco');
const DIR_POR_DEFECTO = new URL('./sinteticos/', import.meta.url).pathname;

function tachar(s: string, llave: string): string {
  return llave ? s.split(llave).join('***') : s;
}

async function existe(p: string): Promise<boolean> {
  try { await Deno.stat(p); return true; } catch { return false; }
}

async function ffmpeg(a: string[]): Promise<void> {
  const r = await new Deno.Command('ffmpeg', { args: a, stdout: 'null', stderr: 'piped' }).output();
  if (!r.success) throw new Error(`ffmpeg falló: ${new TextDecoder().decode(r.stderr).slice(0, 400)}`);
}

function base64ABytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function tts(g: (typeof GUIONES)[number], llave: string, modelo: string, dirTmp: string): Promise<string> {
  const { url, init } = pedidoTts(g, { llave, modelo });
  for (let intento = 1; intento <= 4; intento++) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
    if (res.ok) {
      const data = audioDeRespuesta(await res.json());
      if (!data) throw new Error(`${g.id}: la respuesta del TTS no trae audio`);
      const wav = `${dirTmp}/${g.id}.wav`;
      await Deno.writeFile(wav, base64ABytes(data));
      return wav;
    }
    const cuerpo = tachar((await res.text()).slice(0, 300), llave);
    if ((res.status === 429 || res.status >= 500) && intento < 4) {
      console.warn(`${g.id}: TTS ${res.status}, reintento ${intento}`);
      await new Promise((r) => setTimeout(r, 2000 * 2 ** intento));
      continue;
    }
    throw new Error(`${g.id}: TTS HTTP ${res.status}: ${cuerpo}`);
  }
  throw new Error(`${g.id}: TTS sin respuesta`);
}

if (import.meta.main) {
  const llave = Deno.env.get('GEMINI_API_KEY_PRUEBAS') ?? '';
  if (!seco && llave.length < 20) {
    console.error('Falta GEMINI_API_KEY_PRUEBAS (la llave de pruebas, nunca la de producción). Para probar sin red: --seco');
    Deno.exit(2);
  }
  const salida = (arg('--salida') ?? DIR_POR_DEFECTO).replace(/\/+$/, '');
  const modelo = arg('--modelo') ?? MODELO_TTS;
  const dirRuidos = arg('--ruidos');
  const solo = arg('--solo')?.split(',');
  const guiones = GUIONES.filter((g) => !solo || solo.includes(g.id));
  await Deno.mkdir(salida, { recursive: true });
  const dirTmp = await Deno.makeTempDir({ prefix: 'audios-tts-' });
  const manifiestoPath = `${salida}/manifiesto.json`;
  const previo: EntradaManifiesto[] = (await existe(manifiestoPath)) ? JSON.parse(await Deno.readTextFile(manifiestoPath)).notas ?? [] : [];
  const notas = new Map(previo.map((n) => [n.id, n]));
  let fallas = 0;
  try {
    for (const g of guiones) {
      try {
        const ruidoArchivo = g.condiciones.ruido && dirRuidos && await existe(`${dirRuidos}/${g.condiciones.ruido}.ogg`)
          ? `${dirRuidos}/${g.condiciones.ruido}.ogg` : null;
        const voz = seco ? { seco: true as const } : await tts(g, llave, modelo, dirTmp);
        await ffmpeg(argsFfmpeg(g, { voz, salida: `${salida}/${nombreSintetico(g)}`, ruidoArchivo }));
        notas.set(g.id, entradaManifiesto(g, { seco, modeloTts: modelo, ruidoGrabado: !!ruidoArchivo, ahora: new Date().toISOString() }));
        console.log(`${g.id}: ${salida}/${nombreSintetico(g)}${seco ? ' (seco: tono de prueba, sin voz)' : ''}`);
      } catch (e) {
        fallas++;
        console.error(tachar(String(e), llave));
      }
    }
  } finally {
    await Deno.remove(dirTmp, { recursive: true }).catch(() => {});
  }
  const lista = [...notas.values()].sort((a, b) => a.id.localeCompare(b.id));
  await Deno.writeTextFile(manifiestoPath, JSON.stringify({
    aviso: 'NOTAS SINTÉTICAS PROVISIONALES (TTS de Gemini + ruido de ffmpeg). No reemplazan a las notas reales de GRABAR.md.',
    notas: lista,
  }, null, 2) + '\n');
  console.log(`${lista.length} notas en ${manifiestoPath}; ${fallas} fallas`);
  if (fallas) Deno.exit(1);
}
