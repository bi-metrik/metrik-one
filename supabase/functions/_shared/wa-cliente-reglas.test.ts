import { describe, expect, it } from 'vitest';
import {
  digitosCelular, directorioDesde, claveDeLlave, claveDeNombre, leerEleccionCliente, leerEsLaMisma, llavesDelTexto, pareceNombre, resolverCliente,
  resolverConDirectorio, separarNombreYLlave, soloLlave, textoDelCliente, TEXTO_PIDE_CLIENTE,
} from './wa-cliente-reglas.ts';
import type { FichaCliente, ResolucionCliente } from './wa-cliente-reglas.ts';
import { leerNuevo, leerViajeNuevo } from './wa-entendimiento-reglas.ts';
import {
  armarPlan, armarSegmentos, clienteDeLaCaja, interpretarRespuestaPlan, partesResumenPlan, pendienteDeLaCaja, resolverClientesDelPlan,
  resolverEncabezado, aplicarCambioCliente, claveDestino,
} from './wa-viajes-reglas.ts';
import type { MensajeViaje, ViajeAbierto } from './wa-viajes-reglas.ts';

/**
 * ¿Quién es el cliente? (diseño 2026-10-05, §3; brief del PR A). Una prueba por regla, con textos INVENTADOS.
 * Las decisiones de Mauricio del 2026-10-05: (1) sin celular, correo ni usuario no se crea un cliente; (2) un nombre
 * idéntico a UN contacto se usa, mostrando su celular.
 */

const ficha = (id: string, nombre: string, extra: Partial<FichaCliente> = {}): FichaCliente => ({ id, nombre, cel4: null, correo: false, abiertos: [], cerrado: null, ...extra });
const MARTIN = ficha('c-mr', 'MARTÍN ROBLEDO', { cel4: '9444', abiertos: [{ codigo: 'M1 26 1', nombre: 'MIAMI 7N' }, { codigo: 'M1 26 2', nombre: 'ARMENIA 2N' }] });
const PAOLA = ficha('c-par', 'PAOLA ANDREA RINCÓN DÍAZ', { cel4: '1234', cerrado: { codigo: 'P 26 9', nombre: 'CARTAGENA MAR' } });
const AG1 = ficha('c-ag1', 'ANDRÉS GÓMEZ', { cel4: '4410', abiertos: [{ codigo: 'A 26 1', nombre: 'MIAMI MAY' }] });
const AG2 = ficha('c-ag2', 'ANDRES GOMEZ', { correo: true });
const MAMA = ficha('c-mama', 'LUZ DÍAZ', { cel4: '1234' });

describe('las llaves: celular, correo y usuario, como los escribe el comercial', () => {
  it('el celular con +57, espacios, guiones, paréntesis o el decimal de Excel son el mismo', () => {
    for (const t of ['3005551234', '+57 300 555 1234', '300-555-1234', '(300) 555 1234', '573005551234', '3005551234.0']) {
      expect(digitosCelular(t)).toBe('3005551234');
    }
    expect(digitosCelular('12 de diciembre')).toBeNull();
  });

  it('el correo en minúsculas y el usuario sin arroba; el «2» de «Prueba2» no es parte del número', () => {
    expect(llavesDelTexto('Ana.Gomez@Correo.CO')).toEqual({ correo: 'ana.gomez@correo.co' });
    expect(llavesDelTexto('me escribió por Instagram, @laurapc')).toEqual({ usuario: 'laurapc' });
    expect(separarNombreYLlave('Laura Prueba2 300 123 4567')).toEqual({ nombre: 'Laura Prueba2', llave: { celular: '3001234567' } });
    expect(separarNombreYLlave('Tomás Gil, correo tomas@correo.co')).toEqual({ nombre: 'Tomás Gil', llave: { correo: 'tomas@correo.co' } });
    expect(separarNombreYLlave('Rosa Mejía')).toEqual({ nombre: 'Rosa Mejía', llave: null });
  });

  it('una llave escrita SOLA es la llave; con algo más es contenido', () => {
    expect(soloLlave('300 555 1234')).toEqual({ celular: '3005551234' });
    expect(soloLlave('su cel es 300 555 1234')).toEqual({ celular: '3005551234' });
    expect(soloLlave('correo: ana@correo.co')).toEqual({ correo: 'ana@correo.co' });
    expect(soloLlave('quiere ir el 12 de diciembre, cel 300 555 1234')).toBeNull();
    expect(soloLlave('somos 2 adultos')).toBeNull();
  });
});

