// El interprete es la unica puerta del modelo. Se prueba con un modelo falso que devuelve
// lo que se le diga: lo que importa aqui es (1) que el lector por palabras atienda botones y
// respuestas literales SIN gastar modelo, y (2) que ninguna salida rara del modelo (indices
// fuera de rango, segundo = dominante, especial y ancla a la vez) pase a la estructura.
import { describe, expect, it } from 'vitest';
import { interpreteConModelo, intensidadPorPalabras, normalizarTexto } from './interprete';
import { DIADAS, TRIADAS } from './instrumento';
import type { ModelAdapter } from '../types';

function modeloQueDevuelve(respuestas: string[]): ModelAdapter & { llamadas: number } {
  const m = {
    id: 'falso',
    pricing: { in: 0, out: 0 },
    llamadas: 0,
    async call() {
      const text = respuestas[Math.min(m.llamadas, respuestas.length - 1)];
      m.llamadas += 1;
      return { text };
    },
  };
  return m;
}

describe('intensidadPorPalabras (sin modelo)', () => {
  it('lee las tres etiquetas tal como se ofrecen y como las repite la gente', () => {
    expect(intensidadPorPalabras('Casi parejos')).toBe('casi_parejos');
    expect(intensidadPorPalabras('iban parejos')).toBe('casi_parejos');
    expect(intensidadPorPalabras('Uno mandaba')).toBe('uno_manda_otro_cuenta');
    expect(intensidadPorPalabras('uno mandaba pero el otro contaba')).toBe('uno_manda_otro_cuenta');
    expect(intensidadPorPalabras('Claramente el 1º')).toBe('claramente_el_primero');
    expect(intensidadPorPalabras('claramente el poder')).toBe('claramente_el_primero');
  });

  it('"no se" es no graduar, y lo que no se entiende es null (va al modelo)', () => {
    expect(intensidadPorPalabras('no sé')).toBe('no_gradua');
    expect(intensidadPorPalabras('me da igual')).toBe('no_gradua');
    expect(intensidadPorPalabras('iban iguales')).toBe('casi_parejos');
    expect(intensidadPorPalabras('pues depende del día')).toBeNull();
    // "primero" suelto es ambiguo ("no sé si el primero"): no se lee por palabras.
    expect(intensidadPorPalabras('el primero por mucho')).toBeNull();
  });

  it('normalizarTexto quita tildes, signos y asteriscos', () => {
    expect(normalizarTexto('  ¡Sí, así! ')).toBe('si asi');
    expect(normalizarTexto('*Uno mandaba*')).toBe('uno mandaba');
  });
});

describe('interpreteConModelo: triada', () => {
  it('lee dominante y segundo del JSON del modelo', async () => {
    const m = modeloQueDevuelve(['{"claro":true,"dominante":1,"segundo":2,"solo_uno":false,"especial":null}']);
    const r = await interpreteConModelo(m).triada(TRIADAS.T1_fuente, 'sobre todo los que tienen poder, y algo de fuerzas que nadie controla');
    expect(r).toEqual({ claro: true, dominante: 1, segundo: 2, solo_uno: false, especial: null });
  });

  it('segundo igual al dominante se descarta; un indice fuera de rango no pasa', async () => {
    const m = modeloQueDevuelve(['{"claro":true,"dominante":1,"segundo":1,"solo_uno":false,"especial":null}']);
    const r = await interpreteConModelo(m).triada(TRIADAS.T1_fuente, 'x');
    expect(r.segundo).toBeNull();
    const m2 = modeloQueDevuelve(['{"claro":true,"dominante":7,"segundo":null,"solo_uno":false,"especial":null}']);
    const r2 = await interpreteConModelo(m2).triada(TRIADAS.T1_fuente, 'x');
    expect(r2.dominante).toBeNull();
    expect(r2.claro).toBe(false);
  });

  it('un especial anula dominante y segundo', async () => {
    const m = modeloQueDevuelve(['{"claro":true,"dominante":0,"segundo":1,"solo_uno":true,"especial":"not_applicable"}']);
    const r = await interpreteConModelo(m).triada(TRIADAS.T2_tiempo, 'ninguna de esas');
    expect(r).toEqual({ claro: true, dominante: null, segundo: null, solo_uno: false, especial: 'not_applicable' });
  });

  it('si el modelo no da JSON, reintenta una vez con el aviso', async () => {
    const m = modeloQueDevuelve(['esto no es json', '{"claro":true,"dominante":0,"segundo":null,"solo_uno":true,"especial":null}']);
    const r = await interpreteConModelo(m).triada(TRIADAS.T1_fuente, 'solo la gente');
    expect(m.llamadas).toBe(2);
    expect(r.solo_uno).toBe(true);
  });
});

