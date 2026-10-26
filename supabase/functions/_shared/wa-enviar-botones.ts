// ============================================================
// Enviar un texto de la bandeja con botones de respuesta (resumen y confirmaciones de sí/no) o con una lista
// ------------------------------------------------------------
// Reusa `sendButtons` (el mismo de la aceptación de términos y del aviso de datos). Si el texto no cabe en el cuerpo
// de los botones (1024 caracteres de Meta), el texto va entero como mensaje y los botones en uno corto aparte: nunca
// se corta el resumen. Sin botones, es un texto como siempre.
//
// Bot híbrido (2026-10-06): un punto de decisión sale con su mensaje interactivo (`enviarPunto`): los botones, o una
// lista para elegir viaje o cliente. Mismo criterio de largo: con más de 1024 caracteres, el texto va aparte.
// ============================================================

import { sendButtons, sendList, sendTextMessage } from './wa-respond.ts';
import { MAX_CUERPO_BOTONES, MAX_TITULO_BOTON, TEXTO_BOTONES_APARTE } from './wa-botones-bandeja.ts';
import type { BotonBandeja } from './wa-botones-bandeja.ts';
import { interactivoDe, MAX_CUERPO_INTERACTIVO, TEXTO_SI_NO_ESTA } from './wa-decision-reglas.ts';
import type { FilaLista, PuntoDecision } from './wa-decision-reglas.ts';

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

/** El cuerpo corto de una lista cuando el texto no cabe con ella. */
export const TEXTO_LISTA_APARTE = 'Elige una opción:';

export async function enviarConLista(
  phone: string, texto: string, boton: string, filas: ReadonlyArray<FilaLista>,
  ctx: { workspaceId: string; intent: string; aparte?: string },
): Promise<boolean> {
  const envio = { origen: 'bot' as const, workspaceId: ctx.workspaceId, intent: ctx.intent };
  try {
    if (filas.length === 0) {
      await sendTextMessage(phone, texto, envio);
      return true;
    }
    if (texto.length <= MAX_CUERPO_INTERACTIVO) {
      await sendList(phone, texto, boton, [...filas], envio);
      return true;
    }
    await sendTextMessage(phone, texto, envio);
    await sendList(phone, ctx.aparte ?? TEXTO_LISTA_APARTE, boton, [...filas], envio);
    return true;
  } catch (err) {
    console.error(`[wa-bandeja] no se pudo enviar con lista a ${phone}:`, err);
    return false;
  }
}

/**
 * Una pregunta que es punto de decisión, con su mensaje interactivo: los botones (los de #1034 o los de la decisión) o
 * la lista. Con viajes fuera de la lista, la línea «Si no está, escríbeme el código o el nombre».
 */
export async function enviarPunto(
  phone: string, texto: string, punto: PuntoDecision, ctx: { workspaceId: string; intent: string; aparte?: string },
): Promise<boolean> {
  const i = interactivoDe(punto);
  const cuerpo = punto.hayMas && i.tipo === 'lista' && !texto.includes(TEXTO_SI_NO_ESTA) ? `${texto}\n${TEXTO_SI_NO_ESTA}` : texto;
  if (i.tipo === 'botones') return enviarConBotones(phone, cuerpo, i.botones, ctx);
  if (i.tipo === 'lista') return enviarConLista(phone, cuerpo, i.boton, i.filas, ctx);
  return enviarConBotones(phone, cuerpo, [], ctx);
}