describe('«nuevo» es un VIAJE nuevo (regla de lenguaje, §3.1)', () => {
  it.each([
    ['Bueno, vamos a registrar un nuevo viaje', { cliente: null, viaje: true }],
    ['nueva cotización', { cliente: null, viaje: true }],
    ['otra solicitud', { cliente: null, viaje: true }],
    ['nueva cotización para Andrés Gómez', { cliente: 'Andrés Gómez', viaje: true }],
    ['viaje nuevo del cliente Juan Pablo Ortega Zuleta', { cliente: 'Juan Pablo Ortega Zuleta', viaje: true }],
    ['No. Es para uno nuevo', { cliente: null, viaje: true, mismo: true }],
    ['No es un cliente nuevo, es una cotización nueva sobre un cliente antiguo', { cliente: null, viaje: true, mismo: true }],
  ])('«%s»', (texto, esperado) => {
    expect(leerNuevo(texto)).toEqual(esperado);
  });

  it('lo que sigue sin «de/para» o más largo que el tope no es un nombre (es contenido); «nuevo X» sigue igual', () => {
    expect(leerViajeNuevo('nueva cotización con hotel 4 estrellas')).toBeNull();
    expect(leerViajeNuevo('nuevo plan para la familia de cinco personas')).toBeNull();
    expect(leerNuevo('nueva cotización con hotel 4 estrellas')).toBeNull();
    expect(leerViajeNuevo('Paola nueva cotización')).toBeUndefined();
    expect(leerNuevo('nuevo Laura Prueba')).toEqual({ cliente: 'Laura Prueba' });
    expect(leerNuevo('cliente nuevo Daniel Pérez')).toEqual({ cliente: 'Daniel Pérez' });
  });
});

describe('el resolvedor (§3.2)', () => {
  const llave = { celular: '3005551234' };

  it('por llave: el dueño con el mismo nombre (o sin nombre dado) es esa persona', () => {
    expect(resolverCliente({ nombre: 'Paola Andrea Rincón Díaz', llave, porLlave: [PAOLA] })).toMatchObject({ tipo: 'existente', ficha: PAOLA, por: 'llave' });
    expect(resolverCliente({ nombre: null, llave, porLlave: [PAOLA] })).toMatchObject({ tipo: 'existente', ficha: PAOLA, por: 'llave' });
  });

  it('NUNCA crea con una llave que ya es de otra persona: con otro nombre, «¿es la misma persona?»', () => {
    const r = resolverCliente({ nombre: 'Paola Rincón', llave, porLlave: [PAOLA], porNombre: [] });
    expect(r).toMatchObject({ tipo: 'llave_de_otro', ficha: PAOLA });
    // Aunque el comercial diga que no es ella, la llave sigue siendo de otra persona: nunca «nuevo».
    expect(resolverCliente({ nombre: 'Paola Rincón', llave, porLlave: [PAOLA], porNombre: [], descartadas: ['c-par'] }).tipo).toBe('llave_de_otro');
  });

  it('celular compartido: el nombre desempata (`mismoNombre`); si no, se pregunta cuál', () => {
    expect(resolverCliente({ nombre: 'Luz Díaz', llave, porLlave: [PAOLA, MAMA] })).toMatchObject({ tipo: 'existente', ficha: MAMA });
    expect(resolverCliente({ nombre: null, llave, porLlave: [PAOLA, MAMA] })).toMatchObject({ tipo: 'elegir', motivo: 'llave_compartida' });
  });

  it('decisión 2: un nombre idéntico a UN contacto lo usa; varios idénticos o parecidos, se pregunta', () => {
    expect(resolverCliente({ nombre: 'martin robledo', llave: null, porNombre: [MARTIN] })).toMatchObject({ tipo: 'existente', ficha: MARTIN, por: 'nombre' });
    expect(resolverCliente({ nombre: 'Andrés Gómez', llave: null, porNombre: [AG1, AG2] })).toMatchObject({ tipo: 'elegir', motivo: 'homonimos' });
    expect(resolverCliente({ nombre: 'Paola Rincón', llave: null, porNombre: [PAOLA] })).toMatchObject({ tipo: 'elegir', motivo: 'parecidos' });
    expect(resolverCliente({ nombre: 'Paola Rincón', llave: null, porNombre: [PAOLA], otraPersona: true })).toEqual({ tipo: 'pedir_llave', nombre: 'Paola Rincón' });
  });

  it('decisión 1: nadie y sin llave → se pide la llave; nadie con llave → cliente nuevo (se crea con el «sí»)', () => {
    expect(resolverCliente({ nombre: 'Simón Arango', llave: null, porNombre: [] })).toEqual({ tipo: 'pedir_llave', nombre: 'Simón Arango' });
    expect(resolverCliente({ nombre: 'Simón Arango', llave, porLlave: [], porNombre: [] })).toEqual({ tipo: 'nuevo', nombre: 'Simón Arango', llave });
  });

  it('error al comprobar ≠ permiso para crear: la búsqueda que falla (o que no se hizo) nunca da «nuevo»', () => {
    expect(resolverCliente({ nombre: 'Hugo Prieto', llave, porLlave: null })).toMatchObject({ tipo: 'error' });
    expect(resolverCliente({ nombre: 'Hugo Prieto', llave: null, porNombre: null })).toMatchObject({ tipo: 'error' });
    const vacio = directorioDesde(new Map(), new Map());
    expect(resolverConDirectorio(vacio, { nombre: 'Hugo Prieto', llave })).toMatchObject({ tipo: 'error' });
  });

  it('el nombre parcial y un error de tipeo parecen; otro nombre de pila no', () => {
    expect(pareceNombre('Mauricio', 'MAURICIO MORENO')).toBe(true);
    expect(pareceNombre('Andrés Gomes', 'ANDRÉS GÓMEZ')).toBe(true);
    expect(pareceNombre('Daniel Pérez', 'LINA PÉREZ')).toBe(false);
  });
});

