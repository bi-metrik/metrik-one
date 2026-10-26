import { describe, expect, it } from 'vitest';
import { candidatoNombradoEnLaFrase, cargaDirecta, datoPedidoEnElTexto, nuncaDirecto, otroViajeNombrado, posiblesNombres } from './wa-carga-directa-reglas.ts';
import type { PedidoFoco } from './wa-carga-directa-reglas.ts';
import { alcanceDelTexto, leerConsultaBandeja, relataAlCliente } from './wa-consulta-bandeja.ts';
import { esSiSinReserva } from './wa-viajes-reglas.ts';
import type { ViajeAbierto } from './wa-viajes-reglas.ts';
import { directorioDesde, leerEleccionCliente, nombreEnElDirectorio, tramoExacto } from './wa-cliente-reglas.ts';
import type { FichaCliente } from './wa-cliente-reglas.ts';
import { leerViajeNuevo } from './wa-entendimiento-reglas.ts';
import { validar, type EntradaValidador } from './wa-interprete-reglas.ts';

/** Décimo control de Vera (2026-10-05): una prueba por regla, con textos inventados. */

const PEDIDOS: PedidoFoco[] = [
  { slug: 'ciudad_origen', label: 'Ciudad de salida', tipo: 'texto' },
  { slug: 'fecha_salida', label: 'Fecha de salida', tipo: 'fecha' },
  { slug: 'ninos', label: 'Niños', tipo: 'numero' },
  { slug: 'edades_menores', label: 'Edades de los niños e infantes', tipo: 'texto' },
  { slug: 'categoria_hotel', label: 'Categoría de hotel', tipo: 'select', opciones: ['3 estrellas', '4 estrellas', '5 estrellas', 'Sin preferencia'] },
  { slug: 'presupuesto', label: 'Presupuesto aproximado del viaje', tipo: 'select', opciones: ['Menos de 5 millones', 'Entre 5 y 10 millones'] },
];
const FOCO: ViajeAbierto = { id: 'n-ib', codigo: 'I 26 1', cliente: 'ISIDRO BALLESTEROS', destino: 'LETICIA', nombre: 'LETICIA MAR' };
const OTRO: ViajeAbierto = { id: 'n-tq', codigo: 'T 26 4', cliente: 'TEODORA QUICENO', destino: 'PASTO', nombre: 'PASTO ABR' };
const ctx = (o: Partial<Parameters<typeof cargaDirecta>[1]> = {}) => ({ pedidos: PEDIDOS, foco: FOCO, viajes: [OTRO], otrosClientes: [], ...o });

describe('regla 1: la carga directa va por inclusión', () => {
  it.each([
    ['salen desde Bogotá', 'ciudad_origen'],
    ['el 14 de marzo arrancan', 'fecha_salida'],
    ['van con 3 niños', 'ninos'],
    ['los chicos tienen 6 y 11 años', 'edades_menores'],
    ['prefieren hotel 4 estrellas', 'categoria_hotel'],
    ['tienen como 7 millones para eso', 'presupuesto'],
  ])('«%s» trae el valor de un dato pedido (%s): directo', (texto, slug) => {
    expect(cargaDirecta(texto, ctx())).toEqual({ ok: true, dato: slug });
  });

  it.each([
    ['todavía no saben de dónde salen', 'sin_dato_pedido'],
    ['están muy entusiasmados con el plan', 'sin_dato_pedido'],
    ['Teodora sale desde Ipiales', 'otro_viaje'],
    ['los de Pasto van con 3 niños', 'otro_viaje'],
    ['T 26 4 sale el 20 de abril', 'otro_viaje'],
    ['quieren salir desde Cúcuta', 'ok'],
  ])('«%s» → %s', (texto, motivo) => {
    const d = cargaDirecta(texto, ctx());
    expect(d.ok ? 'ok' : d.motivo).toBe(motivo);
  });

  it('otro cliente del directorio nombrado en la frase (también solo por el nombre de pila): no va directo', () => {
    expect(cargaDirecta('Herminia sale desde Neiva', ctx({ otrosClientes: ['HERMINIA ROJAS'] }))).toEqual({ ok: false, motivo: 'otro_cliente' });
    expect(posiblesNombres('la de Herminia sale desde Neiva', 'ISIDRO BALLESTEROS')).toEqual(expect.arrayContaining(['herminia']));
    expect(posiblesNombres('Isidro sale desde Neiva', 'ISIDRO BALLESTEROS')).not.toContain('isidro');
  });

  it.each([
    ['cuándo es que vuelven', 'pregunta'],
    ['averíguame si salen desde Bogotá', 'pregunta'],
    ['dime cuántos niños van', 'pregunta'],
    ['cancela lo de la fecha', 'orden'],
    ['quítale los 3 niños', 'orden'],
    ['no, lo de los 3 niños era de otro viaje', 'correccion'],
    ['me equivoqué, salen desde Bogotá', 'correccion'],
    ['cotízale a Ramiro un plan con 4 estrellas', 'pedido_nuevo'],
    ['ábrele algo a la familia Cantor', 'pedido_nuevo'],
  ])('nunca directo: «%s» (%s)', (texto, motivo) => {
    expect(nuncaDirecto(texto)).toBe(motivo);
    expect(cargaDirecta(texto, ctx())).toEqual({ ok: false, motivo });
  });

  it('un foco sin los datos pedidos (de antes de este cambio) nunca carga directo', () => {
    expect(cargaDirecta('salen desde Bogotá', ctx({ pedidos: undefined }))).toEqual({ ok: false, motivo: 'sin_pedidos' });
  });

  it('las palabras que también son del viaje en foco no cuentan como otro viaje', () => {
    const otroALeticia: ViajeAbierto = { id: 'n-x', codigo: 'X 26 2', cliente: 'XIMENA DUQUE', destino: 'LETICIA', nombre: 'LETICIA JUN' };
    expect(otroViajeNombrado('en Leticia quieren hotel 4 estrellas', FOCO, [otroALeticia])).toBeNull();
    expect(datoPedidoEnElTexto('en Leticia quieren hotel 4 estrellas', PEDIDOS)).toBe('categoria_hotel');
  });
});

