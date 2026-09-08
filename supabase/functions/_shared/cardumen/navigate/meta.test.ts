// El clasificador de meta-respuestas es estrecho a proposito: lo que importa aqui es
// tanto lo que atrapa como lo que DEJA PASAR. Cada falso positivo se comeria una
// respuesta real de la persona.
import { describe, expect, it } from 'vitest';
import { leerMeta, sinPalabras } from './meta';

describe('sinPalabras', () => {
  it('vacio, espacios, emojis y signos no traen palabras', () => {
    for (const t of ['', '   ', '\n\t', '👍👍👍', '🙃', '...', '???', '¿?', '—']) expect(sinPalabras(t)).toBe(true);
  });
  it('una letra o un digito ya cuentan', () => {
    for (const t of ['a', '1', 'ñ', 'asdkjh', '👍 ok', 'x'.repeat(3000)]) expect(sinPalabras(t)).toBe(false);
  });
});

describe('leerMeta: pregunta de vuelta', () => {
  it.each([
    '¿Quién eres?', 'quien es usted', '¿Y usted quién es?', '¿con quién hablo?', '¿esto es una encuesta?',
    '¿Es una entrevista?', '¿para qué sirve esto?', '¿Para qué me preguntan eso?', '¿qué es Navigate?',
    '¿qué es esto?', 'eres un bot?', '¿es usted una persona?', '¿qué van a hacer con mis respuestas?',
    '¿quién está detrás de esto?', '¿de dónde sacaron mi número?', '¿esto es seguro?', 'esto es una broma?',
    '¿Qué quieren de mí?',
  ])('atrapa: %s', (t) => {
    expect(leerMeta(t)).toBe('pregunta');
  });

  it.each([
    'hola?', 'primero el poder, ¿no?', 'quién es el que manda: los de arriba', 'la gente que es la que sufre',
    'no sé quién es el responsable, pero es nuevo', 'es una prueba de que ya venía pasando',
    // Mas de 14 palabras: una historia que menciona la frase no es una pregunta de vuelta.
    'quien es usted para decirme eso, yo llevo años en esto y la gente de a pie es la que paga, siempre ha sido así y no es nuevo',
  ])('deja pasar: %s', (t) => {
    expect(leerMeta(t)).not.toBe('pregunta');
  });
});

describe('leerMeta: negativa', () => {
  it.each([
    'no quiero responder', 'No quiero responder eso.', 'no quiero responder esa pregunta, gracias', 'paso',
    'Paso.', 'paso de esto', 'prefiero no decir', 'prefiero no responder esta', 'mejor no', 'no voy a contestar',
    'no me interesa', 'no gracias', 'sin comentarios', 'siguiente', 'siguiente pregunta', 'sáltela',
    'saltemos esa pregunta', 'no, paso', 'no pienso responder eso', 'no quiero',
  ])('atrapa: %s', (t) => {
    expect(leerMeta(t)).toBe('negativa');
  });

  it.each([
    'no', 'nop', 'no, corrijo', 'no así no', 'no, primero la gente', 'al revés', 'no del todo nuevo, pero se aceleró',
    'no es nuevo', 'no sé', 'no sabría decir', 'no quiero que se acabe el barrio', 'no me interesa la política, me interesa la gente',
    'ninguna de las dos', 'no aplica', 'ninguno',
  ])('deja pasar: %s', (t) => {
    expect(leerMeta(t)).not.toBe('negativa');
  });
});

describe('leerMeta: lo demas es null', () => {
  it.each(['', '   ', '👍', 'asdkjh', 'x', 'salud', '1', 'Sobre todo el poder, y algo las fuerzas'])('%s', (t) => {
    expect(leerMeta(t)).toBeNull();
  });
});
