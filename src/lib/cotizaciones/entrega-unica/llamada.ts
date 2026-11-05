import { MODELO_ASISTENTE, type Pantallazo, type UsoModelo } from '@/lib/cotizaciones/asistente/armar-con-modelo'
import { ESQUEMA_ENTREGA, ESQUEMA_RESPUESTA, type SalidaEntrega, type SalidaRespuesta } from './esquema'
import type { Pregunta } from './preguntas'

/**
 * La llamada al modelo de la entrega única: UNA por pedido (y una por cada respuesta de la asesora).
 * Misma forma que el piloto del 2026-11-03 (`armarConClaude`): API de Mensajes directa, razonamiento
 * adaptativo con `effort: high` y el esquema como herramienta no estricta (no cabe en la salida
 * estricta). El modelo, `MODELO_ASISTENTE` (Haiku 5.5 por defecto, decisión de Mauricio 2026-11-03).
 */

const INSTRUCCIONES = `Eres Trappi, el asistente de cotizaciones de una agencia de viajes, y trabajas dentro de su sistema (ONE).
Una asesora te manda por WhatsApp un pedido: mensajes de texto (a veces transcritos de un audio) y pantallazos del operador.
Con eso armas EN LA MISMA PASADA los requisitos del viaje y el borrador de la cotización.
Sigue el MANUAL DE LA ENTREGA y el MANUAL DE COTIZACIÓN al pie de la letra, con UNA diferencia: el mensaje para la asesora NO lo escribes tú (ignora §4 del manual de la entrega). Lo arma el sistema. Tú solo redactas preguntas en "redaccion" y el sistema decide cuáles manda.
Lee los precios y datos exactamente como están en los pantallazos (los precios en pesos, enteros, sin puntos).
En cada hotel, "temporadaEnPantallazo" es la temporada copiada letra por letra, con el año si lo trae («*A*ALTA 2026»). No la limpies ni le quites el año.
En "operadorDeclarado" pon el operador como lo nombró la asesora o como aparece escrito en un pantallazo. En "tarifaDicha", solo lo que ella dijo («pública», «neta»); si no lo dijo, null.
Todo lo que no puedas resolver con certeza va en "dudas" (de la cotización), con lo que pusiste mientras tanto. No supongas en silencio. Si no sabes cuántos viajan, "viajeros" es null y "borrador" es null.
En "cajaFoto" da la caja de la foto del hotel en el pantallazo como [ymin, xmin, ymax, xmax] normalizados a 0-1000.
Termina llamando la herramienta.`

const INSTRUCCIONES_RESPUESTA = `${INSTRUCCIONES}

SEGUNDA VUELTA: ya armaste los requisitos y el borrador, y el sistema le mandó a la asesora un mensaje con preguntas numeradas. Ahora llega su respuesta.
Aplica lo que ella dijo y devuelve los requisitos y el borrador COMPLETOS ya corregidos (no solo lo que cambió).
- «sí» sin más = todo bien, no cambia nada; las preguntas quedan resueltas con lo que pusiste mientras tanto.
- «1 pública», «2 sí aplica», «2 quítalo»: resuelve la pregunta con ese número. Si una respuesta quita un hotel, quítalo del borrador.
- Si dice la tarifa (pública o neta), ponla en "tarifaDicha" y en el "tipoTarifa" de cada hotel.
- Si da los viajeros, ponlos en "viajeros" y arma el borrador con la acomodación que corresponda (manual de cotización).
- Si un niño queda gratis en un hotel («sí aplica» a la nota de niños gratis), NO lo saques de ese hotel: agrega en "ninos" un rango «Gratis» con precio 0 y asígnalo ahí en "ninosAsignados". Todo viajero tiene que quedar acomodado en cada hotel.
- En "respuestas", una entrada por pregunta numerada que ella contestó (o que el «sí» cubre).
- Si algo no se entiende o no se puede aplicar, dilo en "noEntendido" con la pregunta que le harías. No inventes.`