describe('regla 3: el encargo y el interés del cliente son relato (contenido)', () => {
  it.each([
    'me pidió que le averigüe si hay vuelo directo',
    'la señora quiere que le confirme el precio con desayuno',
    'nos encargaron que les cotizáramos un crucero',
    'le interesa saber si incluye traslados',
    'les gustaría saber qué pasa si llueve',
  ])('«%s»', texto => {
    expect(relataAlCliente(texto)).toBe(true);
  });
  it('lo que pregunta el comercial al bot no es relato', () => {
    expect(relataAlCliente('quiero saber qué le falta al de Leticia')).toBe(false);
    expect(relataAlCliente('qué le falta al de Leticia?')).toBe(false);
  });
});

describe('regla 4: la cortesía no es reserva', () => {
  it.each(['ah sí', 'ajá, sí, cárguelo', 'uy sí claro', 'sí señora, cárguelo', 'sí jefe, súbelo', 'sí, cárgalo todo', 'créalo de una vez por todas', 'sí, cárgalo sin falta'])(
    '«%s» es el «sí»', texto => expect(esSiSinReserva(texto)).toBe(true),
  );
  it.each(['ah sí?', 'sí señor, pero mañana', 'sí, todo menos el 2', 'sí jefe, cuando confirme', 'sí, son 3', 'uy no'])(
    '«%s» no lo es (condición, espera, pregunta, número, corrección o negación)', texto => expect(esSiSinReserva(texto)).toBe(false),
  );
});

describe('reglas 5 y 5b: el alcance sale del texto, y la corrección sin cifra es la pregunta de completo', () => {
  it.each([
    ['qué le falta para dejar lista la solicitud', 'completo'],
    ['qué falta en total', 'completo'],
    ['y lo deseable?', 'completo'],
    ['qué le falta para terminarla', 'completo'],
    ['qué necesita para empezar a cotizar', 'minimo'],
    ['cómo va', undefined],
  ])('«%s» → %s', (texto, alcance) => expect(alcanceDelTexto(texto)).toBe(alcance));

  it('la consulta de viaje que propone el modelo lleva el alcance del texto', () => {
    const texto = 'oye y a lo de Leticia qué le queda para terminar la solicitud';
    const e: EntradaValidador = { texto, bandeja: true, rol: 'owner', pendiente: null, negocios: [], tanda: null };
    const d = validar({ acciones: [{ accion: 'consulta', tema: 'viaje', evidencia: texto, ref: { destino: 'Leticia' } }] }, e);
    expect(d).toMatchObject({ tipo: 'ejecutar', paso: { p: 'bandeja_consulta', consulta: { tipo: 'viaje', alcance: 'completo' } } });
  });

  it.each(['pero le faltan los datos del hotel y del presupuesto', 'hay campos sin llenar todavía', 'la barra no está llena', 'todavía no está completo'])(
    '«%s» es la pregunta de completo del viaje en foco', texto => {
      expect(leerConsultaBandeja(texto, { reenviado: false })).toMatchObject({ tipo: 'viaje', alcance: 'completo' });
    },
  );
  it('lo que falta DEL CLIENTE sigue siendo contenido', () => {
    expect(leerConsultaBandeja('faltan los datos que el cliente no ha mandado', { reenviado: false })).toBeNull();
  });
});

