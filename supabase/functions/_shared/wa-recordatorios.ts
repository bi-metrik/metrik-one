// ============================================================
// wa-recordatorios — el cron que manda la dosis, y el handler que recibe la confirmación
// ------------------------------------------------------------
// La capacidad es genérica: "recordatorio programado con confirmación y registro". El primer
// consumidor son recordatorios personales a hora fija, pero nada de este archivo sabe de
// eso; lo mismo sirve después para un plazo, un cobro o una tarea. Lo que decide QUÉ y A
// QUIÉN son filas de `wa_recordatorios`, que se siembran por SQL (no hay UI en esta versión).
//
// Lo que aquí se decide, y por qué está aquí y no en `wa-alerta.ts`:
//
//   ⚠️ NO pasa por `enviarAlerta`, a propósito, y no es un olvido:
//     · `enviarAlerta` aplica la regla de DÍA HÁBIL del país del cliente (decisión de
//       Mauricio del 2026-09-27). Un recordatorio corre los 365 días del año, domingo y
//       festivo incluidos. Saltarse un domingo es exactamente el fallo que este módulo vino
//       a evitar. Si alguien "arregla" esto metiéndole `esDiaHabil`, rompe el producto.
//     · `enviarAlerta` aplica un tope de 2 por persona por día. Un recordatorio sale varias
//       veces al día por diseño.
//   Lo que SÍ se reutiliza es todo lo demás: `sendTemplate` (única puerta de salida a la
//   Graph API, y la que deja la fila en `wa_envios`) y el registro de plantillas
//   `WA_ALERT_TEMPLATES` (`wa-plantillas.ts`), porque los nombres de plantilla los aprueba
//   Meta y ese trámite no tiene la cadencia de un deploy.
//
// Idempotencia: la dosis se materializa con una llave única `(recordatorio_id,
// programado_para)` y el envío se RECLAMA con `update ... where enviado_at is null
// returning`. El que se lleva la fila es el que envía. Leer-y-luego-escribir dejaría abierta
// la ventana para que dos corridas solapadas mandaran el mismo recordatorio dos veces.
//
// ⚠️ Privacidad: el único texto que sale de la base hacia Meta es `etiqueta`, que es texto
// neutro por contrato (ver la migración 20260930140000). Este archivo no imprime `etiqueta`
// en consola ni la guarda en ninguna otra parte; lo que se loguea son ids y horas.
// ============================================================

import { todayBogotaISO } from './bogota.ts';
import { sendTemplate } from './wa-respond.ts';
import { leerRegistro, resolverAviso } from './wa-plantillas.ts';
import type { SupabaseClient } from './types.ts';
import {
  INTENT_ESCALAMIENTO,
  INTENT_RECORDATORIO,
  banderaEncendida,
  componenteBotonConfirmacion,
  debeEscalar,
  dosisVencidas,
  eventoDelPayload,
  horaLocalDe,
} from './wa-recordatorios-reglas.ts';
import type { Dosis, EventoRecordatorio, Recordatorio } from './wa-recordatorios-reglas.ts';

const COLUMNAS_RECORDATORIO =
  'id, workspace_id, destinatario_phone, escalamiento_phone, etiqueta, horarios, escalamiento_minutos, activo';
const COLUMNAS_EVENTO =
  'id, recordatorio_id, programado_para, enviado_at, confirmado_at, escalado_at';

/** Lo que el módulo necesita del mundo. Se inyecta para poder probarlo sin Meta ni red. */
export interface DepsRecordatorios {
  ahora?: () => Date;
  env?: (clave: string) => string | undefined;
  /** El doble del envío en pruebas. En producción es `sendTemplate`. */
  enviarPlantilla?: typeof sendTemplate;
}

export interface ResumenRecordatorios {
  ok: boolean;
  /** Verdadero mientras la bandera esté apagada o no haya plantilla declarada. */
  apagado?: boolean;
  motivo?: 'bandera_apagada' | 'sin_plantilla';
  enviados: number;
  escalados: number;
  /** Dosis que ya estaban enviadas cuando esta corrida llegó (otra corrida se las llevó). */
  omitidos: number;
  errores: number;
}

function leerEnv(deps: DepsRecordatorios, clave: string): string | undefined {
  if (deps.env) return deps.env(clave);
  // `Deno` no existe cuando estas pruebas corren en node: por eso el acceso es defensivo y
  // por eso las pruebas inyectan `env`.
  return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(clave);
}