export interface PedidoParaModelo {
  hoy: string
  codigo: string
  /** Los mensajes de texto de la asesora, en orden. */
  mensajes: string[]
  pantallazos: Pantallazo[]
  manual: string
}

export interface ResultadoLlamada<T> {
  salida: T
  uso: UsoModelo
  ms: number
  modelo: string
}

function contenido(p: PedidoParaModelo, extra: string[] = []): unknown[] {
  const content: unknown[] = [{
    type: 'text',
    text: `DATOS DE ONE: hoy es ${p.hoy}. Consecutivo asignado: ${p.codigo}.\n\nCHAT DE LA ASESORA (en orden):\n${p.mensajes.map(m => `- «${m}»`).join('\n') || '- (solo pantallazos)'}`,
  }]
  p.pantallazos.forEach((f, i) => {
    content.push({ type: 'text', text: `Pantallazo ${i + 1} (${f.nombre}):` })
    content.push({ type: 'image', source: { type: 'base64', media_type: f.mime, data: f.base64 } })
  })
  for (const t of extra) content.push({ type: 'text', text: t })
  return content
}

async function llamar<T>(system: string, content: unknown[], herramienta: string, esquema: unknown, timeoutMs = 240_000): Promise<ResultadoLlamada<T>> {
  const llave = process.env.ANTHROPIC_API_KEY?.trim()
  if (!llave) throw new Error('Falta ANTHROPIC_API_KEY')
  const t0 = Date.now()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'content-type': 'application/json', 'x-api-key': llave, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODELO_ASISTENTE,
      max_tokens: 32_000,
      system,
      messages: [{ role: 'user', content }],
      tools: [{ name: herramienta, description: 'Entrega el resultado del pedido.', input_schema: esquema }],
      tool_choice: { type: 'auto' },
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
    }),
  })
  const ms = Date.now() - t0
  if (!res.ok) throw new Error(`Modelo ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  const bloque = (data.content ?? []).find((b: { type: string; name?: string }) => b.type === 'tool_use' && b.name === herramienta)
  if (!bloque) throw new Error(`El modelo no entregó el pedido (terminó con ${data.stop_reason})`)
  const u = data.usage ?? {}
  const pensamiento = u.output_tokens_details?.thinking_tokens ?? 0
  return {
    salida: bloque.input as T,
    uso: {
      promptTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      salidaTokens: (u.output_tokens ?? 0) - pensamiento,
      pensamientoTokens: pensamiento,
      totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
    },
    ms,
    modelo: data.model ?? MODELO_ASISTENTE,
  }
}

export type Llamador = {
  armar(p: PedidoParaModelo): Promise<ResultadoLlamada<SalidaEntrega>>
  aplicar(p: PedidoParaModelo, anterior: SalidaEntrega, preguntas: Pregunta[], respuesta: string): Promise<ResultadoLlamada<SalidaRespuesta>>
}

export const llamadorAnthropic: Llamador = {
  armar: p => llamar<SalidaEntrega>(`${INSTRUCCIONES}\n\n${p.manual}`, contenido(p), 'entregar_pedido', ESQUEMA_ENTREGA),
  aplicar: (p, anterior, preguntas, respuesta) => llamar<SalidaRespuesta>(
    `${INSTRUCCIONES_RESPUESTA}\n\n${p.manual}`,
    contenido(p, [
      `LO QUE ARMASTE (requisitos y borrador):\n${JSON.stringify({ requisitos: anterior.requisitos, borrador: anterior.borrador })}`,
      `PREGUNTAS QUE LE MANDÓ EL SISTEMA:\n${preguntas.map(q => `${q.numero}. [${q.clave}${q.pantallazo ? `, pantallazo ${q.pantallazo}` : ''}] ${q.texto}`).join('\n') || '(ninguna: solo se le pidió confirmar)'}`,
      `RESPUESTA DE LA ASESORA:\n«${respuesta}»`,
    ]),
    'aplicar_respuesta', ESQUEMA_RESPUESTA,
  ),
}
