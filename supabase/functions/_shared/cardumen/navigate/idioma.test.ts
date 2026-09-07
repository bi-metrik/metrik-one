// El detector decide UNA cosa: si se confirma "seguimos en espanol" o se manda el aviso
// trilingue. Por eso las pruebas son de frases de verdad, no de palabras sueltas, y el caso
// que mas importa es que la duda caiga en "desconocido" (= espanol + confirmacion).
import { describe, expect, it } from 'vitest';
import { detectarIdioma } from './idioma';

describe('detectarIdioma', () => {
  it('espanol: una historia tipica del panel', () => {
    expect(detectarIdioma('La carretera al puerto lleva meses con un carril cerrado. Los camiones se meten por el pueblo y ya se hundió una calle.')).toBe('es');
    expect(detectarIdioma('Los jóvenes que estudiaron ya no quieren quedarse acá, pero tampoco se van tan lejos como antes.')).toBe('es');
  });

  it('ingles: la misma clase de historia', () => {
    expect(detectarIdioma('The road to the port has had one lane closed for months. Trucks are cutting through the town and a street already collapsed.')).toBe('en');
    expect(detectarIdioma('People who studied do not want to stay here anymore, but they are not going as far as before.')).toBe('en');
  });

  it('portugues: la misma clase de historia', () => {
    expect(detectarIdioma('A estrada para o porto está há meses com uma faixa fechada. Os caminhões passam pela cidade e uma rua já afundou.')).toBe('pt');
    expect(detectarIdioma('Os jovens que estudaram não querem mais ficar aqui, mas também não vão tão longe como antes.')).toBe('pt');
  });

  it('un mensaje corto o ambiguo no decide: cae a desconocido', () => {
    expect(detectarIdioma('ok')).toBe('desconocido');
    expect(detectarIdioma('')).toBe('desconocido');
    expect(detectarIdioma('hola')).toBe('desconocido');
  });

  it('la eñe decide por espanol aunque haya pocas palabras', () => {
    expect(detectarIdioma('El año pasado fue peor.')).toBe('es');
  });
});
