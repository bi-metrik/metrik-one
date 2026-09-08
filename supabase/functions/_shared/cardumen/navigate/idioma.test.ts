// Dos lectores. `detectarIdioma` sobre la historia solo deja `idioma_detectado` como dato,
// asi que sus pruebas son de frases de verdad, no de palabras sueltas, y la duda cae en
// "desconocido". `leerIdiomaElegido` lee la respuesta ESCRITA al primer mensaje ("¿en que
// idioma prefiere continuar?"): una palabra clara manda y, si no la hay, decide la deteccion;
// null es "no se pudo leer", que el motor repregunta una vez y despues resuelve en espanol.
import { describe, expect, it } from 'vitest';
import { detectarIdioma, leerIdiomaElegido } from './idioma';

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

describe('leerIdiomaElegido (respuesta escrita al primer mensaje)', () => {
  it('una palabra clara manda, con o sin tildes, en cualquiera de los tres idiomas', () => {
    expect(leerIdiomaElegido('Español')).toBe('es');
    expect(leerIdiomaElegido('español por favor')).toBe('es');
    expect(leerIdiomaElegido('castellano')).toBe('es');
    expect(leerIdiomaElegido('spanish is fine')).toBe('es');
    expect(leerIdiomaElegido('english please')).toBe('en');
    expect(leerIdiomaElegido('Inglés')).toBe('en');
    expect(leerIdiomaElegido('Português')).toBe('pt');
    expect(leerIdiomaElegido('portugues')).toBe('pt');
  });

  it('sin palabra clara decide la deteccion por palabras funcionales', () => {
    expect(leerIdiomaElegido('I would like to continue in my language')).toBe('en');
    expect(leerIdiomaElegido('Os jovens que estudaram não querem mais ficar aqui')).toBe('pt');
    expect(leerIdiomaElegido('quiero seguir con la conversación en el idioma que ya está')).toBe('es');
  });

  it('ilegible, un saludo corto o dos idiomas nombrados: null (el motor repregunta, no adivina)', () => {
    expect(leerIdiomaElegido('asdkjh')).toBeNull();
    expect(leerIdiomaElegido('OK')).toBeNull();
    expect(leerIdiomaElegido('hola')).toBeNull();
    expect(leerIdiomaElegido('')).toBeNull();
    expect(leerIdiomaElegido('español o inglés, da igual')).toBeNull();
  });
});
