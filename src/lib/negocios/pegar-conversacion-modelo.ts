/**
 * La llamada al modelo de «Pegar conversación», sin la sesión ni la base: el server action
 * (`pegar-conversacion-servidor.ts`) la usa con la llave y el modelo del entorno, y el arnés de
 * `scripts/eval-haiku/` (familia `trappvel_conversacion`) la usa con los chats del banco de pruebas.
 * Una sola función para los dos: lo que mide el arnés es exactamente lo que corre en producción.
 *
 * No es `'use server'`: exporta una función normal y la importan el server action y los scripts.
 */

import { esquemaCarga, instruccionesCarga } from '../../../supabase/functions/_shared/agente/bandeja/extraccion.ts'
import { mensajesDeTextos } from '../../../supabase/functions/_shared/agente/bandeja/carga.ts'
import { textoParaModelo } from '../../../supabase/functions/_shared/wa-guardianes.ts'
import { leerConGemini, MODELO_ENTENDIMIENTO_POR_DEFECTO, type Lectura } from '../../../supabase/functions/_shared/lectura-gemini.ts'
import type { CampoEntendible } from '../../../supabase/functions/_shared/wa-entendimiento-reglas.ts'
import { fetchModeloChat, haikuActivo } from '../../../supabase/functions/_shared/llm-anthropic.ts'

export interface PedidoLecturaChat {
  fields: ReadonlyArray<CampoEntendible>
  /** Los mensajes del chat, ya normalizados y recortados (`mensajesDelChat`). */
  mensajes: ReadonlyArray<string>
  hoyISO: string
  /** Lo que el bloque ya tiene (`aplanarBloques`). */
  yaTiene: Record<string, unknown>
  /** El viaje como lo nombra `viajeParaModelo`. */
  viaje: string
  apiKey: string | null | undefined
  /** Sin valor, `GEMINI_ENTENDIMIENTO_MODEL` o el de siempre. */
  modelo?: string
  /** Sin valor, `fetchModeloChat` (Haiku en esfuerzo `low`, o Gemini según el interruptor). */
  fetch?: typeof fetch
  /** ¿El pedido va a Haiku? Sin valor, lo dice el interruptor (`haikuActivo`). */
  paraHaiku?: boolean
}

/**
 * Lo que Haiku necesita que se le diga y Gemini ya hacía (arnés de Trappvel, 2026-11-04, sobre los 10 chats de la QA):
 *  · dejaba la frase VACÍA en lo deducido («nacional», «playa», «a medida»), y sin frase el código descarta el valor;
 *  · marcaba «comercial» el mensaje de la agencia que propone las fechas y el operador del bloqueo («Tenemos bloqueo con
 *    Aliados Travel saliendo… el jueves 11 de marzo»), y lo que sale de un mensaje «comercial» tampoco se guarda.
 * Va SOLO cuando el pedido va a Haiku: con el interruptor en Gemini el prompt es el de siempre, byte a byte. No cambia
 * ninguna regla del prompt; dice cómo cumplirlas.
 */
export function parrafoChatHaiku(hoyISO: string): string {
  // El ejemplo es el día 18 del mes ANTERIOR al de hoy: siempre ya pasó, así que su próxima vez es el año siguiente.
  const [a, m] = hoyISO.split('-').map(Number)
  const anio = Number.isFinite(a) ? a : new Date().getFullYear()
  const mesHoy = Number.isFinite(m) && m >= 1 && m <= 12 ? m : 1
  const mes = mesHoy === 1 ? 12 : mesHoy - 1
  const anioPasado = mesHoy === 1 ? anio - 1 : anio
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  const mm = String(mes).padStart(2, '0')
  return [
    '',
    'Cómo cumplir lo anterior:',
    '- frase NUNCA va vacía cuando el campo tiene valor, tampoco si es deducido o calculado: copia, letra por letra, el',
    '  pedazo del mensaje del que sale (para nacional o internacional, el que nombra el destino; para el grupo, el que',
    '  dice quiénes viajan). Un valor sin frase se descarta.',
    '- Un mensaje de la agencia que propone, confirma o resume datos de ESTE viaje (destino, fechas, noches, operador,',
    '  hotel, personas) y el cliente no lo contradice es «cliente», no «comercial» ni promoción: sostiene esos valores',
    '  («Tenemos bloqueo con Aliados Travel saliendo el jueves 11 de marzo», y el cliente sigue). «comercial» es solo',
    '  una opinión del comercial sobre el cliente o la venta.',
    `- El año: hoy es ${hoyISO}. Una fecha sin año que ya pasó es del año siguiente: «18 de ${MESES[mes - 1]}» es`,
    `  ${anioPasado + 1}-${mm}-18, no ${anioPasado}-${mm}-18. Revisa el año de cada fecha antes de responder.`,
    '- Un campo de rangos (el presupuesto): toma la cifra que dijeron, COMPLETA y para todo el viaje (no la dividas',
    '  por persona ni por noche), y elige la opción cuyo rango la contiene, de menor a mayor: 2 millones → menos de 3;',
    '  10 millones → entre 8 y 12; 14 millones → entre 12 y 20; 45 millones o «55 a 65 millones» → más de 20. No te',
    '  guíes por el primer dígito.',
    '- La edad manda sobre la palabra: un menor de 1 año (o de meses) es infante, no niño; «Martín de 7 y Lucía que',
    '  tiene 1 año» son 1 niño y 1 infante. La composición con un infante o un niño es familia, no pareja.',
  ].join('\n')
}

export function modeloDeEntendimiento(): string {
  return (process.env.GEMINI_ENTENDIMIENTO_MODEL || '').trim() || MODELO_ENTENDIMIENTO_POR_DEFECTO
}

/** Lee el chat con el mismo pedido del bot (`leerConGemini`). Nunca lanza. */
export function leerChatConModelo(p: PedidoLecturaChat): Promise<Lectura> {
  return leerConGemini({
    apiKey: p.apiKey,
    modelo: p.modelo ?? modeloDeEntendimiento(),
    instrucciones: instruccionesCarga(p.fields, p.hoyISO, p.yaTiene, {}, { viaje: p.viaje })
      + ((p.paraHaiku ?? haikuActivo()) ? parrafoChatHaiku(p.hoyISO) : ''),
    texto: `Mensajes:\n${textoParaModelo(mensajesDeTextos([...p.mensajes]))}`,
    esquema: esquemaCarga(p.fields, { chat: true }),
    fetch: p.fetch ?? fetchModeloChat,
  })
}
