// ============================================================
// wa-desconocido — que se le contesta a un numero que no esta registrado en ONE
// ------------------------------------------------------------
// Puro: decide y redacta. El webhook (`wa-webhook/index.ts`) lee la bitacora, registra y envia.
//
// Decision de Mauricio (2026-10-29): por el numero de Agus solo habla quien esta registrado en
// MeTRIK ONE; el numero dice de que workspace es y con que rol habla. A quien no esta registrado no
// se le intenta clasificar ni se avisa a nadie: una sola respuesta que lo manda a su administrador o
// al WhatsApp de MeTRIK. El mensaje queda en `wa_message_log` siempre.
// ============================================================

import { NUMERO_METRIK } from './agente/persona.ts';

/** Marca con la que estas conversaciones quedan buscables en `wa_message_log`. */
export const INTENT_DESCONOCIDO = 'numero_desconocido';

/** `573159509103` → `+57 315 950 9103`. */
export function telefonoLegible(digitos: string): string {
  const d = digitos.replace(/\D/g, '');
  const m = d.match(/^(57)(\d{3})(\d{3})(\d{4})$/);
  return m ? `+${m[1]} ${m[2]} ${m[3]} ${m[4]}` : `+${d}`;
}

export const MENSAJE_DESCONOCIDO =
  'Hola. Este número no está registrado en MéTRIK ONE.\n\n' +
  'Pídele al administrador de tu empresa que lo registre en Configuración → Equipo, ' +
  `o escríbenos al WhatsApp de MéTRIK: ${telefonoLegible(NUMERO_METRIK)}.`;

/**
 * ¿Se le contesta? Una vez cada 24 h por numero: veinte mensajes no son veinte respuestas.
 * `previos` = mensajes de este numero con `INTENT_DESCONOCIDO` en las ultimas 24 h, contados ANTES de
 * registrar el actual; `null` si la consulta fallo, y entonces se contesta (dejar a alguien sin respuesta
 * es peor que repetirla).
 */
export function responderDesconocido(previos: number | null): boolean {
  return previos === null || previos === 0;
}