/**
 * Una corrida del cron. Materializa las dosis vencidas del día de Bogotá, las envía una sola
 * vez, y escala las que llevan su plazo sin confirmación.
 */
export async function procesarRecordatorios(
  supabase: SupabaseClient,
  deps: DepsRecordatorios = {},
): Promise<ResumenRecordatorios> {
  const resumen: ResumenRecordatorios = { ok: true, enviados: 0, escalados: 0, omitidos: 0, errores: 0 };
  const ahora = deps.ahora ? deps.ahora() : new Date();

  if (!banderaEncendida(leerEnv(deps, 'WA_RECORDATORIOS'))) {
    return { ...resumen, apagado: true, motivo: 'bandera_apagada' };
  }

  // Sin plantilla declarada NO se manda nada. No degrada a texto libre como las alertas:
  // fuera de la ventana de 24 h Meta rechaza el texto (131047), Meta cuenta el fallo, y el
  // ledger habría quedado diciendo que la dosis salió.
  const registro = leerRegistro(leerEnv(deps, 'WA_ALERT_TEMPLATES'));
  if (!registro[INTENT_RECORDATORIO]) {
    console.warn('[wa-recordatorios] prendido pero sin plantilla declarada para "recordatorio": no sale nada');
    return { ...resumen, apagado: true, motivo: 'sin_plantilla' };
  }

  const enviar = deps.enviarPlantilla ?? sendTemplate;
  const botonDinamico = (leerEnv(deps, 'WA_RECORDATORIO_BOTON_DINAMICO') ?? '').trim().toLowerCase() === 'on';

  const { data: filas, error } = await supabase
    .from('wa_recordatorios')
    .select(COLUMNAS_RECORDATORIO)
    .eq('activo', true);
  if (error) {
    console.error('[wa-recordatorios] no se pudieron leer los recordatorios:', error.message);
    return { ...resumen, ok: false, errores: 1 };
  }
  const recordatorios = (filas ?? []) as Recordatorio[];
  if (recordatorios.length === 0) return resumen;
  const porId = new Map(recordatorios.map((r) => [r.id, r]));

  // ── Envío ─────────────────────────────────────────────────────────────────────────────
  const dia = todayBogotaISO(ahora);
  for (const dosis of dosisVencidas(recordatorios, dia, ahora)) {
    const rec = porId.get(dosis.recordatorio_id);
    if (!rec) continue;

    const eventoId = await asegurarEvento(supabase, dosis);
    if (!eventoId) {
      resumen.errores++;
      continue;
    }

    const tomado = await reclamar(supabase, eventoId, 'enviado_at', ahora);
    if (!tomado) {
      resumen.omitidos++;
      continue;
    }

    const wamid = await enviarDosis(enviar, {
      registro,
      intent: INTENT_RECORDATORIO,
      phone: rec.destinatario_phone,
      etiqueta: rec.etiqueta,
      hora: dosis.hora_local,
      eventoId,
      workspaceId: rec.workspace_id ?? undefined,
      botonDinamico,
    });

    if (wamid) {
      const { error: e } = await supabase
        .from('wa_recordatorio_eventos')
        .update({ wa_envio_id: wamid })
        .eq('id', eventoId);
      if (e) console.error(`[wa-recordatorios] evento ${eventoId} sin wamid guardado:`, e.message);
      resumen.enviados++;
    } else {
      // `enviado_at` NO se devuelve a null. Si se revirtiera, una plantilla que Meta rechaza
      // se reintentaría cada 15 minutos todo el día y Meta cuenta cada fallo. El rechazo
      // queda visible en `wa_envios` (status 'rechazado'), y el escalamiento de más abajo
      // avisa igual a los N minutos, que es justo la red para este caso.
      console.error(`[wa-recordatorios] Meta rechazó la dosis ${eventoId}; queda estampada y se escalará`);
      resumen.errores++;
    }
  }

  // ── Escalamiento ──────────────────────────────────────────────────────────────────────
  const { data: abiertos, error: errAbiertos } = await supabase
    .from('wa_recordatorio_eventos')
    .select(COLUMNAS_EVENTO)
    .in('recordatorio_id', [...porId.keys()])
    .not('enviado_at', 'is', null)
    .is('confirmado_at', null)
    .is('escalado_at', null);
  if (errAbiertos) {
    console.error('[wa-recordatorios] no se pudieron leer los eventos abiertos:', errAbiertos.message);
    return { ...resumen, ok: false, errores: resumen.errores + 1 };
  }

  for (const evento of (abiertos ?? []) as EventoRecordatorio[]) {
    const rec = porId.get(evento.recordatorio_id);
    if (!rec) continue;
    if (!debeEscalar(evento, rec.escalamiento_minutos, ahora)) continue;

    // Se reclama ANTES de mandar nada: así se escala una sola vez aunque dos corridas se
    // solapen, y aunque el aviso al segundo destinatario falle.
    const tomado = await reclamar(supabase, evento.id, 'escalado_at', ahora);
    if (!tomado) continue;

    const hora = horaLocalDe(evento.programado_para);

    // 1. Se le repite al principal. No crea evento nuevo: es la misma dosis.
    await enviarDosis(enviar, {
      registro,
      intent: INTENT_RECORDATORIO,
      phone: rec.destinatario_phone,
      etiqueta: rec.etiqueta,
      hora,
      eventoId: evento.id,
      workspaceId: rec.workspace_id ?? undefined,
      botonDinamico,
    });

    // 2. Y se le avisa a quien tiene que saber. Sin plantilla declarada para esto, el aviso
    // no sale (mismo motivo que arriba) pero el escalamiento ya quedó registrado.
    if (rec.escalamiento_phone) {
      if (registro[INTENT_ESCALAMIENTO]) {
        await enviarDosis(enviar, {
          registro,
          intent: INTENT_ESCALAMIENTO,
          phone: rec.escalamiento_phone,
          etiqueta: rec.etiqueta,
          hora,
          eventoId: evento.id,
          workspaceId: rec.workspace_id ?? undefined,
          // El de escalamiento no confirma la dosis de otro: sin botón dinámico.
          botonDinamico: false,
        });
      } else {
        console.warn('[wa-recordatorios] sin plantilla "recordatorio_escalamiento": el aviso no sale');
      }
    }
    resumen.escalados++;
  }

  return resumen;
}

