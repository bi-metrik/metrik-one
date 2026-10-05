import { describe, expect, it } from 'vitest';
import {
  leerConsultaBandeja, relataAlCliente, textoConsultaAmbigua, textoEstadoViaje, textoTanda, textoViajesDelCliente,
} from './wa-consulta-bandeja.ts';
import { atajoExacto, validar, type Decision, type EntradaValidador, type NegocioCtx } from './wa-interprete-reglas.ts';
import { CONFIG_BANDEJA_POR_DEFECTO } from './wa-bandeja-reglas.ts';

/**
 * Las preguntas escritas al bot dentro de la bandeja, sin prefijo (prueba de Mauricio del 2026-10-05, 09:26: «Que
 * viajes tiene abiertos?» contestaba «¿Qué hago con esto?»). Textos y nombres inventados (Martín Robledo, Gerardo
 * Quintero, Rosaura Pinzón). La frontera entre lo que el comercial le pregunta al bot y lo que pregunta el cliente:
 *   1. un reenvío nunca es una consulta; 2. lo escrito lo es solo con forma de pregunta o pedido y un vocabulario
 *   cerrado; 3. lo que relata lo que preguntó el cliente («me pregunta…») es contenido.
 */

const ESCRITO = { reenviado: false };

describe('lo que es una pregunta al bot', () => {
  it.each([
    ['Que viajes tiene abiertos?', { tipo: 'viajes', cliente: null }],
    ['y ese cliente qué viajes tiene?', { tipo: 'viajes', cliente: null }],
    ['cuántos viajes tiene abiertos?', { tipo: 'viajes', cliente: null }],
    ['¿tiene algo abierto?', { tipo: 'viajes', cliente: null }],
    ['¿qué viajes tiene abiertos Martín Robledo?', { tipo: 'viajes', cliente: 'Martín Robledo' }],
    ['dime los viajes de Gerardo Quintero', { tipo: 'viajes', cliente: 'Gerardo Quintero' }],
    ['muéstrame los viajes de ese cliente', { tipo: 'viajes', cliente: null }],
    ['qué le falta?', { tipo: 'viaje', ref: null }],
    ['¿qué le falta al de Cartagena?', { tipo: 'viaje', ref: 'Cartagena' }],
    ['cómo va el viaje de Rosaura?', { tipo: 'viaje', ref: 'Rosaura' }],
    ['¿cómo va T1 26 14?', { tipo: 'viaje', ref: 'T1 26 14' }],
    ['qué llevo?', { tipo: 'tanda' }],
    ['¿qué te he mandado?', { tipo: 'tanda' }],
    ['cuántos mensajes llevo?', { tipo: 'tanda' }],
  ])('«%s» → %j', (texto, esperado) => {
    expect(leerConsultaBandeja(texto, ESCRITO)).toEqual(esperado);
  });

  it.each([
    // 1. El reenvío: lo que preguntó el cliente es contenido, aunque tenga la misma forma.
    ['Que viajes tiene abiertos?', true],
    ['¿qué le falta?', true],
    // 2. Escrito, pero no es una pregunta sobre la bandeja: sigue como hoy.
    ['¿cuánto cuesta?', false],
    ['¿tienen paquetes a San Andrés?', false],
    ['¿el hotel tiene piscina?', false],
    ['qué hoteles hay en Cartagena?', false],
    ['Vamos a hacer una nueva cotización para Martín Robledo', false],
    ['cómo vamos?', false],
    // 3. El relato de lo que preguntó el cliente.
    ['me pregunta qué viajes hay a Cancún', false],
    ['dice que si tiene algo abierto para diciembre', false],
    ['quiere saber cuánto cuesta el hotel', false],
    ['el cliente pregunta qué le falta', false],
  ])('«%s» (reenviado: %s) no es una pregunta al bot', (texto, reenviado) => {
    expect(leerConsultaBandeja(texto, { reenviado })).toBeNull();
  });

  it('el relato se reconoce aparte (para el validador)', () => {
    expect(relataAlCliente('me pregunta qué viajes tiene abiertos')).toBe(true);
    expect(relataAlCliente('La clienta dice que si hay algo para diciembre')).toBe(true);
    expect(relataAlCliente('qué viajes tiene abiertos?')).toBe(false);
  });
});

describe('lo que contesta', () => {
  it('los viajes de un cliente: uno, varios, ninguno, o que no está', () => {
    expect(textoViajesDelCliente({ cliente: 'Martín Robledo', viajes: [{ linea: 'MIAMI 7N (M1 26 1)' }] })).toBe('Martín Robledo tiene un viaje abierto: MIAMI 7N (M1 26 1).');
    expect(textoViajesDelCliente({ cliente: 'Martín Robledo', viajes: [{ linea: 'MIAMI 7N (M1 26 1)' }, { linea: 'ARMENIA 2N (M1 26 2)' }] }))
      .toBe('Martín Robledo tiene 2 viajes abiertos:\n- MIAMI 7N (M1 26 1)\n- ARMENIA 2N (M1 26 2)');
    expect(textoViajesDelCliente({ cliente: 'Rosaura Pinzón', viajes: [], cerrado: 'SANTA MARTA ENE (R 26 1)' })).toBe('Rosaura Pinzón no tiene viajes abiertos (el último fue SANTA MARTA ENE (R 26 1)).');
    expect(textoViajesDelCliente({ cliente: 'Gerardo Quintero', viajes: [], noExiste: true })).toBe('No tengo a Gerardo Quintero en el directorio, así que no tiene viajes.');
  });

  it('la tanda, el estado de un viaje y la duda: cortos y sin pedir números', () => {
    expect(textoTanda({ nombre: 'Martín Robledo (viaje nuevo)', n: 2, cierre: 'listo' })).toBe('Llevas 2 mensajes de Martín Robledo (viaje nuevo). Cuando termines, escribe «listo».');
    expect(textoEstadoViaje({ avance: 'MIAMI 7N · Martín Robledo (M1 26 1) — mínimo 5/7', faltan: ['fecha de salida', 'adultos'] })).toBe('MIAMI 7N · Martín Robledo (M1 26 1) — mínimo 5/7\nLe falta para cotizar: fecha de salida, adultos.');
    expect(textoEstadoViaje({ avance: 'X', faltan: [] })).toBe('X\nYa tiene todo lo mínimo para cotizar.');
    const duda = textoConsultaAmbigua('Rosaura', [
      { linea: 'SANTA MARTA ENE · Rosaura Pinzón (R 26 1)', cliente: 'ROSAURA PINZÓN', destino: 'SANTA MARTA' },
      { linea: 'LETICIA · Rosaura Díaz (R 26 4)', cliente: 'ROSAURA DÍAZ', destino: 'LETICIA' },
    ]);
    expect(duda).toBe('«Rosaura» puede ser SANTA MARTA ENE · Rosaura Pinzón (R 26 1) o LETICIA · Rosaura Díaz (R 26 4). Pregúntame por uno, por ejemplo «¿cómo va el de Santa Marta?».');
    expect(duda).not.toMatch(/\n\d\./);
  });
});

