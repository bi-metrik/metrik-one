// Lo que comparten la prueba del banco (`wa-interprete-banco.test.ts`, modelo falso, en el CI) y la
// corrida de QA con Gemini real (fuera del CI): la decisión del validador en la forma del `esperado`
// de la simulación, y cuándo cumple. Solo para pruebas: no se despliega con ninguna función.
import { atajoExacto, leerConfirmacion, norm, respuestaExacta, type Decision, type PreguntaUnificada } from '../wa-interprete-reglas.ts';
import { esNombreNuevo, resolverEncabezado } from '../wa-viajes-reglas.ts';
import type { RespuestaConfirmarNuevo, ResolucionEncabezado, ViajeAbierto } from '../wa-viajes-reglas.ts';
import { leerEsLaMisma, separarNombreYLlave, soloLlave } from '../wa-cliente-reglas.ts';

/**
 * Lo que hace el código de hoy con un escrito que NO llega al modelo en la bandeja (como en producción: el atajo
 * exacto, `atajoExacto` con la pregunta pendiente y el encabezado), en la forma del `esperado`. `null`: llega al
 * modelo. Solo los atajos cuyo resultado se puede decir aquí: el encabezado («nuevo …», un código, un nombre
 * exacto), la confirmación de cliente nuevo, el nombre que espera la caja y lo que espera el cliente de un viaje
 * nuevo (2026-10-05). `cliente`: el cliente de la caja abierta (el candidato pendiente).
 */
export function deHoy(
  texto: string, pend: PreguntaUnificada | null, viajes: ReadonlyArray<ViajeAbierto>, cliente: string | null,
  /** Con la caja de un viaje nuevo esperando: la llave, o si el dueño de la llave es la misma persona (lo lee la simulación de la tanda). */
  espera: 'llave' | 'misma' | null = null,
): Record<string, unknown> | null {
  // La simulación de la tanda (`wa-interprete.ts`, 3b): lo que la caja consume no llega al modelo.
  if (espera) {
    if (soloLlave(texto)) return { accion: 'responder', opcion: 'llave' };
    const s = espera === 'misma' ? leerEsLaMisma(texto) : null;
    if (s) return { accion: 'responder', opcion: s };
  }
  const enc = resolverEncabezado(texto, viajes);
  const atajo = atajoExacto(texto, { bandeja: { palabrasCierre: ['listo'] }, pendiente: pend, encabezado: enc });
  // Con «¿Creo el cliente nuevo …?» pendiente, lo exacto (también un nombre que es encabezado) lo contesta.
  if (atajo && pend?.capa === 'nuevo_confirmar' && (atajo === 'respuesta_exacta' || atajo === 'encabezado_exacto')) {
    return atajo === 'respuesta_exacta' ? resumirConfirmacionDeHoy(leerConfirmacion(texto, pend)) : null;
  }
  if (atajo === 'respuesta_exacta' && pend) {
    if (pend.capa === 'tanda_nombre' && respuestaExacta(texto, pend)) {
      if (enc?.tipo === 'nuevo') return resumirEncabezadoDeHoy(enc, cliente);
      const n = esNombreNuevo(texto);
      return n ? { accion: 'abrir_viaje', nuevo: norm(separarNombreYLlave(n).nombre || n) } : { accion: 'pedir_nombre' };
    }
    if (pend.capa === 'tanda_cliente') {
      if (soloLlave(texto)) return { accion: 'responder', opcion: 'llave' };
      const s = leerEsLaMisma(texto);
      return s ? { accion: 'responder', opcion: s } : { accion: 'pedir_aclaracion' };
    }
    return null;
  }
  if (atajo === 'encabezado_exacto' && enc && !pend) return resumirEncabezadoDeHoy(enc, cliente);
  return null;
}

/** Lo que hace el código de hoy con un encabezado exacto, en la forma del `esperado`. */
export function resumirEncabezadoDeHoy(r: ResolucionEncabezado, cliente: string | null): Record<string, unknown> {
  if (r.tipo === 'viaje') return { accion: 'abrir_viaje', viaje: r.viaje.id };
  if (r.tipo === 'nuevo') {
    if (r.cliente) return { accion: 'abrir_viaje', nuevo: norm(r.cliente) };
    // «es para uno nuevo», «sobre un cliente antiguo»: el cliente de la caja (`armarSegmentos`).
    if (r.mismo && cliente) return { accion: 'abrir_viaje', nuevo: norm(cliente) };
    return { accion: 'pedir_nombre' };
  }
  if (r.tipo === 'aproximado') return { accion: 'preguntar_viaje', candidatos: [r.viaje.id] };
  if (r.tipo === 'ambiguo') return { accion: 'preguntar_viaje', candidatos: r.candidatos.map(v => v.id) };
  return { accion: 'pedir_aclaracion' };
}

/**
 * Lo que hace el código de hoy con una respuesta a «¿Creo el cliente nuevo «X»?» que el atajo lee exacta (no llega
 * al modelo), en la misma forma del `esperado`. El banco la usa para los turnos NC (sexto control de Vera).
 */
