import { describe, expect, it } from 'vitest';
import BANCO from './__fixtures__/interprete-banco.json';
import { esEscrito, norm, preguntaPendienteUnificada, validar, type Decision, type NegocioCtx, type PreguntaUnificada } from './wa-interprete-reglas.ts';

/**
 * El banco de la simulación (escenarios.json, 45 turnos: 37 + los 8 de control H1–H8) como prueba de
 * integración del VALIDADOR con un modelo falso que devuelve las acciones esperadas (la primera corrida
 * de gemini-2.5-flash que acertó, convertida al esquema nuevo; a mano donde ninguna acertó). Valida el
 * validador, no el modelo: la corrida con Gemini real la hace la QA (§9 del diseño), no el CI.
 *
 * Cada turno arranca del estado esperado, como en la simulación. El despacho de cada acción a la
 * función que ya existe se prueba aparte, con mocks (`wa-interprete.test.ts`).
 */

type Turno = (typeof BANCO.turnos)[number];
type Pend = { capa: string; texto: string; opciones?: string[] } | null;

const VIAJES: NegocioCtx[] = BANCO.contextos.trappvel.viajes.map(v => ({ alias: v.id, id: v.id, codigo: v.codigo, cliente: v.cliente, destino: v.destino }));
const NEGOCIOS: NegocioCtx[] = BANCO.contextos.termotech.negocios.map(n => ({ alias: n.id, id: n.id, codigo: n.codigo, nombre: n.nombre, cliente: null, destino: null }));

function pendiente(t: Turno): PreguntaUnificada | null {
  if (t.pendiente_previo === 'pide_nombre') return preguntaPendienteUnificada({ tanda: { tipo: 'nombre' } });
  if (t.pendiente_previo === 'gasto_monto') return preguntaPendienteUnificada({ sesion: { state: 'collecting', pending_action: 'W01' } });
  const p = t.pendiente as Pend;
  if (!p) return null;
  if (p.capa === 'entrega') {
    const opciones = (p.opciones ?? []).filter(o => VIAJES.some(v => v.id === o)).map(o => VIAJES.find(v => v.id === o)!);
    return preguntaPendienteUnificada({ bandeja: { espera: 'viaje', nombre: 'Tanda de las 09:28', corta: p.texto, opciones } });
  }
  if (p.capa === 'resumen') return preguntaPendienteUnificada({ bandeja: { espera: 'resumen', nombre: 'Carolina Ruiz', corta: p.texto } });
  if (p.capa === 'gasto_confirmar') return preguntaPendienteUnificada({ sesion: { state: 'confirming', pending_action: 'W01' } });
  if (p.capa === 'soporte') return preguntaPendienteUnificada({ sesion: { state: 'awaiting_image', pending_action: 'W01' } });
  throw new Error(`capa sin armar en el banco: ${p.capa}`);
}

/** La decisión en la forma del `esperado` de la simulación (la del prototipo). */
function resumir(d: Decision): Record<string, unknown> {
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
function cumple(r: Record<string, unknown>, e: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(e)) {
    if (k === 'gastos') {
      const gs = r.gastos as Array<Record<string, unknown>> | undefined;
      const es = v as Array<Record<string, unknown>>;
      if (!gs || gs.length !== es.length) return false;
      if (!es.every((g, i) => Object.entries(g).every(([kk, vv]) => (kk === 'desc' ? String(gs[i].desc ?? '').includes(String(vv)) : gs[i][kk] === vv)))) return false;
      continue;
    }
    if (k === 'nuevo') { if (norm(r.nuevo) !== norm(v)) return false; continue; }
    if (k === 'valor' && typeof v === 'string') { if (norm(r.valor) !== norm(v)) return false; continue; }
    if (JSON.stringify(r[k]) !== JSON.stringify(v)) return false;
  }
  return true;
}

describe('banco de la simulación con un modelo falso: el validador', () => {
  const resultados: Array<{ id: string; ok: boolean }> = [];
  for (const t of BANCO.turnos as Turno[]) {
    it(`${t.id}.${t.turno}${t.control ? ' (control)' : ''} · «${t.texto.slice(0, 50)}»`, () => {
      // Un reenvío no pasa por el modelo: sigue como hoy, a la bandeja como contenido.
      if (t.reenviado) {
        expect(esEscrito({ type: 'text', text: t.texto, reenviado: true })).toBe(false);
        resultados.push({ id: t.id, ok: true });
        return;
      }
      const trappvel = t.cliente === 'trappvel';
      const d = validar(t.modelo, {
        texto: t.texto, bandeja: trappvel, rol: 'owner', pendiente: pendiente(t), negocios: trappvel ? VIAJES : NEGOCIOS,
        tanda: t.tanda ? { abierta: true, nombre: 'la tanda abierta', cajaId: null } : null,
      });
      const r = resumir(d);
      const ok = cumple(r, t.esperado as Record<string, unknown>);
      resultados.push({ id: t.id, ok });
      // La descripción de un gasto se compara por contenido («peaje» dentro de «peaje yendo a la obra…»).
      expect({ turno: `${t.id}.${t.turno}`, ok, obtenido: r, esperado: t.esperado }).toMatchObject({ ok: true });
    });
  }

  it('los 45 turnos están en el banco y todos salen como se esperaba', () => {
    expect(BANCO.turnos).toHaveLength(45);
    expect(resultados.filter(r => !r.ok)).toEqual([]);
  });
});
