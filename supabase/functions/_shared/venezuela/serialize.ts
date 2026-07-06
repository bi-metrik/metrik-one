// Serializador del estudio Voz de Venezuela: convierte la transcripcion de la conversacion
// en un registro estructurado (una llamada a Gemini al cierre). Equivalente al R2 de Cardumen.
// No inventa: si un dato no aparece en lo que dijo la persona, lo deja null / lista vacia.

import { generate } from "./gemini.ts";

export interface VeRecord {
  atribucion: "con_nombre" | "anonima";
  nombre: string | null;
  ubicacion: string | null;
  necesidades: string[];
  quien_ayudo: string | null;
  historia: string | null;
  edad: number | null;
  sexo: string | null;
  genero: string | null;
  zona: "rural" | "urbano" | null;
  resumen: string;
  idioma: string;
}

const EXTRACT_MODEL = "gemini-3.1-flash-lite"; // extraccion barata, thinking OFF

const SYSTEM = `Eres un extractor de datos. Recibes la transcripcion de una conversacion de escucha
con una persona afectada por el terremoto de Venezuela. Devuelve SOLO un objeto JSON con estos campos,
extraidos EXCLUSIVAMENTE de lo que dijo la persona. NO inventes ni completes: si un dato no aparece,
usa null (o [] para listas).

{
  "atribucion": "con_nombre" o "anonima",  // "con_nombre" SOLO si dio permiso explicito de aparecer con su nombre
  "nombre": string o null,                  // el nombre con el que quiere aparecer; null si es anonima o no lo dijo
  "ubicacion": string o null,               // ciudad / sector / municipio aproximado
  "necesidades": [string],                  // necesidades mencionadas (agua, comida, medicinas, techo, pilas...)
  "quien_ayudo": string o null,             // quien ha ayudado hasta ahora, si lo menciono
  "historia": string o null,                // el mensaje que quiere que el mundo escuche (textual o parafraseo fiel)
  "edad": number o null,                    // edad en anios, solo si la dijo
  "sexo": string o null,                    // sexo, si lo menciono
  "genero": string o null,                  // genero con el que se identifica (respeta la identidad de genero que exprese)
  "zona": "rural" o "urbano" o null,        // si vive en zona rural o urbana
  "resumen": string,                        // 1-2 frases neutrales que resumen su situacion
  "idioma": string                          // codigo del idioma en que hablo: "es", "pt", etc.
}`;

function parseLoose<T>(text: string): T | null {
  const clean = (text || "").replace(/```json|```/gi, "").trim();
  try { return JSON.parse(clean) as T; } catch { /* continua */ }
  const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
  if (s >= 0 && e > s) {
    try { return JSON.parse(clean.slice(s, e + 1)) as T; } catch { /* continua */ }
  }
  return null;
}

export async function serializeVe(
  history: { role: "user" | "model"; text: string }[],
): Promise<VeRecord | null> {
  const transcript = history
    .map((t) => `${t.role === "user" ? "PERSONA" : "ASISTENTE"}: ${t.text}`)
    .join("\n");

  const r = await generate({
    model: EXTRACT_MODEL,
    system: SYSTEM,
    messages: [{ role: "user", text: transcript }],
    temperature: 0.2,
    maxOutputTokens: 600,
    thinkingBudget: 0,
    jsonMime: true,
  });

  const rec = parseLoose<Partial<VeRecord>>(r.text);
  if (!rec) return null;

  // Normalizacion defensiva.
  return {
    atribucion: rec.atribucion === "con_nombre" ? "con_nombre" : "anonima",
    nombre: rec.nombre ?? null,
    ubicacion: rec.ubicacion ?? null,
    necesidades: Array.isArray(rec.necesidades) ? rec.necesidades : [],
    quien_ayudo: rec.quien_ayudo ?? null,
    historia: rec.historia ?? null,
    edad: typeof rec.edad === "number" ? rec.edad : null,
    sexo: rec.sexo ?? null,
    genero: rec.genero ?? null,
    zona: rec.zona === "rural" || rec.zona === "urbano" ? rec.zona : null,
    resumen: rec.resumen ?? "",
    idioma: rec.idioma ?? "es",
  };
}
