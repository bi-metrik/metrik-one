// Bot de customer service por WhatsApp — orquestación para el webhook.
//
// Calca el patrón de _shared/venezuela/index.ts (mismas firmas, mismo ciclo
// de vida), pero el desenlace es distinto: en vez de serializar una historia
// a una tabla propia, deja un LEAD en `contactos` + `contacto_interacciones`
// del workspace, que es donde el asesor ya los ve.
//
// ADITIVO Y OPT-IN: solo se activa para workspaces que declaren
// `config_extra.wa_customer_bot`. Sin esa config, ningún número entra aquí y
// el webhook se comporta exactamente igual que antes.
//
// Quien escribe NO es usuario de ONE: es un cliente final del cliente. Por
// eso el enganche va ANTES de identificar staff en el webhook.

import { sendTextMessage, sendTypingIndicator } from "../wa-respond.ts";
import { generate, type Msg } from "../venezuela/gemini.ts";
import { buildSystem, BLOQUE_DATO_SENSIBLE, type NegocioCtx } from "./prompt.ts";
import { detectarDatoSensible, extraerCorreo, enmascarar } from "./deteccion.ts";
import { extraerLead, registrarLead } from "./cierre.ts";

// deno-lint-ignore no-explicit-any
type Supa = any;

const MODEL = "gemini-2.5-flash";
const TURN_CAP = 20;
const EXIT_WORDS = ["salir", "cancelar", "terminar", "stop"];
const MARCADOR_CIERRE = "[LISTO]";

export interface CustomerBotConfig extends NegocioCtx {
  trigger: string;
  /** Saludo determinista. Si no se declara, se arma uno con la marca. */
  saludo?: string;
}

interface CsState {
  history: { role: "user" | "model"; text: string }[];
  turns: number;
  correo?: string | null;
  aviso_dato_sensible?: boolean;
}

const clean = (s: string) => (s || "").replace(/```[a-z]*|```/gi, "").trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Retraso proporcional al texto: una respuesta instantánea a un mensaje
// largo se siente robótica. Tope bajo para no exceder la ventana del
// indicador "escribiendo" ni impacientar.
const humanDelay = (text: string) => sleep(Math.min(800 + (text?.length ?? 0) * 10, 3000));

function saludoDe(cfg: CustomerBotConfig): string {
  if (cfg.saludo) return cfg.saludo;
  return (
    `Hola, soy el asistente de ${cfg.marca}. Con gusto te ayudo.\n\n` +
    `Te hago un par de preguntas para entender tu caso y coordino que un asesor te llame. ` +
    `Por aquí no manejamos datos de pago ni documentos: eso lo ve el asesor por el canal seguro.\n\n` +
    `Cuéntame, ¿qué te trae por aquí?`
  );
}

/**
 * Resuelve qué workspace tiene un bot con ese disparador.
 *
 * Se consulta en cada mensaje suelto, pero solo para textos cortos: un
 * disparador es una palabra, así que filtrar por longitud evita ir a la
 * base por cada mensaje largo que nunca sería un trigger.
 */
export async function resolverCustomerTrigger(
  supabase: Supa,
  text: string,
): Promise<{ workspaceId: string; config: CustomerBotConfig } | null> {
  const t = (text || "").trim().toLowerCase().replace(/[!¡.,¿?]/g, "");
  if (!t || t.length > 40) return null;

  // Este bloque corre en CADA mensaje de texto del webhook, incluidos los del
  // equipo registrando gastos. Si la consulta fallara y la excepcion subiera,
  // tumbaria el bot interno completo por una funcion opcional. Ante cualquier
  // error se devuelve null: el mensaje sigue su curso normal.
  try {
    const { data, error } = await supabase
      .from("workspaces")
      .select("id, config_extra")
      .not("config_extra->wa_customer_bot", "is", null);
    if (error) {
      console.error("[cs-chat] resolverCustomerTrigger:", error.message);
      return null;
    }

    for (const ws of data ?? []) {
      const cfg = ws.config_extra?.wa_customer_bot as CustomerBotConfig | undefined;
      if (!cfg?.trigger) continue;
      if (String(cfg.trigger).trim().toLowerCase() === t) {
        return { workspaceId: ws.id, config: cfg };
      }
    }
    return null;
  } catch (e) {
    console.error("[cs-chat] resolverCustomerTrigger lanzo:", (e as Error).message ?? "");
    return null;
  }
}

