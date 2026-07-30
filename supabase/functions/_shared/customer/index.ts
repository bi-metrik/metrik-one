// Bot de SERVICIO AL CLIENTE por WhatsApp — orquestación para el webhook.
//
// Atiende a clientes que YA contrataron. Al abrir la conversación resuelve
// quién escribe contra ONE (contactos + negocios + etapas) y conversa con
// ese contexto: lo saluda por su nombre, sabe qué producto tiene y en qué
// etapa va. Lo que no puede resolver lo pasa a llamada y deja el caso en la
// bandeja para que un agente lo tome.
//
// Calca el ciclo de vida de _shared/venezuela/index.ts (sesión por teléfono,
// tope de turnos, expiración a 24h, salida explícita).
//
// ADITIVO Y OPT-IN: solo se activa para workspaces que declaren
// `config_extra.wa_customer_bot`. Sin esa config nada de esto corre.

import { sendTextMessage, sendTypingIndicator } from "../wa-respond.ts";
import { generate, type Msg } from "../venezuela/gemini.ts";
import { buildSystem, BLOQUE_DATO_SENSIBLE, type EstadoPagos, type Frecuente, type PerfilCliente } from "./prompt.ts";
import { detectarDatoSensible, enmascarar } from "./deteccion.ts";
import { escalarALlamada } from "./cierre.ts";

// deno-lint-ignore no-explicit-any
type Supa = any;

const MODEL = "gemini-2.5-flash";
const TURN_CAP = 20;
const EXIT_WORDS = ["salir", "cancelar", "terminar", "stop"];
const RE_RESUELTO = /\[RESUELTO\]/i;
const RE_LLAMAR = /\[LLAMAR:\s*([^\]]*)\]/i;

export interface CustomerBotConfig {
  trigger: string;
  marca: string;
  frecuentes?: Frecuente[];
  /** Mapa nombre de etapa -> qué significa, en palabras del cliente. */
  etapas_explicacion?: Record<string, string>;
  /** Moneda en que factura este negocio. Default COP. */
  moneda?: string;
  /** Saludo para cliente reconocido. Admite {nombre}. */
  saludo?: string;
  /** Saludo cuando no se reconoce el número. */
  saludo_desconocido?: string;
}

type PerfilExt = PerfilCliente & { contactoId: string | null; negocioId: string | null };

interface CsState {
  history: { role: "user" | "model"; text: string }[];
  turns: number;
  perfil: PerfilExt;
  pagos?: EstadoPagos | null;
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-08-05" -> "5 de agosto de 2026". Sin Date: el parseo de fechas sueltas cambia con la zona horaria. */
function fechaLarga(iso: string | null): string | null {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const mes = MESES[Number(m[2]) - 1];
  if (!mes) return null;
  return `${Number(m[3])} de ${mes} de ${m[1]}`;
}

function money(v: unknown, moneda: string): string | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  // El formato sigue a la MONEDA, no al idioma del bot. Un cliente de Advise
  // está en Estados Unidos o Puerto Rico: "US$ 1.200,00" (notación colombiana)
  // se lee raro y en plata la ambigüedad cuesta una llamada. USD va como
  // $1,200.00; COP como $1.200.
  const esUsd = moneda === "USD";
  try {
    return new Intl.NumberFormat(esUsd ? "en-US" : "es-CO", {
      style: "currency",
      currency: moneda,
      minimumFractionDigits: esUsd ? 2 : 0,
    }).format(n);
  } catch {
    return `${moneda} ${n}`;
  }
}

/**
 * Trae el estado de pagos y lo deja como TEXTO ya formateado.
 *
 * El formateo ocurre aquí y no en el modelo a propósito: el modelo solo
 * repite. Nunca lanza — si falla, el prompt recibe null y el bot escala,
 * que es el comportamiento correcto cuando no tenemos el dato.
 */
async function traerPagos(
  supabase: Supa,
  negocioId: string | null,
  moneda: string,
): Promise<EstadoPagos | null> {
  if (!negocioId) return null;
  try {
    const { data, error } = await supabase.rpc("cs_estado_pagos", { p_negocio_id: negocioId });
    if (error) {
      console.error("[cs-chat] cs_estado_pagos:", error.message);
      return null;
    }
    const r = data?.[0];
    if (!r) return null;
    // Sin precio no hay nada que contar de plata; mejor escalar.
    if (r.precio_total === null && Number(r.pagado ?? 0) === 0) return null;

    const ultFecha = fechaLarga(r.ultimo_pago_fecha);
    const proxFecha = fechaLarga(r.proxima_fecha);
    const ultMonto = money(r.ultimo_pago_monto, moneda);
    const proxMonto = money(r.proxima_monto, moneda);

    return {
      precioTotal: money(r.precio_total, moneda),
      pagado: money(r.pagado, moneda),
      saldo: money(r.saldo, moneda),
      cuotas: r.cuotas_totales ? `${r.cuotas_pagadas} de ${r.cuotas_totales}` : null,
      ultimoPago: ultMonto && ultFecha ? `${ultMonto} el ${ultFecha}` : null,
      proximaCuota: proxMonto && proxFecha ? `${proxMonto} el ${proxFecha}` : null,
      vencido: r.hay_vencido ? money(r.monto_vencido, moneda) : null,
    };
  } catch (e) {
    console.error("[cs-chat] traerPagos lanzó:", (e as Error).message ?? "");
    return null;
  }
}

