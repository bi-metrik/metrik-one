// ============================================================
// El ANCLA de cada mensaje de la asesora a su pedido de bloqueo (entrega única, brief del 2026-11-04)
// ------------------------------------------------------------
// Una asesora lleva varios clientes a la vez. Cada pedido es un hilo con su código (COT-…): lo que llega
// respondiendo (citando) un mensaje de ese hilo va a ese pedido. Lo que llega suelto se asigna SOLO si no
// hay duda; si la hay, se pregunta. Nunca se adivina. Puro: sin red ni base (lo usan el webhook y Next).
//
// Lo que dice Meta (documentación leída el 2026-11-04):
//  · Un mensaje que cita otro trae `context.id` = wamid del citado (webhooks/reference/messages/text;
//    `context.from` + `context.id` en el ejemplo de respuesta). El de un toque de botón también
//    (interactive-reply-buttons-messages). Para imágenes la referencia no muestra `context.id`: por eso un
//    pantallazo sin cita se trata como suelto.
//  · Botones de respuesta: máximo 3, título ≤ 20 caracteres, id ≤ 256.
// ============================================================

export type EstadoAncla = 'recibiendo' | 'procesando' | 'tipo_por_confirmar' | 'por_confirmar' | 'aplicando' | 'frenado' | 'listo'

export interface EntregaAbierta {
  id: string
  codigo: string | null
  cliente: string | null
  estado: EstadoAncla
  /** Todos los wamid del hilo: lo que ella mandó y lo que Trappi le contestó. */
  wamids: ReadonlyArray<string>
  /** ¿Ya trae un texto que abre pedido («bloqueo para …»)? */
  tieneEncabezado: boolean
  /** Hora del último mensaje del hilo (ISO). */
  ultimaEn: string
}

export interface MensajeEntrante {
  tipo: 'texto' | 'imagen' | 'boton'
  texto: string | null
  contextoWamid: string | null
  /** El id del botón tocado (`eb|…`). */
  botonId: string | null
}

export type DecisionAncla =
  /** No es de la entrega única: sigue el flujo de siempre. */
  | { accion: 'otro' }
  /** Abre un pedido nuevo con este mensaje. `tentativo`: un texto sin señal de bloqueo; si no llegan pantallazos, se suelta. */
  | { accion: 'nueva'; tentativo: boolean }
  | { accion: 'agregar'; entregaId: string }
  | { accion: 'responder'; entregaId: string }
  | { accion: 'tipo'; entregaId: string; tipo: 'bloqueo' | 'a_medida' }
  /** El toque que asigna un mensaje suelto: a un pedido o a uno nuevo. */
  | { accion: 'asignar'; piezaId: string; entregaId: string | 'nuevo' }
  /** No se sabe a cuál: se pregunta con estas opciones. */
  | { accion: 'preguntar'; opciones: { id: string; titulo: string }[]; motivo: string }

/** Minutos en que un pedido que se está recibiendo sigue abierto a mensajes sueltos. */
export const MINUTOS_RECIBIENDO = 10

/** «bloqueo», «Aliados», «Tu Reserva», «paquete del operador» (E-03). */
export function tieneSenalDeBloqueo(texto: string | null | undefined): boolean {
  return /\bbloqueos?\b|\baliados\b|\btu\s*reserva\b|paquete\s+del\s+operador/i.test(String(texto ?? ''))
}

/** Un texto corto que contesta («sí», «sí, 1 pública», «2 no aplica», «no, son 3»). */
export function pareceRespuesta(texto: string | null | undefined): boolean {
  const t = String(texto ?? '').trim().toLowerCase()
  if (!t || t.length > 280) return false
  return /^(s[ií]|si,|ok|listo|dale|correcto|no\b|\d+[\s.)-])/.test(t) || /^\d+\s/.test(t)
}

const recibiendo = (e: EntregaAbierta, ahora: Date) =>
  e.estado === 'recibiendo' && ahora.getTime() - Date.parse(e.ultimaEn) <= MINUTOS_RECIBIENDO * 60_000
const esperandoRespuesta = (e: EntregaAbierta) => e.estado === 'por_confirmar' || e.estado === 'frenado'

/**
 * El nombre que trae el texto del pedido («bloqueo para Laura Gómez, 2 adultos» → «Laura Gómez»), para rotular un
 * pedido que todavía no tiene código. `null` si no lo dice.
 */
export function clienteDelTexto(texto: string | null | undefined): string | null {
  const m = /\bpara\s+(?:la\s+señora\s+|el\s+señor\s+|la\s+sra\.?\s+|el\s+sr\.?\s+)?(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)?)/u.exec(String(texto ?? ''))
  return m ? m[1] : null
}

