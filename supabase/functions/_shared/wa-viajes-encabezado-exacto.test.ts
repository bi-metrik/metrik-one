/**
 * QA de #971 v5 · solo un encabezado EXACTO cambia la caja.
 *   a. Exacto (código, nombre de pila, nombre + apellido): cambia la caja y el bot avisa «📌 …».
 *   b. Aproximado («Lusia», «Jorje»), solo el apellido o el destino: no cambia la caja; el bot
 *      pregunta «¿Cambias a…? sí/no» y lo que sigue queda sin asignar hasta el «sí».
 *   c. Los nombres del equipo (staff y colaboradores) nunca son candidatos.
 *   d. Las palabras comunes de un comercial nunca son encabezado.
 * Todos los nombres de este archivo son SINTÉTICOS (apellidos y nombres comunes en Colombia).
 */
import { describe, expect, it } from 'vitest';
import {
  armarPlan,
  armarSegmentos,
  esNo,
  esSi,
  pareceEncabezado,
  resolverEncabezado,
  respuestaAlEncabezado,
  type MensajeViaje,
  type ViajeAbierto,
} from './wa-viajes-reglas.ts';

// Los 60 escritos cortos de banco50.ts del QA v5.
const BANCO = ['gracias', 'listo ya', 'perfecto', 'dale', 'claro', 'ok va', 'ya', 'va', 'ok', 'listo', 'bueno', 'vale', 'genial', 'super',
  'excelente', 'de una', 'con gusto', 'a la orden', 'ya casi', 'espera', 'un momento', 'ahorita', 'pendiente', 'confirmado', 'confirmo',
  'también', 'este también', 'del mismo', 'el mismo', 'ese mismo', 'igual', 'sigue', 'mira', 'ojo', 'urgente', 'importante', 'otro', 'otra',
  'más', 'falta', 'ya está', 'enviado', 'recibido', 'anotado', 'entendido', 'mañana', 'hoy', 'luego', 'después', 'gracias mil',
  'muchas gracias', 'buen día', 'buenas tardes', 'hola', 'cotizado', 'pagado', 'reservado', 'Tatiana', 'Edgar', 'cliente'];
const APELLIDOS = ['GARCÍA', 'GÓMEZ', 'RODRÍGUEZ', 'MARTÍNEZ', 'LÓPEZ', 'GONZÁLEZ', 'HERNÁNDEZ', 'PÉREZ', 'SÁNCHEZ', 'RAMÍREZ', 'TORRES',
  'FLÓREZ', 'DÍAZ', 'VARGAS', 'ROJAS', 'CASTRO', 'MORENO', 'JIMÉNEZ', 'ORTIZ', 'RUIZ', 'SUÁREZ', 'MUÑOZ', 'ROMERO', 'HERRERA', 'MEDINA',
  'AGUILAR', 'CARDONA', 'RESTREPO', 'OSORIO', 'RÍOS', 'MEJÍA', 'VALENCIA', 'CASTILLO', 'GUERRERO', 'QUINTERO', 'PARRA', 'SALAZAR', 'MORA',
  'OSPINA', 'ARANGO', 'GIRALDO', 'ZAPATA', 'CORREA', 'BEDOYA', 'MARÍN', 'SERNA', 'LONDOÑO', 'VÉLEZ', 'MONTOYA', 'ACOSTA', 'BENÍTEZ',
  'CLARO', 'PERFECTO', 'BUENO', 'DALE', 'LUGO', 'VALE', 'SUPER', 'LUNA', 'PAZ', 'GRACIA', 'OTERO', 'SIGUENZA', 'IGUARÁN', 'MIRANDA',
  'URIBE', 'HOYOS', 'LUENGAS', 'DESPAIGNE', 'MAÑANA'];
const NOMBRES = ['MARIANA', 'CLARA', 'MARIO', 'SERGIO', 'GLORIA', 'ESPERANZA', 'DOLORES', 'MERCEDES', 'GRACIELA', 'GRACIA', 'OLGA', 'LINA',
  'TATIANA', 'EDGAR', 'TATIANO', 'EDGARDO'];
/** Quienes escriben al bot en el workspace (staff y colaboradores). */
const EQUIPO = ['Tatiana Quiroga', 'Edgar Lozada'];

