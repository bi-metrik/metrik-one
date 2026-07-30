// Cierre de la conversación de servicio.
//
// Dos desenlaces:
//   - RESUELTO  → el bot contestó y no queda nada pendiente. No se escala.
//   - LLAMAR    → queda un caso en la bandeja para que un agente lo tome.
//
// El escalamiento es el producto, no el fallback. Un bot de servicio que
// nunca escala es un bot que está inventando respuestas.

import { generate } from "../venezuela/gemini.ts";
import type { PerfilCliente } from "./prompt.ts";

// deno-lint-ignore no-explicit-any
type Supa = any;

const MODELO_RESUMEN = "gemini-2.5-flash";

const SCHEMA_HINT = `
Devuelves SOLO un objeto JSON con esta forma:

{
  "motivo": "en una frase, qué necesita la persona que no se pudo resolver",
  "resumen": "dos o tres frases para que el agente entre en contexto sin leer el chat",
  "nombre_declarado": "el nombre que la persona dio de sí misma, o null si no lo dijo"
}

Reglas:
- Escribe para el agente que va a llamar, no para el cliente.
- No inventes datos que no estén en la conversación.
- No incluyas datos de pago ni documentos aunque aparezcan.
`.trim();

export interface ResumenEscalamiento {
  motivo: string;
  resumen: string;
  /** Nombre que la persona dio, cuando el número no estaba registrado. */
  nombreDeclarado: string | null;
}

/** Resume el caso para el agente. Si el modelo falla, se escala igual con lo que hay. */
export async function resumirParaAgente(
  history: { role: "user" | "model"; text: string }[],
): Promise<ResumenEscalamiento | null> {
  const transcripcion = history
    .map((t) => `${t.role === "user" ? "CLIENTE" : "BOT"}: ${t.text}`)
    .join("\n");

  try {
    const r = await generate({
      model: MODELO_RESUMEN,
      system: SCHEMA_HINT,
      messages: [{ role: "user", text: transcripcion }],
      temperature: 0,
      maxOutputTokens: 400,
      thinkingBudget: 0,
      jsonMime: true,
    });
    const limpio = (r.text || "").replace(/```json|```/gi, "").trim();
    if (!limpio) return null;
    const rec = JSON.parse(limpio) as ResumenEscalamiento & { nombre_declarado?: string | null };
    return {
      motivo: rec.motivo ?? "Sin motivo registrado",
      resumen: rec.resumen ?? "",
      nombreDeclarado: rec.nombre_declarado ?? null,
    };
  } catch (e) {
    console.error("[cs-chat] resumirParaAgente falló:", (e as Error).message ?? "");
    return null;
  }
}

/**
 * Deja el caso en la bandeja de llamadas.
 *
 * Nunca lanza: si esto falla, la persona ya recibió la promesa de que la
 * llaman, así que el error se registra pero no se le devuelve a ella. Lo que
 * sí queda es rastro en el log para que no se pierda en silencio.
 */
export async function escalarALlamada(
  supabase: Supa,
  args: {
    workspaceId: string;
    phone: string;
    perfil: PerfilCliente & { contactoId?: string | null; negocioId?: string | null };
    franja: string | null;
    history: { role: "user" | "model"; text: string }[];
  },
): Promise<{ id: string | null }> {
  const resumen = await resumirParaAgente(args.history);

  try {
    const { data, error } = await supabase
      .from("cs_escalamientos")
      .insert({
        workspace_id: args.workspaceId,
        contacto_id: args.perfil.contactoId ?? null,
        negocio_id: args.perfil.negocioId ?? null,
        phone: args.phone,
        // Si el número no estaba registrado, el nombre es el que la persona
        // dijo. Sin esto el agente recibe un teléfono suelto y no sabe ni por
        // quién preguntar cuando llame.
        cliente_nombre: args.perfil.nombre ?? resumen?.nombreDeclarado ?? null,
        motivo: resumen?.motivo ?? "Solicitud por WhatsApp sin clasificar",
        franja: args.franja,
        resumen: resumen?.resumen ?? null,
        conversacion: args.history,
        estado: "pendiente",
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error("[cs-chat] no se pudo escalar:", error?.message ?? "");
      return { id: null };
    }
    console.log(`[cs-chat] escalado ${data.id} · ${args.phone} · franja: ${args.franja ?? "sin definir"}`);
    return { id: data.id };
  } catch (e) {
    console.error("[cs-chat] escalarALlamada lanzó:", (e as Error).message ?? "");
    return { id: null };
  }
}
