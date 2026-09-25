// Verificacion de la firma `x-hub-signature-256` que Meta pone en cada POST del webhook de WhatsApp.
//
// Modulo PURO a proposito: no lee `Deno.env` ni la red, asi que se prueba desde vitest sin importar
// `wa-webhook/index.ts` (que llama `Deno.serve` al cargar). Quien llama lee las variables de entorno
// y se las pasa.
//
// Por que existe (2026-09-25): el webhook llamaba `if (!verifySignature(body, signature))` sin
// `await`. La funcion es async, la Promise siempre es truthy, y el chequeo NUNCA rechazaba nada:
// cualquier POST sin firmar se procesaba como si lo mandara Meta. Por eso la prueba de regresion
// exige que el resultado sea un booleano ya resuelto, no una Promise.
//
// Falla CERRADO: sin secreto se rechaza. Antes se intentaba adivinar "estoy en produccion" con
// `DENO_DEPLOYMENT_ID` / `NODE_ENV`, y no esta claro que el Edge Runtime de Supabase ponga ninguna
// de las dos: un secreto ausente podia terminar aceptando todo. La unica excepcion es explicita
// (`saltarFirma`, que el webhook toma de `WA_WEBHOOK_SKIP_FIRMA=1`) y solo aplica cuando NO hay
// secreto configurado: con secreto, siempre se verifica.

const PREFIJO = 'sha256=';
// HMAC-SHA256 = 32 bytes = 64 caracteres hex.
const LARGO_HEX = 64;

export interface OpcionesFirma {
  /** Solo desarrollo local. Viene de `WA_WEBHOOK_SKIP_FIRMA=1`. Ignorado si hay secreto. */
  saltarFirma?: boolean;
}

export async function verificarFirmaMeta(
  body: string,
  signature: string | null,
  appSecret: string | undefined,
  opciones: OpcionesFirma = {},
): Promise<boolean> {
  if (!appSecret) {
    if (opciones.saltarFirma) {
      console.warn('[wa-firma] WHATSAPP_APP_SECRET ausente y WA_WEBHOOK_SKIP_FIRMA=1: firma NO verificada (solo desarrollo local)');
      return true;
    }
    console.error('[wa-firma] WHATSAPP_APP_SECRET ausente: se rechaza la peticion');
    return false;
  }

  if (!signature) return false;
  if (!signature.startsWith(PREFIJO)) return false;
  const recibida = signature.slice(PREFIJO.length).toLowerCase();
  if (recibida.length !== LARGO_HEX) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const firma = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  const calculada = Array.from(firma).map((b) => b.toString(16).padStart(2, '0')).join('');

  return igualesEnTiempoConstante(calculada, recibida);
}

// Compara dos cadenas del mismo largo sin cortar en el primer caracter distinto, para no filtrar
// por tiempo cuantos caracteres acerto quien falsifica la firma.
function igualesEnTiempoConstante(a: string, b: string): boolean {
  const ba = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}
