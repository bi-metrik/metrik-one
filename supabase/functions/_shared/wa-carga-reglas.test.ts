import { describe, expect, it } from 'vitest';
import {
  armarOpcionesNegocio,
  cargarEnExistente,
  CLAVE_CONFLICTOS,
  codigoCompacto,
  interpretarRespuestaNegocio,
  mensajeCargaExistente,
  nombraAlCliente,
  origenDeFrase,
  primerNombre,
  textoPreguntaNegocio,
  trazaCarga,
  type NegocioAbierto,
  type OpcionNegocio,
} from './wa-carga-reglas.ts';
import { instruccionesEntendimiento, type CampoEntendible } from './wa-entendimiento-reglas.ts';

// Config sintética con la forma de la solicitud de viaje (slugs y tipos, sin datos de clientes).
const FIELDS: CampoEntendible[] = [
  { slug: 'destino', tipo: 'texto', label: 'Destino', nivel: 'minimo', pregunta: '¿A dónde quieren viajar?' },
  { slug: 'fecha_salida', tipo: 'fecha', label: 'Salida', nivel: 'minimo', pregunta: '¿Qué día salen?' },
  { slug: 'fecha_regreso', tipo: 'fecha', label: 'Regreso', nivel: 'minimo', pregunta: '¿Qué día regresan?' },
  { slug: 'adultos', tipo: 'numero', label: 'Adultos', nivel: 'minimo', pregunta: '¿Cuántos adultos?' },
  { slug: 'ninos', tipo: 'numero', label: 'Niños', nivel: 'minimo', pregunta: '¿Viajan niños?', default: 0 },
  { slug: 'numero_pasajeros', tipo: 'numero', label: 'Pasajeros', suma_de: ['adultos', 'ninos'] },
  { slug: 'categoria', tipo: 'select', label: 'Hotel', opciones: [{ value: 'cuatro', label: '4 estrellas' }, { value: 'cinco', label: '5 estrellas' }] },
];

function neg(id: string, p: Partial<NegocioAbierto> = {}): NegocioAbierto {
  return { id, codigo: `T1 26 ${id}`, cliente: `CLIENTE ${id}`, cliente_id: `c${id}`, destino: null, created_at: `2026-09-${id.padStart(2, '0')}T12:00:00Z`, del_remitente: false, ...p };
}

describe('la lista de «¿A qué viaje van?»', () => {
  it('los del remitente, del más reciente al más viejo, máximo cinco', () => {
    const negocios = [
      ...['1', '2', '3', '4', '5', '6', '7'].map(i => neg(i, { del_remitente: true })),
      neg('20'), // de otro comercial, más reciente: no entra
    ];
    const ops = armarOpcionesNegocio(negocios, 'hola');
    expect(ops.map(o => o.id)).toEqual(['7', '6', '5', '4', '3']);
  });

  it('si el remitente no es responsable de ninguno, se ofrecen todos los de la línea', () => {
    const ops = armarOpcionesNegocio([neg('1'), neg('2')], 'hola');
    expect(ops.map(o => o.id)).toEqual(['2', '1']);
  });

  it('sin negocios abiertos no hay opciones y la pregunta solo ofrece NUEVO', () => {
    const ops = armarOpcionesNegocio([], 'hola');
    expect(ops).toEqual([]);
    const t = textoPreguntaNegocio({ nMensajes: 3, opciones: ops });
    expect(t).toContain('Recibí 3 mensajes.');
    expect(t).toContain('NUEVO');
    expect(t).not.toMatch(/^1\./m);
  });

  it('un cliente nombrado con UN negocio abierto va primero, marcado como propuesto (aunque no sea del remitente)', () => {
    const negocios = [
      neg('1', { del_remitente: true }),
      neg('2', { del_remitente: true }),
      neg('3', { cliente: 'MARTA GÓMEZ', cliente_id: 'marta' }),
    ];
    const ops = armarOpcionesNegocio(negocios, 'Audio: habla marta gomez, que siempre sí van los niños');
    expect(ops.map(o => o.id)).toEqual(['3', '2', '1']);
    expect(ops[0].propuesto).toBe(true);
    const t = textoPreguntaNegocio({ nMensajes: 2, opciones: ops });
    expect(t).toContain('Parece de MARTA GÓMEZ: es la 1.');
    expect(t).toContain('1. T1 26 3 · MARTA GÓMEZ');
  });

  it('si el cliente nombrado tiene DOS negocios abiertos no se propone ninguno', () => {
    const negocios = [
      neg('1', { cliente: 'MARTA GÓMEZ', cliente_id: 'marta', del_remitente: true }),
      neg('2', { cliente: 'MARTA GÓMEZ', cliente_id: 'marta', del_remitente: true }),
    ];
    const ops = armarOpcionesNegocio(negocios, 'marta gómez');
    expect(ops.some(o => o.propuesto)).toBe(false);
  });

  it('un solo nombre de pila no basta para proponer', () => {
    expect(nombraAlCliente('hola, habla Marta', 'MARTA GÓMEZ')).toBe(false);
    expect(nombraAlCliente('la señora Gómez, Marta', 'MARTA GÓMEZ')).toBe(true);
    expect(nombraAlCliente('marta', 'MARTA')).toBe(false);
  });

  it('cada opción: código · cliente · destino', () => {
    const ops = armarOpcionesNegocio([neg('14', { cliente: 'MARTA GÓMEZ', destino: 'Punta Cana', del_remitente: true })], '');
    expect(textoPreguntaNegocio({ nMensajes: 1, opciones: ops })).toContain('1. T1 26 14 · MARTA GÓMEZ · Punta Cana');
  });
});

