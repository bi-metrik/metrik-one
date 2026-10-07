// ============================================================
// Núcleo conversacional — la configuración por workspace (`config_extra.bot_conversacional`)
// ------------------------------------------------------------
// Sin migración: llaves del jsonb que ya existe. Solo `agente: true` literal lo prende; apagado, el webhook no hace ni
// una consulta más que en `main`.
//
// Modelo (Yuto, §3.12 del diseño, 2026-10-06): gemini-3.8-flash con razonamiento LOW, temperatura por defecto,
// maxOutputTokens 2048 y `generateContent`. Respaldo por llamado: si el principal no responde en 2,5 s, ese llamado va
// a gemini-3.5-flash-lite MINIMAL. Todo se puede cambiar por workspace sin desplegar.
// ============================================================

export interface ConfigModelo {
  modelo: string;
  /** `thinkingLevel` de Gemini 3 (LOW, MEDIUM…); `null` = sin `thinkingConfig`. */
  razonamiento: string | null;
  /** `null` = la del proveedor (1.0 en Gemini 3). */
  temperatura: number | null;
  maxSalida: number;
}

export interface ConfigAgente {
  activo: boolean;
  /**
   * `bot_conversacional.agente_telefonos`: si existe, SOLO esos remitentes van al núcleo (los demás siguen por el camino
   * de hoy). En E.164 sin «+», como llega en el webhook («57320…»). `null` = todo el workspace.
   */
  telefonos: string[] | null;
  principal: ConfigModelo;
  /** Respaldo por llamado. `null` = sin respaldo. */
  respaldo: ConfigModelo | null;
  /** Si el principal no responde en este tiempo, el llamado va al respaldo. */
  corteMs: number;
  topes: {
    llamados: number;
    entradaTokens: number;
    texto: number;
    turnoMs: number;
    ventanaHoras: number;
  };
  /** Cupo de uso justo: turnos del modelo por mes. Pasarlo NO corta: avisa a MéTRIK. */
  cupoTurnosMes: number;
  /** Puntero a la versión publicada del reglamento (`bot_reglamentos.id`). Sin él, la última publicada. */
  reglamentoId: string | null;
  /** Ms tras los que se vuelve a encender «escribiendo…» (Meta lo apaga a los 25 s). */
  reencenderMs: number;
}

export const CONFIG_POR_DEFECTO: ConfigAgente = {
  activo: false,
  telefonos: null,
  principal: { modelo: 'gemini-3.8-flash', razonamiento: 'LOW', temperatura: null, maxSalida: 2048 },
  respaldo: { modelo: 'gemini-3.5-flash-lite', razonamiento: 'MINIMAL', temperatura: null, maxSalida: 2048 },
  corteMs: 2500,
  topes: { llamados: 3, entradaTokens: 12000, texto: 600, turnoMs: 20000, ventanaHoras: 24 },
  cupoTurnosMes: 800,
  reglamentoId: null,
  reencenderMs: 20000,
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : null);
const texto = (v: unknown, d: string): string => (typeof v === 'string' && v.trim() ? v.trim() : d);
const numero = (v: unknown, d: number, min = 0): number => (typeof v === 'number' && Number.isFinite(v) && v >= min ? v : d);

function leerModelo(v: unknown, d: ConfigModelo): ConfigModelo {
  const o = obj(v);
  if (!o) return d;
  return {
    modelo: texto(o.modelo, d.modelo),
    razonamiento: o.razonamiento === null ? null : texto(o.razonamiento, d.razonamiento ?? '') || null,
    temperatura: typeof o.temperatura === 'number' ? o.temperatura : d.temperatura,
    maxSalida: numero(o.max_salida, d.maxSalida, 1),
  };
}

/** Lee `config_extra.bot_conversacional`. Lo que falte o no se entienda queda en su valor por defecto. Pura. */
export function leerConfigAgente(botConversacional: unknown): ConfigAgente {
  const b = obj(botConversacional);
  const d = CONFIG_POR_DEFECTO;
  if (!b) return d;
  const a = obj(b.agente_config) ?? {};
  const topes = obj(a.topes) ?? {};
  return {
    activo: b.agente === true,
    telefonos: leerTelefonos(b.agente_telefonos),
    principal: leerModelo(a.modelo, d.principal),
    respaldo: a.respaldo === null ? null : leerModelo(a.respaldo, d.respaldo!),
    corteMs: numero(a.corte_ms, d.corteMs, 100),
    topes: {
      llamados: numero(topes.llamados, d.topes.llamados, 1),
      entradaTokens: numero(topes.entrada_tokens, d.topes.entradaTokens, 1000),
      texto: numero(topes.texto, d.topes.texto, 50),
      turnoMs: numero(topes.turno_ms, d.topes.turnoMs, 1000),
      ventanaHoras: numero(topes.ventana_horas, d.topes.ventanaHoras, 1),
    },
    cupoTurnosMes: numero(b.cupo_turnos_mes, d.cupoTurnosMes, 1),
    reglamentoId: typeof a.reglamento_id === 'string' && a.reglamento_id ? a.reglamento_id : null,
    reencenderMs: numero(a.reencender_ms, d.reencenderMs, 1000),
  };
}

const digitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

/**
 * La lista de teléfonos: solo dígitos, sin vacíos. Ausente (o nula) = `null`: todo el workspace. Presente pero mal
 * escrita (no es una lista) = nadie: un error de configuración nunca abre el núcleo a todo el workspace. Pura.
 */
export function leerTelefonos(v: unknown): string[] | null {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) return [];
  return v.map(digitos).filter((t) => t.length >= 7);
}

/**
 * ¿Este remitente va al núcleo? Solo con `agente: true` literal y, si hay `agente_telefonos`, solo si su teléfono está
 * en la lista (se comparan solo dígitos: «+57 320…» y «57320…» son el mismo). Una lista vacía no deja pasar a nadie.
 * Pura.
 */
export function agenteActivo(botConversacional: unknown, phone?: string | null): boolean {
  const b = obj(botConversacional);
  if (!b || b.agente !== true) return false;
  const lista = leerTelefonos(b.agente_telefonos);
  if (lista === null) return true;
  const t = digitos(phone);
  return t.length > 0 && lista.includes(t);
}
