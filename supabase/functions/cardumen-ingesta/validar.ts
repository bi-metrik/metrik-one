// Validacion del cuerpo que manda un instrumento de Cardumen (mini-web).
//
// Vive aparte del handler a proposito: es logica PURA y la ejercita `validar.test.ts` en
// vitest. Lo que entra aqui viene de una pagina publica, sin sesion de Supabase, asi que
// cada supuesto sobre la forma del cuerpo tiene que estar escrito.

/**
 * Tope del cuerpo. Los instrumentos pueden adjuntar audio en base64 y base64 infla ~33%:
 * sin tope, un envio de 20 MB se vuelve una fila de 20 MB en `cardumen_respuestas` y un
 * error de PostgREST que la pagina no sabe leer. 1 MB alcanza para respuestas de texto;
 * el audio necesita Storage, no esta tabla, y eso es decision aparte.
 */
export const LIMITE_BYTES = 1_000_000;

/** Idiomas que el instrumento puede declarar. Otro valor no se guarda, se cae a null. */
const LANGS = ["es", "en", "pt"];

/**
 * Claves con las que un instrumento puede traer el id de la sesion. Lista CERRADA: el id
 * se usa para no duplicar la fila si la pagina reintenta, y aceptar cualquier clave
 * convertiria un dato del participante en llave de idempotencia por accidente.
 */
export const CLAVES_SESION = ["session_id", "sesion_id", "sessionId"] as const;

export interface CuerpoValido {
  estudio: string;
  token: string | null;
  lang: string | null;
  payload: Record<string, unknown>;
}

export type Validacion =
  | { ok: true; cuerpo: CuerpoValido }
  | { ok: false; motivo: string };

export function validarCuerpo(raw: unknown): Validacion {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, motivo: "cuerpo debe ser un objeto JSON" };
  }
  const b = raw as Record<string, unknown>;

  const estudio = typeof b.estudio === "string" ? b.estudio.trim() : "";
  // Mismo alfabeto que los slugs del catalogo. No es cosmetico: el slug entra despues en
  // un filtro de PostgREST, y acotarlo aqui deja fuera cualquier forma rara de una vez.
  if (!estudio || estudio.length > 80 || !/^[a-z0-9][a-z0-9-]*$/.test(estudio)) {
    return { ok: false, motivo: "estudio invalido" };
  }

  // `payload` es NOT NULL en la tabla y es TODO el valor del envio: un objeto vacio es un
  // envio sin respuestas, que no vale guardar.
  if (b.payload === null || typeof b.payload !== "object" || Array.isArray(b.payload)) {
    return { ok: false, motivo: "payload debe ser un objeto JSON" };
  }
  const payload = b.payload as Record<string, unknown>;
  if (Object.keys(payload).length === 0) {
    return { ok: false, motivo: "payload vacio" };
  }

  // token = con quien se liga el envio (hoy el telefono por el que llego el link). Es
  // nullable en la tabla: un instrumento abierto sin `?p=` sigue pudiendo responder.
  let token: string | null = null;
  if (typeof b.token === "string" && b.token.trim()) token = b.token.trim().slice(0, 64);

  const lang = typeof b.lang === "string" && LANGS.includes(b.lang.toLowerCase())
    ? b.lang.toLowerCase()
    : null;

  return { ok: true, cuerpo: { estudio, token, lang, payload } };
}

/**
 * Id de sesion del payload y la clave con la que vino, o null si no trae ninguno.
 *
 * Se devuelve TAMBIEN la clave porque la busqueda del duplicado filtra por esa ruta
 * (`payload->>session_id`): el que reintenta es el mismo instrumento, asi que la fila
 * anterior guardo el id bajo la misma clave. Sin la clave habria que consultar tres veces.
 */
export function idSesionDelPayload(
  payload: Record<string, unknown>,
): { clave: string; id: string } | null {
  for (const clave of CLAVES_SESION) {
    const v = payload[clave];
    if (typeof v === "string" && v.trim() && v.length <= 200) {
      return { clave, id: v.trim() };
    }
  }
  return null;
}