export function resumirConfirmacionDeHoy(r: RespuestaConfirmarNuevo): Record<string, unknown> {
  switch (r.tipo) {
    case 'si': return { accion: 'confirmar' };
    case 'existente': return { accion: 'responder', opcion: r.negocio_id };
    case 'codigo': return { accion: 'responder', opcion: r.codigo };
    case 'descartar': return { accion: 'responder', opcion: 'descartar' };
    case 'nombre': return { accion: 'responder', opcion: 'nuevo', nuevo: norm(r.nombre) };
    default: return { accion: 'pedir_aclaracion' };
  }
}

/** La decisión en la forma del `esperado` de la simulación (la del prototipo). */
export function resumir(d: Decision): Record<string, unknown> {
  if (d.tipo === 'fallback') return { accion: 'fallback' };
  const p = d.paso;
  switch (p.p) {
    case 'registrar': {
      const i = p.interpretacion;
      if (i.accion === 'abrir_viaje' && i.viaje_id) return { accion: 'abrir_viaje', viaje: i.viaje_id, ...(i.con_contenido ? { con_contenido: true } : {}) };
      if (i.accion === 'abrir_viaje' && i.nuevo) return { accion: 'abrir_viaje', nuevo: norm(i.nuevo), ...(i.con_contenido ? { con_contenido: true } : {}) };
      if (i.accion === 'abrir_viaje') return { accion: 'pedir_nombre' };
      if (i.accion === 'nombre') return { accion: 'abrir_viaje', nuevo: norm(i.nuevo) };
      if (i.accion === 'preguntar_viaje') return { accion: 'preguntar_viaje', candidatos: i.candidatos };
      if (i.accion === 'contenido' && i.varios) return { accion: 'contenido_varios', viajes: i.varios };
      return { accion: 'contenido' };
    }
    case 'responder_bandeja': {
      const i = p.interpretacion;
      if (i.accion === 'confirmar') return { accion: 'confirmar' };
      if (i.accion === 'mover') return { accion: 'mover', n: Number(/el (\d+)/.exec(p.canonico)?.[1]), viaje: i.viaje_id };
      if (i.accion === 'descartar') return { accion: 'responder', opcion: 'descartar' };
      if (i.nuevo) return { accion: 'responder', opcion: 'nuevo', nuevo: norm(i.nuevo) };
      return { accion: 'responder', opcion: i.viaje_id };
    }
    case 'nota_interna': return { accion: 'nota_interna' };
    case 'cerrar_tanda': return { accion: 'cerrar_tanda' };
    case 'descartar': return { accion: 'descartar', alcance: p.alcance };
    case 'bot_gastos': return { accion: 'gasto', gastos: p.gastos.map(g => ({ monto: g.monto, negocio: g.negocio === 'empresa' ? 'empresa' : g.negocio?.id ?? null, desc: g.descripcion ? norm(g.descripcion) : null })) };
    case 'bot_corregir': {
      const c = p.cambios[0];
      return { accion: 'corregir_gasto', campo: c.campo, valor: c.campo === 'negocio' ? (c.valor === 'empresa' ? 'empresa' : c.valor?.id) : c.campo === 'descripcion' ? norm(c.valor) : c.valor };
    }
    case 'bot_boton': return { accion: p.boton === 'btn_confirm' ? 'confirmar' : p.boton === 'btn_cancel' ? 'cancelar' : 'responder', ...(p.boton === 'btn_sin_soporte' ? { opcion: 'no_tengo' } : {}) };
    case 'bot_texto': return { accion: 'responder', valor: Number(p.texto.replace(/\D/g, '')) * (/mil/.test(p.texto) ? 1000 : 1) };
    case 'bot_consulta': return { accion: 'consulta' };
    case 'bot_ayuda': return { accion: 'saludo' };
    case 'nada': return { accion: 'acuse' };
    case 'decir': return { accion: d.accion === 'fuera_de_alcance' ? 'fuera_de_alcance' : d.accion };
    default: return { accion: p.p };
  }
}

/** Lo que el `esperado` exige: sus claves, con `gastos` comparados solo en lo que el banco fija. */
export function cumple(r: Record<string, unknown>, e: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(e)) {
    if (k === 'gastos') {
      const gs = r.gastos as Array<Record<string, unknown>> | undefined;
      const es = v as Array<Record<string, unknown>>;
      if (!gs || gs.length !== es.length) return false;
      if (!es.every((g, i) => Object.entries(g).every(([kk, vv]) => (kk === 'desc' ? String(gs[i].desc ?? '').includes(String(vv)) : gs[i][kk] === vv)))) return false;
      continue;
    }
    if (k === 'nuevo') { if (norm(r.nuevo) !== norm(v)) return false; continue; }
    // `sin`: claves que NO pueden venir (un viaje nuevo nunca termina en un viaje existente).
    if (k === 'sin') { if ((v as string[]).some(x => r[x] !== undefined)) return false; continue; }
    if (k === 'valor' && typeof v === 'string') { if (norm(r.valor) !== norm(v)) return false; continue; }
    if (JSON.stringify(r[k]) !== JSON.stringify(v)) return false;
  }
  return true;
}