describe('interpreteConModelo: segundo polo', () => {
  it('no acepta como segundo el polo que ya es dominante', async () => {
    const m = modeloQueDevuelve(['{"claro":true,"segundo":1,"ninguno":false}']);
    const r = await interpreteConModelo(m).segundo(TRIADAS.T1_fuente, 1, 'el poder otra vez');
    expect(r).toEqual({ claro: false, segundo: null, ninguno: false });
  });

  it('"ninguno" se lee como tal', async () => {
    const m = modeloQueDevuelve(['{"claro":true,"segundo":null,"ninguno":true}']);
    const r = await interpreteConModelo(m).segundo(TRIADAS.T1_fuente, 1, 'ninguno');
    expect(r).toEqual({ claro: true, segundo: null, ninguno: true });
  });
});

describe('interpreteConModelo: intensidad', () => {
  it('la etiqueta literal no gasta modelo', async () => {
    const m = modeloQueDevuelve(['{"etiqueta":"casi_parejos"}']);
    const r = await interpreteConModelo(m).intensidad('a', 'b', 'uno mandaba pero el otro contaba');
    expect(r.etiqueta).toBe('uno_manda_otro_cuenta');
    expect(m.llamadas).toBe(0);
  });

  it('lo que no se lee por palabras va al modelo', async () => {
    const m = modeloQueDevuelve(['{"etiqueta":"claramente_el_primero"}']);
    const r = await interpreteConModelo(m).intensidad('a', 'b', 'el primero por mucho');
    expect(r.etiqueta).toBe('claramente_el_primero');
    expect(m.llamadas).toBe(1);
  });
});

describe('interpreteConModelo: diada', () => {
  it('ancla clara', async () => {
    const m = modeloQueDevuelve(['{"claro":true,"ancla":4,"especial":null,"lado":"der"}']);
    const r = await interpreteConModelo(m).diada(DIADAS.D1_novedad, 'es bastante nuevo');
    expect(r).toEqual({ claro: true, ancla: 4, especial: null, lado: 'der' });
  });

  it('"middle" fija el ancla 3 aunque el modelo mande otra', async () => {
    const m = modeloQueDevuelve(['{"claro":true,"ancla":2,"especial":"middle","lado":null}']);
    const r = await interpreteConModelo(m).diada(DIADAS.D1_novedad, 'un poco de las dos');
    expect(r.ancla).toBe(3);
    expect(r.especial).toBe('middle');
  });

  it('both_intense no lleva ancla', async () => {
    const m = modeloQueDevuelve(['{"claro":true,"ancla":3,"especial":"both_intense","lado":null}']);
    const r = await interpreteConModelo(m).diada(DIADAS.D2_afecto, 'las dos, con mucha fuerza');
    expect(r).toEqual({ claro: true, ancla: null, especial: 'both_intense', lado: null });
  });

  it('un matiz sin ancla deja el lado como pista', async () => {
    const m = modeloQueDevuelve(['{"claro":false,"ancla":null,"especial":null,"lado":"izq"}']);
    const r = await interpreteConModelo(m).diada(DIADAS.D1_novedad, 'nuevo no del todo, pero se aceleró');
    expect(r).toEqual({ claro: false, ancla: null, especial: null, lado: 'izq' });
  });
});
