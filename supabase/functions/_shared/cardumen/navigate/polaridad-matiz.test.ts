// Dos arreglos del lector de diadas tras el benchmark v2 (resultados-v2.md, 2026-09-25):
//   1. G22: "It's been happening for years, nada nuevo" salio en el polo CONTRARIO ("Esto es
//      completamente nuevo") 3 de 3 con 3.5-flash-lite. Guarda de polaridad: si la respuesta niega
//      de forma explicita el polo elegido, no se ubica y se repregunta. Ubicar al reves es peor que
//      no ubicar.
//   2. G13: "liderados del sector publico pero con agentes privados" (un polo dominante con un matiz
//      del otro) la guarda `medioQueEsAmbas` la subia a both_intense. Ahora solo dispara con fuerza
//      comparable en los dos polos; el polo con matiz se repregunta con las anclas de su lado.
// Y la regresion: G15, G16 y G23 siguen en both_intense y un punto medio de verdad en middle.
import { describe, expect, it } from 'vitest';
import { DIADAS } from './instrumento';
import { SISTEMA_CLASIFICADOR } from './filtro';
import { evidenciaEspecial, interpreteConModelo, matizDeUnPolo, medioQueEsAmbas, niegaPolo } from './interprete';
import type { ModelAdapter, ModelCallOpts } from '../types';

// Textos del golden v1 (proyectos/metrik/cardumen/evals/golden-lector/golden-v1.yaml).
const G13 = 'deberían ser liderados del sector público pero con agentes privados ejecutando los proyectos. Poner la plata sobre la mesa y que el sector privado llegue con estos proyectos';
const G15 = 'Deben existir objetivos claro. Para donde vamos... Pero en la particularidad deben existir flexibilidad de ejecución. Son muchas las variables a controlar y hay que hacer malabares muchas veces. Sin flexibilidad puede que nos estrellemos';
const G16 = 'Las dos cosas. Me preocupa muchísimo y al mismo tiempo me da esperanza ver que la gente se está moviendo';
const G22 = "It's been happening for years, nada nuevo";
const G23 = 'Me da hope pero también mucho worry, las dos al mismo tiempo la verdad';

const Q15 = { id: 'D1_novedad' as const, izq: 'El sector privado', der: 'El sector publico' };
const Q13 = { id: 'D1_novedad' as const, izq: 'Flexibilidad y espacio para explorar', der: 'Estructura y claras directrices' };
const D1 = DIADAS.D1_novedad;
const POLOS_D1: [string, string] = [D1.izq, D1.der];
const POLOS_Q15: [string, string] = [Q15.izq, Q15.der];
const POLOS_Q13: [string, string] = [Q13.izq, Q13.der];

/** El filtro responde R; el lector responde `lector` tal cual (lo que devolvio el modelo en el benchmark). */
function modelo(lector: string): ModelAdapter & { ultimas: ModelCallOpts[] } {
  const m = {
    id: 'falso',
    pricing: { in: 0, out: 0 },
    ultimas: [] as ModelCallOpts[],
    async call(opts: ModelCallOpts) {
      m.ultimas.push(opts);
      return { text: opts.system === SISTEMA_CLASIFICADOR ? '{"categoria":"R"}' : lector };
    },
  };
  return m as unknown as ModelAdapter & { ultimas: ModelCallOpts[] };
}

const NO_LEIDO = { claro: false, ancla: null, especial: null, lado: null };

describe('G22: guarda de polaridad (negacion explicita del polo elegido)', () => {
  it('lo que devolvio 3.5-flash-lite (ancla 5, der) no se ubica: se repregunta sin lado', async () => {
    const r = await interpreteConModelo(modelo('{"claro":true,"ancla":5,"especial":null,"lado":"der"}')).diada(D1, G22);
    expect(r).toEqual(NO_LEIDO);
  });

  it('tampoco con matiz hacia el polo negado (ancla 4), ni se ofrece ese lado si el modelo no ubica', async () => {
    expect(await interpreteConModelo(modelo('{"claro":true,"ancla":4,"especial":null,"lado":"der"}')).diada(D1, G22)).toEqual(NO_LEIDO);
    expect(await interpreteConModelo(modelo('{"claro":false,"ancla":null,"especial":null,"lado":"der"}')).diada(D1, G22)).toEqual(NO_LEIDO);
  });

  it('la lectura correcta (ancla 1, izq, la de 3.1 y de v1) pasa intacta', async () => {
    const r = await interpreteConModelo(modelo('{"claro":true,"ancla":1,"especial":null,"lado":"izq"}')).diada(D1, G22);
    expect(r).toEqual({ claro: true, ancla: 1, especial: null, lado: 'izq' });
  });

  it('niegaPolo: negaciones del polo, en espanol e ingles mezclado', () => {
    expect(niegaPolo(G22, POLOS_D1, 'der')).toBe(true);
    expect(niegaPolo(G22, POLOS_D1, 'izq')).toBe(false);
    expect(niegaPolo('no es completamente nuevo', POLOS_D1, 'der')).toBe(true);
    expect(niegaPolo('yo no creo que sea nuevo', POLOS_D1, 'der')).toBe(true);
    expect(niegaPolo('esto no venía pasando, apareció de golpe', POLOS_D1, 'izq')).toBe(true);
    expect(niegaPolo('not really, nada de esperanza', [DIADAS.D2_afecto.izq, DIADAS.D2_afecto.der], 'der')).toBe(true);
  });

  it('niegaPolo: no confunde un "no" de otra frase, un "no solo" ni el polo afirmado', () => {
    expect(niegaPolo('No, es completamente nuevo', POLOS_D1, 'der')).toBe(false);
    expect(niegaPolo('No sé. Pero es nuevo, eso sí', POLOS_D1, 'der')).toBe(false);
    expect(niegaPolo('no solo es nuevo, es rarísimo', POLOS_D1, 'der')).toBe(false);
    expect(niegaPolo('esto es completamente nuevo', POLOS_D1, 'der')).toBe(false);
    // Una palabra que comparten los dos polos no cuenta ("hacer" en la diada de agencia).
    expect(niegaPolo('no se que hacer', [DIADAS.D3_agencia.izq, DIADAS.D3_agencia.der], 'der')).toBe(false);
  });

  it('una respuesta que afirma el polo sin negarlo se ubica como siempre', async () => {
    const r = await interpreteConModelo(modelo('{"claro":true,"ancla":5,"especial":null,"lado":"der"}')).diada(D1, 'esto es completamente nuevo, nunca lo había visto');
    expect(r).toEqual({ claro: true, ancla: 5, especial: null, lado: 'der' });
  });

  it('el prompt de la diada le dice al modelo que mire la negacion', async () => {
    const m = modelo('{"claro":true,"ancla":1,"especial":null,"lado":"izq"}');
    await interpreteConModelo(m).diada(D1, G22);
    const system = m.ultimas.find((o) => o.system !== SISTEMA_CLASIFICADOR)!.system;
    expect(system).toMatch(/Mira la NEGACION/);
    expect(system).toMatch(/"nada nuevo" no es "completamente nuevo"/);
  });
});

