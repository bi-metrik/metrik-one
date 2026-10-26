// ============================================================
// Arnés de audios — las piezas puras de la voz sintética PROVISIONAL (spec 2026-10-26, §4.6)
// ------------------------------------------------------------
// Las notas buenas son personas reales leyendo los guiones (GRABAR.md): la voz sintética no trae el acento ni el ruido
// que nos hace fallar. Mientras llegan, `generar.ts` arma notas sintéticas con el TTS de Gemini y les mezcla ruido con
// ffmpeg. Todo lo que sale de aquí queda marcado como sintético: en el nombre (`<id>.sintetico.ogg`) y en el manifiesto.
//
// TTS (doc oficial, https://ai.google.dev/gemini-api/docs/speech-generation, leída el 2026-10-26): `POST
// /v1beta/interactions` con `x-goog-api-key`, `model` `gemini-3.8-flash-tts` (la doc lo recomienda para dialectos
// regionales), el texto en `input[].content[]` con una anotación `speech_metadata` de estilo, `response_format: {type:
// "audio"}` y la voz en `generation_config.speech_config: [{voice}]`. Devuelve WAV (24 kHz) en base64 en
// `steps[].content[]` de tipo `audio`.
//
// Formato de salida: OGG/Opus mono 48 kHz a 24 kbps con `-application voip`, como las notas de voz de WhatsApp.
// ============================================================

import { dicho } from './guiones.ts';
import type { Guion, Ruido } from './guiones.ts';

export const URL_INTERACTIONS = 'https://generativelanguage.googleapis.com/v1beta/interactions';
export const MODELO_TTS = 'gemini-3.8-flash-tts';

/** El pedido al TTS para un guion. La llave, solo en la cabecera. Pura. */
export function pedidoTts(g: Guion, o: { llave: string; modelo?: string }): { url: string; init: RequestInit } {
  const estilo = `${g.estilo}. Español de Colombia, como una nota de voz de WhatsApp${g.condiciones.rapido ? ', hablando rápido' : ''}.`;
  return {
    url: URL_INTERACTIONS,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': o.llave },
      body: JSON.stringify({
        model: o.modelo ?? MODELO_TTS,
        input: [{ type: 'user_input', content: [{ type: 'text', text: dicho(g), annotations: [{ type: 'speech_metadata', style: estilo }] }] }],
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice: g.voz }] },
      }),
    },
  };
}

/** El último audio de la respuesta del TTS (base64), o `null`. Pura. */
export function audioDeRespuesta(r: unknown): string | null {
  const steps = (r as { steps?: Array<{ type?: string; content?: Array<{ type?: string; data?: string }> }> })?.steps;
  if (!Array.isArray(steps)) return null;
  const audios = steps.filter((s) => s?.type === 'model_output').flatMap((s) => s.content ?? []).filter((c) => c?.type === 'audio' && typeof c.data === 'string');
  return audios.length ? audios[audios.length - 1].data! : null;
}

/** Ruido sintético por ambiente (con `--ruidos <dir>` se usa en cambio una grabación real `<ambiente>.ogg`, en bucle). */
const RUIDO_SINTETICO: Record<Ruido, string> = {
  calle: 'anoisesrc=color=brown:amplitude=0.25:sample_rate=48000',
  obra: 'anoisesrc=color=white:amplitude=0.08:sample_rate=48000',
  salon: 'anoisesrc=color=pink:amplitude=0.10:sample_rate=48000',
};
const FILTRO_RUIDO: Record<Ruido, string> = {
  calle: 'lowpass=f=900,volume=0.9',
  obra: 'highpass=f=600,tremolo=f=6:d=0.7,volume=0.8',
  salon: 'bandpass=f=1500:width_type=h:w=2500,volume=0.7',
};
/** Segundos que se le quitan al final a una nota con corte (la cola se alcanza a empezar y se corta). */
export const SEGUNDOS_CORTE = 0.7;
export const TEMPO_RAPIDO = 1.15;

export interface EntradaFfmpeg {
  /** El WAV del TTS. Con `seco`, en cambio, un tono de 3 s generado por ffmpeg (sin red). */
  voz: string | { seco: true };
  salida: string;
  /** Grabación real del ambiente; sin ella, ruido sintético. */
  ruidoArchivo?: string | null;
}

/** Los argumentos de ffmpeg para una nota: tempo, corte, ruido y OGG/Opus. Pura. */
export function argsFfmpeg(g: Guion, e: EntradaFfmpeg): string[] {
  const c = g.condiciones;
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  if (typeof e.voz === 'string') args.push('-i', e.voz);
  else args.push('-f', 'lavfi', '-i', 'sine=frequency=220:duration=3:sample_rate=24000');
  const voz = ['aresample=48000', 'aformat=channel_layouts=mono'];
  if (c.rapido) voz.push(`atempo=${TEMPO_RAPIDO}`);
  if (c.corte) voz.push('areverse', `atrim=start=${SEGUNDOS_CORTE}`, 'areverse', 'asetpts=N/SR/TB');
  else voz.push('apad=pad_dur=0.3');
  let filtro = `[0:a]${voz.join(',')}[v]`;
  let mapa = '[v]';
  if (c.ruido) {
    if (e.ruidoArchivo) args.push('-stream_loop', '-1', '-i', e.ruidoArchivo);
    else args.push('-f', 'lavfi', '-i', RUIDO_SINTETICO[c.ruido]);
    const ruido = e.ruidoArchivo ? 'aresample=48000,aformat=channel_layouts=mono,volume=0.5' : FILTRO_RUIDO[c.ruido];
    filtro += `;[1:a]${ruido}[n];[v][n]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[m]`;
    mapa = '[m]';
  }
  args.push('-filter_complex', filtro, '-map', mapa, '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '24k', '-application', 'voip', e.salida);
  return args;
}

/** El nombre del archivo: el «sintetico» va en el nombre, para que nadie lo confunda con una nota real. Pura. */
export function nombreSintetico(g: Guion): string {
  return `${g.id}.sintetico.ogg`;
}

export interface EntradaManifiesto {
  id: string;
  archivo: string;
  sintetico: true;
  /** `true` = tono de prueba sin voz (corrida en seco): no sirve para medir. */
  seco: boolean;
  modelo_tts: string | null;
  voz: string;
  condiciones: Guion['condiciones'];
  ruido: 'sintetico' | 'grabado' | null;
  generado_at: string;
}

export function entradaManifiesto(g: Guion, o: { seco: boolean; modeloTts: string | null; ruidoGrabado: boolean; ahora: string }): EntradaManifiesto {
  return {
    id: g.id, archivo: nombreSintetico(g), sintetico: true, seco: o.seco, modelo_tts: o.seco ? null : o.modeloTts, voz: g.voz,
    condiciones: g.condiciones, ruido: g.condiciones.ruido ? (o.ruidoGrabado ? 'grabado' : 'sintetico') : null, generado_at: o.ahora,
  };
}
