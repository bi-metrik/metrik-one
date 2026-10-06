import { describe, expect, it } from 'vitest';
import BANCO from './__fixtures__/interprete-banco.json';
import { esEscrito, preguntaPendienteUnificada, validar, type NegocioCtx, type PreguntaUnificada } from './wa-interprete-reglas.ts';
import { cumple, deHoy, resumir } from './__fixtures__/interprete-banco-resumen.ts';

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

export const PIDE_LLAVE = 'No tengo a Simón Arango en el directorio. ¿Me pasas su celular o su correo? Así reviso que no lo tengamos con otro nombre, y sin uno de los dos no lo creo.';
export const CONFIRMA_LLAVE = 'Ese celular ya lo tenemos a nombre de Paola Andrea Rincón Díaz (último viaje: CARTAGENA MAR). ¿Es la misma persona?';

const VIAJES: NegocioCtx[] = BANCO.contextos.trappvel.viajes.map(v => ({ alias: v.id, id: v.id, codigo: v.codigo, cliente: v.cliente, destino: v.destino }));
const NEGOCIOS: NegocioCtx[] = BANCO.contextos.termotech.negocios.map(n => ({ alias: n.id, id: n.id, codigo: n.codigo, nombre: n.nombre, cliente: null, destino: null }));

function pendiente(t: Turno): PreguntaUnificada | null {
  if (t.pendiente_previo === 'pide_nombre') return preguntaPendienteUnificada({ tanda: { tipo: 'nombre' } });
  // 2026-10-05: la caja de un viaje nuevo espera la llave, o si el dueño de la llave es la misma persona.
  if (t.pendiente_previo === 'pide_llave') return preguntaPendienteUnificada({ tanda: { tipo: 'cliente', texto: PIDE_LLAVE } });
  if (t.pendiente_previo === 'confirma_llave') return preguntaPendienteUnificada({ tanda: { tipo: 'cliente', texto: CONFIRMA_LLAVE } });
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
      const cliente = (t as { tanda_cliente?: string }).tanda_cliente ?? null;
      // En la bandeja, lo que el código de hoy lee exacto no llega al modelo (la confirmación de cliente nuevo, el
      // encabezado, lo que espera la caja): se resume lo que hace el código.
      const espera = t.pendiente_previo === 'pide_llave' ? 'llave' : t.pendiente_previo === 'confirma_llave' ? 'misma' : null;
      // Décimo control: con un viaje en foco, la carga directa (la memoria) va antes del modelo.
      const foco = (t as { foco?: string }).foco ? { viaje: (t as { foco: string }).foco, otrosClientes: (t as { directorio_otros?: string[] }).directorio_otros ?? [] } : null;
      const hoy = trappvel ? deHoy(t.texto, pend, BANCO.contextos.trappvel.viajes, cliente, espera, foco) : null;
      const r = hoy ?? resumir(validar(t.modelo, {
        texto: t.texto, bandeja: trappvel, rol: 'owner', pendiente: pend, negocios: trappvel ? VIAJES : NEGOCIOS,
        tanda: t.tanda ? { abierta: true, nombre: 'la tanda abierta', cajaId: null, cliente } : null,
      }));
      const ok = cumple(r, t.esperado as Record<string, unknown>);
      resultados.push({ id: t.id, ok });
      // La descripción de un gasto se compara por contenido («peaje» dentro de «peaje yendo a la obra…»).
      expect({ turno: `${t.id}.${t.turno}`, ok, obtenido: r, esperado: t.esperado }).toMatchObject({ ok: true });
    });
  }

  it('los 137 turnos están en el banco (45 + 11 de la confirmación de cliente nuevo + 32 de identidad + 12 del octavo control + 13 de preguntas sin prefijo + 8 del noveno control + 4 de la conversación con memoria + 12 de la carga directa del décimo control) y todos salen como se esperaba', () => {
    expect(BANCO.turnos).toHaveLength(137);
    expect(resultados.filter(r => !r.ok)).toEqual([]);
  });
});