describe('la respuesta: número, código o NUEVO', () => {
  const ops: OpcionNegocio[] = [
    { id: 'a', codigo: 'T1 26 14', cliente: 'MARTA', destino: null },
    { id: 'b', codigo: 'S1 26 3', cliente: 'LUIS', destino: null },
  ];

  it('por número', () => {
    expect(interpretarRespuestaNegocio('2', ops)).toEqual({ tipo: 'existente', negocio_id: 'b' });
    expect(interpretarRespuestaNegocio(' 1. ', ops)).toEqual({ tipo: 'existente', negocio_id: 'a' });
    expect(interpretarRespuestaNegocio('3', ops)).toEqual({ tipo: 'no_entendida' });
    expect(interpretarRespuestaNegocio('0', ops)).toEqual({ tipo: 'no_entendida' });
  });

  it('por código, con o sin espacios ni mayúsculas', () => {
    expect(interpretarRespuestaNegocio('T1 26 14', ops)).toEqual({ tipo: 'existente', negocio_id: 'a' });
    expect(interpretarRespuestaNegocio('t12614', ops)).toEqual({ tipo: 'existente', negocio_id: 'a' });
    expect(interpretarRespuestaNegocio('s1-26-3', ops)).toEqual({ tipo: 'existente', negocio_id: 'b' });
  });

  it('un código que no está en la lista se busca aparte', () => {
    expect(interpretarRespuestaNegocio('T1 26 9', ops)).toEqual({ tipo: 'codigo', codigo: 'T1269' });
  });

  it('NUEVO, solo o con el nombre del cliente', () => {
    expect(interpretarRespuestaNegocio('NUEVO', ops)).toEqual({ tipo: 'nuevo', cliente: null });
    expect(interpretarRespuestaNegocio('nuevo', [])).toEqual({ tipo: 'nuevo', cliente: null });
    expect(interpretarRespuestaNegocio('Nuevo: Marta Gómez 3001234567', ops)).toEqual({ tipo: 'nuevo', cliente: 'Marta Gómez 3001234567' });
  });

  it('un nombre suelto o un texto cualquiera no se adivina', () => {
    expect(interpretarRespuestaNegocio('Marta', ops)).toEqual({ tipo: 'no_entendida' });
    expect(interpretarRespuestaNegocio('el de punta cana', ops)).toEqual({ tipo: 'no_entendida' });
    expect(interpretarRespuestaNegocio('novedad', ops)).toEqual({ tipo: 'no_entendida' });
  });

  it('el código compacto', () => {
    expect(codigoCompacto('T1 26 14')).toBe('T12614');
    expect(codigoCompacto(null)).toBe('');
  });
});

