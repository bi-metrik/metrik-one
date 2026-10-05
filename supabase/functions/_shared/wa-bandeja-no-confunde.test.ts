/**
 * Trappvel, 2026-10-02 (brief-max-2026-10-02-bandeja-no-confunde-clientes.md): la bandeja no pega
 * mensajes al viaje de otro cliente. Reglas sueltas, sin base. La secuencia completa del comercial va
 * en `wa-bandeja-vivo.test.ts`. Todos los nombres son SINTÉTICOS.
 *   1. Un viaje existente solo con evidencia exacta; otro nombre de pila con el mismo apellido no es
 *      candidato; el tipeo del MISMO nombre y el apellido solo se preguntan con la lista numerada.
 *   2. «Nuevo» en cualquier forma; «otro cliente» sin nombre pide el nombre.
 *   3. La respuesta a la pregunta abierta, según lo que espera.
 *   4. «descartar» / «cancelar» en cualquier forma.
 */
import { describe, expect, it } from 'vitest';
import {
  armarPlan,
  armarSegmentos,
  esRespuestaA,
  pareceRespuesta,
  leerEleccion,
  resolverEncabezado,
  respuestaAlEncabezado,
  TEXTO_PIDE_NOMBRE_NUEVO,
  type MensajeViaje,
  type ViajeAbierto,
} from './wa-viajes-reglas.ts';
import { leerNuevo, MAX_PALABRAS_NOMBRE_NUEVO, nombreNuevoCabe } from './wa-entendimiento-reglas.ts';
import { interpretarRespuestaNegocio } from './wa-carga-reglas.ts';
import { esDescartarTodo } from './wa-bandeja-reglas.ts';

const LINA: ViajeAbierto = { id: 'lina', codigo: 'L1 26 1', cliente: 'LINA PÉREZ', destino: 'CARTAGENA', nombre: 'L1 CTG ENE 27' };
const LUISA: ViajeAbierto = { id: 'luisa', codigo: 'L 26 4', cliente: 'LUISA GÓMEZ', destino: 'SAN ANDRÉS', nombre: null };
const PEDRO: ViajeAbierto = { id: 'pedro', codigo: 'P 26 2', cliente: 'PEDRO GÓMEZ', destino: 'ARUBA', nombre: null };
const PIE = 'Responde con el número, NUEVO y el nombre si es un cliente nuevo, o DESCARTAR. Hasta entonces no asigno lo que sigue.';