export async function hasOpenCustomerChat(supabase: Supa, phone: string): Promise<boolean> {
  // Mismo criterio que arriba: ante un fallo se responde "no hay conversacion
  // abierta" y el mensaje cae al flujo normal de ONE. Degradar es preferible a
  // dejar sin servicio a quien si esta autorizado.
  try {
    const { data, error } = await supabase
      .from("cs_chat_sessions")
      .select("phone")
      .eq("phone", phone)
      .eq("closed", false)
      .maybeSingle();
    if (error) {
      console.error("[cs-chat] hasOpenCustomerChat:", error.message);
      return false;
    }
    return !!data;
  } catch (e) {
    console.error("[cs-chat] hasOpenCustomerChat lanzo:", (e as Error).message ?? "");
    return false;
  }
}

export async function startCustomerChat(
  supabase: Supa,
  phone: string,
  workspaceId: string,
  config: CustomerBotConfig,
  waMessageId?: string,
): Promise<void> {
  const saludo = saludoDe(config);
  const state: CsState = { history: [{ role: "model", text: saludo }], turns: 0 };

  await supabase.from("cs_chat_sessions").upsert({
    phone,
    workspace_id: workspaceId,
    state,
    closed: false,
    desenlace: null,
    contacto_id: null,
    updated_at: new Date().toISOString(),
  });

  if (waMessageId) await sendTypingIndicator(waMessageId);
  await humanDelay(saludo);
  await sendTextMessage(phone, saludo);
  console.log(`[cs-chat] iniciada para ${phone} (ws ${workspaceId})`);
}

