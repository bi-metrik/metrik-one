// ============================================================
// Enviar un texto de la bandeja con botones de respuesta (resumen y confirmaciones de sí/no)
// ------------------------------------------------------------
// Reusa `sendButtons` (el mismo de la aceptación de términos y del aviso de datos). Si el texto no cabe en el cuerpo
// de los botones (1024 caracteres de Meta), el texto va entero como mensaje y los botones en uno corto aparte: nunca
// se corta el resumen. Sin botones, es un texto como siempre.
// ============================================================

import { sendButtons, sendTextMessage } from './wa-respond.ts';
import { MAX_CUERPO_BOTONES, MAX_TITULO_BOTON, TEXTO_BOTONES_APARTE } from './wa-botones-bandeja.ts';
import type { BotonBandeja } from './wa-botones-bandeja.ts';

export async function enviarConBotones(
  phone: string, texto: string, botones: ReadonlyArray<BotonBandeja>,
  ctx: { workspaceId: string; intent: string; aparte?: string },
): Promise<boolean> {
  const envio = { origen: 'bot' as const, workspaceId: ctx.workspaceId, intent: ctx.intent };
  try {
    const bs = botones.slice(0, 3).map(b => ({ id: b.id, title: [...b.title].slice(0, MAX_TITULO_BOTON).join('') }));
    if (bs.length === 0) {
      await sendTextMessage(phone, texto, envio);
      return true;
    }
    if (texto.length <= MAX_CUERPO_BOTONES) {
      await sendButtons(phone, texto, bs, envio);
      return true;
    }
    await sendTextMessage(phone, texto, envio);
    await sendButtons(phone, ctx.aparte ?? TEXTO_BOTONES_APARTE, bs, envio);
    return true;
  } catch (err) {
    console.error(`[wa-bandeja] no se pudo enviar con botones a ${phone}:`, err);
    return false;
  }
}
