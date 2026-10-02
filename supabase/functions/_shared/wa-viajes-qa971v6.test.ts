/**
 * QA de #971 v6: los cuatro S3.
 *   1. Apodos del equipo: el primer nombre suelto y su comienzo (3+ letras) tampoco son encabezado.
 *   2. «nuevo» suelto: el bot pide el nombre en el acto; hasta que llega, lo que sigue no se asigna.
 *   3. Sí/no con un normalizador compartido; lo que no se entiende recibe «No entendí» en el acto.
 *   4. Más palabras coloquiales; dos palabras de la lista juntas tampoco tienen efecto.
 * Todos los nombres son SINTÉTICOS.
 */
import { describe, expect, it } from 'vitest';
import {
  armarPlan,
  armarSegmentos,
  esNombreNuevo,
  esSi,
  leerSiNo,
  pareceEncabezado,
  PALABRAS_COMUNES,
  pendienteDeLaCaja,
  resolverEncabezado,
  respuestaAlEncabezado,
  textoNoEntendiEleccion,
  TEXTO_PIDE_NOMBRE_NUEVO,
  type MensajeViaje,
  type ViajeAbierto,
} from './wa-viajes-reglas.ts';

const EQUIPO = ['Tatiana Quiroga', 'Mauricio Lozada'];
const viajes = (nombres: string[]): ViajeAbierto[] => nombres.map((c, i) => ({ id: `v${i}`, codigo: `T1 26 ${100 + i}`, cliente: c, destino: null }));
const t = (min: number) => new Date(Date.parse('2026-10-01T14:00:00Z') + min * 60_000).toISOString();
const m = (n: number, cuerpo: string): MensajeViaje => ({ n, cuerpo, reenviado: true, tipo: 'text', en: t(n) });
const enc = (n: number, cuerpo: string): MensajeViaje => ({ n, cuerpo, reenviado: false, tipo: 'text', en: t(n) });
const efecto = (w: string, vs: ViajeAbierto[], equipo: string[] = EQUIPO) =>
  resolverEncabezado(w, vs, equipo)?.tipo ?? (pareceEncabezado(w, vs, equipo) ? 'corta' : null);
const reparto = (ms: MensajeViaje[], vs: ViajeAbierto[]) => {
  const { segmentos, encabezados } = armarSegmentos(ms, vs, { horasCajaActiva: 4, equipo: EQUIPO });
  return { segmentos, plan: armarPlan({ mensajes: ms, viajes: vs, segmentos, encabezados }) };
};
const destinos = (ms: MensajeViaje[], vs: ViajeAbierto[]) => reparto(ms, vs).plan.mensajes.map(x =>
  [x.n, !x.destino ? null : x.destino.tipo === 'existente' ? x.destino.codigo : `NUEVO ${x.destino.cliente}`]);

describe('1 · apodos del equipo', () => {
  const vs = viajes(['TATIANA RÍOS', 'MAURICIO PÉREZ', 'MARIANA SERNA', 'CAROLINA RUIZ']);

  it.each(['Tati', 'Tatia', 'Tatiana', 'Mau', 'Mauri', 'Mauricio', 'gracias Tati', 'Tati gracias', 'ok Mau'])('«%s» no mueve, no pregunta, no corta', w => {
    expect(efecto(w, vs)).toBeNull();
  });

  it('sin el equipo, «Tati» cortaba y «Mauricio» movía la caja (el caso del QA v6)', () => {
    expect([efecto('Tati', vs, []), efecto('Mauricio', vs, [])]).toEqual(['corta', 'viaje']);
  });

  it('dos letras no son apodo; con su apellido, la clienta que se llama como alguien del equipo se puede nombrar', () => {
    expect(efecto('Ta', viajes(['TAMARA GIL']))).toBeNull(); // muy corto para ser encabezado de todos modos
    expect(resolverEncabezado('Tatiana Ríos', vs, EQUIPO)).toMatchObject({ tipo: 'viaje', viaje: { id: 'v0' } });
    expect(resolverEncabezado('Carolina', vs, EQUIPO)).toMatchObject({ tipo: 'viaje', viaje: { id: 'v3' } });
  });
});