describe('cargar en un negocio que ya existe', () => {
  const meta = { entrega_id: 'e2', en: '2026-09-30T15:00:00.000Z', origenDe: () => 'audio' as const };

  it('llena los campos vacíos con su marca de sugerido y recalcula la suma', () => {
    const data = { destino: 'PUNTA CANA', adultos: 2 };
    const r = cargarEnExistente(data, FIELDS, {
      fecha_salida: { valor: '2026-11-15', frase: 'el 15 de noviembre' },
      ninos: { valor: 1, frase: 'va el niño' },
    }, meta);
    expect(r.escritos).toEqual(['fecha_salida', 'ninos']);
    expect(r.data.fecha_salida).toBe('2026-11-15');
    expect(r.data.ninos).toBe(1);
    expect(r.data.numero_pasajeros).toBe(3);
    expect(r.data._sugeridos).toEqual({
      fecha_salida: { fuente: 'whatsapp', entrega_id: 'e2', frase: 'el 15 de noviembre', en: meta.en },
      ninos: { fuente: 'whatsapp', entrega_id: 'e2', frase: 'va el niño', en: meta.en },
    });
    expect(r.conflictos).toEqual([]);
  });

  it('un valor escrito por una persona NO se pisa: queda como conflicto', () => {
    const data = { destino: 'PUNTA CANA', fecha_salida: '2026-11-15', adultos: 2 };
    const r = cargarEnExistente(data, FIELDS, {
      fecha_salida: { valor: '2026-11-20', frase: 'mejor el 20 de noviembre' },
      adultos: { valor: 2, frase: 'somos dos' },
    }, meta);
    expect(r.data.fecha_salida).toBe('2026-11-15');
    expect(r.escritos).toEqual([]);
    expect(r.iguales).toEqual(['adultos']);
    expect(r.conflictos).toEqual([{ slug: 'fecha_salida', actual: '2026-11-15', valor: '2026-11-20', frase: 'mejor el 20 de noviembre' }]);
    expect(r.data[CLAVE_CONFLICTOS]).toEqual({
      fecha_salida: { fuente: 'whatsapp', entrega_id: 'e2', valor: '2026-11-20', frase: 'mejor el 20 de noviembre', en: meta.en, origen: 'audio' },
    });
    expect(r.data._sugeridos).toBeUndefined();
  });

  it('un valor todavía sugerido de una entrega anterior tampoco se pisa', () => {
    const data = { destino: 'CANCÚN', _sugeridos: { destino: { fuente: 'whatsapp', entrega_id: 'e1', frase: 'cancún', en: 'x' } } };
    const r = cargarEnExistente(data, FIELDS, { destino: { valor: 'Punta Cana', frase: 'punta cana' } }, meta);
    expect(r.data.destino).toBe('CANCÚN');
    expect(r.conflictos.map(c => c.slug)).toEqual(['destino']);
    expect(r.data._sugeridos).toEqual(data._sugeridos);
  });

  it('en un negocio vivo el default cuenta como valor (no se sabe si alguien lo dejó a propósito)', () => {
    const r = cargarEnExistente({ ninos: 0 }, FIELDS, { ninos: { valor: 2, frase: 'dos niños' } }, meta);
    expect(r.data.ninos).toBe(0);
    expect(r.conflictos.map(c => c.slug)).toEqual(['ninos']);
  });

  it('un campo que una persona vació con corrección registrada no se llena solo', () => {
    const r = cargarEnExistente({ destino: '', _ediciones: { destino: { por: 'x' } } }, FIELDS, { destino: { valor: 'Aruba', frase: 'aruba' } }, meta);
    expect(r.data.destino).toBe('');
    expect(r.conflictos.map(c => c.slug)).toEqual(['destino']);
  });

  it('el mismo valor dicho distinto (mayúsculas, tildes, número como texto) no es conflicto', () => {
    const r = cargarEnExistente({ destino: 'PUNTA CANA', adultos: '2' }, FIELDS, {
      destino: { valor: 'Punta Caná', frase: 'punta cana' },
      adultos: { valor: 2, frase: 'dos' },
    }, meta);
    expect(r.conflictos).toEqual([]);
    expect(r.iguales).toEqual(['destino', 'adultos']);
  });

  it('el texto nuevo del bloque de viaje entra en mayúscula; lo que ya estaba no se toca', () => {
    const r = cargarEnExistente({ adultos: 2, fecha_salida: '2026-11-15' }, FIELDS, { destino: { valor: 'Punta Cana', frase: 'punta cana' } }, meta);
    expect(r.data.destino).toBe('PUNTA CANA');
  });

  it('un slug que ya atendió otro bloque se salta', () => {
    const vistos = new Set(['destino']);
    const r = cargarEnExistente({}, FIELDS, { destino: { valor: 'Aruba', frase: 'aruba' } }, meta, vistos);
    expect(r.escritos).toEqual([]);
    expect(r.data.destino).toBeUndefined();
  });

  it('el origen de la frase: audio si salió de una transcripción', () => {
    const msgs = [{ cuerpo: 'hola', cuerpo_origen: 'texto' }, { cuerpo: 'Mejor el 20 de noviembre', cuerpo_origen: 'transcripcion' }];
    expect(origenDeFrase('mejor el 20 de noviembre', msgs)).toBe('audio');
    expect(origenDeFrase('hola', msgs)).toBe('mensaje');
  });
});

