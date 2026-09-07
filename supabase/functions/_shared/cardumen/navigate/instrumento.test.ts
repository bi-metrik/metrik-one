// El instrumento de Navigate esta CONGELADO: cada literal de aqui es una copia de
// `proyectos/metrik/cardumen/navigate-demo/data/meta.json` (clave `instrumento`) tomada el
// 2026-09-07. Si esta prueba falla, alguien cambio el instrumento en codigo sin pasar por
// meta.json — o al reves, y entonces hay que copiar de nuevo y actualizar AQUI tambien.
import { describe, expect, it } from 'vitest';
import {
  APERTURA, DIADAS, INTENSIDADES, REPARTO_SOLO_UNO, SECTORES, SECTORES_CATALOGO, SECUENCIA, TRIADAS,
  anclasDe, composicion, etiquetaSector, preguntaMostrada,
} from './instrumento';
import { normalizarTexto } from './interprete';

const META_INSTRUMENTO = {
  T1_fuente: {
    pregunta: 'De dónde nace lo que observó',
    polos: ['La gente común, la vida de a pie', 'Quienes tienen poder, dinero o influencia', 'Fuerzas que nadie controla del todo'],
  },
  T2_tiempo: {
    pregunta: 'En el fondo, qué se siente que es',
    polos: ['Algo que se está acabando', 'Algo que apenas comienza', 'Algo que se repite una y otra vez'],
  },
  T3_enjuego: {
    pregunta: 'Qué está realmente en juego (solo expertos)',
    polos: ['Lo que nos conviene', 'Lo que es justo', 'Lo que nos mantiene unidos'],
  },
  D1_novedad: { izq: 'Esto ya venía pasando', der: 'Esto es completamente nuevo' },
  D2_afecto: { izq: 'Me preocupa profundamente', der: 'Me da esperanza' },
  D3_agencia: { izq: 'Me deja sin saber qué hacer', der: 'Tengo claro qué habría que hacer' },
};

describe('Capa A literal de meta.json', () => {
  it('las tres triadas coinciden palabra por palabra', () => {
    for (const id of ['T1_fuente', 'T2_tiempo', 'T3_enjuego'] as const) {
      expect(TRIADAS[id].pregunta).toBe(META_INSTRUMENTO[id].pregunta);
      expect(TRIADAS[id].polos).toEqual(META_INSTRUMENTO[id].polos);
    }
  });

  it('las tres diadas coinciden palabra por palabra', () => {
    for (const id of ['D1_novedad', 'D2_afecto', 'D3_agencia'] as const) {
      expect(DIADAS[id].izq).toBe(META_INSTRUMENTO[id].izq);
      expect(DIADAS[id].der).toBe(META_INSTRUMENTO[id].der);
    }
  });

  it('a la persona no se le muestra la anotacion "(solo expertos)" de T3, pero el literal se conserva', () => {
    expect(preguntaMostrada(TRIADAS.T3_enjuego)).toBe('Qué está realmente en juego');
    expect(preguntaMostrada(TRIADAS.T1_fuente)).toBe('De dónde nace lo que observó');
    expect(TRIADAS.T3_enjuego.pregunta).toContain('(solo expertos)');
  });

  it('los extremos de las cinco anclas son los polos literales', () => {
    const a = anclasDe(DIADAS.D2_afecto);
    expect(a.map((x) => x.posicion)).toEqual([1, 2, 3, 4, 5]);
    expect(a[0].texto).toBe('Me preocupa profundamente');
    expect(a[4].texto).toBe('Me da esperanza');
    expect(a[1].texto).toBe('más cerca de "Me preocupa profundamente", con matices');
    expect(a[3].texto).toBe('más cerca de "Me da esperanza", con matices');
    expect(a.map((x) => x.value)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(a[2].special_case).toBe('middle');
  });
});

describe('secuencia y turno cero', () => {
  it('ciudadano: T1, T2, D1, D2; experto: ademas T3 y D3', () => {
    expect(SECUENCIA.ciudadano).toEqual(['T1_fuente', 'T2_tiempo', 'D1_novedad', 'D2_afecto']);
    expect(SECUENCIA.experto).toEqual(['T1_fuente', 'T2_tiempo', 'D1_novedad', 'D2_afecto', 'T3_enjuego', 'D3_agencia']);
  });

  it('los 12 sectores del brief, en ese orden: el slug que se guarda va SIN tildes (como respuestas.json)', () => {
    expect(SECTORES).toEqual([
      'Infraestructura y construccion', 'Comercio y retail', 'Agroindustria', 'Manufactura',
      'Transporte y logistica', 'Energia y servicios publicos', 'Turismo y hoteleria', 'Servicios financieros',
      'Salud', 'Educacion', 'Tecnologia', 'Sector publico',
    ]);
  });

  it('lo que se MUESTRA lleva tildes, y solo difiere del slug en las tildes', () => {
    expect(SECTORES_CATALOGO.map((s) => s.etiqueta)).toEqual([
      'Infraestructura y construcción', 'Comercio y retail', 'Agroindustria', 'Manufactura',
      'Transporte y logística', 'Energía y servicios públicos', 'Turismo y hotelería', 'Servicios financieros',
      'Salud', 'Educación', 'Tecnología', 'Sector público',
    ]);
    // Si la etiqueta se apartara del slug en algo mas que tildes, `leerSector` dejaria de
    // reconocer el nombre tal como se lo mostramos a la persona.
    for (const s of SECTORES_CATALOGO) expect(normalizarTexto(s.etiqueta)).toBe(normalizarTexto(s.slug));
    expect(etiquetaSector('Infraestructura y construccion')).toBe('Infraestructura y construcción');
    expect(etiquetaSector('Salud')).toBe('Salud');
    expect(etiquetaSector('algo que no esta')).toBe('algo que no esta');
  });

  it('las dos aperturas son las de la seccion 01 de la muestra', () => {
    expect(APERTURA.ciudadano).toBe('Cuéntenos algo que haya visto, oído o vivido últimamente que le haya hecho pensar. Algo que podría estar anunciando un cambio, para bien o para mal.');
    expect(APERTURA.experto).toBe('Desde su ángulo particular, ¿qué ha estado observando que pocos están viendo todavía? ¿Qué señal débil le llama la atención?');
  });
});

describe('tabla pre-registrada de composicion (§3.1)', () => {
  it('cada etiqueta suma 1 y va en el orden de los polos', () => {
    for (const i of INTENSIDADES) {
      expect(i.reparto.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    }
    // dominante = polo 2, segundo = polo 0, residual = polo 1
    expect(composicion(2, 0, INTENSIDADES[1].reparto)).toEqual([0.3, 0.05, 0.65]);
    expect(composicion(0, 1, INTENSIDADES[0].reparto)).toEqual([0.5, 0.45, 0.05]);
    expect(composicion(1, 2, INTENSIDADES[2].reparto)).toEqual([0.05, 0.85, 0.1]);
  });

  it('"fue solo X": 0.90 al dominante y el residual repartido', () => {
    expect(REPARTO_SOLO_UNO.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(composicion(1, null, REPARTO_SOLO_UNO)).toEqual([0.05, 0.9, 0.05]);
  });

  it('resolucion gruesa: dominante = 1, resto = 0', () => {
    expect(composicion(2, 0, null)).toEqual([0, 0, 1]);
  });
});
