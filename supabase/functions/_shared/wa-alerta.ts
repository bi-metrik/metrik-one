// ============================================================
// wa-alerta — la unica puerta por la que sale una alerta proactiva
// ------------------------------------------------------------
// Antes cada alerta de `wa-alerts` hacia tres pasos sueltos: consultar el cupo, llamar a
// `sendTextMessage` y escribir en `wa_message_log`. Tres pasos que cada sitio nuevo tenia
// que acordarse de repetir, y el W25 ya se los habia saltado a medias (consultaba el cupo
// una vez y despues mandaba hasta tres mensajes). Aqui van juntos, asi que una alerta
// nueva nace con el cupo respetado y con plantilla, sin que su autor lo recuerde.
// ============================================================

import { sendTemplate, sendTextMessage } from './wa-respond.ts';
import { leerRegistro, resolverAviso } from './wa-plantillas.ts';
import type { RegistroPlantillas } from './wa-plantillas.ts';
import type { OrigenEnvio } from './wa-envios.ts';
import type { SupabaseClient } from './types.ts';

/** Tope de alertas por persona por dia. Acota cuantas se INICIAN, no cuantos mensajes
 *  llegan: un texto largo se parte en varios y todos salen (ver `splitMessage`). Con
 *  plantilla el punto es discutible — una plantilla es siempre un mensaje. */
const TOPE_ALERTAS_DIA = 2;

// El registro se lee una vez por isolate: una corrida de wa-alerts son cientos de envios
// y parsear el mismo JSON en cada uno es basura pura. Un cambio del secreto reinicia la
// funcion, asi que no hay riesgo de servir un mapa viejo.
let registroCache: RegistroPlantillas | null = null;
function registro(): RegistroPlantillas {
  if (!registroCache) registroCache = leerRegistro(Deno.env.get('WA_ALERT_TEMPLATES'));
  return registroCache;
}

/** Solo para pruebas y para forzar una relectura. */
export function _olvidarRegistro(): void {
  registroCache = null;
}

/**
 * Cuantas alertas se le han iniciado hoy a este numero, y si queda cupo.
 *
 * ⚠️ Cuenta contra `wa_envios`, no contra `wa_message_log`. Dos razones, y las dos
 * salieron del incidente del 2026-09-01:
 *
 *   (a) `wa_message_log` no sabe como termino el mensaje. Las tres W25 de ese dia las
 *       acepto la Graph API (200 + wamid) y Meta las fallo despues por el webhook con
 *       `131047`: nadie las recibio y las tres consumieron cupo igual. Un envio que el
 *       destinatario nunca vio no puede callar el del dia siguiente.
 *   (b) `wa_envios` tiene TODO lo saliente, incluidas las respuestas del bot. Por eso el
 *       filtro `origen = 'alerta'` es obligatorio: sin el, quien chatee dos veces con el
 *       bot se queda sin alertas. Es exactamente el riesgo que la migracion
 *       `20260901000003_wa_envios` dejo advertido, entrando por la puerta de al lado.
 *
 * Ante un error de lectura devuelve `true` (deja pasar). Un aviso de saldo vencido que no
 * sale porque la base tosio es peor que uno de mas.
 */
export async function hayCupoDeAlerta(supabase: SupabaseClient, phone: string): Promise<boolean> {
  const inicioDelDia = new Date();
  inicioDelDia.setHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('wa_envios')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('origen', 'alerta')
    .not('status', 'in', '("failed","rechazado")')
    .gte('created_at', inicioDelDia.toISOString());

  if (error) {
    console.error(`[wa-alerta] no se pudo leer el cupo de ${phone}, se deja pasar:`, error.message);
    return true;
  }
  return (count ?? 0) < TOPE_ALERTAS_DIA;
}

export interface AlertaSalida {
  /** Falso si el cupo la freno. No es un error: es el tope funcionando. */
  enviada: boolean;
  via: 'plantilla' | 'texto' | 'sin_cupo';
}

export interface AlertaEntrada {
  phone: string;
  intent: string;
  /** Lo que se manda si el intent no tiene plantilla declarada. Es el texto de hoy. */
  texto: string;
  /** Valores con nombre que la plantilla puede pedir. El sitio que envia los publica
   *  aunque todavia no exista plantilla: eso es lo que despues deja declararla sin tocar
   *  codigo. */
  variables?: Record<string, string | number | null | undefined>;
  workspaceId?: string;
}

/**
 * Manda una alerta proactiva. Consulta el cupo, elige plantilla o texto, y envia.
 *
 * Un intent sin plantilla declarada sale como texto — o sea, exactamente como hoy — y lo
 * dice en consola. Es deliberado: el registro arranca vacio y nada cambia hasta que Yuto
 * apruebe las plantillas en Meta. Lo que cambia el dia que las apruebe es un secreto.
 */
export async function enviarAlerta(
  supabase: SupabaseClient,
  a: AlertaEntrada,
): Promise<AlertaSalida> {
  if (!(await hayCupoDeAlerta(supabase, a.phone))) {
    console.log(`[wa-alerta] ${a.intent}: tope diario alcanzado para ${a.phone}`);
    return { enviada: false, via: 'sin_cupo' };
  }

  const ctx = { origen: 'alerta' as OrigenEnvio, workspaceId: a.workspaceId, intent: a.intent };
  const aviso = resolverAviso(registro(), a.intent, a.variables);

  if (aviso.modo === 'plantilla') {
    await sendTemplate(a.phone, aviso.plantilla.name, aviso.plantilla.lang, aviso.componentes, ctx);
    return { enviada: true, via: 'plantilla' };
  }

  // `sin_registro` no se reporta: es el estado normal mientras no haya plantillas. Los
  // otros dos si, porque significan que alguien declaro algo y no cuadra.
  if (aviso.motivo !== 'sin_registro') {
    console.warn(`[wa-alerta] ${a.intent} sale como texto libre (${aviso.motivo}: ${aviso.detalle ?? '-'}). ` +
      'Fuera de la ventana de 24 h Meta lo rechaza con 131047.');
  }
  await sendTextMessage(a.phone, a.texto, ctx);
  return { enviada: true, via: 'texto' };
}

/**
 * Como `enviarAlerta` pero sin tope: para avisos internos que reaccionan a un hecho
 * puntual (no a un cron) y que no pueden quedarse callados por un contador diario.
 */
export async function enviarAvisoInterno(
  phone: string,
  intent: string,
  texto: string,
  variables: Record<string, string | number | null | undefined> = {},
): Promise<void> {
  const ctx = { origen: 'interno' as OrigenEnvio, intent };
  const aviso = resolverAviso(registro(), intent, variables);
  if (aviso.modo === 'plantilla') {
    await sendTemplate(phone, aviso.plantilla.name, aviso.plantilla.lang, aviso.componentes, ctx);
    return;
  }
  if (aviso.motivo !== 'sin_registro') {
    console.warn(`[wa-alerta] aviso interno ${intent} sale como texto libre (${aviso.motivo}: ${aviso.detalle ?? '-'})`);
  }
  await sendTextMessage(phone, texto, ctx);
}
