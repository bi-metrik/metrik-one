import { describe, expect, it } from 'vitest';
import BANCO from './__fixtures__/interprete-banco.json';
import { esEscrito, leerConfirmacion, preguntaPendienteUnificada, respuestaExacta, validar, type NegocioCtx, type PreguntaUnificada } from './wa-interprete-reglas.ts';
import { cumple, resumir, resumirConfirmacionDeHoy } from './__fixtures__/interprete-banco-resumen.ts';

/**
 * El banco de la simulación (escenarios.json, 45 turnos: 37 + los 8 de control H1–H8; más los 11 NC de la
 * confirmación de cliente nuevo del sexto control de Vera) como prueba de
 * integración del VALIDADOR con un modelo falso que devuelve las acciones esperadas (la primera corrida
 * de gemini-2.5-flash que acertó, convertida al esquema nuevo; a mano donde ninguna acertó). Valida el
 * validador, no el modelo: la corrida con Gemini real la hace la QA (§9 del diseño), no el CI.
 *
 * Cada turno arranca del estado esperado, como en la simulación. El despacho de cada acción a la
 * función que ya existe se prueba aparte, con mocks (`wa-interprete.test.ts`).
 */

type Turno = (typeof BANCO.turnos)[number];
type Pend = { capa: string; texto: string; opciones?: string[]; nuevo?: string } | null;

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
  if (p.capa === 'nuevo_confirmar') {
    // «¿Creo el cliente nuevo «X»?» (sexto control de Vera): la lista de «¿A qué viaje van?», X y los viajes abiertos.
    const opciones = (p.opciones ?? []).map(o => VIAJES.find(v => v.id === o)!);
    return preguntaPendienteUnificada({ bandeja: { espera: 'viaje', nombre: 'Tanda de las 16:20', corta: p.texto, opciones, nuevoPorConfirmar: p.nuevo, viajesAbiertos: VIAJES } });
  }
  if (p.capa === 'gasto_confirmar') return preguntaPendienteUnificada({ sesion: { state: 'confirming', pending_action: 'W01' } });
  if (p.capa === 'soporte') return preguntaPendienteUnificada({ sesion: { state: 'awaiting_image', pending_action: 'W01' } });
  throw new Error(`capa sin armar en el banco: ${p.capa}`);
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
      const pend = pendiente(t);
      // En la confirmación de cliente nuevo, lo que el atajo lee exacto no llega al modelo: lo hace el código de hoy.
      const r = pend?.capa === 'nuevo_confirmar' && respuestaExacta(t.texto, pend)
        ? resumirConfirmacionDeHoy(leerConfirmacion(t.texto, pend))
        : resumir(validar(t.modelo, {
          texto: t.texto, bandeja: trappvel, rol: 'owner', pendiente: pend, negocios: trappvel ? VIAJES : NEGOCIOS,
          tanda: t.tanda ? { abierta: true, nombre: 'la tanda abierta', cajaId: null } : null,
        }));
      const ok = cumple(r, t.esperado as Record<string, unknown>);
      resultados.push({ id: t.id, ok });
      // La descripción de un gasto se compara por contenido («peaje» dentro de «peaje yendo a la obra…»).
      expect({ turno: `${t.id}.${t.turno}`, ok, obtenido: r, esperado: t.esperado }).toMatchObject({ ok: true });
    });
  }

  it('los 56 turnos están en el banco (45 + 11 de la confirmación de cliente nuevo) y todos salen como se esperaba', () => {
    expect(BANCO.turnos).toHaveLength(56);
    expect(resultados.filter(r => !r.ok)).toEqual([]);
  });
});