describe('regla 6: con dos viajes, el que se nombra en cualquier parte de la frase', () => {
  it('por su destino, su cliente o su código dentro de la frase; lo que comparten no desempata', () => {
    const cands = [FOCO, OTRO];
    expect(candidatoNombradoEnLaFrase('lo de los niños es para lo de Pasto, son 3', cands)?.id).toBe('n-tq');
    expect(candidatoNombradoEnLaFrase('salen desde Bogotá los Ballesteros', cands)?.id).toBe('n-ib');
    expect(candidatoNombradoEnLaFrase('I 26 1 sale el 14 de marzo', cands)?.id).toBe('n-ib');
    expect(candidatoNombradoEnLaFrase('salen desde Bogotá', cands)).toBeNull();
  });
});

describe('reglas 7 y 8: el tramo exacto del nombre', () => {
  const ficha = (nombre: string): FichaCliente => ({ id: `c-${nombre}`, nombre, cel4: '1234', correo: false, usuario: false, abiertos: [], cerrado: null, exacto: true });
  const dir = directorioDesde(new Map([['leonor pardo', [ficha('LEONOR PARDO')]]]), new Map());
  it('lo que sobra delante es una fórmula, o detrás un destino o relleno: vale el tramo', () => {
    expect(tramoExacto('es mi clienta de siempre, Leonor Pardo', dir)).toBe('Leonor Pardo');
    expect(tramoExacto('Leonor Pardo Cartagena', dir)).toBe('Leonor Pardo');
    expect(tramoExacto('Leonor Pardo diciembre', dir)).toBe('Leonor Pardo');
  });
  it('un apellido de más pegado detrás: no vale, se pregunta con el nombre entero', () => {
    expect(tramoExacto('Leonor Pardo Villegas', dir)).toBeNull();
    expect(nombreEnElDirectorio('Leonor Pardo Villegas', dir)).toEqual({ nombre: 'Leonor Pardo Villegas', dudoso: false });
  });
});

describe('regla 9: una pregunta de plata no es la consulta de un viaje', () => {
  it.each(['cómo va la cartera este mes?', 'cómo van las ventas?', 'cómo vamos de gastos?'])('«%s»', texto => {
    expect(leerConsultaBandeja(texto, { reenviado: false })).toBeNull();
  });
});

describe('regla 10: viaje nuevo con perífrasis o con «uno», y «hizo un viaje» es haber viajado', () => {
  it.each(['debemos crear una cotización para Leonor Pardo', 'tocaría abrir un viaje para Leonor Pardo', 'empecemos uno para Leonor Pardo', 'arranquemos uno para Leonor Pardo', 'móntale uno a Leonor Pardo'])(
    '«%s»', texto => expect(leerViajeNuevo(texto)).toEqual({ cliente: 'Leonor Pardo', viaje: true }),
  );
  it('el viaje que empieza en una fecha no es un viaje nuevo', () => {
    expect(leerViajeNuevo('el viaje empieza el 10')).toBeUndefined();
  });
  it('en la lista de homónimos, «el que ya hizo un viaje con nosotros»', () => {
    const conViaje: FichaCliente = { id: 'a', nombre: 'LEONOR PARDO', cel4: '1111', correo: false, usuario: false, abiertos: [], cerrado: { id: 'v', nombre: 'ARUBA', codigo: 'L 25 1' } as never, exacto: true };
    const sinViaje: FichaCliente = { id: 'b', nombre: 'LEONOR PARDO', cel4: '2222', correo: false, usuario: false, abiertos: [], cerrado: null, exacto: true };
    expect(leerEleccionCliente('el que ya hizo un viaje con nosotros', [conViaje, sinViaje])).toEqual({ tipo: 'ficha', ficha: conViaje });
    expect(leerEleccionCliente('la que nunca ha hecho un viaje', [conViaje, sinViaje])).toEqual({ tipo: 'ficha', ficha: sinViaje });
  });
});