describe('regla 2 · «nuevo» en cualquier forma', () => {
  it.each([
    ['cliente nuevo Daniel Pérez', 'Daniel Pérez'],
    ['Cliente nuevo: Daniel Pérez', 'Daniel Pérez'],
    ['nuevo cliente Daniel Pérez', 'Daniel Pérez'],
    ['es nuevo Daniel Pérez', 'Daniel Pérez'],
    ['nueva clienta Ana Gómez', 'Ana Gómez'],
    ['cliente nueva Ana Gómez', 'Ana Gómez'],
    ['es una clienta nueva Ana Gómez', 'Ana Gómez'],
    ['nuevo Daniel Pérez', 'Daniel Pérez'],
    ['NUEVO daniel perez', 'daniel perez'],
  ])('«%s» → NUEVO %s, aunque haya un viaje abierto de alguien con el mismo apellido', (texto, cliente) => {
    expect(resolverEncabezado(texto, [LINA, LUISA])).toMatchObject({ tipo: 'nuevo', cliente });
    // No es candidato del viaje de la otra persona; el acuse dice que se parece (2026-10-03) y que se crea con el «sí».
    const acuse = respuestaAlEncabezado(resolverEncabezado(texto, [LINA, LUISA]))!;
    expect(acuse.split('\n')[0]).toBe(`Va como viaje nuevo de ${cliente}. Antes del resumen reviso si ya es cliente.`);
    expect(acuse.split('\n')[1]).toBe(/p[eé]rez/i.test(cliente) ? 'Ya hay un viaje de Lina Pérez (L1 26 1): si es para ese, escribe L1 26 1.' : 'Ya hay un viaje de Luisa Gómez (L 26 4): si es para ese, escribe L 26 4.');
  });

  it.each(['otro cliente', 'Otra clienta', 'otro cliente.', 'cambio de cliente', 'cliente nuevo', 'nuevo cliente', 'nueva', 'es otro cliente'])(
    '«%s» sin nombre pide el nombre (y no es contenido)', texto => {
      expect(resolverEncabezado(texto, [LINA])).toEqual({ tipo: 'nuevo', cliente: null });
      expect(respuestaAlEncabezado(resolverEncabezado(texto, [LINA]))).toBe(TEXTO_PIDE_NOMBRE_NUEVO);
    },
  );

  it('«otro cliente X»: X exacto es su viaje; un nombre que no está, un NUEVO', () => {
    expect(resolverEncabezado('otro cliente Lina Pérez', [LINA])).toMatchObject({ tipo: 'viaje', viaje: { id: 'lina' } });
    expect(resolverEncabezado('otro cliente: Daniel Pérez', [LINA])).toEqual({ tipo: 'nuevo', cliente: 'Daniel Pérez', parecidos: [LINA] });
    expect(resolverEncabezado('otro cliente: Daniel Rojas', [LINA])).toEqual({ tipo: 'nuevo', cliente: 'Daniel Rojas' });
  });

  it('lo que no es un «nuevo» no lo es: «nuevos precios», una nota larga, «el cliente nuevo» en una frase', () => {
    expect(leerNuevo('nuevos precios')).toBeNull();
    expect(leerNuevo('el cliente nuevo quiere playa')).toBeNull();
    expect(resolverEncabezado('nuevo Daniel quiere ir a Cartagena en diciembre', [LINA])).toBeNull();
  });

  it('la misma lectura contesta «¿A qué viaje van?» y «¿cuál contacto?»', () => {
    expect(interpretarRespuestaNegocio('cliente nuevo Daniel Pérez', [])).toEqual({ tipo: 'nuevo', cliente: 'Daniel Pérez' });
    expect(interpretarRespuestaNegocio('otro cliente', [])).toEqual({ tipo: 'nuevo', cliente: null });
  });
});

describe('regla 2b · «nuevo …» como respuesta a la lista tiene el tope del encabezado (control de Vera, I3)', () => {
  const OPS = [{ id: 'lina', codigo: 'L1 26 1', cliente: 'LINA PÉREZ', destino: 'CARTAGENA' }];

  it('una sola constante: el encabezado y la respuesta a la lista cortan en el mismo número de palabras', () => {
    expect(MAX_PALABRAS_NOMBRE_NUEVO).toBe(4);
    expect(nombreNuevoCabe('Ana María Gómez Ruiz')).toBe(true);
    expect(nombreNuevoCabe('cotización con hotel 4 estrellas')).toBe(false);
    expect(nombreNuevoCabe(null)).toBe(true);
  });

  it.each([
    'nueva cotización con hotel 4 estrellas',
    'nuevo plan para la familia de cinco personas',
    'Nueva solicitud: tiquetes y hotel para diciembre',
  ])('«%s» no crea un cliente: no se entiende y el bot vuelve a preguntar con la lista', texto => {
    expect(interpretarRespuestaNegocio(texto, OPS)).toEqual({ tipo: 'no_entendida' });
    expect(interpretarRespuestaNegocio(texto, [])).toEqual({ tipo: 'no_entendida' });
    // Tampoco es un encabezado (ya no lo era): no abre «NUEVO cotización con hotel…».
    expect(resolverEncabezado(texto, [LINA])).toBeNull();
    // Sigue teniendo forma de respuesta: contesta la pregunta (se re-pregunta), no queda como contenido.
    expect(pareceRespuesta(texto)).toBe(true);
    expect(esRespuestaA('viaje', texto)).toBe(true);
  });

  it.each([
    ['nuevo', null],
    ['cliente nuevo', null],
    ['nueva Daniela Rojas', 'Daniela Rojas'],
    ['nuevo: Juan Pablo Gómez Ruiz', 'Juan Pablo Gómez Ruiz'],
    ['NUEVO Ana María Gómez Ruiz', 'Ana María Gómez Ruiz'],
  ])('«%s» sigue igual: NUEVO %s', (texto, cliente) => {
    expect(interpretarRespuestaNegocio(texto, OPS)).toEqual({ tipo: 'nuevo', cliente });
    expect(resolverEncabezado(texto, [LINA])).toEqual({ tipo: 'nuevo', cliente });
  });
});

