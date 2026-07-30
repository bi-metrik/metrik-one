// Cierre de la conversación: de historial de chat a lead en ONE.
//
// El lead aterriza en `contactos` + `contacto_interacciones`, exactamente
// donde ya caen los leads de Meta (meta-leads-webhook). Así el asesor no
// tiene una bandeja nueva que aprender: el que entró por el bot y el que
// entró por pauta se ven en el mismo sitio y se convierten igual.
//
// Igual que en Meta: NO se crea un negocio. Se crea el contacto y se deja
// una interacción en estado 'nueva'. El humano decide cuál convierte.

import { generate } from "../venezuela/gemini.ts";

// deno-lint-ignore no-explicit-any
type Supa = any;

const MODELO_SERIALIZE = "gemini-2.5-flash";

export interface LeadExtraido {
  nombre: string | null;
  correo: string | null;
  motivo: string | null;
  momento_llamada: string | null;
  resumen: string | null;
}

const SCHEMA_HINT = `
Devuelves SOLO un objeto JSON con esta forma exacta:

{
  "nombre": "nombre de pila y apellido si lo dio, o null",
  "correo": "correo si lo dio, o null",
  "motivo": "en una frase, qué problema de crédito trae, o null",
  "momento_llamada": "cuándo pidió que la llamen, textual, o null",
  "resumen": "dos frases sobre la conversación, para que el asesor entre en contexto"
}

Reglas:
- Si un dato no aparece en la conversación, va null. NO lo inventes ni lo deduzcas.
- El nombre sale de lo que la persona dijo de sí misma, no del saludo del bot.
- No incluyas datos de pago ni documentos aunque aparezcan en el texto.
`.trim();

/** Extrae los campos del lead del historial. Devuelve null si el modelo falla. */
export async function extraerLead(
  history: { role: "user" | "model"; text: string }[],
): Promise<LeadExtraido | null> {
  const transcripcion = history
    .map((t) => `${t.role === "user" ? "PERSONA" : "BOT"}: ${t.text}`)
    .join("\n");

  try {
    const r = await generate({
      model: MODELO_SERIALIZE,
      system: SCHEMA_HINT,
      messages: [{ role: "user", text: transcripcion }],
      temperature: 0,
      maxOutputTokens: 512,
      thinkingBudget: 0,
      jsonMime: true,
    });
    const limpio = (r.text || "").replace(/```json|```/gi, "").trim();
    if (!limpio) return null;
    const rec = JSON.parse(limpio) as LeadExtraido;
    return {
      nombre: rec.nombre ?? null,
      correo: rec.correo ?? null,
      motivo: rec.motivo ?? null,
      momento_llamada: rec.momento_llamada ?? null,
      resumen: rec.resumen ?? null,
    };
  } catch (e) {
    console.error("[cs-chat] extraerLead falló:", (e as Error).message ?? "");
    return null;
  }
}

/**
 * Crea o reusa el contacto y deja la interacción.
 *
 * Dedup por teléfono dentro del workspace: si la persona ya había escrito
 * antes, se actualiza lo que falte en vez de duplicar la ficha. Nunca se
 * pisa un dato existente con null.
 */
export async function registrarLead(
  supabase: Supa,
  workspaceId: string,
  phone: string,
  lead: LeadExtraido | null,
  extras: { correoDetectado?: string | null; turnos: number; historyEnmascarado: unknown },
): Promise<{ contactoId: string | null }> {
  // El correo capturado por expresión regular manda sobre el del modelo:
  // el primero se leyó del texto, el segundo se infirió.
  const correo = extras.correoDetectado ?? lead?.correo ?? null;
  const nombre = lead?.nombre?.trim() || `Contacto WhatsApp ${phone.slice(-4)}`;
  const telefono = phone.startsWith("+") ? phone : `+${phone}`;

  try {
    const { data: existente } = await supabase
      .from("contactos")
      .select("id, nombre, email")
      .eq("workspace_id", workspaceId)
      .eq("telefono", telefono)
      .maybeSingle();

    let contactoId: string;

    if (existente) {
      contactoId = existente.id;
      // Solo se completa lo que falta. Un contacto que ya tenía nombre real
      // no se degrada al placeholder de esta conversación.
      const parche: Record<string, unknown> = {};
      if (!existente.email && correo) parche.email = correo;
      if (lead?.nombre && existente.nombre?.startsWith("Contacto WhatsApp")) parche.nombre = lead.nombre;
      if (Object.keys(parche).length > 0) {
        await supabase.from("contactos").update(parche).eq("id", contactoId);
      }
    } else {
      const { data: creado, error } = await supabase
        .from("contactos")
        .insert({
          workspace_id: workspaceId,
          nombre,
          telefono,
          email: correo,
          fuente_adquisicion: "web_organico",
          fuente_detalle: "Bot de WhatsApp",
          segmento: "contactado",
        })
        .select("id")
        .single();
      if (error || !creado) {
        console.error("[cs-chat] no se pudo crear el contacto:", error?.message ?? "");
        return { contactoId: null };
      }
      contactoId = creado.id;
    }

    await supabase.from("contacto_interacciones").insert({
      workspace_id: workspaceId,
      contacto_id: contactoId,
      fuente: "whatsapp_bot",
      fuente_ref: phone,
      estado: "nueva",
      ocurrida_at: new Date().toISOString(),
      payload: {
        motivo: lead?.motivo ?? null,
        momento_llamada: lead?.momento_llamada ?? null,
        resumen: lead?.resumen ?? null,
        turnos: extras.turnos,
        conversacion: extras.historyEnmascarado,
      },
    });

    return { contactoId };
  } catch (e) {
    console.error("[cs-chat] registrarLead falló:", (e as Error).message ?? "");
    return { contactoId: null };
  }
}
