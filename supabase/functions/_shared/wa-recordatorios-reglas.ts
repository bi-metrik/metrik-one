// ============================================================
// wa-recordatorios-reglas — qué dosis toca, qué se escala y cómo se lee el botón
// ------------------------------------------------------------
// Módulo PURO a propósito: no lee `Deno.env`, no habla con la base y no habla con Meta.
// Todo lo que decide "sale o no sale" vive aquí para poder probarse, porque los dos fallos
// que importan son silenciosos: un recordatorio que sale a la hora equivocada por la zona
// horaria, y una confirmación que marca la dosis de otra hora.
//
// ⚠️ Zona fija UTC-5. Colombia no tiene horario de verano y la tabla lo garantiza con un
// CHECK (`zona = 'America/Bogota'`). Vercel y Deno corren en UTC: entre las 19:00 y la
// medianoche de Bogotá, `new Date().getDate()` ya da el día siguiente, así que ningún
// cálculo de este archivo usa la fecha local del proceso — el día civil entra por parámetro
// (`todayBogotaISO()` de `bogota.ts`) y la hora se resuelve con el desplazamiento escrito.
// ============================================================

/** Una fila de `wa_recordatorios`, con lo que el cálculo necesita. */
export interface Recordatorio {
  id: string;
  workspace_id?: string | null;
  destinatario_phone: string;
  escalamiento_phone?: string | null;
  /** El único texto que viaja a Meta. Neutro por contrato: ver la migración. */
  etiqueta: string;
  /** 'HH:MM' o 'HH:MM:SS', como los devuelve `time[]` de Postgres. */
  horarios: string[];
  escalamiento_minutos: number;
  activo?: boolean;
}

/** Una fila de `wa_recordatorio_eventos`. */
export interface EventoRecordatorio {
  id: string;
  recordatorio_id: string;
  programado_para: string;
  enviado_at?: string | null;
  confirmado_at?: string | null;
  escalado_at?: string | null;
}

/** Una dosis que ya venció. */
export interface Dosis {
  recordatorio_id: string;
  /** ISO en UTC. Es la llave de idempotencia junto con `recordatorio_id`. */
  programado_para: string;
  /** 'HH:MM' en Bogotá, para mostrarle a la persona la hora que ella configuró. */
  hora_local: string;
}

/** Desplazamiento fijo de Colombia. La tabla no admite otra zona justamente por esto. */
const OFFSET_BOGOTA_MIN = -5 * 60;