describe('1b · un cliente exacto gana sobre el apodo del equipo (ajuste antes del QA v7)', () => {
  const equipo = ['Mariana Quiroga', 'Tatiana Lozada'];
  const vs = viajes(['MARÍA PÉREZ', 'MARTA GIL', 'TATIANA RÍOS']);

  it('con una Mariana en el equipo, «María» y «María Pérez» nombran a la clienta María', () => {
    expect(resolverEncabezado('María', vs, equipo)).toMatchObject({ tipo: 'viaje', viaje: { id: 'v0' } });
    expect(resolverEncabezado('Maria Perez', vs, equipo)).toMatchObject({ tipo: 'viaje', viaje: { id: 'v0' } });
    expect(resolverEncabezado('Marta', vs, equipo)).toMatchObject({ tipo: 'viaje', viaje: { id: 'v1' } });
  });

  it('sin un cliente exacto, el apodo del equipo sigue sin efecto', () => {
    for (const w of ['Mari', 'Mar', 'Tati']) expect(efecto(w, vs, equipo), w).toBeNull();
  });

  it('el primer nombre completo de alguien del equipo nunca es encabezado, aunque haya una clienta que se llame igual', () => {
    expect(efecto('Tatiana', vs, equipo)).toBeNull();
    expect(efecto('Mariana', viajes(['MARIANA SERNA']), equipo)).toBeNull();
    // Con su apellido, sí.
    expect(resolverEncabezado('Tatiana Ríos', vs, equipo)).toMatchObject({ tipo: 'viaje', viaje: { id: 'v2' } });
  });
});

describe('2 · «nuevo» suelto', () => {
  const vs = viajes(['CAROLINA RUIZ']);

  it('el bot pide el nombre en el acto', () => {
    expect(respuestaAlEncabezado(resolverEncabezado('nuevo', vs))).toBe(TEXTO_PIDE_NOMBRE_NUEVO);
    expect(respuestaAlEncabezado(resolverEncabezado('Nueva', vs))).toBe(TEXTO_PIDE_NOMBRE_NUEVO);
    expect(respuestaAlEncabezado(resolverEncabezado('nuevo Pedro Gómez', vs))).toBe('📌 NUEVO Pedro Gómez');
  });

  it('sin nombre, lo que sigue queda sin asignar; con el nombre, va al NUEVO con ese nombre', () => {
    const base = [enc(1, 'Carolina'), m(2, 'salimos el 28'), enc(3, 'nuevo'), m(4, 'vamos a Aruba')];
    expect(destinos(base, vs)).toEqual([[2, 'T1 26 100'], [4, null]]);
    expect(reparto(base, vs).plan.mensajes[1].motivo).toContain('sin nombre');
    expect(pendienteDeLaCaja(reparto(base, vs).segmentos)).toEqual({ tipo: 'nombre', conContenido: true });
    const con = [...base, enc(5, 'Pedro Gómez'), m(6, 'somos 2')];
    expect(destinos(con, vs)).toEqual([[2, 'T1 26 100'], [4, 'NUEVO Pedro Gómez'], [6, 'NUEVO Pedro Gómez']]);
    expect(pendienteDeLaCaja(reparto(con, vs).segmentos)).toBeNull();
    // Un escrito común no es un nombre: sigue esperando (y un acuse del comercial no va al resumen: 2026-10-02).
    expect(destinos([...base, enc(5, 'gracias'), m(6, 'somos 2')], vs)).toEqual([[2, 'T1 26 100'], [4, null], [6, null]]);
    // Un sí, un no o un número no son el nombre ni contenido.
    expect(destinos([...base, enc(5, 'si'), enc(6, '2'), m(7, 'somos 2')], vs)).toEqual([[2, 'T1 26 100'], [4, null], [7, null]]);
  });

  it('qué es un nombre', () => {
    expect(esNombreNuevo('Pedro Gómez')).toBe('Pedro Gómez');
    expect(esNombreNuevo('se llama Pedro Gómez')).toBe('Pedro Gómez');
    for (const x of ['gracias', 'sí', 'ok', '¿quién?', 'son 3', 'Tati']) expect(esNombreNuevo(x, EQUIPO), x).toBeNull();
  });
});

describe('3 · sí/no con un normalizador compartido', () => {
  it.each(['sí', 'Si', 'SÍ', 'si claro', 'sí, es ella', 'ok', 'sip', '👍', 'dale', 'si señora', 'correcto', 'de una', 'así es', 'okis', 'Sí 👍'])('«%s» es sí a «¿Cambias a…?»', x => {
    expect(leerSiNo(x)).toBe('si');
  });
  it.each(['no', 'No.', 'nop', 'no, es Carolina', 'no señora', 'para nada', '👎', 'negativo'])('«%s» es no', x => {
    expect(leerSiNo(x)).toBe('no');
  });
  it.each(['no sé', 'ok pero falta uno', 'sí no', 'mañana', 'Carolina', 'espera', '', 'sí pero la otra'])('«%s» no se adivina', x => {
    expect(leerSiNo(x)).toBeNull();
  });

  it('el «sí» que carga un reparto es el mismo normalizador, en modo estricto: un acuse reflejo no carga (F11)', () => {
    expect(['si claro', 'sí, es así', 'así es', 'dale'].map(esSi)).toEqual([true, true, true, true]);
    expect(['ok', '👍', 'listo', 'ok pero falta uno'].map(esSi)).toEqual([false, false, false, false]);
  });

  // Trappvel 2026-10-02: el aproximado ya no es sí/no; un «ok» no elige (ni es contenido), el número sí.
  it('en la tanda: «ok» no elige ni es contenido; «1» elige; «no sé» no, y la caja sigue esperando', () => {
    const vs = viajes(['CAROLINA RUIZ', 'LUISA MEJÍA']);
    const base = [enc(1, 'Carolina'), m(2, 'salimos el 28'), enc(3, 'Lusia')];
    expect(destinos([...base, enc(4, 'ok'), m(5, 'somos 2')], vs)).toEqual([[2, 'T1 26 100'], [5, null]]);
    expect(destinos([...base, enc(4, '1'), m(5, 'somos 2')], vs)).toEqual([[2, 'T1 26 100'], [5, 'T1 26 101']]);
    const duda = [...base, enc(4, 'no sé'), m(5, 'somos 2')];
    expect(destinos(duda, vs)).toEqual([[2, 'T1 26 100'], [4, null], [5, null]]);
    expect(pendienteDeLaCaja(reparto(duda, vs).segmentos)).toMatchObject({ tipo: 'eleccion', candidatos: [{ id: 'v1' }], conContenido: true });
    expect(textoNoEntendiEleccion('Lusia', [vs[1]])).toBe('No entendí. ¿De qué viaje es «Lusia»?\n1. Luisa Mejía (T1 26 101)\nResponde con el número, NUEVO y el nombre si es un cliente nuevo, o DESCARTAR. Hasta entonces no asigno lo que sigue.');
  });
});

