// cardumen-ingesta — recibe el envio de un instrumento de Cardumen (modo `miniweb`).
//
// POR QUE existe: los instrumentos nuevos (`reframeit.metrik.com.co/adultos` y `/ninos`)
// son HTML estatico y hoy guardan SOLO en el dispositivo (localStorage/IndexedDB). O sea
// que lo que responde la persona no llega a ninguna parte: si cambia de telefono o limpia
// el navegador, se pierde. Este endpoint es la via para que ese envio aterrice en
// `cardumen_respuestas`, la misma tabla donde ya aterrizan el chat y las mini-webs viejas.
//
// POR QUE es publico: quien responde NO es usuario de ONE y no tiene sesion de Supabase.
// Es el mismo trato que ya tenia `cardumen_respuestas` (grant de INSERT a `anon` desde el
// 2026-08-10). La diferencia es que aqui el `estudio` se VALIDA contra el catalogo antes de
// escribir, cosa que un INSERT directo con la anon key no hace.
//
// LO QUE ESTE ENDPOINT NO HACE, a proposito:
//   - no devuelve ninguna respuesta guardada (es solo de escritura);
//   - no loguea el payload (es lo que dijo la persona);
//   - no acepta un `estudio` que no exista o este apagado;
//   - no guarda audio: el tope de 1 MB lo deja fuera (ver `LIMITE_BYTES` en validar.ts).

import { getServiceClient } from "../_shared/supabase-client.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { LIMITE_BYTES, idSesionDelPayload, validarCuerpo } from "./validar.ts";

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };

function responder(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

Deno.serve(async (req) => {
  // Preflight: la pagina vive en otro dominio (reframeit.metrik.com.co).
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { ...corsHeaders, "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  }
  if (req.method !== "POST") {
    return responder(405, { error: "method_not_allowed" });
  }

  // Tope de tamano. Se revisa el Content-Length (barato) Y el cuerpo leido: el header lo
  // pone el cliente y puede faltar o mentir, asi que no alcanza con creerle.
  const declarado = Number(req.headers.get("content-length") ?? "0");
  if (declarado > LIMITE_BYTES) {
    return responder(413, { error: "payload_too_large", limite_bytes: LIMITE_BYTES });
  }

  let texto: string;
  try {
    texto = await req.text();
  } catch {
    return responder(400, { error: "cuerpo_ilegible" });
  }
  if (new TextEncoder().encode(texto).length > LIMITE_BYTES) {
    return responder(413, { error: "payload_too_large", limite_bytes: LIMITE_BYTES });
  }

  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    return responder(400, { error: "json_invalido" });
  }

  const v = validarCuerpo(crudo);
  if (!v.ok) return responder(400, { error: "cuerpo_invalido", detalle: v.motivo });
  const { estudio, token, lang, payload } = v.cuerpo;

  const supabase = getServiceClient();

  // 1. El estudio tiene que existir y estar encendido. Si no, 404 sin decir cual de las
  //    dos cosas fallo: desde afuera no hay por que poder enumerar el catalogo.
  const { data: fila, error: errEstudio } = await supabase
    .from("cardumen_estudios")
    .select("estudio, activo")
    .eq("estudio", estudio)
    .maybeSingle();
  if (errEstudio) {
    console.error("[cardumen-ingesta] error consultando catalogo:", errEstudio.message);
    return responder(500, { error: "error_interno" });
  }
  if (!fila || fila.activo === false) {
    console.warn(`[cardumen-ingesta] envio rechazado: estudio '${estudio}' no existe o esta apagado`);
    return responder(404, { error: "estudio_no_disponible" });
  }

  // 2. Idempotencia, si el instrumento trae un id de sesion. Reintentar (red intermitente,
  //    boton tocado dos veces) tiene que dejar UNA fila, no dos: dos filas del mismo envio
  //    no se distinguen de dos participantes y le mueven el denominador al analisis.
  //
  //    NO es atomica — la tabla no tiene unique sobre una ruta del payload, y ponerselo
  //    exigiria decidir la clave canonica del id de sesion, que es decision de Saga. Dos
  //    POST verdaderamente simultaneos del mismo envio pueden insertar dos filas. Cubre el
  //    caso real (reintento secuencial), no una carrera.
  const sesion = idSesionDelPayload(payload);
  if (sesion) {
    const { data: previa, error: errPrevia } = await supabase
      .from("cardumen_respuestas")
      .select("id")
      .eq("estudio", estudio)
      .eq(`payload->>${sesion.clave}`, sesion.id)
      .limit(1)
      .maybeSingle();
    if (errPrevia) {
      console.error("[cardumen-ingesta] error buscando envio previo:", errPrevia.message);
      // Se sigue adelante: perder el envio es peor que arriesgar un duplicado.
    } else if (previa?.id) {
      // El envio mas reciente de la misma sesion reemplaza al anterior (el instrumento
      // puede mandar un parcial y despues el completo).
      const { error: errUpd } = await supabase
        .from("cardumen_respuestas")
        .update({ payload, lang, token })
        .eq("id", previa.id);
      if (errUpd) {
        console.error("[cardumen-ingesta] error actualizando envio previo:", errUpd.message);
        return responder(500, { error: "error_interno" });
      }
      console.log(`[cardumen-ingesta] envio actualizado estudio='${estudio}' (misma sesion)`);
      return responder(200, { ok: true, id: previa.id, duplicado: true });
    }
  }

  const { data: creada, error: errIns } = await supabase
    .from("cardumen_respuestas")
    .insert({ estudio, token, lang, payload })
    .select("id")
    .maybeSingle();
  if (errIns) {
    console.error("[cardumen-ingesta] error guardando envio:", errIns.message);
    return responder(500, { error: "error_interno" });
  }

  // Se registra el QUE y el CUANTO, nunca el contenido.
  console.log(`[cardumen-ingesta] envio guardado estudio='${estudio}' bytes=${texto.length} con_sesion=${!!sesion}`);
  return responder(201, { ok: true, id: creada?.id ?? null, duplicado: false });
});