const clean = (s: string) => (s || "").replace(/```[a-z]*|```/gi, "").trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const humanDelay = (text: string) => sleep(Math.min(800 + (text?.length ?? 0) * 10, 3000));

const PERFIL_VACIO: PerfilExt = {
  nombre: null, caso: null, producto: null, etapaNumero: null,
  etapa: null, responsable: null, identificado: false,
  contactoId: null, negocioId: null,
};

/**
 * Resuelve quién escribe contra ONE.
 *
 * Nunca lanza: si la identificación falla, se atiende sin perfil. Un cliente
 * mal atendido es peor que uno atendido en genérico, pero un bot caído es
 * peor que los dos.
 */
async function identificar(supabase: Supa, workspaceId: string, phone: string): Promise<PerfilExt> {
  try {
    const { data, error } = await supabase.rpc("cs_identificar_cliente", {
      p_workspace_id: workspaceId,
      p_phone: phone,
    });
    if (error) {
      console.error("[cs-chat] identificar:", error.message);
      return PERFIL_VACIO;
    }
    const r = data?.[0];
    // `ambiguo` = el sufijo coincide con varios contactos. Se atiende SIN
    // perfil a propósito: hablarle del caso de otra persona expone datos
    // de un tercero.
    if (!r || r.ambiguo) {
      if (r?.ambiguo) console.warn(`[cs-chat] telefono ambiguo, se atiende sin perfil: ${phone}`);
      return PERFIL_VACIO;
    }
    return {
      nombre: r.contacto_nombre ?? null,
      caso: r.caso_codigo ?? null,
      producto: r.producto ?? null,
      etapaNumero: r.etapa_numero ?? null,
      etapa: r.etapa_nombre ?? null,
      responsable: r.responsable ?? null,
      identificado: true,
      contactoId: r.contacto_id ?? null,
      negocioId: r.negocio_id ?? null,
    };
  } catch (e) {
    console.error("[cs-chat] identificar lanzó:", (e as Error).message ?? "");
    return PERFIL_VACIO;
  }
}

function saludoDe(cfg: CustomerBotConfig, perfil: PerfilExt): string {
  if (!perfil.identificado) {
    return (
      cfg.saludo_desconocido ??
      `Hola, soy el asistente de ${cfg.marca}. Cuéntame en qué te puedo ayudar y, si necesitas algo de tu cuenta, coordino que un asesor te llame.`
    );
  }
  const nombre = (perfil.nombre ?? "").split(" ")[0] || "";
  if (cfg.saludo) return cfg.saludo.replace(/\{nombre\}/g, nombre);
  return `Hola ${nombre}, soy el asistente de ${cfg.marca}. ¿En qué te ayudo hoy?`;
}

export async function resolverCustomerTrigger(
  supabase: Supa,
  text: string,
): Promise<{ workspaceId: string; config: CustomerBotConfig } | null> {
  const t = (text || "").trim().toLowerCase().replace(/[!¡.,¿?]/g, "");
  if (!t || t.length > 40) return null;

  // Corre en CADA mensaje de texto del webhook, incluidos los del equipo
  // registrando gastos. Ante cualquier error se devuelve null y el mensaje
  // sigue su curso: una función opcional no puede tumbar el bot interno.
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
    console.error("[cs-chat] resolverCustomerTrigger lanzó:", (e as Error).message ?? "");
    return null;
  }
}