describe('4 · escritos coloquiales contra nombres sintéticos', () => {
  // Las 70 nuevas del QA v6 (banco.ts), sin los nombres de pila y sin «nuevo»/«nueva» (punto 2).
  const NUEVAS = ['ufff', 'uff', 'jajaja', 'jejeje', 'jajajaja', 'buenísimo', 'buenisima', 'ahí te va', 'ahi va', 'este', 'de este', 'perfecto gracias',
    'gracias Tati', '👍', '🙏', '😂', '✅', 'ok 👍', 'listo 🙌', 'ya quedó', 'quedó', 'mándame', 'espérame', 'un segundo', 'dame un minuto', 'súper bien',
    'chévere', 'bacano', 'de nada', 'okis', 'oka', 'vamos bien', 'seguimos', 'continúo', 'ahora sí', 'eso es', 'así es', 'tal cual', 'exacto gracias',
    'sale', 'hágale', 'listo pues', 'bueno pues', 'mmm', 'aja', 'ajá', 'esa', 'otro más', 'el otro', 'la otra', 'todo bien', 'qué pena', 'disculpa',
    'perdón', 'ok gracias', 'confirmadísimo', 'ya mismo', 'en camino', 'revisa', 'mira esto', 'te cuento', 'adelante', 'siguiente', 'el siguiente', 'Tati'];
  const APELLIDOS = ['GARCÍA', 'GÓMEZ', 'PÉREZ', 'TORRES', 'ROJAS', 'MORA', 'LUGO', 'OTERO', 'CLARO', 'BUENO', 'VALE', 'LUNA', 'PAZ', 'GRACIA', 'MIRANDA',
    'NUEVO', 'NOVOA', 'ESTEBAN', 'SALE', 'TAL', 'REVISA', 'ADELANTE', 'SEGUNDO', 'CHEVERE', 'PENA', 'TATI', 'MAÑANA', 'HOYOS', 'LUENGAS'];
  const NOMBRES = ['MARIANA', 'CLARA', 'MARIO', 'ESPERANZA', 'GRACIELA', 'OLGA', 'LINA', 'ESTEBAN', 'SEGUNDO'];
  const conjuntos: Array<[string, ViajeAbierto[]]> = [
    ['«CLIENTE X»', viajes(APELLIDOS.map(a => `CLIENTE ${a}`))],
    ['solo el apellido', viajes(APELLIDOS)],
    ['nombre + apellido', viajes(NOMBRES.flatMap(n => APELLIDOS.map(a => `${n} ${a}`)))],
  ];

  it.each(conjuntos)('ninguna mueve, pregunta ni corta (%s)', (_t, vs) => {
    // Un cliente que se llama exactamente «Tati» gana sobre el apodo del equipo (ajuste antes del QA v7).
    const tatiEsCliente = vs.some(v => /^(CLIENTE )?TATI$/.test(String(v.cliente)));
    expect(NUEVAS.map(w => [w, efecto(w, vs)]).filter(([w, e]) => e !== null && !(w === 'Tati' && tatiEsCliente && e === 'viaje'))).toEqual([]);
  });

  it('dos palabras de la lista juntas, en cualquier orden, tampoco', () => {
    const vs = conjuntos[2][1];
    const lista = [...PALABRAS_COMUNES].filter((_, i) => i % 3 === 0);
    const con: string[] = [];
    for (const a of lista) for (const b of lista) if (efecto(`${a} ${b}`, vs) !== null) con.push(`${a} ${b}`);
    expect(con).toEqual([]);
  });
});
