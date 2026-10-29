// ============================================================
// Asistente público — la configuración por workspace (`config_extra.bot_conversacional.chatwoot`)
// ------------------------------------------------------------
// Sin migración: llaves del jsonb que ya existe. Solo `activo: true` literal lo prende. Lo que falte o no se entienda
// queda en su valor por defecto; un valor mal escrito nunca abre más de lo que abre el defecto.
//
// Modelo (D1, Mauricio 2026-10-20): Claude Haiku 5.5 (`claude-haiku-5-5`) por el adaptador nativo, SIN modelo de
// respaldo. `respaldo` existe en la forma pero en la etapa 1 se lee siempre como `null`: un respaldo decide turnos y
// tiene que pasar el mismo arnés antes de encenderse (diseño §4.1). Los tiempos (`corte_1`, `corte_total`, ráfaga) y
// el esfuerzo se cambian por workspace sin desplegar (§4.1, D5).
//
// Secretos (nunca aquí): el de la firma del Agent Bot en `CHATWOOT_WEBHOOK_SECRET_<SLUG>` y el token de la API en
// `CHATWOOT_API_TOKEN_<SLUG>` (slug en mayúsculas, guiones como `_`). La llave de Gemini para audios, en la variable
// que diga `audio.llave_env` (por defecto `GEMINI_API_KEY_PAGO`): tiene que ser del plan pago (Anexo 5.8).
// ============================================================

import type { Canal, MotivoPersona } from './tipos.ts';
import { MOTIVOS_PERSONA } from './tipos.ts';
import { leerConfigTranscripcion, TOPE_PISTAS } from '../pistas.ts';
import type { ConfigTranscripcion } from '../pistas.ts';

export type Esfuerzo = 'low' | 'medium' | 'high';

export interface ConfigModeloPublico {
  proveedor: 'anthropic' | 'gemini';
  modelo: string;
  /** `output_config.effort` de Anthropic. */
  esfuerzo: Esfuerzo;
  /** Pensamiento adaptativo. Con pensamiento, las herramientas van en `tool_choice: auto` (la API no fuerza con pensamiento). */
  pensamiento: boolean;
  maxSalida: number;
  /** `strict: true` en las herramientas (si el esquema cabe en los topes de la salida estructurada). */
  estricto: boolean;
}

export interface InboxPublico {
  id: number;
  canal: Canal;
  /** Instagram: la conversación llegó por un anuncio Click-to-Direct (ventana de 7 días). HUECO: tipo de anuncio (§12.10). */
  anuncio7Dias: boolean;
}

/** De qué es el asistente: experiencias con reserva (Sabor) o venta de productos del catálogo de Ferretería (Dimpro). */
export type DominioAsistente = 'experiencias' | 'ventas';

export interface ConfigPublico {
  activo: boolean;
  /** `chatwoot.dominio`. Sin él (o con otro valor), `experiencias`: lo de siempre. */
  dominio: DominioAsistente;
  cuentaId: number | null;
  apiUrl: string;
  inboxes: InboxPublico[];
  reglamentoId: string | null;
  modelo: ConfigModeloPublico;
  /** Siempre `null` en la etapa 1 (sin respaldo, D1). */
  respaldo: null;
  corte1Ms: number;
  corteTotalMs: number;
  rafagaMs: number;
  audio: { modelo: string; llaveEnv: string; maxBytes: number };
  /**
   * Pistas para transcribir (spec 2026-10-26, §4.6): `bot_conversacional.transcripcion` (el mismo interruptor del
   * workspace que ONE, fuera de `chatwoot`). Apagado por defecto.
   */
  transcripcion: ConfigTranscripcion;
  /** El link de términos y política de datos. HUECO: lo publica Sabor (§5.1). */
  terminosUrl: string;
  /** Links que el asistente puede escribir (además del de términos). */
  enlacesPermitidos: string[];
  /** Presupuesto diario en USD (D12, Carmen). `null` = sin tope (y sin alertas). */
  presupuestoDiarioUsd: number | null;
  topes: {
    llamados: number;
    turnosPorConversacion: number;
    mensajesPorHora: number;
    contextoTokens: number;
    texto: number;
  };
  /** Horas sin mensajes tras las que vuelve el aviso de bot (§5.1, propuesta 24 h). */
  pausaLargaHoras: number;
  /** Equipo de Chatwoot por motivo de paso a persona (HUECO §6.2): `null` = sin asignar equipo. */
  equipos: Partial<Record<MotivoPersona, number>>;
}

export const MODELO_HAIKU_55 = 'claude-haiku-5-5';
export const TERMINOS_EJEMPLO = 'https://ejemplo.invalid/sabor/terminos-EJEMPLO';

export const CONFIG_PUBLICO_POR_DEFECTO: ConfigPublico = {
  activo: false,
  dominio: 'experiencias',
  cuentaId: null,
  apiUrl: 'https://app.chatwoot.com',
  inboxes: [],
  reglamentoId: null,
  modelo: { proveedor: 'anthropic', modelo: MODELO_HAIKU_55, esfuerzo: 'low', pensamiento: false, maxSalida: 2048, estricto: true },
  respaldo: null,
  corte1Ms: 5000,
  corteTotalMs: 20000,
  rafagaMs: 2500,
  audio: { modelo: 'gemini-3.5-flash-lite', llaveEnv: 'GEMINI_API_KEY_PAGO', maxBytes: 20 * 1024 * 1024 },
  transcripcion: { pistas: false, tope: TOPE_PISTAS, vocabulario: [] },
  terminosUrl: TERMINOS_EJEMPLO,
  enlacesPermitidos: [],
  presupuestoDiarioUsd: null,
  topes: { llamados: 3, turnosPorConversacion: 30, mensajesPorHora: 30, contextoTokens: 100_000, texto: 600 },
  pausaLargaHoras: 24,
  equipos: {},
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : null);
const texto = (v: unknown, d: string): string => (typeof v === 'string' && v.trim() ? v.trim() : d);
const numero = (v: unknown, d: number, min = 0, max = Number.POSITIVE_INFINITY): number =>
  (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : d);