describe('G13: un polo dominante con matiz del otro no es both_intense', () => {
  it('las guardas no lo suben a both_intense', () => {
    expect(medioQueEsAmbas(G13, POLOS_Q15)).toBe(false);
    expect(evidenciaEspecial('both_intense', G13, POLOS_Q15)).toBe(false);
    expect(matizDeUnPolo(G13, POLOS_Q15)).toEqual({ lado: 'der' });
  });

  it('lo que devolvio 3.5 (middle / ancla 3) se repregunta con las anclas del lado publico', async () => {
    for (const lector of [
      '{"claro":true,"ancla":3,"especial":"middle","lado":null}',
      '{"claro":true,"ancla":3,"especial":null,"lado":null}',
    ]) {
      const r = await interpreteConModelo(modelo(lector)).diada(Q15, G13);
      expect(r, lector).toEqual({ claro: false, ancla: null, especial: null, lado: 'der' });
    }
  });

  it('lo que devolvio 3.1 (both_intense directo) tampoco se acepta', async () => {
    const r = await interpreteConModelo(modelo('{"claro":true,"ancla":null,"especial":"both_intense","lado":null}')).diada(Q15, G13);
    expect(r).toEqual({ claro: false, ancla: null, especial: null, lado: 'der' });
  });

  it('si el modelo lee el ancla 4 (lo esperado), pasa intacta', async () => {
    const r = await interpreteConModelo(modelo('{"claro":true,"ancla":4,"especial":null,"lado":"der"}')).diada(Q15, G13);
    expect(r).toEqual({ claro: true, ancla: 4, especial: null, lado: 'der' });
  });

  it('un matiz CON fuerza (el ejemplo del prompt) si es both_intense', () => {
    const conFuerza = 'Deben existir objetivos claros y directrices firmes, pero con total libertad para explorar como llegar';
    expect(matizDeUnPolo(conFuerza, POLOS_Q13)).toBeNull();
    expect(medioQueEsAmbas(conFuerza, POLOS_Q13)).toBe(true);
  });
});

describe('regresion: G15, G16 y G23 siguen en both_intense; el punto medio sigue en middle', () => {
  const lecturas = [
    '{"claro":true,"ancla":null,"especial":"both_intense","lado":null}',
    '{"claro":true,"ancla":3,"especial":"middle","lado":null}',
    '{"claro":true,"ancla":3,"especial":null,"lado":null}',
  ];

  it('G15', async () => {
    for (const lector of lecturas) {
      const r = await interpreteConModelo(modelo(lector)).diada(Q13, G15);
      expect(r, lector).toEqual({ claro: true, ancla: null, especial: 'both_intense', lado: null });
    }
  });

  it('G16 y G23', async () => {
    for (const texto of [G16, G23]) {
      for (const lector of lecturas) {
        const r = await interpreteConModelo(modelo(lector)).diada(DIADAS.D2_afecto, texto);
        expect(r, `${texto} / ${lector}`).toEqual({ claro: true, ancla: null, especial: 'both_intense', lado: null });
      }
    }
  });

  it('un punto medio genuino sigue en middle', async () => {
    for (const texto of [
      'un poco de flexibilidad y un poco de estructura',
      'ni lo uno ni lo otro, algo de estructura y algo de flexibilidad',
      'estoy en el medio entre la flexibilidad y la estructura',
    ]) {
      const r = await interpreteConModelo(modelo('{"claro":true,"ancla":3,"especial":"middle","lado":null}')).diada(Q13, texto);
      expect(r, texto).toEqual({ claro: true, ancla: 3, especial: 'middle', lado: null });
    }
  });
});