export async function hasOpenCustomerChat(supabase: Supa, phone: string): Promise<boolean> {
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
    console.error("[cs-chat] hasOpenCustomerChat lanzó:", (e as Error).message ?? "");
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
  const perfil = await identificar(supabase, workspaceId, phone);
  const pagos = await traerPagos(supabase, perfil.negocioId, config.moneda ?? "COP");
  const saludo = saludoDe(config, perfil);
  const state: CsState = { history: [{ role: "model", text: saludo }], turns: 0, perfil, pagos };

  await supabase.from("cs_chat_sessions").upsert({
    phone,
    workspace_id: workspaceId,
    state,
    closed: false,
    desenlace: null,
    contacto_id: perfil.contactoId,
    updated_at: new Date().toISOString(),
  });

  if (waMessageId) await sendTypingIndicator(waMessageId);
  await humanDelay(saludo);
  await sendTextMessage(phone, saludo);
  console.log(
    `[cs-chat] iniciada ${phone} · ws ${workspaceId} · ${perfil.identificado ? `${perfil.nombre} (${perfil.caso ?? "sin caso"})` : "sin identificar"}`,
  );
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
  if (!row) return;

  const { data: ws } = await supabase
    .from("workspaces")
    .select("config_extra")
    .eq("id", row.workspace_id)
    .single();
  const config = ws?.config_extra?.wa_customer_bot as CustomerBotConfig | undefined;
  if (!config) {
    await cerrar(supabase, phone, "abandonada");
    await sendTextMessage(phone, "Gracias por escribir. Un asesor te contacta pronto.");
    return;
  }

  if (waMessageId) await sendTypingIndicator(waMessageId);

  // Ventana de servicio de WhatsApp: fuera de 24h el hilo no se retoma.
  if (Date.now() - new Date(row.updated_at).getTime() > 24 * 60 * 60 * 1000) {
    await cerrar(supabase, phone, "expirada");
    await sendTextMessage(
      phone,
      `Pasaron más de 24 horas y cerré la conversación anterior. Escribe *${config.trigger}* para retomar.`,
    );
    return;
  }

  const state = row.state as CsState;
  const perfil: PerfilExt = state.perfil ?? PERFIL_VACIO;
  const salida = (text || "").trim().toLowerCase().replace(/[!¡.,]/g, "");

  if (EXIT_WORDS.includes(salida)) {
    state.history.push({ role: "user", text: enmascarar(text) });
    await persistir(supabase, phone, state, true, "salida_explicita");
    await sendTextMessage(phone, "Listo. Cuando necesites algo, aquí estoy.");
    return;
  }

  const sensible = detectarDatoSensible(text);
  // El historial se persiste SIEMPRE enmascarado. El modelo ve el original
  // en este turno para poder reaccionar; lo que queda guardado, no.
  state.history.push({ role: "user", text: enmascarar(text) });

  if (state.turns >= TURN_CAP) {
    await persistir(supabase, phone, state, true, "escalada");
    await sendTextMessage(phone, "Voy a pasarle tu caso a un asesor para que te llame y lo resuelvan bien.");
    await escalar(supabase, phone, row.workspace_id, state, null);
    return;
  }

  let system = buildSystem({
    marca: config.marca,
    perfil,
    frecuentes: config.frecuentes ?? [],
    etapasExplicacion: config.etapas_explicacion,
    pagos: state.pagos ?? null,
  });
  if (sensible) system += "\n\n" + BLOQUE_DATO_SENSIBLE;

  const messages: Msg[] = state.history.map((t) => ({ role: t.role, text: t.text }));
  if (messages[0]?.role === "model") {
    messages.unshift({ role: "user", text: "(El cliente escribe al WhatsApp de servicio.)" });
  }

  try {
    const r = await generate({
      model: MODEL,
      system,
      messages,
      temperature: 0.5,
      maxOutputTokens: 320,
      thinkingBudget: 0,
    });

    const bruto = clean(r.text) || "Perdona, no te entendí bien. ¿Me lo repites?";

    // Los marcadores son internos y se quitan siempre, estén donde estén.
    const mLlamar = bruto.match(RE_LLAMAR);
    const pideLlamada = !!mLlamar;
    const franja = mLlamar?.[1]?.trim() || null;
    const resuelto = RE_RESUELTO.test(bruto);
    const botText = bruto.replace(RE_LLAMAR, "").replace(RE_RESUELTO, "").trim();

    state.history.push({ role: "model", text: botText });
    state.turns += 1;

    const cerrado = pideLlamada || resuelto;
    await persistir(supabase, phone, state, cerrado, pideLlamada ? "escalada" : resuelto ? "resuelta" : null);

    await humanDelay(botText);
    await sendTextMessage(phone, botText);

    if (pideLlamada) await escalar(supabase, phone, row.workspace_id, state, franja);
  } catch (e) {
    // El modelo no respondió tras los reintentos. La sesión NO se cierra.
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

async function escalar(
  supabase: Supa,
  phone: string,
  workspaceId: string,
  state: CsState,
  franja: string | null,
): Promise<void> {
  const { id } = await escalarALlamada(supabase, {
    workspaceId,
    phone,
    perfil: state.perfil ?? PERFIL_VACIO,
    franja,
    history: state.history,
  });
  if (id) {
    await supabase.from("cs_chat_sessions").update({ escalamiento_id: id }).eq("phone", phone);
  }
}
