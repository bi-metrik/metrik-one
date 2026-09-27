// Guarda de sustento en la triada, tras el benchmark v4 (resultados-v4.md, 2026-09-27):
//   G03: "La Araucania es una region con bastantes necesidades y oportunidades..." frente a la
//   triada "Consideraciones del negocio" salio dominante 1 ("Las necesidades de la region") en 3 de
//   3 con 3.5-flash-lite. Describe la region, no elige: Saga la etiqueto claro:false. La guarda no
//   ubica un dominante suelto (sin segundo ni "solo ese") cuando el texto no trae marca de elegir u
//   ordenar. Y la regresion: ninguna triada legitima del golden v1 ni del golden de CI pierde su
//   lectura.
import { describe, expect, it } from 'vitest';
import golden from './golden-lector.json';
import { TRIADAS } from './instrumento';
import { SISTEMA_CLASIFICADOR } from './filtro';
import { dominanteSinSustento, interpreteConModelo } from './interprete';
import type { ModelAdapter } from '../types';

const G03 = 'La Araucanía es una región con bastantes necesidades y oportunidades, no solamente para las personas de la región, sino con oportunidades de turismo grande';
const Q4 = {
  id: 'T1_fuente' as const,
  pregunta: 'Consideraciones del negocio',
  polos: ['La influencia de otras regiones', 'Las necesidades de la region', 'El Medio Ambiente y el contexto'] as [string, string, string],
};

/** El filtro responde R; el lector responde `lector` tal cual. */
function modelo(lector: string): ModelAdapter {
  return {
    id: 'falso',
    pricing: { in: 0, out: 0 },
    async call(opts: { system: string }) {
      return { text: opts.system === SISTEMA_CLASIFICADOR ? '{"categoria":"R"}' : lector };
    },
  } as unknown as ModelAdapter;
}

const NO_LEIDO = { claro: false, dominante: null, segundo: null, solo_uno: false, especial: null };
const suelto = (dominante: number) => ({ dominante, segundo: null, solo_uno: false, especial: null });

describe('G03: un polo leido de una descripcion no se ubica', () => {
  it('lo que devolvio 3.5-flash-lite (dominante 1, sin segundo) queda no leido', async () => {
    const r = await interpreteConModelo(modelo('{"claro":true,"dominante":1,"segundo":null,"solo_uno":false,"especial":null}')).triada(Q4, G03);
    expect(r).toEqual(NO_LEIDO);
  });

  it('"no solamente" no cuenta como "solo ese": afirma varias cosas a la vez', () => {
    expect(dominanteSinSustento(G03, suelto(1))).toBe(true);
    expect(dominanteSinSustento('la region tiene necesidades, no solo turismo sino gente que vive de eso', suelto(1))).toBe(true);
  });
});

describe('lo que la guarda NO toca', () => {
  it('un dominante con marca de elegir u ordenar pasa', () => {
    for (const t of [
      'sobre todo los que tienen poder, y ya lo demas depende',
      'yo diria que los que tienen la plata, eso es lo que mas pesa aqui',
      'primero la gente comun, que fue la que se movio en el barrio',
      'definitely the powerful ones, they run everything around here',
      'solo la gente comun, los demas ni se enteraron del asunto',
      'lo que es justo es lo que realmente esta en juego aqui',
    ]) expect(dominanteSinSustento(t, suelto(1)), t).toBe(false);
  });

  it('nombrar un polo a secas (respuesta corta) sigue siendo una respuesta', () => {
    for (const t of ['el poder', 'Lo justo', 'la gente comun', 'las necesidades de la region'])
      expect(dominanteSinSustento(t, suelto(0)), t).toBe(false);
  });

  it('con segundo, con "solo ese" o con especial no dispara', () => {
    expect(dominanteSinSustento(G03, { dominante: 1, segundo: 0, solo_uno: false, especial: null })).toBe(false);
    expect(dominanteSinSustento(G03, { dominante: 1, segundo: null, solo_uno: true, especial: null })).toBe(false);
    expect(dominanteSinSustento(G03, { dominante: null, segundo: null, solo_uno: false, especial: 'dont_know' })).toBe(false);
    expect(dominanteSinSustento(G03, { dominante: null, segundo: null, solo_uno: false, especial: null })).toBe(false);
  });

  it('una lectura con dominante y segundo de una respuesta valida pasa intacta', async () => {
    const r = await interpreteConModelo(modelo('{"claro":true,"dominante":1,"segundo":0,"solo_uno":false,"especial":null}'))
      .triada(TRIADAS.T1_fuente, 'Yo diría que primero los que tienen la plata y el poder, y ya después la gente del común que se deja llevar');
    expect(r).toEqual({ claro: true, dominante: 1, segundo: 0, solo_uno: false, especial: null });
  });

  // Triadas LEGITIMAS del golden v1 (G01, G06, G07, G21) y del golden de CI: aunque el modelo se
  // equivocara y leyera solo el dominante, ninguna pierde la lectura por esta guarda.
  const LEGITIMAS_V1 = [
    'deberían ser liderados del sector público pero con agentes privados ejecutando los proyectos',
    'Yo diría que primero los que tienen la plata y el poder, y ya después la gente del común que se deja llevar',
    'Lo justo, sin duda. Solo eso, lo demás no pesa',
    'Honestly, first the people with power, y en segundo lugar la gente común',
  ];
  type Caso = { id: string; punto: string; texto: string; esperado: { claro?: boolean; dominante?: number } };
  const LEGITIMAS_CI = (golden.casos as Caso[])
    .filter((c) => c.punto === 'triada' && c.esperado.claro === true && c.esperado.dominante !== undefined)
    .map((c) => c.texto);

  it.each([...LEGITIMAS_CI, ...LEGITIMAS_V1.slice(1)])('"%s" conserva su dominante', (t) => {
    expect(dominanteSinSustento(t, suelto(1))).toBe(false);
  });

  it('G01 (dominante + segundo) no depende de marcas: la guarda no mira lecturas con orden', () => {
    expect(dominanteSinSustento(LEGITIMAS_V1[0], { dominante: 2, segundo: 1, solo_uno: false, especial: null })).toBe(false);
  });
});
