// Que se le contesta a un numero que no esta registrado en ONE, y cuando.
import { describe, expect, it } from 'vitest';
import { INTENT_DESCONOCIDO, MENSAJE_DESCONOCIDO, responderDesconocido, telefonoLegible } from './wa-desconocido';
import { aEspanolNeutro } from './es-neutro';

describe('responderDesconocido', () => {
  it('contesta el primer mensaje del dia', () => {
    expect(responderDesconocido(0)).toBe(true);
  });

  it('calla los siguientes dentro de las 24 h', () => {
    expect(responderDesconocido(1)).toBe(false);
    expect(responderDesconocido(20)).toBe(false);
  });

  it('contesta si no se pudo leer la bitacora', () => {
    expect(responderDesconocido(null)).toBe(true);
  });
});

describe('MENSAJE_DESCONOCIDO', () => {
  it('manda al administrador y al WhatsApp de MeTRIK', () => {
    expect(MENSAJE_DESCONOCIDO).toContain('administrador');
    expect(MENSAJE_DESCONOCIDO).toContain('+57 315 950 9103');
  });

  it('no ofrece crear cuenta ni nombra flujos que ya no existen', () => {
    expect(MENSAJE_DESCONOCIDO).not.toMatch(/metrikone\.co|cardumen|venezuela/i);
  });

  it('va en español neutro', () => {
    expect(aEspanolNeutro(MENSAJE_DESCONOCIDO).correcciones).toEqual([]);
  });

  it('cabe en un mensaje de WhatsApp', () => {
    expect(MENSAJE_DESCONOCIDO.length).toBeLessThan(4096);
  });
});

describe('telefonoLegible', () => {
  it('agrupa un celular colombiano', () => {
    expect(telefonoLegible('573159509103')).toBe('+57 315 950 9103');
  });

  it('deja tal cual lo que no reconoce', () => {
    expect(telefonoLegible('14155550100')).toBe('+14155550100');
  });
});

it('la marca de la bitacora no cambia (los registros viejos siguen siendo buscables)', () => {
  expect(INTENT_DESCONOCIDO).toBe('numero_desconocido');
});
