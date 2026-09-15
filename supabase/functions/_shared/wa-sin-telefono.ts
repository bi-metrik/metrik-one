// ============================================================
// wa-sin-telefono — que se hace con un mensaje del que Meta no mando el telefono
// ------------------------------------------------------------
// Puro: decide y redacta. El webhook (`wa-webhook/index.ts`) lee la bitacora, envia y avisa.
//
// Quien cae aqui tiene nombre de usuario de WhatsApp y el numero del bot no le ha escrito ni
// recibido nada en 30 dias (ver cabecera de `wa-webhook-payload.ts`). Todo el bot esta indexado
// por telefono —usuarios, sesiones, Cardumen, aceptaciones de terminos—, asi que con solo el
// BSUID no hay a quien enrutarlo. Tres cosas, y ninguna depende de las otras:
//   1. queda registrado en `wa_message_log`, con el BSUID en `phone`;
//   2. se le contesta por su BSUID pidiendole el numero;
//   3. se avisa a quien opera (`WA_ADMIN_NOTIFY_PHONE`) con usuario, BSUID y texto.
// ============================================================

import type { MensajeSinTelefono } from './wa-webhook-payload.ts';

/** Marca con la que estas conversaciones quedan buscables en `wa_message_log`. */
export const INTENT_SIN_TELEFONO = 'remitente_sin_telefono';

/**
 * Avisos internos por BSUID en 24 h. No es uno, como para los numeros desconocidos, porque aqui
 * el segundo mensaje suele ser justo el que trae el numero que se le pidio: callar ese aviso es
 * perder lo unico util de la conversacion. Tres cubren "hola", el numero y una aclaracion, y
 * todavia frenan a quien insista.
 */
export const TOPE_AVISOS_SIN_TELEFONO = 3;

export const MENSAJE_SIN_TELEFONO_PRIMERO =
  'Hola, recibimos tu mensaje. Tu WhatsApp tiene nombre de usuario y por eso no nos llega tu número de teléfono, que es con lo que te identificamos para atenderte.\n\n' +
  'Escríbenos aquí tu número de celular con el indicativo del país (por ejemplo, +57 300 123 4567). Si alguien de nuestro equipo ya te había escrito por WhatsApp, también puedes responderle en ese chat.';

export const MENSAJE_SIN_TELEFONO_SEGUIMIENTO =
  'Gracias, ya le avisamos a nuestro equipo. Si todavía no nos has escrito tu número de celular, escríbelo aquí para que te contactemos.';

export interface DecisionSinTelefono {
  /** Que se le contesta a la persona. */
  mensaje: string;
  /** Si sale aviso interno. */
  avisar: boolean;
}

/**
 * `previos`: cuantos mensajes de este BSUID hay en la bitacora en las ultimas 24 h, contados
 * ANTES de registrar el actual. `null` si la consulta fallo: se trata como la primera vez, porque
 * perder un aviso es peor que repetirlo.
 */
export function decidirSinTelefono(previos: number | null): DecisionSinTelefono {
  const n = previos ?? 0;
  return {
    mensaje: n === 0 ? MENSAJE_SIN_TELEFONO_PRIMERO : MENSAJE_SIN_TELEFONO_SEGUIMIENTO,
    avisar: n < TOPE_AVISOS_SIN_TELEFONO,
  };
}

/** Lo que se guarda en `wa_message_log.message_preview` (la bitacora lo corta a 100). */
export function previewSinTelefono(m: MensajeSinTelefono): string {
  const quien = m.username ? `@${m.username}` : 'sin usuario';
  return `[${quien}] ${m.texto}`;
}

/** Aviso interno. Lleva lo necesario para reconocer a la persona sin abrir ninguna tabla. */
export function avisoSinTelefono(m: MensajeSinTelefono): string {
  return [
    '👤 Alguien con nombre de usuario de WhatsApp le escribió al bot y Meta no envió su número.',
    '',
    `Usuario: ${m.username ? `@${m.username}` : '(sin nombre de usuario)'}`,
    `Nombre: ${m.nombre ?? '(sin nombre de perfil)'}`,
    `BSUID: ${m.user_id}`,
    `Dice: ${m.texto.slice(0, 200)}`,
    '',
    'El bot le pidió su número de celular. Mientras no lo tenga no lo puede identificar ni atender, y tampoco le puede mostrar una aceptación pendiente. Si sabes quién es, que el bot le escriba a su teléfono: desde ese momento Meta vuelve a mandar su número por 30 días y el flujo normal lo atiende.',
  ].join('\n');
}

/** Variables con nombre para la plantilla, si algun dia `WA_ALERT_TEMPLATES` declara una. */
export function variablesAvisoSinTelefono(m: MensajeSinTelefono): Record<string, string> {
  return {
    usuario: m.username ? `@${m.username}` : '',
    nombre: m.nombre ?? '',
    bsuid: m.user_id,
    mensaje: m.texto.slice(0, 200),
  };
}