describe('lo que el bot dice: una pregunta, sin comandos en mayúsculas, con el dato que distingue', () => {
  const casos: ResolucionCliente[] = [
    { tipo: 'existente', ficha: MARTIN, por: 'nombre', nombre: 'Martín Robledo', llave: null },
    { tipo: 'nuevo', nombre: 'Simón Arango', llave: { correo: 'simon@correo.co' } },
    { tipo: 'pedir_llave', nombre: 'Simón Arango' },
    { tipo: 'llave_de_otro', ficha: PAOLA, nombre: 'Paola Rincón', llave: { celular: '3005551234' } },
    { tipo: 'elegir', opciones: [AG1, AG2], motivo: 'homonimos', nombre: 'Andrés Gómez', llave: null },
    { tipo: 'sin_nombre' },
  ];
  it.each(casos.map(c => [c.tipo, c] as const))('%s', (_t, r) => {
    const texto = textoDelCliente(r);
    expect(texto).not.toMatch(/\b(?:SÍ|NUEVO|DESCARTAR)\b/);
    expect((texto.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
    // El celular completo de un contacto que ya existe nunca sale: solo sus 4 últimos dígitos.
    expect(texto).not.toMatch(/3005551234|300 555 1234/);
  });

  it('los textos exactos de D1 y D3', () => {
    expect(textoDelCliente(casos[0])).toBe('Va como viaje nuevo de Martín Robledo, el que ya tenemos (cel. …9444, 2 viajes abiertos).\nReenvíame lo que te pidió y al final te muestro el resumen.');
    expect(textoDelCliente(casos[4])).toBe('Tengo dos Andrés Gómez: el primero, cel. …4410 (un viaje abierto: MIAMI MAY); el segundo, con correo (sin viajes). ¿Cuál es, o es otra persona?');
    expect(textoDelCliente({ tipo: 'sin_nombre' })).toBe(TEXTO_PIDE_CLIENTE);
  });
});

describe('las respuestas libres a «¿Cuál es?» y «¿Es la misma persona?»', () => {
  it('el número, el ordinal, los 4 dígitos o lo que lo distingue eligen; «otra persona» o «ninguno» no', () => {
    expect(leerEleccionCliente('2', [AG1, AG2])).toEqual({ tipo: 'ficha', ficha: AG2 });
    expect(leerEleccionCliente('el primero', [AG1, AG2])).toEqual({ tipo: 'ficha', ficha: AG1 });
    expect(leerEleccionCliente('el del 4410', [AG1, AG2])).toEqual({ tipo: 'ficha', ficha: AG1 });
    expect(leerEleccionCliente('el de Miami', [AG1, AG2])).toEqual({ tipo: 'ficha', ficha: AG1 });
    expect(leerEleccionCliente('ninguno, es otro', [AG1, AG2])).toEqual({ tipo: 'otra' });
    expect(leerEleccionCliente('es otra persona', [PAOLA])).toEqual({ tipo: 'otra' });
    expect(leerEleccionCliente('sí, es ella', [PAOLA])).toEqual({ tipo: 'ficha', ficha: PAOLA });
    // Lo que no distingue a uno solo no elige: se vuelve a preguntar.
    expect(leerEleccionCliente('el otro', [AG1, AG2])).toBeNull();
    expect(leerEleccionCliente('Andrés', [AG1, AG2])).toBeNull();
  });

  it('«sí, es ella, se registró con el nombre completo» es sí; «no, es la mamá» es no', () => {
    expect(leerEsLaMisma('sí, es ella, se registró con el nombre completo')).toBe('si');
    expect(leerEsLaMisma('Si')).toBe('si');
    expect(leerEsLaMisma('no, es la mamá, comparten celular')).toBe('no');
    expect(leerEsLaMisma('son dos personas distintas')).toBe('no');
    expect(leerEsLaMisma('quiere ir a Cartagena')).toBeNull();
  });
});

// ── En la tanda (sin I/O): las cajas leen el directorio ──────────────────────

const VIAJES_MR: ViajeAbierto[] = [
  { id: 'n-mr1', codigo: 'M1 26 1', cliente: 'MARTÍN ROBLEDO', destino: 'MIAMI', nombre: 'MIAMI 7N' },
  { id: 'n-mr2', codigo: 'M1 26 2', cliente: 'MARTÍN ROBLEDO', destino: 'ARMENIA', nombre: 'ARMENIA 2N' },
];
let k = 0;
const escrito = (cuerpo: string): MensajeViaje => ({ n: ++k, cuerpo, reenviado: false, tipo: 'text', en: new Date(Date.UTC(2026, 9, 5, 15, 0, k)).toISOString() });
const reenvio = (cuerpo: string): MensajeViaje => ({ ...escrito(cuerpo), reenviado: true });
const DIR = directorioDesde(
  new Map([[claveDeNombre('Martín Robledo'), [MARTIN]], [claveDeNombre('Paola Rincón'), [PAOLA]], [claveDeNombre('Simón Arango'), []]]),
  new Map([[claveDeLlave({ celular: '3005551234' }), [PAOLA]]]),
);
const cfg = { horasCajaActiva: 4, directorio: DIR };

describe('armarSegmentos con el directorio (el camino compartido de los atajos y el intérprete)', () => {
  it('tras «nuevo viaje», el nombre de un cliente con viajes abiertos es el cliente del viaje NUEVO (turno 2), no un encabezado de sus viajes', () => {
    k = 0;
    const ms = [escrito('Bueno, vamos a registrar un nuevo viaje'), escrito('El cliente es Martín Robledo'), reenvio('Cartagena en diciembre')];
    const { segmentos, encabezados } = armarSegmentos(ms, VIAJES_MR, cfg);
    expect(segmentos).toHaveLength(1);
    expect(encabezados).toEqual([1, 2]);
    expect(clienteDeLaCaja(segmentos[0], DIR)).toMatchObject({ tipo: 'existente', ficha: MARTIN });
    expect(resolverEncabezado('El cliente es Martín Robledo', VIAJES_MR)).toMatchObject({ tipo: 'ambiguo' }); // sin «nuevo viaje», la lista
  });

  it('«es para uno nuevo» y «sobre un cliente antiguo» no abren otra caja: siguen en el viaje nuevo del mismo cliente', () => {
    k = 0;
    const ms = [escrito('nuevo Martín Robledo'), escrito('No. Es para uno nuevo'), escrito('No es un cliente nuevo, es una cotización nueva sobre un cliente antiguo'), reenvio('Cartagena')];
    const { segmentos } = armarSegmentos(ms, VIAJES_MR, cfg);
    expect(segmentos).toHaveLength(1);
    expect(segmentos[0].mensajes).toEqual([4]);
  });

  it('en la caja de un viaje que YA existe, «es para uno nuevo» abre un viaje nuevo de ese cliente (§3.3, pregunta 3)', () => {
    k = 0;
    const ms = [escrito('M1 26 1'), escrito('es para uno nuevo'), reenvio('Cartagena')];
    const { segmentos } = armarSegmentos(ms, VIAJES_MR, cfg);
    expect(segmentos.map(s => s.encabezado?.resolucion.tipo)).toEqual(['viaje', 'nuevo']);
    expect(segmentos[1].encabezado!.resolucion).toMatchObject({ tipo: 'nuevo', cliente: 'Martín Robledo' });
    expect(segmentos[1].mensajes).toEqual([3]);
  });

  it('la llave de otra persona: «¿Es la misma persona?» espera; «no» la descarta y nunca se crea con ella', () => {
    k = 0;
    const ms = [escrito('nueva clienta Paola Rincón 300 555 1234'), escrito('no, es la mamá'), reenvio('San Andrés')];
    const { segmentos } = armarSegmentos(ms, [], cfg);
    expect(segmentos[0].cliente).toMatchObject({ llave: null, descartadas: ['c-par'] });
    const plan = resolverClientesDelPlan(armarPlan({ mensajes: ms, viajes: [], segmentos, encabezados: [1, 2] }), DIR);
    // Ni la llave ni el parecido descartado: falta otra llave (sin ella no se crea).
    expect(plan.mensajes[0].destino).toMatchObject({ tipo: 'nuevo', falta: 'llave', descartadas: ['c-par'] });
  });

  it('lo que espera la caja: la llave del cliente nuevo (decisión 1)', () => {
    k = 0;
    const ms = [escrito('nuevo Simón Arango')];
    const { segmentos } = armarSegmentos(ms, [], cfg);
    expect(pendienteDeLaCaja(segmentos, DIR)).toMatchObject({ tipo: 'cliente', resolucion: { tipo: 'pedir_llave', nombre: 'Simón Arango' } });
  });
});

describe('el resumen y su «sí» (se mantiene el «sí» del resumen)', () => {
  it('sin la llave el «sí» no carga; la llave escrita al resumen la completa; el «sí» confirma lo que se muestra', () => {
    k = 0;
    const ms = [escrito('nuevo Simón Arango'), reenvio('Santa Marta')];
    const { segmentos, encabezados } = armarSegmentos(ms, [], cfg);
    const plan = resolverClientesDelPlan(armarPlan({ mensajes: ms, viajes: [], segmentos, encabezados }), DIR);
    expect(partesResumenPlan(plan, ms).join('\n')).toContain('No cargué nada todavía. Antes del sí: ¿Me pasas el celular o el correo de Simón Arango?');
    expect(interpretarRespuestaPlan('sí', plan, [])).toEqual({ tipo: 'no_entendida', aviso: 'Antes del sí: ¿Me pasas el celular o el correo de Simón Arango? Sin uno de los dos no lo creo (también vale su usuario de WhatsApp o Instagram).' });
    const r = interpretarRespuestaPlan('simon@correo.co', plan, []);
    expect(r).toEqual({ tipo: 'cliente', clave: claveDestino(plan.mensajes[0].destino!), cambio: { llave: { correo: 'simon@correo.co' } } });
    const conLlave = resolverClientesDelPlan(aplicarCambioCliente(plan, (r as { clave: string }).clave, (r as { cambio: object }).cambio),
      directorioDesde(new Map([[claveDeNombre('Simón Arango'), []]]), new Map([[claveDeLlave({ correo: 'simon@correo.co' }), []]])));
    expect(partesResumenPlan(conLlave, ms).join('\n')).toContain('1) Viaje nuevo de Simón Arango (cliente nuevo, correo simon@correo.co) — 1 mensaje');
    expect(interpretarRespuestaPlan('sí', conLlave, [])).toEqual({ tipo: 'si' });
  });

  it('un cliente que ya existe se muestra con su dato y el «sí» lo confirma (decisión 2): sin turno de «¿es el mismo?»', () => {
    k = 0;
    const ms = [escrito('nuevo Martín Robledo'), reenvio('Cartagena')];
    const { segmentos, encabezados } = armarSegmentos(ms, VIAJES_MR, cfg);
    const plan = resolverClientesDelPlan(armarPlan({ mensajes: ms, viajes: VIAJES_MR, segmentos, encabezados }), DIR);
    expect(partesResumenPlan(plan, ms, undefined, VIAJES_MR).join('\n')).toContain('1) Viaje nuevo de Martín Robledo (ya es cliente: cel. …9444, 2 viajes abiertos) — 1 mensaje');
    expect(interpretarRespuestaPlan('sí', plan, VIAJES_MR)).toEqual({ tipo: 'si' });
    // Nombrar al cliente en un reenvío no es «hablar de otro viaje»: es el mismo cliente.
    expect(plan.mensajes.every(m => !m.sospecha)).toBe(true);
  });
});