describe('lo que se cuenta', () => {
  it('la respuesta al comercial: qué se cargó, qué quedó en conflicto y hasta tres preguntas', () => {
    const m = mensajeCargaExistente({
      codigo: 'T1 26 14', fields: FIELDS,
      escritos: [{ slug: 'fecha_regreso', valor: '2026-11-27' }, { slug: 'categoria', valor: 'cinco' }],
      conflictos: [{ slug: 'fecha_salida', actual: '2026-11-15', valor: '2026-11-20', frase: 'x' }],
      faltanMinimo: [{ pregunta: 'P1' }, { pregunta: 'P2' }, { pregunta: 'P3' }, { pregunta: 'P4' }],
      enlace: 'https://t.x/negocios/1',
    });
    expect(m).toContain('Cargué en T1 26 14: regreso 27 nov, hotel 5 estrellas.');
    expect(m).toContain('No cambié un dato que ya tenía otro valor: salida (en ONE: 15 nov; el cliente dijo: 20 nov).');
    expect(m).toContain('3. P3');
    expect(m).not.toContain('P4');
    expect(m).toContain('https://t.x/negocios/1');
  });

  it('sin datos nuevos y con el mínimo completo', () => {
    const m = mensajeCargaExistente({ codigo: 'T1 26 14', fields: FIELDS, escritos: [], conflictos: [], faltanMinimo: [], enlace: 'L' });
    expect(m).toBe('No encontré datos nuevos para T1 26 14.\nYa está el mínimo para cotizar: L');
  });

  it('la traza de la actividad lleva quién, el día y la historia fechada debajo', () => {
    const t = trazaCarga({
      quien: primerNombre('TATIANA RUIZ'), fechaISO: '2026-09-30', escritos: ['ninos', 'fecha_regreso', 'categoria'],
      conflictos: [{ slug: 'fecha_salida', actual: 'a', valor: 'b', frase: '' }], fields: FIELDS, historia: 'La clienta confirmó que viaja el niño.',
    });
    expect(t.split('\n')[0]).toBe('Se cargaron 3 datos desde WhatsApp (Tatiana, 30-sep).');
    expect(t).toContain('En conflicto, sin cambiar: Salida.');
    expect(t).toContain('Historia del 30-sep:\nLa clienta confirmó que viaja el niño.');
  });

  it('las instrucciones al modelo llevan lo que ya se sabe y piden no copiarlo', () => {
    const i = instruccionesEntendimiento(FIELDS, '2026-09-30', { destino: 'PUNTA CANA', adultos: 2, ninos: '', _sugeridos: {} });
    expect(i).toContain('Este viaje YA existe.');
    const sabido = i.slice(i.indexOf('YA existe'));
    expect(sabido).toContain('- destino: PUNTA CANA');
    expect(sabido).toContain('- adultos: 2');
    expect(sabido).not.toContain('- ninos');
    expect(sabido).not.toContain('_sugeridos');
    expect(i).toContain('no copies lo que ya se sabe');
    expect(instruccionesEntendimiento(FIELDS, '2026-09-30')).not.toContain('YA existe');
  });
});