export async function continueCustomerChat(
  supabase: Supa,
  phone: string,
  text: string,
  waMessageId?: string,
): Promise<void> {
  const { data: row } = await supabase
    .from("cs_chat_sessions")
    .select("state, updated_at, workspace_id")
    .eq("phone", phone)
    .eq("closed", false)
    .maybeSingle();
  if (!row) return; // carrera: la sesión se cerró entre el check y aquí

  const { data: ws } = await supabase
    .from("workspaces")
    .select("config_extra")
    .eq("id", row.workspace_id)
    .single();
  const config = ws?.config_extra?.wa_customer_bot as CustomerBotConfig | undefined;
  if (!config) {
    // Le quitaron la config al workspace con una conversación viva. Se cierra
    // con gracia en vez de dejar a la persona hablando sola.
    await cerrar(supabase, phone, "abandonada");
    await sendTextMessage(phone, "Gracias por escribir. Un asesor te contacta pronto.");
    return;
  }

  if (waMessageId) await sendTypingIndicator(waMessageId);

  // Ventana de servicio de WhatsApp: fuera de 24h el hilo no se puede retomar.
  if (Date.now() - new Date(row.updated_at).getTime() > 24 * 60 * 60 * 1000) {
    await cerrar(supabase, phone, "expirada");
    await sendTextMessage(
      phone,
      `Pasaron más de 24 horas, así que cerré la conversación anterior. Escribe *${config.trigger}* si quieres retomar.`,
    );
    return;
  }

  const state = row.state as CsState;
  const salida = (text || "").trim().toLowerCase().replace(/[!¡.,]/g, "");

  if (EXIT_WORDS.includes(salida)) {
    state.history.push({ role: "user", text: enmascarar(text) });
    await persistir(supabase, phone, state, true, "salida_explicita");
    await sendTextMessage(phone, "Listo, no te escribo más. Si cambias de opinión, aquí estoy.");
    return;
  }

  // ── Barreras deterministas, antes de llamar al modelo ──────────────────
  const sensible = detectarDatoSensible(text);
  const correoNuevo = extraerCorreo(text);
  if (correoNuevo) state.correo = correoNuevo;

  // El historial se persiste SIEMPRE enmascarado. El modelo ve el texto
  // original en este turno para poder reaccionar, pero lo que queda guardado
  // no contiene el dato.
  state.history.push({ role: "user", text: enmascarar(text) });

  const cap = TURN_CAP;
  if (state.turns >= cap) {
    await persistir(supabase, phone, state, true, "abandonada");
    await sendTextMessage(phone, "Voy a pasarle tu caso a un asesor para que te contacte. Gracias por tu tiempo.");
    await cerrarConLead(supabase, phone, row.workspace_id, state);
    return;
  }

  let system = buildSystem(config);
  if (sensible) {
    system += "\n\n" + BLOQUE_DATO_SENSIBLE;
    state.aviso_dato_sensible = true;
  }

  // Gemini exige que el historial arranque con turno de usuario; el nuestro
  // empieza con el saludo del bot, así que se antepone un turno sintético.
  const messages: Msg[] = state.history.map((t) => ({ role: t.role, text: t.text }));
  if (messages[0]?.role === "model") {
    messages.unshift({ role: "user", text: "(La persona escribe al WhatsApp del negocio.)" });
  }

  try {
    const r = await generate({
      model: MODEL,
      system,
      messages,
      temperature: 0.6,
      maxOutputTokens: 300,
      thinkingBudget: 0,
    });

    const bruto = clean(r.text) || "Perdona, no te entendí bien. ¿Me lo repites?";
    const cierra = bruto.includes(MARCADOR_CIERRE);
    // El marcador es interno: se quita siempre, incluso si el modelo lo
    // pone a mitad del texto. La persona nunca debe verlo.
    const botText = bruto.split(MARCADOR_CIERRE).join("").trim();

    state.history.push({ role: "model", text: botText });
    state.turns += 1;

    const cerrado = cierra || state.turns >= cap;
    await persistir(supabase, phone, state, cerrado, cerrado ? "lead_capturado" : null);

    await humanDelay(botText);
    await sendTextMessage(phone, botText);

    if (cerrado) await cerrarConLead(supabase, phone, row.workspace_id, state);
  } catch (e) {
    // El modelo no respondió tras los reintentos. La sesión NO se cierra: el
    // hilo queda guardado y la persona puede retomar reenviando su mensaje.
    console.error("[cs-chat] error en turno:", (e as Error).message ?? "");
    await sendTextMessage(phone, "Perdona, se me cruzaron los cables. ¿Me repites lo último?");
  }
}

async function persistir(
  supabase: Supa,
  phone: string,
  state: CsState,
  closed: boolean,
  desenlace: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = { state, closed, updated_at: new Date().toISOString() };
  if (desenlace) patch.desenlace = desenlace;
  await supabase.from("cs_chat_sessions").update(patch).eq("phone", phone);
}

async function cerrar(supabase: Supa, phone: string, desenlace: string): Promise<void> {
  await supabase
    .from("cs_chat_sessions")
    .update({ closed: true, desenlace, updated_at: new Date().toISOString() })
    .eq("phone", phone);
}

/** Extrae el lead y lo registra. Nunca rompe el cierre de la conversación. */
async function cerrarConLead(
  supabase: Supa,
  phone: string,
  workspaceId: string,
  state: CsState,
): Promise<void> {
  try {
    const lead = await extraerLead(state.history);
    const { contactoId } = await registrarLead(supabase, workspaceId, phone, lead, {
      correoDetectado: state.correo ?? null,
      turnos: state.turns,
      historyEnmascarado: state.history,
    });
    if (contactoId) {
      await supabase.from("cs_chat_sessions").update({ contacto_id: contactoId }).eq("phone", phone);
      console.log(`[cs-chat] lead registrado para ${phone} → contacto ${contactoId}`);
    }
  } catch (e) {
    console.error("[cs-chat] cierre con lead falló:", (e as Error).message ?? "");
  }
}