describe('regla 1 · un viaje existente solo con evidencia exacta', () => {
  it('código, nombre + apellido y nombre del negocio, tal cual: el viaje', () => {
    expect(resolverEncabezado('L1 26 1', [LINA])).toMatchObject({ tipo: 'viaje', viaje: { id: 'lina' }, por: 'codigo' });
    expect(resolverEncabezado('Lina Pérez', [LINA])).toMatchObject({ tipo: 'viaje', viaje: { id: 'lina' }, por: 'nombre' });
    expect(resolverEncabezado('l1 ctg ene 27', [LINA])).toMatchObject({ tipo: 'viaje', viaje: { id: 'lina' }, por: 'negocio' });
  });

  it('otro nombre de pila con el mismo apellido NO es candidato, ni aproximado', () => {
    expect(resolverEncabezado('Daniel Pérez', [LINA])).toBeNull();
    expect(resolverEncabezado('Daniel Martínez Pérez', [LINA])).toBeNull();
    expect(resolverEncabezado('Ana Gómez', [LUISA, PEDRO])).toBeNull();
    // Un tipeo del nombre de pila con OTRO apellido tampoco.
    expect(resolverEncabezado('Lusia Pérez', [LUISA, LINA])).toBeNull();
  });

  it('el tipeo del MISMO nombre completo se pregunta con la lista numerada (un solo candidato, nunca sí/no)', () => {
    const r = resolverEncabezado('Lusia Gómez', [LUISA, LINA]);
    expect(r).toMatchObject({ tipo: 'aproximado', viaje: { id: 'luisa' }, por: 'nombre' });
    expect(respuestaAlEncabezado(r, 'Lusia Gómez')).toBe(`¿De qué viaje es «Lusia Gómez»?\n1. Luisa Gómez (L 26 4)\n${PIE}`);
  });

  it('solo el apellido con UN viaje: la lista numerada con NUEVO, nunca en silencio ni sí/no', () => {
    const r = resolverEncabezado('Pérez', [LINA, LUISA]);
    expect(r).toMatchObject({ tipo: 'aproximado', viaje: { id: 'lina' }, por: 'apellido' });
    expect(respuestaAlEncabezado(r, 'Pérez')).toBe(`¿De qué viaje es «Pérez»?\n1. L1 CTG ENE 27 · Lina Pérez (L1 26 1)\n${PIE}`);
  });

  it('solo el apellido con DOS viajes: la lista numerada con los dos', () => {
    const r = resolverEncabezado('Gómez', [LUISA, PEDRO, LINA]);
    expect(r).toMatchObject({ tipo: 'ambiguo', candidatos: [{ id: 'luisa' }, { id: 'pedro' }] });
    expect(respuestaAlEncabezado(r, 'Gómez')).toBe(`¿De qué viaje es «Gómez»?\n1. Luisa Gómez (L 26 4)\n2. Pedro Gómez (P 26 2)\n${PIE}`);
  });

  it('en la tanda, la elección es el número; el «sí» no elige y no es contenido; lo demás queda sin asignar', () => {
    const t = (min: number) => new Date(Date.parse('2026-10-02T14:00:00Z') + min * 60_000).toISOString();
    const enc = (n: number, cuerpo: string): MensajeViaje => ({ n, cuerpo, reenviado: false, tipo: 'text', en: t(n) });
    const m = (n: number, cuerpo: string): MensajeViaje => ({ n, cuerpo, reenviado: true, tipo: 'text', en: t(n) });
    const plan = (ms: MensajeViaje[]) => {
      const vs = [LUISA, PEDRO];
      const { segmentos, encabezados } = armarSegmentos(ms, vs, { horasCajaActiva: 4 });
      return armarPlan({ mensajes: ms, viajes: vs, segmentos, encabezados });
    };
    const destinos = (ms: MensajeViaje[]) => plan(ms).mensajes.map(x => [x.n, x.destino?.tipo === 'existente' ? x.destino.negocio_id : null]);
    expect(destinos([enc(1, 'Gómez'), enc(2, 'si'), m(3, 'somos 2'), enc(4, '2'), m(5, 'del 3 al 8')])).toEqual([[3, 'pedro'], [5, 'pedro']]);
    expect(plan([enc(1, 'Gómez'), enc(2, 'si'), m(3, 'somos 2')]).encabezados).toEqual([1, 2]);
    expect(destinos([enc(1, 'Gómez'), enc(2, '7'), m(3, 'somos 2')])).toEqual([[3, null]]);
  });
});