/** 'HH:MM' desde 'HH:MM' o 'HH:MM:SS'. Devuelve null si no es una hora del día. */
export function normalizarHora(hora: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec((hora ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * El instante UTC de una hora local de Bogotá en un día civil dado.
 * `instanteBogota('2026-09-30', '19:30')` → 2026-10-01T00:30:00.000Z.
 */
export function instanteBogota(diaISO: string, hora: string): Date | null {
  const hhmm = normalizarHora(hora);
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec((diaISO ?? '').slice(0, 10));
  if (!hhmm || !d) return null;
  const [h, min] = hhmm.split(':').map(Number);
  return new Date(
    Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), h, min) - OFFSET_BOGOTA_MIN * 60_000,
  );
}

/**
 * Las dosis del día civil de Bogotá que ya vencieron.
 *
 * Solo mira el día que se le pasa: a las 00:15 no puede devolver la dosis de las 22:00 de
 * ayer, y por eso el cron no "despierta" de madrugada un recordatorio que se perdió. Una
 * dosis atrasada del MISMO día sí sale (tarde es mejor que nunca dentro del día), y la
 * cadencia de 15 minutos del cron acota cuánto.
 */
export function dosisVencidas(
  recordatorios: readonly Recordatorio[],
  diaBogotaISO: string,
  ahora: Date,
): Dosis[] {
  const out: Dosis[] = [];
  for (const r of recordatorios) {
    if (r.activo === false) continue;
    for (const horario of r.horarios ?? []) {
      const hora = normalizarHora(horario);
      const instante = hora ? instanteBogota(diaBogotaISO, hora) : null;
      if (!hora || !instante) {
        console.error(`[wa-recordatorios] horario ilegible en ${r.id}, se ignora: ${horario}`);
        continue;
      }
      if (instante.getTime() > ahora.getTime()) continue;
      out.push({
        recordatorio_id: r.id,
        programado_para: instante.toISOString(),
        hora_local: hora,
      });
    }
  }
  // Orden estable: la dosis más vieja primero, por si un envío falla a mitad de corrida.
  return out.sort((a, b) => a.programado_para.localeCompare(b.programado_para));
}

/**
 * ¿A este evento ya le pasó el plazo sin confirmación?
 * Se cuenta desde `enviado_at`, no desde `programado_para`: si el envío salió tarde, el
 * plazo de la persona empieza cuando recibió el mensaje.
 */
export function debeEscalar(
  evento: EventoRecordatorio,
  minutos: number,
  ahora: Date,
): boolean {
  if (!evento.enviado_at) return false;
  if (evento.confirmado_at || evento.escalado_at) return false;
  const salio = Date.parse(evento.enviado_at);
  if (Number.isNaN(salio)) return false;
  return ahora.getTime() - salio >= Math.max(1, minutos) * 60_000;
}

/** 'HH:MM' en Bogotá de un instante UTC. Para decirle a la persona de qué dosis se habla. */
export function horaLocalDe(instanteISO: string): string {
  const t = Date.parse(instanteISO);
  if (Number.isNaN(t)) return '';
  const d = new Date(t + OFFSET_BOGOTA_MIN * 60_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

// ── El botón de la plantilla ────────────────────────────────────────────────────────────
//
// La confirmación entra por un botón de RESPUESTA RÁPIDA de la plantilla, no por texto
// libre: la respuesta llega al webhook como `type: 'button'` con su payload y se resuelve
// sin adivinar intención. "Ya", "listo", "creo que sí" y un emoji son la misma cosa para
// una persona y tres cosas distintas para un parser.

/**
 * Prefijo del payload del botón. Lo que va detrás es el id de la dosis que se confirma.
 * Es el contrato con la plantilla que se somete a Meta: si el botón se crea con payload
 * estático, ese payload tiene que ser exactamente `rec_ok`.
 */
const PREFIJO_CONFIRMACION = 'rec_ok';

export function payloadConfirmacion(eventoId: string): string {
  return `${PREFIJO_CONFIRMACION}:${eventoId}`;
}

/**
 * ¿Este toque de botón es de un recordatorio? Se decide sin tocar la base, porque el
 * webhook tiene que saber si lo atiende él o lo deja seguir al bot antes de hacer I/O.
 *
 * Acepta también el payload SIN id: si la plantilla que apruebe Meta trae el payload
 * estático (es lo normal cuando no se declara variable en el botón), lo que llega es
 * `rec_ok` a secas y la dosis se resuelve por el teléfono.
 */
export function esConfirmacionDeRecordatorio(payload: string | null | undefined): boolean {
  const p = (payload ?? '').trim();
  return p === PREFIJO_CONFIRMACION || p.startsWith(`${PREFIJO_CONFIRMACION}:`);
}

/** El id del evento que trae el payload, o null si vino estático. */
export function eventoDelPayload(payload: string | null | undefined): string | null {
  const p = (payload ?? '').trim();
  if (!p.startsWith(`${PREFIJO_CONFIRMACION}:`)) return null;
  const id = p.slice(PREFIJO_CONFIRMACION.length + 1).trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

/** La forma de los `components` de la Graph API. Se declara aquí para que este módulo no
 *  importe `wa-respond.ts` (que lee `Deno.env` y habla con la red). */
export interface ComponentePlantilla {
  type: 'header' | 'body' | 'button';
  sub_type?: string;
  index?: string;
  parameters?: Array<Record<string, unknown>>;
}

/**
 * El componente del botón con el payload dinámico. Solo hace falta si la plantilla declara
 * variable en el botón; si Meta la aprobó con payload estático, este componente se rechaza.
 * De ahí que sea opcional (`WA_RECORDATORIO_BOTON_DINAMICO`) y que el handler sepa resolver
 * las dos formas.
 */
export function componenteBotonConfirmacion(eventoId: string): ComponentePlantilla {
  return {
    type: 'button',
    sub_type: 'quick_reply',
    index: '0',
    parameters: [{ type: 'payload', payload: payloadConfirmacion(eventoId) }],
  };
}

// ── La bandera ──────────────────────────────────────────────────────────────────────────

/**
 * El cron no manda nada mientras esto no esté prendido. Dos condiciones, y las dos tienen
 * que cumplirse:
 *
 *   1. `WA_RECORDATORIOS=on` — el interruptor. Apagado es el default y es el estado en que
 *      esto se entrega.
 *   2. una plantilla declarada para el intent en `WA_ALERT_TEMPLATES` — que es el registro
 *      que ya existe (`wa-plantillas.ts`) y que solo se puede llenar cuando Meta apruebe la
 *      plantilla. Sin ella el envío NO degrada a texto libre: fuera de la ventana de 24 h
 *      Meta rechaza el texto con 131047 y cuenta el fallo, y un recordatorio que "salió" y
 *      nadie recibió es peor que uno que no salió, porque el ledger diría que salió.
 */
export function banderaEncendida(crudo: string | null | undefined): boolean {
  return (crudo ?? '').trim().toLowerCase() === 'on';
}

/** Intents del registro de plantillas (`WA_ALERT_TEMPLATES`). */
export const INTENT_RECORDATORIO = 'recordatorio';
export const INTENT_ESCALAMIENTO = 'recordatorio_escalamiento';