// ── El intérprete: el atajo y el validador ──────────────────────────────────

const MR: NegocioCtx = { alias: 'n1', id: 'v-mr1', codigo: 'M1 26 1', cliente: 'MARTÍN ROBLEDO', destino: 'MIAMI' };
const RP: NegocioCtx = { alias: 'n2', id: 'v-rp', codigo: 'R 26 1', cliente: 'ROSAURA PINZÓN', destino: 'SANTA MARTA' };
const entrada = (texto: string, o: Partial<EntradaValidador> = {}): EntradaValidador => ({
  texto, bandeja: true, rol: 'operator', pendiente: null, negocios: [MR, RP], tanda: { abierta: true, nombre: 'Martín Robledo', cajaId: null, cliente: 'Martín Robledo' }, ...o,
});
const ejec = (d: Decision) => {
  if (d.tipo !== 'ejecutar') throw new Error(JSON.stringify(d));
  return d;
};

describe('con el intérprete prendido', () => {
  it('lo que el código lee exacto no llega al modelo (el atajo), con o sin pregunta pendiente', () => {
    expect(atajoExacto('Que viajes tiene abiertos?', { bandeja: CONFIG_BANDEJA_POR_DEFECTO, pendiente: null, encabezado: null })).toBe('consulta_bandeja');
    expect(atajoExacto('¿qué te he mandado?', { bandeja: CONFIG_BANDEJA_POR_DEFECTO, pendiente: null, encabezado: null })).toBe('consulta_bandeja');
    expect(atajoExacto('¿cuánto cuesta?', { bandeja: CONFIG_BANDEJA_POR_DEFECTO, pendiente: null, encabezado: null })).not.toBe('consulta_bandeja');
    // Sin la bandeja (otra empresa), no.
    expect(atajoExacto('Que viajes tiene abiertos?', { bandeja: null, pendiente: null, encabezado: null })).not.toBe('consulta_bandeja');
  });

  it.each([
    ['oye, y de los viajes que tiene abiertos, me haces la lista?', { tema: 'viajes' }, { tipo: 'viajes', cliente: null }],
    ['me recuerdas lo que tiene abierto Rosaura Pinzón', { tema: 'viajes', ref_cliente: 'Rosaura Pinzón' }, { tipo: 'viajes', cliente: 'Rosaura Pinzón' }],
    ['y lo de Santa Marta en qué quedó', { tema: 'viaje', ref_destino: 'Santa Marta' }, { tipo: 'viaje', ref: 'Santa Marta' }],
    ['a ver, recuérdame lo que te he pasado', { tema: 'tanda' }, { tipo: 'tanda' }],
  ])('el modelo lee una paráfrasis («%s») como consulta: va a la consulta de la bandeja, en solo lectura', (texto, campos, consulta) => {
    const d = ejec(validar({ acciones: [{ accion: 'consulta', evidencia: texto, ...campos }] }, entrada(texto)));
    expect(d.paso).toEqual({ p: 'bandeja_consulta', consulta });
    expect(d.accion).toBe('bandeja.consulta');
  });

  it('el cliente que el modelo copió del contexto y no está escrito no cuenta: es el de la tanda', () => {
    const d = ejec(validar({ acciones: [{ accion: 'consulta', evidencia: 'y de viajes qué tiene abierto', tema: 'viajes', ref_cliente: 'Martín Robledo' }] }, entrada('y de viajes qué tiene abierto')));
    expect(d.paso).toEqual({ p: 'bandeja_consulta', consulta: { tipo: 'viajes', cliente: null } });
  });

  it('regla 3: lo que relata la pregunta del cliente es contenido de la tanda, aunque el modelo diga consulta', () => {
    const texto = 'me pregunta qué viajes tienen abiertos para Cancún';
    const d = ejec(validar({ acciones: [{ accion: 'consulta', evidencia: texto, tema: 'viajes' }] }, entrada(texto)));
    expect(d.paso).toMatchObject({ p: 'registrar', interpretacion: { accion: 'contenido' } });
  });

  it('un rol de solo lectura también pregunta por la bandeja (es de solo lectura)', () => {
    const d = ejec(validar({ acciones: [{ accion: 'consulta', evidencia: 'qué lleva mi tanda', tema: 'tanda' }] }, entrada('qué lleva mi tanda', { rol: 'read_only' })));
    expect(d.paso).toEqual({ p: 'bandeja_consulta', consulta: { tipo: 'tanda' } });
  });
});
