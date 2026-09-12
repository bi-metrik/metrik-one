// El clasificador es lo unico que separa "el usuario dijo que si" de "el usuario dijo algo
// que no reconozco". Antes de este modulo esa distincion no existia: todo lo que no fuera
// imagen, audio o "después" caia por el mismo hueco.
import { describe, expect, it } from 'vitest';
import { clasificarRespuesta, normalizarRespuesta } from './wa-intencion';

describe('normalizarRespuesta', () => {
  it('baja a minusculas, quita tildes y colapsa espacios', () => {
    expect(normalizarRespuesta('  Sí,   Señor  ')).toBe('si senor');
  });

  it('reemplaza la puntuacion por espacio, no la borra', () => {
    // Borrarla convertiria "no,tengo" en "notengo" y la marca de negacion se perderia.
    expect(normalizarRespuesta('no,tengo')).toBe('no tengo');
    expect(normalizarRespuesta('no-tengo')).toBe('no tengo');
  });

  it('nulo y vacio no revientan', () => {
    expect(normalizarRespuesta(null)).toBe('');
    expect(normalizarRespuesta(undefined)).toBe('');
    expect(normalizarRespuesta('   ')).toBe('');
  });
});

describe('clasificarRespuesta — afirmaciones', () => {
  // "Si" es el caso que abrio el frente: es la respuesta natural a una pregunta de si/no
  // y hasta hoy cerraba la sesion.
  const afirmaciones = [
    'Si', 'sí', 'SÍ', 'si!', 'sii', 'sip', 's', 'claro', 'Dale', 'ok', 'okey', 'listo',
    'tengo', 'ya', 'ahí va', 'ahi voy', 'yes', 'vale', 'perfecto', 'de una', 'así es',
    'un momento', 'espérame', 'sí tengo la foto', 'ya te la mando',
  ];
  for (const t of afirmaciones) {
    it(`"${t}" es si`, () => expect(clasificarRespuesta(t)).toBe('si'));
  }

  it('un pulgar arriba solo tambien es si', () => {
    // Un mensaje que es SOLO un emoji se normaliza a un texto sin ninguna marca de
    // palabra: sin la lectura aparte caeria en `desconocido`.
    expect(clasificarRespuesta('👍')).toBe('si');
    expect(clasificarRespuesta('✅')).toBe('si');
  });
});

describe('clasificarRespuesta — negaciones', () => {
  const negaciones = ['no', 'No.', 'NO', 'nop', 'nel', 'no tengo', 'No tengo soporte', 'ninguno', 'nada', 'negativo'];
  for (const t of negaciones) {
    it(`"${t}" es no`, () => expect(clasificarRespuesta(t)).toBe('no'));
  }

  it('la negacion gana sobre una marca de si que venga en la misma frase', () => {
    // "no tengo" contiene "tengo", que es marca de afirmacion. Si el orden se invirtiera,
    // a quien no tiene soporte se le pediria la foto para siempre.
    expect(clasificarRespuesta('no tengo')).toBe('no');
    expect(clasificarRespuesta('no, no tengo listo eso')).toBe('no');
  });

  it('un pulgar abajo es no', () => expect(clasificarRespuesta('👎')).toBe('no'));
});

describe('clasificarRespuesta — aplazamiento', () => {
  const despues = ['después', 'despues', 'luego', 'ahorita', 'más tarde', 'al rato', 'mañana', 'Luego te la mando'];
  for (const t of despues) {
    it(`"${t}" es despues`, () => expect(clasificarRespuesta(t)).toBe('despues'));
  }

  it('el aplazamiento gana sobre la negacion', () => {
    // "ahorita no" y "no, luego" son un aplazamiento, no una negativa: quien lo dice
    // todavia piensa mandar el soporte.
    expect(clasificarRespuesta('ahorita no')).toBe('despues');
    expect(clasificarRespuesta('no, luego')).toBe('despues');
  });
});

describe('clasificarRespuesta — cancelar', () => {
  for (const t of ['cancelar', 'cancela', 'olvídalo', 'déjalo así', 'salir']) {
    it(`"${t}" es cancelar`, () => expect(clasificarRespuesta(t)).toBe('cancelar'));
  }
});

describe('clasificarRespuesta — desconocido', () => {
  for (const t of ['', '   ', 'asdfgh', 'gracias', '¿y eso cómo es?', '1']) {
    it(`"${t}" es desconocido`, () => expect(clasificarRespuesta(t)).toBe('desconocido'));
  }

  it('no se cuela dentro de otra palabra', () => {
    // `\b` de JS no basta con tildes y un `includes` suelto convertiria "sino" en un si
    // y "nota" en un no. Los lookarounds de letra son lo que lo impide.
    expect(clasificarRespuesta('sino')).toBe('desconocido');
    expect(clasificarRespuesta('nota')).toBe('desconocido');
    expect(clasificarRespuesta('mantengo')).toBe('desconocido');
    expect(clasificarRespuesta('yate')).toBe('desconocido');
  });
});