/** El título de un botón para un pedido: «COT-2026-0015» o el cliente, en 20 caracteres. */
export function tituloDeEntrega(e: Pick<EntregaAbierta, 'codigo' | 'cliente'>): string {
  const t = e.codigo ? `${e.codigo.replace(/^COT-\d{4}-0*/, 'COT ')}${e.cliente ? ` ${e.cliente.split(/\s+/)[0]}` : ''}` : (e.cliente ?? 'Pedido en curso')
  return [...t].slice(0, 20).join('')
}

function opcionesPara(abiertas: EntregaAbierta[], piezaId: string, conNuevo: boolean): { id: string; titulo: string }[] {
  const ops = abiertas.slice(0, conNuevo ? 2 : 3).map(e => ({ id: `eb|asignar|${e.id}|${piezaId}`, titulo: tituloDeEntrega(e) }))
  if (conNuevo) ops.push({ id: `eb|asignar|nuevo|${piezaId}`, titulo: 'Pedido nuevo' })
  return ops
}

/**
 * `piezaId`: el id con que se guardará el mensaje (para que el toque de la pregunta lo encuentre).
 * `abiertas`: los pedidos de ESTA asesora que no han terminado.
 */
export function decidirAncla(m: MensajeEntrante, abiertas: ReadonlyArray<EntregaAbierta>, piezaId: string, ahora: Date): DecisionAncla {
  // 1. Toques de botones de la entrega.
  if (m.tipo === 'boton' && m.botonId?.startsWith('eb|')) {
    const [, que, a, b] = m.botonId.split('|')
    if (que === 'tipo' && (a === 'bloqueo' || a === 'a_medida') && b) return { accion: 'tipo', entregaId: b, tipo: a }
    if (que === 'asignar' && a && b) return { accion: 'asignar', entregaId: a, piezaId: b }
    return { accion: 'otro' }
  }
  if (m.tipo === 'boton') return { accion: 'otro' }

  // 2. Cita un mensaje del hilo: va a ese pedido, sin preguntar.
  if (m.contextoWamid) {
    const del = abiertas.find(e => e.wamids.includes(m.contextoWamid!))
    if (del) {
      if (m.tipo === 'texto' && esperandoRespuesta(del)) return { accion: 'responder', entregaId: del.id }
      return { accion: 'agregar', entregaId: del.id }
    }
  }

  const enCurso = abiertas.filter(e => recibiendo(e, ahora))
  const porResponder = abiertas.filter(esperandoRespuesta)

  // 3. Un texto con señal de bloqueo abre pedido, salvo que sea el encabezado que le falta al que se recibe.
  if (m.tipo === 'texto' && tieneSenalDeBloqueo(m.texto)) {
    const sinEncabezado = enCurso.filter(e => !e.tieneEncabezado)
    if (sinEncabezado.length === 1 && enCurso.length === 1) return { accion: 'agregar', entregaId: sinEncabezado[0].id }
    return { accion: 'nueva', tentativo: false }
  }

  // 4. Una respuesta suelta: si hay un solo pedido esperando respuesta (y ninguno recibiéndose), es de ese.
  if (m.tipo === 'texto' && pareceRespuesta(m.texto) && porResponder.length > 0 && enCurso.length === 0) {
    if (porResponder.length === 1) return { accion: 'responder', entregaId: porResponder[0].id }
    return { accion: 'preguntar', opciones: opcionesPara(porResponder, piezaId, false), motivo: 'Tienes varias cotizaciones esperando respuesta. ¿Para cuál es?' }
  }

  // 5. Un pantallazo o un texto suelto.
  if (enCurso.length === 1 && porResponder.length === 0) return { accion: 'agregar', entregaId: enCurso[0].id }
  if (enCurso.length === 1 && m.tipo === 'texto') return { accion: 'agregar', entregaId: enCurso[0].id }
  if (enCurso.length + porResponder.length === 0) {
    // Nada abierto: una imagen abre pedido (E-03: los pantallazos del operador dicen bloqueo); un texto, tentativo.
    return m.tipo === 'imagen' ? { accion: 'nueva', tentativo: false } : { accion: 'nueva', tentativo: true }
  }
  if (m.tipo === 'texto' && enCurso.length === 0) return { accion: 'otro' }
  const candidatos = [...enCurso, ...porResponder.filter(e => !enCurso.includes(e))]
  return {
    accion: 'preguntar',
    opciones: opcionesPara(candidatos, piezaId, true),
    motivo: m.tipo === 'imagen'
      ? 'No sé a qué cotización va este pantallazo. ¿Para cuál es? (O respóndeme citando el mensaje del pedido.)'
      : 'No sé a qué cotización va este mensaje. ¿Para cuál es?',
  }
}
