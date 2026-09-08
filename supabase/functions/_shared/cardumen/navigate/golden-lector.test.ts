// El golden set del lector vive en `golden-lector.json` y se corre contra el modelo VIVO con
// `scripts/navigate-lector-eval.ts` (eso no cabe en CI: cuesta, tarda y no es determinista).
// Lo que SI se fija aqui, en CI y sin modelo:
//   1. la forma del set: 15+ casos por punto de lectura y las categorias obligatorias del brief;
//   2. lo que la capa determinista garantiza ANTES del modelo: toda pregunta de vuelta y toda
//      negativa del set la atrapa `meta.ts` (jamas llegan al lector), y ningun caso valido se
//      la come;
//   3. el lector por palabras de intensidad no FABRICA etiquetas sobre los casos del set.
import { describe, expect, it } from 'vitest';
import golden from './golden-lector.json';
import { contradiccionPorPalabras, evidenciaEspecial, intensidadPorPalabras } from './interprete';
import { leerMeta, sinPalabras } from './meta';

type Esperado = {
  claro?: boolean; dominante?: number; segundo?: number; solo_uno?: boolean; ninguno?: boolean;
  especial?: string; ancla_en?: number[]; lado?: string | null; etiqueta_en?: Array<string | null>;
};
type Caso = { id: string; punto: string; categoria: string; texto: string; esperado: Esperado; dimension?: string; dominante?: number };

const CASOS = golden.casos as Caso[];
const PUNTOS = ['triada', 'segundo', 'intensidad', 'diada'] as const;
const OBLIGATORIAS = golden.categorias_obligatorias as string[];

const esNoLectura = (e: Esperado): boolean =>
  e.claro === false || (Array.isArray(e.etiqueta_en) && e.etiqueta_en.every((x) => x === null));

describe('golden-lector.json: forma', () => {
  it('ids unicos', () => {
    const ids = CASOS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(PUNTOS)('%s: al menos 15 casos y todas las categorias obligatorias', (punto) => {
    const del = CASOS.filter((c) => c.punto === punto);
    expect(del.length).toBeGreaterThanOrEqual(15);
    const cats = new Set(del.map((c) => c.categoria));
    for (const cat of OBLIGATORIAS) expect(cats.has(cat), `${punto} sin categoria ${cat}`).toBe(true);
    // Tambien casos VALIDOS: sin ellos, un lector que dijera "no leido" a todo saldria perfecto.
    expect(del.filter((c) => !esNoLectura(c.esperado)).length).toBeGreaterThanOrEqual(2);
  });

  it('cada caso declara un esperado con la forma de su punto', () => {
    for (const c of CASOS) {
      expect(PUNTOS).toContain(c.punto);
      expect(typeof c.texto).toBe('string');
      if (c.punto === 'intensidad') expect(Array.isArray(c.esperado.etiqueta_en), c.id).toBe(true);
      else expect(typeof c.esperado.claro, c.id).toBe('boolean');
      if (c.punto === 'segundo') expect(typeof c.dominante, c.id).toBe('number');
    }
  });

  it('el caso de riesgo esta en cada punto y se espera "no leido": hoy el motor lo trata como ruido', () => {
    for (const punto of PUNTOS) {
      const riesgo = CASOS.filter((c) => c.punto === punto && c.categoria === 'riesgo');
      expect(riesgo.length).toBeGreaterThanOrEqual(1);
      for (const c of riesgo) expect(esNoLectura(c.esperado), c.id).toBe(true);
    }
  });
});

describe('golden-lector.json: lo que la capa determinista garantiza antes del modelo', () => {
  it('toda pregunta de vuelta del set la atrapa meta.ts', () => {
    for (const c of CASOS.filter((x) => x.categoria === 'pregunta_vuelta')) expect(leerMeta(c.texto), `${c.id}: ${c.texto}`).toBe('pregunta');
  });

  it('toda negativa del set la atrapa meta.ts', () => {
    for (const c of CASOS.filter((x) => x.categoria === 'negativa')) expect(leerMeta(c.texto), `${c.id}: ${c.texto}`).toBe('negativa');
  });

  it('ningun caso valido, especial, enterrado, mezclado o matizado lo atrapa meta.ts', () => {
    const suaves = new Set(['valida', 'especial', 'enterrada', 'mezcla_idiomas', 'matiz']);
    for (const c of CASOS.filter((x) => suaves.has(x.categoria))) expect(leerMeta(c.texto), `${c.id}: ${c.texto}`).toBeNull();
  });

  it('los casos de solo emojis los atrapa sinPalabras', () => {
    for (const c of CASOS.filter((x) => /^[\p{Emoji}\s]+$/u.test(x.texto))) expect(sinPalabras(c.texto), c.id).toBe(true);
  });

  it('el lector por palabras de intensidad nunca fabrica: lo que devuelve esta en esperado.etiqueta_en o es null', () => {
    for (const c of CASOS.filter((x) => x.punto === 'intensidad')) {
      const e = intensidadPorPalabras(c.texto);
      expect(e === null || (c.esperado.etiqueta_en ?? []).includes(e), `${c.id}: "${c.texto}" -> ${e}`).toBe(true);
    }
  });

  it('las contradicciones literales del set no llegan al modelo', () => {
    for (const id of ['T-12', 'T-13', 'S-05']) {
      const c = CASOS.find((x) => x.id === id)!;
      expect(contradiccionPorPalabras(c.texto), `${id}: ${c.texto}`).toBe(true);
    }
  });

  it('ningun caso "no leido" del set trae evidencia de un especial: si el modelo lo inventa, se descarta', () => {
    // Las contradicciones ("los dos primero", "las dos y ninguna") traen esas palabras a proposito
    // y las ataja `contradiccionPorPalabras` antes; las negativas las ataja meta.ts.
    const fuera = new Set(['negativa', 'contradiccion']);
    for (const c of CASOS.filter((x) => x.punto !== 'intensidad' && x.esperado.claro === false && !fuera.has(x.categoria))) {
      const especiales = c.punto === 'diada' ? ['not_applicable', 'dont_know', 'both_intense'] : ['not_applicable', 'dont_know'];
      for (const e of especiales) expect(evidenciaEspecial(e, c.texto), `${c.id} "${c.texto}" ${e}`).toBe(false);
    }
  });

  it('los especiales legitimos del set SI traen evidencia', () => {
    for (const c of CASOS.filter((x) => x.esperado.especial && x.esperado.especial !== 'middle')) {
      expect(evidenciaEspecial(c.esperado.especial!, c.texto), `${c.id} "${c.texto}"`).toBe(true);
    }
  });

  it('las etiquetas literales del set SI las lee por palabras (sin modelo)', () => {
    for (const id of ['I-13', 'I-14', 'I-16']) {
      const c = CASOS.find((x) => x.id === id)!;
      expect(intensidadPorPalabras(c.texto), id).toBe(c.esperado.etiqueta_en![0]);
    }
  });
});