/** La fila de la dosis, creándola si es la primera vez que se ve. Devuelve su id. */
async function asegurarEvento(supabase: SupabaseClient, dosis: Dosis): Promise<string | null> {
  const { data, error } = await supabase
    .from('wa_recordatorio_eventos')
    .insert({ recordatorio_id: dosis.recordatorio_id, programado_para: dosis.programado_para })
    .select('id');

  const fila = (data ?? [])[0] as { id?: string } | undefined;
  if (!error && fila?.id) return fila.id;

  // Ya existía (llave única) o la insert no devolvió la fila: se busca.
  const { data: previas, error: errBusca } = await supabase
    .from('wa_recordatorio_eventos')
    .select('id')
    .eq('recordatorio_id', dosis.recordatorio_id)
    .eq('programado_para', dosis.programado_para)
    .limit(1);
  if (errBusca) {
    console.error('[wa-recordatorios] no se pudo resolver la dosis:', errBusca.message);
    return null;
  }
  const previa = (previas ?? [])[0] as { id?: string } | undefined;
  if (previa?.id) return previa.id;
  if (error) console.error('[wa-recordatorios] no se pudo crear la dosis:', error.message);
  return null;
}

/**
 * Estampa una marca de tiempo SOLO si todavía estaba en null, y dice si se la llevó.
 * Es la pieza de la idempotencia: la condición viaja en el `update`, no se consulta antes.
 */