describe('regla 3 · la respuesta a la pregunta abierta, según lo que espera', () => {
  it('el resumen: sí/no, números, correcciones; un nombre suelto no (abre caja)', () => {
    for (const x of ['sí', 'no', '2', '1 y 3', 'el 2 es de Luisa', 'el 2 es nuevo Pedro', 'dejar todos', 'descartar el 3', 'corregir']) {
      expect(esRespuestaA('resumen', x), x).toBe(true);
    }
    for (const x of ['Carolina', 'nuevo Diego', 'Quiero un viaje a Aruba para 2']) expect(esRespuestaA('resumen', x), x).toBe(false);
  });

  it('«¿A qué viaje van?»: número, código, nombre corto, NUEVO; un texto largo no', () => {
    for (const x of ['2', 'P 26 2', 'Pedro Gómez', 'nuevo Daniel Pérez', 'sí']) expect(esRespuestaA('viaje', x), x).toBe(true);
    expect(esRespuestaA('viaje', 'Hola, queremos ir a Cartagena del 12 al 16 de diciembre')).toBe(false);
  });

  it('«¿es el mismo?» / «¿lo creo?»: sí/no, número, celular, NUEVO a secas; «nuevo X» abre su caja', () => {
    for (const x of ['sí', 'no', '1', '300 555 1234', 'NUEVO']) expect(esRespuestaA('otra', x), x).toBe(true);
    expect(esRespuestaA('otra', 'nuevo Diego Gómez')).toBe(false);
  });

  it('la elección de la lista del encabezado', () => {
    expect(['1', '2.', 'el 2', ' 3 ', 'la 1'].map(leerEleccion)).toEqual([1, 2, 2, 3, 1]);
    expect(['sí', 'uno', '2 adultos', ''].map(leerEleccion)).toEqual([null, null, null, null]);
  });
});

describe('regla 4 · «descartar» en cualquier forma', () => {
  it.each(['descartar', 'DESCARTAR', 'Descartar.', 'descártalo', 'Descartar todo', 'cancelar', 'Cancelar!', 'cancelar todo'])('«%s» descarta todo', x => {
    expect(esDescartarTodo(x)).toBe(true);
  });
  it.each(['descartar el 3', 'descartar los sospechosos', 'no descartes', 'cancelado', 'hay que descartar el hotel'])('«%s» no', x => {
    expect(esDescartarTodo(x)).toBe(false);
  });
});