const viajes = (nombres: string[]): ViajeAbierto[] => nombres.map((c, i) => ({ id: `v${i}`, codigo: `T1 26 ${100 + i}`, cliente: c, destino: null }));
const t = (min: number) => new Date(Date.parse('2026-10-01T14:00:00Z') + min * 60_000).toISOString();
const m = (n: number, cuerpo: string): MensajeViaje => ({ n, cuerpo, reenviado: true, tipo: 'text', en: t(n) });
const enc = (n: number, cuerpo: string): MensajeViaje => ({ n, cuerpo, reenviado: false, tipo: 'text', en: t(n) });
const efecto = (w: string, vs: ViajeAbierto[], equipo = EQUIPO) =>
  resolverEncabezado(w, vs, equipo)?.tipo ?? (pareceEncabezado(w, vs, equipo) ? 'corta' : null);

describe('d · banco50 contra nombres sintéticos: ningún escrito común mueve, pregunta ni corta la caja', () => {
  const conjuntos: Array<[string, ViajeAbierto[]]> = [
    ['«CLIENTE X», como banco50', viajes(APELLIDOS.map(a => `CLIENTE ${a}`))],
    ['nombre + apellido', viajes(NOMBRES.flatMap((n, i) => APELLIDOS.slice(i * 4, i * 4 + 6).map(a => `${n} ${a}`)))],
    ['apellido + nombre', viajes(NOMBRES.flatMap((n, i) => APELLIDOS.slice(i * 3, i * 3 + 5).map(a => `${a} ${n}`)))],
    ['solo el apellido', viajes(APELLIDOS)],
  ];
  it.each(conjuntos)('%s', (_t, vs) => {
    expect(BANCO.map(w => [w, efecto(w, vs)]).filter(([, e]) => e !== null)).toEqual([]);
  });

  it('dentro de una caja, ninguno cambia el viaje de lo que sigue', () => {
    const vs = viajes(['CAROLINA RUIZ', 'MARIO BUENO', 'GRACIA OTERO', 'JUAN CLARO', 'TATIANA RÍOS', 'EDGAR VARGAS', 'LINA MORA']);
    for (const w of BANCO) {
      const { segmentos, encabezados } = armarSegmentos([enc(1, 'Carolina'), m(2, 'salimos el 28'), enc(3, w), m(4, 'somos 3 adultos')], vs, { horasCajaActiva: 4, equipo: EQUIPO });
      expect([encabezados, segmentos.map(s => s.mensajes)], w).toEqual([[1], [[2, 3, 4]]]);
    }
  });
});

