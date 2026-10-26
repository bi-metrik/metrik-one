import { describe, expect, it } from 'vitest';
import { agregarFoco, consultaVigente, focosVigentes, viajeEnFoco, type FocoViaje } from './wa-foco.ts';
import { leerConsultaBandeja, textoEstadoViaje } from './wa-consulta-bandeja.ts';
import { validar, type EntradaValidador } from './wa-interprete-reglas.ts';
import { leerConfigBandeja } from './wa-bandeja-reglas.ts';

/**
 * Conversación con memoria (2026-10-05, prueba de Mauricio de las 12:15–12:21): el viaje en foco, lo que se pregunta
 * (completo, mínimo o los dos), la afirmación que corrige al bot y la consulta de la bandeja que no frena el rol.
 * Textos inventados.
 */

const T = Date.parse('2026-10-05T17:00:00Z');
const hace = (min: number) => new Date(T - min * 60_000).toISOString();
const foco = (id: string, min: number, o: Partial<FocoViaje> = {}): FocoViaje => ({ negocio_id: id, at: hace(min), por: 'carga', ...o });

describe('el viaje en foco', () => {
  it('el último primero, sin repetir el viaje, y lo que faltaba se conserva cuando vuelve por una consulta', () => {
    let fs: FocoViaje[] = [];
    fs = agregarFoco(fs, foco('a', 10, { faltan: 3 }));
    fs = agregarFoco(fs, foco('b', 5));
    fs = agregarFoco(fs, { negocio_id: 'a', at: hace(1), por: 'consulta' });
    expect(fs.map(f => [f.negocio_id, f.por, f.faltan])).toEqual([['a', 'consulta', 3], ['b', 'carga', undefined]]);
  });

  it('uno solo en la ventana es el foco; dos, se pregunta; fuera de la ventana, ninguno', () => {
    expect(viajeEnFoco([foco('a', 5)], T, 60)).toMatchObject({ tipo: 'uno', foco: { negocio_id: 'a' } });
    expect(viajeEnFoco([foco('a', 5), foco('b', 20)], T, 60)).toMatchObject({ tipo: 'dos' });
    expect(viajeEnFoco([foco('a', 5), foco('b', 90)], T, 60)).toMatchObject({ tipo: 'uno', foco: { negocio_id: 'a' } });
    expect(viajeEnFoco([foco('a', 120)], T, 60)).toEqual({ tipo: 'ninguno' });
    expect(focosVigentes([foco('b', 20), foco('a', 5)], T, 60).map(f => f.negocio_id)).toEqual(['a', 'b']);
  });

  it('la consulta que espera su viaje vence a los 10 minutos', () => {
    expect(consultaVigente({ tipo: 'viaje', at: hace(9) }, T)).not.toBeNull();
    expect(consultaVigente({ tipo: 'viaje', at: hace(11) }, T)).toBeNull();
  });

  it('la ventana se configura por workspace (`minutos_foco`), 60 por defecto', () => {
    expect(leerConfigBandeja({ bandeja_solicitudes: {} }).minutosFoco).toBe(60);
    expect(leerConfigBandeja({ bandeja_solicitudes: { minutos_foco: 30 } }).minutosFoco).toBe(30);
    expect(leerConfigBandeja({ bandeja_solicitudes: { minutos_foco: 2 } }).minutosFoco).toBe(60);
  });
});

describe('contestar lo que se pregunta', () => {
  it.each([
    ['que queda pendiente para completar la solicitud del viaje de Rodrigo Vélez', { tipo: 'viaje', ref: 'Rodrigo Vélez', alcance: 'completo' }],
    ['que faltaría para entregarlo completo?', { tipo: 'viaje', ref: null, alcance: 'completo' }],
    ['qué le falta para cotizar?', { tipo: 'viaje', ref: null, alcance: 'minimo' }],
    ['¿cómo va?', { tipo: 'viaje', ref: null }],
    ['Pero faltan 4 puntos para que quede completo', { tipo: 'viaje', ref: null, alcance: 'completo' }],
    ['todavía le faltan datos para cotizar', { tipo: 'viaje', ref: null, alcance: 'minimo' }],
  ])('«%s» → %j', (texto, esperado) => {
    expect(leerConsultaBandeja(texto, { reenviado: false })).toEqual(esperado);
  });

  it('una afirmación sobre lo que falta del CLIENTE (contenido) no es la corrección al bot', () => {
    expect(leerConsultaBandeja('falta que me mande el pasaporte', { reenviado: false })).toBeNull();
    expect(leerConsultaBandeja('le faltan los tiquetes de vuelta', { reenviado: false })).toBeNull();
  });

  it('completo, mínimo o los dos', () => {
    const p = { avance: 'X — Mínimo 8/9 (89 %) · Completo 8/10 (80 %)', faltan: ['categoría de hotel'], faltanCompleto: ['categoría de hotel', 'presupuesto'] };
    expect(textoEstadoViaje({ ...p, alcance: 'completo' })).toBe(`${p.avance}\nLe faltan 2 datos para completo: categoría de hotel, presupuesto.`);
    expect(textoEstadoViaje({ ...p, alcance: 'minimo' })).toBe(`${p.avance}\nLe falta para cotizar: categoría de hotel.`);
    expect(textoEstadoViaje(p)).toBe(`${p.avance}\nLe falta para cotizar: categoría de hotel.\nLe faltan 2 datos para completo: categoría de hotel, presupuesto.`);
    expect(textoEstadoViaje({ ...p, faltan: [], faltanCompleto: [], alcance: 'completo' })).toBe(`${p.avance}\nYa está completo.`);
  });
});

describe('el rol no frena la consulta de la bandeja (colaborador: operator)', () => {
  const entrada = (texto: string): EntradaValidador => ({ texto, bandeja: true, rol: 'operator', pendiente: null, negocios: [], tanda: null });
  it.each(['que viajes están abiertos?', '¿qué viajes hay abiertos?'])('«%s» la lee el código como la consulta de la bandeja', texto => {
    expect(leerConsultaBandeja(texto, { reenviado: false })).toEqual({ tipo: 'viajes', cliente: null });
  });
  it('la paráfrasis larga que el modelo lee como «negocios» va a la consulta de la bandeja, no al texto del rol', () => {
    const texto = 'oye me podrías decir cuáles son los viajes que siguen abiertos con nosotros';
    const d = validar({ acciones: [{ accion: 'consulta', tema: 'negocios', evidencia: texto }] }, entrada(texto));
    expect(d).toMatchObject({ tipo: 'ejecutar', paso: { p: 'bandeja_consulta', consulta: { tipo: 'viajes' } } });
  });
  it('una pregunta de plata del mismo colaborador sigue con el texto de su rol', () => {
    const texto = 'cuánto hemos vendido este mes';
    const d = validar({ acciones: [{ accion: 'consulta', tema: 'numeros', evidencia: texto }] }, entrada(texto));
    expect(d).toMatchObject({ tipo: 'ejecutar', accion: 'rol.consulta' });
  });
});