async function reclamar(
  supabase: SupabaseClient,
  eventoId: string,
  columna: 'enviado_at' | 'escalado_at',
  ahora: Date,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('wa_recordatorio_eventos')
    .update({ [columna]: ahora.toISOString() })
    .eq('id', eventoId)
    .is(columna, null)
    .select('id');
  if (error) {
    console.error(`[wa-recordatorios] no se pudo reclamar ${columna} de ${eventoId}:`, error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

interface EnvioDosis {
  registro: ReturnType<typeof leerRegistro>;
  intent: string;
  phone: string;
  etiqueta: string;
  hora: string;
  eventoId: string;
  workspaceId?: string;
  botonDinamico: boolean;
}

/** Resuelve la plantilla y la manda. Devuelve el wamid, o null si no salió. */
async function enviarDosis(
  enviar: typeof sendTemplate,
  e: EnvioDosis,
): Promise<string | null> {
  // Las variables se publican con nombre aunque la plantilla todavía no las pida: así se
  // puede declarar la plantilla sin tocar código (mismo criterio que `wa-alerta.ts`).
  const aviso = resolverAviso(e.registro, e.intent, { etiqueta: e.etiqueta, hora: e.hora });
  if (aviso.modo !== 'plantilla') {
    console.error(`[wa-recordatorios] ${e.intent} sin plantilla usable (${aviso.motivo}): no sale`);
    return null;
  }
  const componentes = e.botonDinamico
    ? [...aviso.componentes, componenteBotonConfirmacion(e.eventoId)]
    : [...aviso.componentes];

  return await enviar(e.phone, aviso.plantilla.name, aviso.plantilla.lang, componentes, {
    origen: 'template',
    intent: e.intent,
    workspaceId: e.workspaceId,
    // `preview` explícito: lo que queda en `wa_envios` es la plantilla y la dosis, no el
    // texto del cuerpo.
    preview: `[plantilla ${aviso.plantilla.name}] dosis ${e.eventoId} ${e.hora}`,
  });
}

// ============================================================
// Confirmación
// ============================================================

export interface ResultadoConfirmacion {
  confirmado: boolean;
  eventoId?: string;
  motivo?: 'sin_evento' | 'ya_confirmado' | 'error';
}

/**
 * El toque del botón de la plantilla. Llega al webhook como `type: 'button'` con su payload.
 *
 * Dos caminos, y los dos tienen que existir:
 *   · payload CON id de dosis (`rec_ok:<uuid>`): se marca esa, exacta. Es lo que se obtiene
 *     si la plantilla declara variable en el botón (`WA_RECORDATORIO_BOTON_DINAMICO=on`).
 *   · payload estático (`rec_ok`): Meta no dice de qué mensaje vino, así que se marca la
 *     dosis más reciente ENVIADA y SIN CONFIRMAR de ese teléfono. Con dos dosis pendientes
 *     esa es la interpretación correcta: la persona acaba de recibir la última.
 *
 * No depende de la bandera: alguien puede tocar el botón de un mensaje viejo después de
 * apagarla, y esa confirmación es un dato válido.
 */
export async function confirmarRecordatorio(
  supabase: SupabaseClient,
  phoneCrudo: string,
  payload: string | null | undefined,
  deps: DepsRecordatorios = {},
): Promise<ResultadoConfirmacion> {
  const ahora = deps.ahora ? deps.ahora() : new Date();
  const phone = (phoneCrudo ?? '').replace(/\D/g, '');
  if (!phone) return { confirmado: false, motivo: 'sin_evento' };

  const directo = eventoDelPayload(payload);
  const eventoId = directo ?? (await ultimaDosisPendiente(supabase, phone));
  if (!eventoId) return { confirmado: false, motivo: 'sin_evento' };

  const { data, error } = await supabase
    .from('wa_recordatorio_eventos')
    .update({ confirmado_at: ahora.toISOString(), confirmado_por: phone })
    .eq('id', eventoId)
    .is('confirmado_at', null)
    .select('id');
  if (error) {
    console.error(`[wa-recordatorios] no se pudo confirmar ${eventoId}:`, error.message);
    return { confirmado: false, motivo: 'error' };
  }
  if ((data ?? []).length === 0) return { confirmado: false, eventoId, motivo: 'ya_confirmado' };
  return { confirmado: true, eventoId };
}

/**
 * La dosis más reciente que salió y nadie confirmó, de los recordatorios de ese teléfono.
 * Cuenta tanto el destinatario principal como el de escalamiento: el segundo recibe el aviso
 * y puede ser quien responda. Dos consultas `eq` y no un `or` con el teléfono interpolado: el
 * escape de `.or()` de PostgREST es su propio problema y aquí no hace falta correr el riesgo.
 */
async function ultimaDosisPendiente(supabase: SupabaseClient, phone: string): Promise<string | null> {
  const ids = new Set<string>();
  for (const columna of ['destinatario_phone', 'escalamiento_phone'] as const) {
    const { data, error } = await supabase.from('wa_recordatorios').select('id').eq(columna, phone);
    if (error) {
      console.error('[wa-recordatorios] no se pudieron leer los recordatorios del número:', error.message);
      return null;
    }
    for (const f of (data ?? []) as Array<{ id: string }>) ids.add(f.id);
  }
  if (ids.size === 0) return null;

  const { data, error } = await supabase
    .from('wa_recordatorio_eventos')
    .select('id, enviado_at')
    .in('recordatorio_id', [...ids])
    .not('enviado_at', 'is', null)
    .is('confirmado_at', null)
    .order('enviado_at', { ascending: false })
    .limit(1);
  if (error) {
    console.error('[wa-recordatorios] no se pudo buscar la dosis pendiente:', error.message);
    return null;
  }
  const fila = (data ?? [])[0] as { id?: string } | undefined;
  return fila?.id ?? null;
}