describe('a y b · exacto cambia la caja; aproximado pregunta', () => {
  const vs = viajes(['GRACIA OTERO', 'MARIO BUENO', 'LUISA MEJÍA', 'CAROLINA RUIZ']);

  it('el nombre de pila (con o sin apellido) o el código cambian la caja', () => {
    expect(resolverEncabezado('Gracia', vs, EQUIPO)).toMatchObject({ tipo: 'viaje', viaje: { id: 'v0' }, por: 'nombre' });
    expect(resolverEncabezado('Mario Bueno', vs, EQUIPO)).toMatchObject({ tipo: 'viaje', viaje: { id: 'v1' }, por: 'nombre' });
    expect(resolverEncabezado('T1 26 102', vs, EQUIPO)).toMatchObject({ tipo: 'viaje', viaje: { id: 'v2' }, por: 'codigo' });
  });

  it('el apellido solo, un error de tipeo o el destino preguntan', () => {
    expect(resolverEncabezado('Otero', vs, EQUIPO)).toMatchObject({ tipo: 'aproximado', viaje: { id: 'v0' }, por: 'apellido' });
    expect(resolverEncabezado('Lusia', vs, EQUIPO)).toMatchObject({ tipo: 'aproximado', viaje: { id: 'v2' }, por: 'nombre' });
    expect(resolverEncabezado('Jorje', viajes(['JORGE PÉREZ']), EQUIPO)).toMatchObject({ tipo: 'aproximado', viaje: { id: 'v0' } });
    expect(resolverEncabezado('la de punta cana', [{ id: 'p', codigo: 'T1 26 9', cliente: 'ANA ROJAS', destino: 'PUNTA CANA' }], EQUIPO))
      .toMatchObject({ tipo: 'aproximado', por: 'destino' });
    // «bueno» es una palabra común: aunque el cliente se apellide Bueno, no es encabezado.
    expect(resolverEncabezado('bueno', vs, EQUIPO)).toBeNull();
  });

  it('lo que el bot contesta en el acto', () => {
    expect(respuestaAlEncabezado(resolverEncabezado('Carolina', vs))).toBe('📌 Carolina Ruiz (T1 26 103)');
    // Trappvel 2026-10-02: el aproximado pregunta con la lista numerada (nunca «¿Cambias a…? sí/no»).
    expect(respuestaAlEncabezado(resolverEncabezado('Lusia', vs), 'Lusia')).toBe('¿De qué viaje es «Lusia»?\n1. Luisa Mejía (T1 26 102)\nResponde con el número, NUEVO y el nombre si es un cliente nuevo, o DESCARTAR. Hasta entonces no asigno lo que sigue.');
    expect(respuestaAlEncabezado(resolverEncabezado('nuevo Pedro', vs))).toBe('📌 NUEVO Pedro');
    expect(respuestaAlEncabezado(null)).toBeNull();
    expect([esNo('no'), esNo('No.'), esNo('no, la de Carolina'), esSi('sí'), esSi('sí, pero')]).toEqual([true, true, false, true, false]);
  });

  it('sin elegir, lo que sigue al aproximado queda sin asignar; con el número, va a su viaje; «sí» o «no» no eligen ni son contenido', () => {
    const base = [enc(1, 'Carolina'), m(2, 'salimos el 28 de diciembre'), enc(3, 'Lusia'), m(4, 'el hotel con desayuno'), m(5, 'somos 2')];
    const reparto = (ms: MensajeViaje[]) => {
      const { segmentos, encabezados } = armarSegmentos(ms, vs, { horasCajaActiva: 4, equipo: EQUIPO });
      return armarPlan({ mensajes: ms, viajes: vs, segmentos, encabezados }).mensajes.map(x => [x.n, x.destino?.tipo === 'existente' ? x.destino.codigo : null]);
    };
    expect(reparto(base)).toEqual([[2, 'T1 26 103'], [4, null], [5, null]]);
    expect(reparto([...base, enc(6, '1')])).toEqual([[2, 'T1 26 103'], [4, 'T1 26 102'], [5, 'T1 26 102']]);
    expect(reparto([...base.slice(0, 3), enc(4, '1'), m(5, 'el hotel con desayuno')])).toEqual([[2, 'T1 26 103'], [5, 'T1 26 102']]);
    expect(reparto([...base, enc(6, 'sí')])).toEqual([[2, 'T1 26 103'], [4, null], [5, null]]);
    expect(reparto([...base, enc(6, 'no')])).toEqual([[2, 'T1 26 103'], [4, null], [5, null]]);
    expect(reparto([...base.slice(0, 3), enc(4, 'Sí'), m(5, 'el hotel con desayuno')])).toEqual([[2, 'T1 26 103'], [5, null]]);
  });
});

describe('c · el nombre de alguien del equipo nunca es candidato', () => {
  const vs = viajes(['TATIANA RÍOS', 'EDGAR VARGAS', 'MARIANA SERNA']);

  it('«Tatiana» y «Edgar» no resuelven ni cortan, aunque haya un negocio a su nombre', () => {
    for (const w of ['Tatiana', 'Edgar', 'Tatiana Quiroga', 'Edgar Lozada']) expect(efecto(w, vs), w).toBeNull();
    // Sin la lista del equipo, «Tatiana» resolvía al negocio a su nombre (el caso del QA v5).
    expect(resolverEncabezado('Tatiana', vs)).toMatchObject({ tipo: 'viaje', viaje: { id: 'v0' } });
  });

  it('con su apellido, el negocio de una clienta que se llama como alguien del equipo sí se puede nombrar', () => {
    expect(resolverEncabezado('Tatiana Ríos', vs, EQUIPO)).toMatchObject({ tipo: 'viaje', viaje: { id: 'v0' } });
  });
});