const entero = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
const CANALES: Canal[] = ['instagram', 'tiktok', 'whatsapp', 'otro'];
const ESFUERZOS: Esfuerzo[] = ['low', 'medium', 'high'];

function leerModelo(v: unknown): ConfigModeloPublico {
  const d = CONFIG_PUBLICO_POR_DEFECTO.modelo;
  const o = obj(v);
  if (!o) return d;
  return {
    proveedor: o.proveedor === 'gemini' ? 'gemini' : 'anthropic',
    modelo: texto(o.modelo, d.modelo),
    esfuerzo: ESFUERZOS.includes(o.esfuerzo as Esfuerzo) ? o.esfuerzo as Esfuerzo : d.esfuerzo,
    pensamiento: o.pensamiento === true,
    maxSalida: numero(o.max_salida, d.maxSalida, 256, 32_000),
    estricto: o.estricto === false ? false : d.estricto,
  };
}

function leerInboxes(v: unknown): InboxPublico[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => {
    const o = obj(x);
    const id = entero(o?.id);
    if (!o || id === null) return null;
    return { id, canal: CANALES.includes(o.canal as Canal) ? o.canal as Canal : 'otro', anuncio7Dias: o.anuncio_7_dias === true };
  }).filter((x): x is InboxPublico => !!x);
}

function leerEquipos(v: unknown): Partial<Record<MotivoPersona, number>> {
  const o = obj(v) ?? {};
  const out: Partial<Record<MotivoPersona, number>> = {};
  for (const m of MOTIVOS_PERSONA) {
    const id = entero(o[m]);
    if (id !== null) out[m] = id;
  }
  return out;
}

/** Un link de https bien formado, o nada. */
function enlace(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Lee `config_extra.bot_conversacional.chatwoot`. Pura. */
export function leerConfigPublico(botConversacional: unknown): ConfigPublico {
  const d = CONFIG_PUBLICO_POR_DEFECTO;
  const c = obj(obj(botConversacional)?.chatwoot);
  if (!c) return d;
  const topes = obj(c.topes) ?? {};
  const audio = obj(c.audio) ?? {};
  const corte1Ms = numero(c.corte_1_ms, d.corte1Ms, 1000, 30_000);
  const corteTotalMs = Math.max(numero(c.corte_total_ms, d.corteTotalMs, 2000, 60_000), corte1Ms + 1000);
  const presupuesto = c.presupuesto_diario_usd;
  return {
    activo: c.activo === true,
    dominio: c.dominio === 'ventas' ? 'ventas' : 'experiencias',
    cuentaId: entero(c.cuenta_id),
    apiUrl: enlace(c.api_url)?.replace(/\/+$/, '') ?? d.apiUrl,
    inboxes: leerInboxes(c.inboxes),
    reglamentoId: typeof c.reglamento_id === 'string' && c.reglamento_id ? c.reglamento_id : null,
    modelo: leerModelo(c.modelo),
    respaldo: null,
    corte1Ms,
    corteTotalMs,
    rafagaMs: numero(c.rafaga_ms, d.rafagaMs, 0, 15_000),
    audio: {
      modelo: texto(audio.modelo, d.audio.modelo),
      llaveEnv: texto(audio.llave_env, d.audio.llaveEnv),
      maxBytes: numero(audio.max_bytes, d.audio.maxBytes, 1024, 20 * 1024 * 1024),
    },
    transcripcion: leerConfigTranscripcion(botConversacional),
    terminosUrl: enlace(c.terminos_url) ?? d.terminosUrl,
    enlacesPermitidos: Array.isArray(c.enlaces_permitidos) ? c.enlaces_permitidos.map(enlace).filter((x): x is string => !!x) : [],
    presupuestoDiarioUsd: typeof presupuesto === 'number' && Number.isFinite(presupuesto) && presupuesto > 0 ? presupuesto : null,
    topes: {
      llamados: numero(topes.llamados, d.topes.llamados, 1, 6),
      turnosPorConversacion: numero(topes.turnos_conversacion, d.topes.turnosPorConversacion, 1, 500),
      mensajesPorHora: numero(topes.mensajes_hora, d.topes.mensajesPorHora, 1, 1000),
      contextoTokens: numero(topes.contexto_tokens, d.topes.contextoTokens, 4000, 100_000),
      texto: numero(topes.texto, d.topes.texto, 100, 1000),
    },
    pausaLargaHoras: numero(c.pausa_larga_horas, d.pausaLargaHoras, 1, 24 * 30),
    equipos: leerEquipos(c.equipos),
  };
}

/** El inbox, si es uno de los registrados del workspace. Pura. */
export function inboxRegistrado(c: ConfigPublico, inboxId: number | null): InboxPublico | null {
  if (inboxId === null) return null;
  return c.inboxes.find((i) => i.id === inboxId) ?? null;
}

/** El nombre de la variable de entorno de un secreto del workspace (`CHATWOOT_API_TOKEN_SABOR`). Pura. */
export function variableSecreta(prefijo: 'CHATWOOT_WEBHOOK_SECRET' | 'CHATWOOT_API_TOKEN', slug: string): string {
  return `${prefijo}_${slug.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}
