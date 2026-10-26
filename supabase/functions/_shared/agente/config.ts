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
  /**
   * `agente_config.respaldo_estricto` (por defecto sí): el respaldo propone SIN `texto` arriba del resumen. Medido en
   * producción (2026-10-07 a 10-09): de 7 propuestas del respaldo, las 3 que traían texto repetían la pregunta del
   * resumen («¿Anoto en M1 26 1…?» encima de «¿Lo anoto en M1 26 1…?»); las 2 del principal con texto eran respuestas.
   */
  respaldoEstricto: boolean;
  /**
   * `agente_config.extraccion_compacta` (por defecto no): la extracción de `anotar`/`cargar` pide solo los campos con valor
   * más la lista de los que no (`esquemaCargaCompacta`). Menos tokens de salida; se enciende después de medirla con el
   * modelo real (`arnes/extraccion-casos.ts --esquema ambas`).
   */
  extraccionCompacta: boolean;
  /**
   * `agente_config.leer_adjuntos` (bandeja, por defecto sí, 2026-10-21): las fotos y los PDF que llegan se guardan, se leen
   * con el modelo (Haiku; respaldo Gemini) y lo leído entra a la carga del viaje. `false` lo apaga sin desplegar (el
   * archivo queda solo con su id de Meta en la conversación, como antes).
   */
  leerAdjuntos: boolean;
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
  respaldoEstricto: true,
  extraccionCompacta: false,
  leerAdjuntos: true,
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
    respaldoEstricto: a.respaldo_estricto === false ? false : d.respaldoEstricto,
    extraccionCompacta: a.extraccion_compacta === true,
    leerAdjuntos: a.leer_adjuntos === false ? false : d.leerAdjuntos,
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

// ── Qué dominio atiende a este remitente (2026-10-21) ────────────────────────
//
// Mauricio, 2026-10-20: «necesito el modo agente en todo ONE, también para termotech». Desde aquí el núcleo corre en
// TODO workspace con el dominio de ONE (gastos con su soporte, actividades, contactos, consultas de negocios), sin
// configurar nada. Trappvel conserva su bandeja.
//
//   · `bot_conversacional.agente === true` (el encendido de siempre, solo Trappvel hoy) → `bandeja`, con su lista de
//     teléfonos: el que no está en la lista sigue por el camino de hoy, igual que antes de este cambio.
//   · `bot_conversacional.agente === false` → apagado: todo el workspace por el camino de hoy (el interruptor).
//   · cualquier otra cosa (sin `bot_conversacional`, o sin la llave `agente`) → `one`. Si hay `agente_telefonos`, solo
//     esos teléfonos.
//   · `bot_conversacional.dominio` ('one' | 'bandeja') manda sobre lo anterior cuando `agente` no es `false`.
//   · `porDefecto: false` (el secreto `AGENTE_ONE=off` de las edge functions) apaga el `one` por defecto en todos los
//     workspaces sin tocar la base; los que lo piden explícito (`dominio: 'one'`) siguen.

export type DominioAgente = 'bandeja' | 'one';

/** ¿Qué dominio atiende a este remitente? `null` = el camino de hoy (wa-parse + máquina de estados). Pura. */
export function dominioDelAgente(botConversacional: unknown, phone?: string | null, o: { porDefecto?: boolean } = {}): DominioAgente | null {
  const b = obj(botConversacional);
  if (b?.agente === false) return null;
  const explicito = b?.dominio === 'one' || b?.dominio === 'bandeja' ? b.dominio as DominioAgente : null;
  const dominio: DominioAgente | null = explicito ?? (b?.agente === true ? 'bandeja' : o.porDefecto === false ? null : 'one');
  if (!dominio) return null;
  const lista = leerTelefonos(b?.agente_telefonos);
  if (lista === null) return dominio;
  const t = digitos(phone);
  return t.length > 0 && lista.includes(t) ? dominio : null;
}

/** El secreto `AGENTE_ONE` de las edge functions: solo `off` (o `0`, `false`, `no`) apaga el dominio ONE por defecto. Pura. */
export function agenteOnePorDefecto(valor: string | null | undefined): boolean {
  return !['off', '0', 'false', 'no', 'apagado'].includes(String(valor ?? '').trim().toLowerCase());
}

/**
 * El corte del dominio ONE si el workspace no fija `agente_config.corte_ms`: 5 s. Con Claude Haiku 5.5 de principal y
 * Gemini de respaldo (Mauricio, 2026-10-20: «siempre el respaldo de gemini»), un corte de 2,5 s pondría a Gemini a
 * competir en casi un tercio de los llamados (medido con Haiku en el arnés de la bandeja el 2026-10-20: p50 2,2 s y p90
 * 4,3 s por llamado) y contestaría muchos de ellos: Gemini dejaría de ser solo el respaldo.
 */
export const CORTE_ONE_MS = 5000;

/** La configuración del dominio ONE: la de siempre, con el corte de ONE si el workspace no fija el suyo. Pura. */
export function leerConfigOne(botConversacional: unknown): ConfigAgente {
  const c = leerConfigAgente(botConversacional);
  const propio = obj(obj(botConversacional)?.agente_config)?.corte_ms;
  return typeof propio === 'number' ? c : { ...c, corteMs: CORTE_ONE_MS };
}
