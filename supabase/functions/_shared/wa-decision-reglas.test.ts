import { describe, expect, it } from 'vitest';
import {
  canonicoDe, CANONICO_NO_ES_NUEVO, conLlaveDelTexto, contextoDecision, esquemaDecision, idDecision, interactivoDe, leerConfirmacionNuevoCanonica,
  leerExacto, leerToqueDecision, MAX_DESCRIPCION_FILA, MAX_FILAS_LISTA, MAX_ID_FILA, MAX_TITULO_BOTON_RESPUESTA, MAX_TITULO_FILA, nombreLiteral,
  puntoCliente, puntoConfirmacion, puntoContacto, puntoDeLaCaja, puntoDelNuevo, puntoDelResumen, puntoDelViaje, puntoTanda, siSinCargar,
  textoVolverAPreguntar, TEXTO_NO_TE_ENTENDI, validarDecision, versionDe,
  esViajePropuesto, etiquetaDeViaje, opcionPropuesta, textoPropuesta, modeloDeLaDecision, MODELO_DECISION_POR_DEFECTO,
} from './wa-decision-reglas.ts';
import type { PuntoDecision } from './wa-decision-reglas.ts';
import { botonesDelResumen } from './wa-viajes-reglas.ts';
import type { DestinoNuevo, PlanViajes, ViajeAbierto } from './wa-viajes-reglas.ts';

/** Un resumen de un viaje nuevo al que le falta algo de su cliente (o nada: un viaje que ya existe). Datos inventados. */
function planCon(falta: 'elegir' | 'llave' | 'ninguna'): PlanViajes {
  const fichas = [
    { id: 'c-1', nombre: 'ANA GÓMEZ', cel4: '4410', correo: false, abiertos: [] },
    { id: 'c-2', nombre: 'ANA GOMEZ', cel4: null, correo: true, abiertos: [] },
  ];
  const destino = falta === 'ninguna'
    ? { tipo: 'existente' as const, negocio_id: 'v1', codigo: 'T1 26 11', cliente: 'CAROLINA RUIZ' }
    : ({ tipo: 'nuevo', cliente: falta === 'elegir' ? 'Ana' : 'Simón Arango', resuelto: true, falta, ...(falta === 'elegir' ? { opciones: fichas } : {}) } as DestinoNuevo);
  return { version: 2, mensajes: [{ n: 1, destino, por: 'encabezado' }, { n: 2, destino, por: 'encabezado' }], encabezados: [], avisos: [] };
}
const huellaDelPlanParaPruebas = planCon;

/**
 * Bot híbrido de la bandeja (brief del 2026-10-06): las reglas de los puntos de decisión, sin I/O. Datos inventados.
 * Lo que se fija aquí: qué lee el código sin el modelo (y nada más), qué acepta del modelo, cómo sale cada pregunta
 * (botones o lista, con los límites de Meta) y que un toque con otra huella no decide nada.
 */

const V: ViajeAbierto[] = [
  { id: 'v1', codigo: 'T1 26 11', cliente: 'CAROLINA RUIZ', destino: 'PUNTA CANA', nombre: 'PUNTA CANA NOV' },
  { id: 'v2', codigo: 'T1 26 14', cliente: 'LINA PÉREZ', destino: 'CARTAGENA', nombre: 'CARTAGENA 3N' },
  { id: 'v3', codigo: 'T1 26 9', cliente: 'LUISA MEJÍA', destino: 'SAN ANDRÉS', nombre: null },
  { id: 'v4', codigo: 'J 26 2', cliente: 'JORGE PÉREZ', destino: 'MADRID', nombre: 'MADRID 7D' },
];
const OPCIONES = V.slice(0, 3).map(v => ({ id: v.id, codigo: v.codigo, cliente: v.cliente, destino: v.destino, nombre: v.nombre }));
const viaje = () => puntoDelViaje('entrega', 'ent-1', 'Tanda de las 09:28', OPCIONES, V);

describe('los ids de los toques llevan la huella de la pregunta', () => {
  it('ida y vuelta, con el prefijo de la bandeja y por debajo de 200 caracteres', () => {
    const id = idDecision('v2', '6f1a2b3c-0000-4000-8000-000000000001', 'k3j2a');
    expect(id).toBe('bdj|d|v2|6f1a2b3c-0000-4000-8000-000000000001|k3j2a');
    expect(id.length).toBeLessThanOrEqual(MAX_ID_FILA);
    expect(leerToqueDecision(id)).toEqual({ clave: 'v2', ref: '6f1a2b3c-0000-4000-8000-000000000001', version: 'k3j2a' });
  });
  it('los botones de #1034 (r, p, t), un id mal formado o de otra cosa no son toques de decisión', () => {
    for (const id of ['bdj|r|si|e1|abc', 'bdj|p|no|x|-', 'bdj|d|V2|e|x', 'bdj|d||e|x', 'acepto', '', null, undefined]) expect(leerToqueDecision(id)).toBeNull();
  });
  it('la huella cambia si cambia lo que el comercial VE; no si se abre otro viaje fuera de la lista', () => {
    const a = viaje();
    const b = puntoDelViaje('entrega', 'ent-1', 'Tanda de las 09:28', OPCIONES, [...V, { id: 'v9', codigo: 'Z 26 1', cliente: 'ZOE', destino: 'LIMA', nombre: null }]);
    const c = puntoDelViaje('entrega', 'ent-1', 'Tanda de las 09:28', OPCIONES.slice(0, 2), V);
    expect(b.version).toBe(a.version);
    expect(c.version).not.toBe(a.version);
    const { version: _v, ...sin } = a;
    expect(versionDe(sin)).toBe(a.version);
  });
});

describe('cómo sale cada pregunta: botones (hasta tres) o lista (para elegir viaje o cliente), con los límites de Meta', () => {
  it('«¿A qué viaje van?»: una lista con los viajes numerados, «Viaje nuevo» y «Descartar»; los demás viajes abiertos no salen', () => {
    const i = interactivoDe(viaje());
    expect(i.tipo).toBe('lista');
    if (i.tipo !== 'lista') return;
    expect(i.boton).toBe('Elegir');
    expect(i.filas.map(f => f.title)).toEqual(['1. PUNTA CANA NOV', '2. CARTAGENA 3N', '3. Luisa Mejía', 'Viaje nuevo', 'Descartar']);
    expect(i.filas[0].description).toBe('Carolina Ruiz · T1 26 11');
    expect(i.filas.every(f => f.id.startsWith('bdj|d|') && f.id.length <= MAX_ID_FILA)).toBe(true);
    expect(viaje().hayMas).toBe(true);
  });
  it('con muchos viajes: a lo sumo 10 filas; títulos de 24, descripciones de 72', () => {
    const muchos = Array.from({ length: 14 }, (_, k) => ({ id: `w${k}`, codigo: `W 26 ${k}`, cliente: `CLIENTA CON UN NOMBRE MUY LARGO NÚMERO ${k}`, destino: `UN DESTINO CON NOMBRE LARGUÍSIMO QUE NO CABE ${k}`, nombre: `VIAJE CON NOMBRE LARGUÍSIMO ${k}` }));
    const i = interactivoDe(puntoDelViaje('entrega', 'e', '', muchos, muchos));
    if (i.tipo !== 'lista') throw new Error('debía ser lista');
    expect(i.filas.length).toBeLessThanOrEqual(MAX_FILAS_LISTA);
    expect(i.filas.every(f => [...f.title].length <= MAX_TITULO_FILA && [...(f.description ?? '')].length <= MAX_DESCRIPCION_FILA)).toBe(true);
    expect(i.filas.slice(-2).map(f => f.title)).toEqual(['Viaje nuevo', 'Descartar']);
  });
  it('«¿Creo el cliente nuevo?» sin parecidos: tres botones [Crear] [No es nuevo] [Descartar], de 20 caracteres o menos', () => {
    const p = puntoDelNuevo('en-1', 'Tanda', 'Gabriela Ossa', OPCIONES, V);
    const i = interactivoDe(p);
    expect(i).toMatchObject({ tipo: 'botones' });
    if (i.tipo !== 'botones') return;
    expect(i.botones.map(b => b.title)).toEqual(['Crear', 'No es nuevo', '🗑 Descartar']);
    expect(i.botones.every(b => [...b.title].length <= MAX_TITULO_BOTON_RESPUESTA)).toBe(true);
  });
  it('«¿Creo el cliente nuevo?» con parecidos del guardián: una lista con «Crear», los parecidos, «No es nuevo» y «Descartar»', () => {
    const p = puntoDelNuevo('en-1', 'Tanda', 'Ana Pérez', OPCIONES, V);
    const i = interactivoDe(p);
    if (i.tipo !== 'lista') throw new Error('debía ser lista');
    expect(i.filas.map(f => f.title)).toEqual(['Crear', 'Es Lina Pérez', 'Es Jorge Pérez', 'No es nuevo', '🗑 Descartar']);
  });
  it('el resumen reusa los botones de #1034 tal cual; con «¿Cuál es?» de un cliente nuevo, una lista de las fichas', () => {
    const plan = planCon('ninguna');
    const r = puntoDelResumen('ent-9', plan, 'Carolina Ruiz');
    expect(interactivoDe(r)).toEqual({ tipo: 'botones', botones: botonesDelResumen(plan, 'ent-9') });
    const planElegir = huellaDelPlanParaPruebas('elegir');
    const e = interactivoDe(puntoDelResumen('ent-9', planElegir, 'Ana'));
    if (e.tipo !== 'lista') throw new Error('debía ser lista');
    expect(e.filas.map(f => f.title)).toEqual(['1. Ana Gómez', '2. Ana Gomez', 'Otra persona', '🗑 Descartar']);
  });
  it('las preguntas del contacto y de la caja: los botones de «¿Es la misma persona?»; la lista de «¿Cuál es?»; «Descartar» cuando se pide la llave o el nombre', () => {
    expect(interactivoDe(puntoContacto({ ref: 'x', nombre: '', pregunta: '', pide: 'llave', fichas: [] }))).toMatchObject({ tipo: 'botones', botones: [{ title: '🗑 Descartar' }] });
    expect(interactivoDe(puntoContacto({ ref: 'x', nombre: '', pregunta: '', pide: 'crear', fichas: [] }))).toMatchObject({ tipo: 'botones', botones: [{ title: 'Crear' }, { title: '🗑 Descartar' }] });
    const elegir = interactivoDe(puntoTanda({ ref: 't', nombre: '', pregunta: '', pendiente: { tipo: 'elegir', fichas: [{ id: 'c1', nombre: 'PAOLA RINCÓN', dato: 'cel. …1234' }, { id: 'c2', nombre: 'PAOLA RINCON', dato: 'con correo' }] } }));
    expect(elegir).toMatchObject({ tipo: 'lista' });
    expect(interactivoDe(puntoTanda({ ref: 't', nombre: '', pregunta: '', pendiente: { tipo: 'nombre' } }))).toMatchObject({ tipo: 'botones', botones: [{ title: '🗑 Descartar' }] });
  });
});

describe('lo que el código lee sin el modelo: el número de la lista, el código exacto, «sí» o «no» solos y la llave sola; nada más', () => {
  const p = viaje();
  it('un número dentro de la lista elige su fila; fuera de ella no es nada más que «fuera»', () => {
    expect(leerExacto('2', p)).toMatchObject({ tipo: 'opcion', opcion: { clave: 'v2', canonico: '2' } });
    expect(leerExacto('2.', p)).toMatchObject({ tipo: 'opcion', opcion: { clave: 'v2' } });
    expect(leerExacto('9', p)).toEqual({ tipo: 'fuera' });
    // Escrito con su artículo (2026-10-06): «la dos», «el segundo», «la 2», «el primero» son el número.
    for (const t of ['el 2', 'la 2', 'la dos', 'La Dos.', 'el segundo', 'la segunda', 'en la segunda', 'la opción 2', 'el número 2']) {
      expect([t, leerExacto(t, p)]).toMatchObject([t, { tipo: 'opcion', opcion: { clave: 'v2' } }]);
    }
    expect(leerExacto('el primero', p)).toMatchObject({ tipo: 'opcion', opcion: { clave: 'v1' } });
    expect(leerExacto('la novena', p)).toEqual({ tipo: 'fuera' });
    expect(leerExacto('el 9', p)).toEqual({ tipo: 'fuera' });
    // Sin el artículo, en plural o con más palabras, no: lo lee el modelo («los dos» es «ambos», no el 2).
    for (const t of ['dos', 'segundo', 'los dos', 'las dos', 'el segundo de arriba', 'el primero que pusiste', 'el de dos']) expect([t, leerExacto(t, p)]).toEqual([t, null]);
  });
  it('«el último» solo si la lista lo deja claro: todos los viajes en ella, del 1 al último', () => {
    // La lista corta no tiene todos los viajes abiertos (hay uno oculto): «el último» no es claro.
    expect(p.hayMas).toBe(true);
    expect(leerExacto('el último', p)).toBeNull();
    const todos = puntoDelViaje('entrega', 'ent-1', 'Tanda', OPCIONES, V.slice(0, 3));
    expect(todos.hayMas).toBe(false);
    expect(leerExacto('el último', todos)).toMatchObject({ tipo: 'opcion', opcion: { clave: 'v3' } });
    expect(leerExacto('la última', todos)).toMatchObject({ tipo: 'opcion', opcion: { clave: 'v3' } });
  });
  it('un código exacto de la lista, o de un viaje abierto fuera de ella (opción oculta con su código)', () => {
    expect(leerExacto('T1 26 14', p)).toMatchObject({ tipo: 'opcion', opcion: { clave: 'v2' } });
    expect(leerExacto('t12614', p)).toMatchObject({ tipo: 'opcion', opcion: { clave: 'v2' } });
    expect(leerExacto('J 26 2', p)).toMatchObject({ tipo: 'opcion', opcion: { clave: 'xj262', canonico: 'J 26 2', visible: false } });
    expect(leerExacto('es el T1 26 14', p)).toBeNull();
  });
  it('en la caja abierta, el código de otro viaje no contesta la lista: es un encabezado', () => {
    const caja = puntoDeLaCaja('t1', { tipo: 'eleccion', texto: 'Pérez', candidatos: [V[1], V[3]], conContenido: false })!;
    expect(leerExacto('T1 26 11', caja, V.map(v => v.codigo!))).toEqual({ tipo: 'codigo_ajeno' });
    expect(leerExacto('J 26 2', caja, V.map(v => v.codigo!))).toMatchObject({ tipo: 'opcion', opcion: { clave: 'e2' } });
  });
  it('«sí» o «no» solos solo donde hay esas salidas; «sii», «dale», «sí señor» no', () => {
    const misma = puntoContacto({ ref: 'x', nombre: '', pregunta: '', pide: 'misma', fichas: [{ id: 'c', nombre: 'X' }] });
    expect(leerExacto('Sí', misma)).toMatchObject({ opcion: { clave: 'si', canonico: 'sí' } });
    expect(leerExacto('no.', misma)).toMatchObject({ opcion: { clave: 'no', canonico: 'no' } });
    for (const t of ['sii', 'dale', 'sí señor', 'si claro', 'no, es otra']) expect(leerExacto(t, misma)).toBeNull();
    expect(leerExacto('sí', viaje())).toBeNull(); // la lista de viajes no tiene un «sí»
  });
  it('la llave escrita sola, donde se pide', () => {
    const llave = puntoContacto({ ref: 'x', nombre: '', pregunta: '', pide: 'llave', fichas: [] });
    expect(leerExacto('300 555 1234', llave)).toMatchObject({ tipo: 'llave', llave: { celular: '3005551234' } });
    expect(leerExacto('ana@correo.co', llave)).toMatchObject({ tipo: 'llave', llave: { correo: 'ana@correo.co' } });
    expect(leerExacto('300 555 1234', viaje())).toBeNull();
  });
  it('un «sí» escrito al resumen que todavía no se puede cargar: «Todavía no lo cargo» y qué falta, sin el modelo', () => {
    const plan = huellaDelPlanParaPruebas('llave');
    const r = puntoDelResumen('e', plan, 'Simón Arango');
    expect(siSinCargar('sí', r)).toBe(true);
    expect(siSinCargar('sí, cárgalo', r)).toBe(false);
    expect(textoVolverAPreguntar(r, 'todavia')).toBe('Todavía no lo cargo. Simón Arango · ¿Me pasas su celular o su correo?');
  });
});

describe('lo que el código acepta del modelo: un id vigente, «contenido», «pregunta», «no sé», y donde se pide, el nombre, la llave o la corrección', () => {
  const p = viaje();
  it('un id vigente; uno inventado es «no sé»', () => {
    // Elegir un viaje escribe en él: el id es vigente, pero lo leído de un escrito pide el toque.
    expect(validarDecision({ tipo: 'opcion', opcion: 'v3' }, p, 'el de San Andrés')).toMatchObject({ tipo: 'solo_toque', opcion: { canonico: '3' } });
    expect(validarDecision({ tipo: 'opcion', opcion: 'des' }, p, 'eso no va')).toMatchObject({ tipo: 'opcion', opcion: { canonico: 'descartar' } });
    expect(validarDecision({ tipo: 'opcion', opcion: 'v7' }, p, 'el séptimo')).toEqual({ tipo: 'no_se', motivo: 'id_inventado' });
    expect(validarDecision({ tipo: 'opcion', opcion: 'n2' }, p, 'el 2')).toEqual({ tipo: 'no_se', motivo: 'id_inventado' });
  });
  it('«contenido», «pregunta», «no sé», un tipo desconocido y un JSON roto', () => {
    expect(validarDecision({ tipo: 'contenido' }, p, 'x')).toEqual({ tipo: 'contenido' });
    expect(validarDecision({ tipo: 'pregunta' }, p, 'x')).toEqual({ tipo: 'pregunta' });
    expect(validarDecision({ tipo: 'no_se' }, p, 'x')).toEqual({ tipo: 'no_se', motivo: 'modelo_no_sabe' });
    expect(validarDecision({ tipo: 'cargar' }, p, 'x')).toEqual({ tipo: 'no_se', motivo: 'tipo_desconocido' });
    expect(validarDecision(null, p, 'x')).toEqual({ tipo: 'no_se', motivo: 'tipo_desconocido' });
  });
  it('«Viaje nuevo» con el nombre: solo si está escrito tal cual; el canónico lleva la llave del escrito', () => {
    const v = validarDecision({ tipo: 'opcion', opcion: 'nuevo', nombre: 'Marta Gómez' }, p, 'es nuevo, de Marta Gómez 300 555 1234');
    expect(v).toMatchObject({ tipo: 'opcion', nombre: 'Marta Gómez' });
    if (v.tipo === 'opcion') expect(canonicoDe(v.opcion, v.nombre, 'es nuevo, de Marta Gómez 300 555 1234')).toBe('nuevo Marta Gómez 3005551234');
    expect(validarDecision({ tipo: 'opcion', opcion: 'nuevo', nombre: 'Marta Gómez Ruiz' }, p, 'es de Marta Gómez')).toEqual({ tipo: 'no_se', motivo: 'nombre_no_escrito' });
  });
  it('el nombre solo donde se pide, copiado del escrito; repetir el propuesto es crear: pide el toque', () => {
    const nombre = puntoTanda({ ref: 't', nombre: '', pregunta: '', pendiente: { tipo: 'nombre' } });
    expect(validarDecision({ tipo: 'nombre', nombre: 'Martín Robledo' }, nombre, 'El cliente es Martín Robledo')).toEqual({ tipo: 'nombre', nombre: 'Martín Robledo' });
    expect(validarDecision({ tipo: 'nombre', nombre: 'Martín Robledo' }, p, 'Martín Robledo')).toEqual({ tipo: 'no_se', motivo: 'nombre_no_permitido' });
    expect(validarDecision({ tipo: 'nombre', nombre: 'Marta' }, nombre, 'es la señora de siempre')).toEqual({ tipo: 'no_se', motivo: 'nombre_no_escrito' });
    const nuevo = puntoDelNuevo('e', '', 'Ignacio Salgar', OPCIONES, V);
    expect(validarDecision({ tipo: 'nombre', nombre: 'Ignacio Salgar' }, nuevo, 'Ignacio Salgar')).toMatchObject({ tipo: 'solo_toque', opcion: { clave: 'crear' } });
    expect(validarDecision({ tipo: 'opcion', opcion: 'crear' }, nuevo, 'sí, créalo')).toMatchObject({ tipo: 'solo_toque' });
  });
  it('la llave, donde se pide, la copia el código del escrito; la corrección, solo en el resumen', () => {
    const llave = puntoTanda({ ref: 't', nombre: '', pregunta: '', pendiente: { tipo: 'llave' } });
    expect(validarDecision({ tipo: 'llave' }, llave, 'anótale el cel 300 222 3344')).toEqual({ tipo: 'llave', canonico: '3002223344' });
    expect(validarDecision({ tipo: 'llave' }, llave, 'ahorita lo consigo')).toEqual({ tipo: 'no_se', motivo: 'llave_no_escrita' });
    expect(validarDecision({ tipo: 'correccion' }, p, 'el 2 es de Luisa')).toEqual({ tipo: 'no_se', motivo: 'correccion_no_permitida' });
  });
  it('la corrección la arma el modelo y el código la valida: números del resumen, un viaje de las opciones por su código, descartar, dejar o nuevo', () => {
    const r = puntoDelResumen('e', huellaDelPlanParaPruebas('ninguna'), '', 'entrega', V);
    expect(r.numeros).toEqual([1, 2]);
    const v = (cambios: unknown, texto = 'el 2 es de Luisa, y quita el 1') => validarDecision({ tipo: 'correccion', cambios }, r, texto);
    expect(v([{ mensajes: [2], destino: 'xt1269' }, { mensajes: [1], destino: 'descartar' }])).toEqual({ tipo: 'correccion', canonico: 'corregir: el 2 es de T1 26 9; descartar el 1' });
    expect(v([{ mensajes: [1, 2], destino: 'dejar' }])).toEqual({ tipo: 'correccion', canonico: 'corregir: dejar los 1 y 2' });
    expect(v([{ mensajes: [2], destino: 'nuevo', nombre: 'Pedro Gómez' }], 'el 2 es de un cliente nuevo, Pedro Gómez')).toEqual({ tipo: 'correccion', canonico: 'corregir: el 2 es de nuevo Pedro Gómez' });
    // Un número que no está en el resumen, un destino inventado, un nombre que no está escrito o sin cambios: «no sé».
    expect(v([{ mensajes: [5], destino: 'descartar' }])).toEqual({ tipo: 'no_se', motivo: 'correccion_invalida' });
    expect(v([{ mensajes: [2], destino: 'v9' }])).toEqual({ tipo: 'no_se', motivo: 'correccion_invalida' });
    expect(v([{ mensajes: [2], destino: 'nuevo', nombre: 'Ana Ruiz' }])).toEqual({ tipo: 'no_se', motivo: 'correccion_invalida' });
    expect(v([])).toEqual({ tipo: 'no_se', motivo: 'correccion_invalida' });
    expect(v(undefined)).toEqual({ tipo: 'no_se', motivo: 'correccion_invalida' });
  });
  it('nombreLiteral: palabras seguidas del escrito, sin tildes ni mayúsculas que cuenten, de 1 a 4, sin una que sea solo números', () => {
    expect(nombreLiteral('martin robledo', 'El cliente es Martín Robledo.')).toBe('Martín Robledo');
    expect(nombreLiteral('Valeria Prueba5', 'nuevo Valeria Prueba5 300 1')).toBe('Valeria Prueba5');
    expect(nombreLiteral('Ana 300', 'Ana 300 555')).toBeNull();
    expect(nombreLiteral('Juan Pablo Ortega Zuleta Ruiz', 'Juan Pablo Ortega Zuleta Ruiz')).toBeNull();
  });
});

describe('lo que escribe en un viaje o crea algo sale solo de lo exacto, nunca de lo que el modelo leyó (2026-10-06, SR3 «👌»)', () => {
  const resumen = puntoDelResumen('e', huellaDelPlanParaPruebas('ninguna'), '', 'entrega', V);
  const nuevo = puntoDelNuevo('e', '', 'Ignacio Salgar', OPCIONES, V);
  const cruce = puntoConfirmacion({ ref: 'n', nombre: '', pregunta: '', corta: '¿Van a T1 26 9?', c: 'cruce', botones: [{ id: 'bdj|p|si|n|-', title: 'Sí, van ahí' }] });
  const sinSolicitud = puntoConfirmacion({ ref: 'n', nombre: '', pregunta: '', corta: '¿Abro el viaje?', c: 'sin_solicitud', botones: [{ id: 'bdj|p|si|n|-', title: 'Sí, ábrelo' }] });
  const misma = puntoContacto({ ref: 'x', nombre: '', pregunta: '', pide: 'misma', fichas: [{ id: 'c', nombre: 'X' }] });
  const elegir = puntoContacto({ ref: 'x', nombre: '', pregunta: '', pide: 'elegir', fichas: [{ id: 'c1', nombre: 'Ana Gómez' }, { id: 'c2', nombre: 'Ana Gomez' }] });
  const crear = puntoContacto({ ref: 'x', nombre: '', pregunta: '', pide: 'crear', fichas: [], propuesto: 'Ignacio Salgar' });
  it('SR3 y sus variantes: «👌», «👍», «ok», «dale» al resumen no cargan; el toque, el número y el «sí» solo, sí', () => {
    for (const texto of ['👌', '👍', 'ok', 'dale', 'Dale pues', 'okis 👌']) {
      expect(leerExacto(texto, resumen)).toBeNull();
      const v = validarDecision({ tipo: 'opcion', opcion: 'si' }, resumen, texto);
      expect(v).toMatchObject({ tipo: 'solo_toque', opcion: { clave: 'si' } });
      expect(textoVolverAPreguntar(resumen, 'solo_toque', v.tipo === 'solo_toque' ? v.opcion : null)).toMatch(/^Para cargarlo, toca «.+»\. No he cargado nada\.\n/);
    }
    for (const texto of ['sí', 'Si', 'SÍ.', 'si!']) expect(leerExacto(texto, resumen)).toMatchObject({ tipo: 'opcion', opcion: { clave: 'si' } });
    // «Descartar» y la corrección no escriben en un viaje: siguen saliendo del modelo.
    expect(validarDecision({ tipo: 'opcion', opcion: 'des' }, resumen, 'bórralo todo')).toMatchObject({ tipo: 'opcion' });
    expect(resumen.opciones.map(o => o.clave)).toEqual(['si', 'des', 'g1', 'xt12611', 'xt12614', 'xt1269', 'xj262']);
  });
  it('cada opción que escribe o crea, en cada punto, pide el toque; lo que no escribe, no', () => {
    const casos: Array<[string, PuntoDecision, string, boolean]> = [
      ['resumen · Cargar', resumen, 'si', true],
      ['viaje · un viaje de la lista', viaje(), 'v2', true],
      ['viaje · un viaje fuera de la lista', viaje(), 'xj262', true],
      ['viaje · «Viaje nuevo» a secas (muestra el cliente antes de crearlo)', viaje(), 'nuevo', false],
      ['viaje · Descartar', viaje(), 'des', false],
      ['nuevo · Crear', nuevo, 'crear', true],
      ['nuevo · un viaje que ya existe', nuevo, 'v1', true],
      ['nuevo · No es nuevo', nuevo, 'no_nuevo', false],
      ['cruce · Sí', cruce, 'si', true],
      ['cruce · Es otro viaje', cruce, 'no', false],
      ['sin solicitud · Sí', sinSolicitud, 'si', true],
      ['contacto · Sí, es la misma', misma, 'si', true],
      ['contacto · No, es otra', misma, 'no', false],
      ['contacto · una ficha', elegir, 'c1', true],
      ['contacto · Otra persona', elegir, 'otra', false],
      ['contacto · Crear', crear, 'crear', true],
    ];
    for (const [nombre, punto, clave, toque] of casos) {
      expect(punto.opciones.some(o => o.clave === clave), nombre).toBe(true);
      expect(validarDecision({ tipo: 'opcion', opcion: clave }, punto, 'algo escrito').tipo, nombre).toBe(toque ? 'solo_toque' : 'opcion');
    }
  });
  it('lo exacto sí aplica: el número de la lista, el código y el «sí» escrito solo', () => {
    expect(leerExacto('2', viaje())).toMatchObject({ tipo: 'opcion', opcion: { clave: 'v2' } });
    expect(leerExacto('T1 26 9', viaje())).toMatchObject({ tipo: 'opcion', opcion: { clave: 'v3' } });
    expect(leerExacto('sí', cruce)).toMatchObject({ tipo: 'opcion', opcion: { clave: 'si' } });
    expect(leerExacto('300 555 1234', crear)).toMatchObject({ tipo: 'llave' });
  });
  it('«Viaje nuevo» con el nombre copiado va a la confirmación (otro toque); el nombre propuesto repetido pide el toque', () => {
    expect(validarDecision({ tipo: 'opcion', opcion: 'nuevo', nombre: 'Marta Gómez' }, viaje(), 'es nuevo, de Marta Gómez')).toMatchObject({ tipo: 'opcion', nombre: 'Marta Gómez' });
    expect(validarDecision({ tipo: 'nombre', nombre: 'Ignacio Salgar' }, crear, 'sí, Ignacio Salgar')).toMatchObject({ tipo: 'solo_toque', opcion: { clave: 'crear' } });
    expect(validarDecision({ tipo: 'nombre', nombre: 'Ignacio Salgado' }, crear, 'no, es Ignacio Salgado')).toEqual({ tipo: 'nombre', nombre: 'Ignacio Salgado' });
  });
  it('en el contacto de un viaje nuevo la llave cierra o crea: leída del escrito, se pide escrita sola; en la caja, no', () => {
    const v = validarDecision({ tipo: 'llave' }, crear, 'sí, créalo con el 300 555 1234');
    expect(v).toEqual({ tipo: 'solo_toque', opcion: null });
    expect(textoVolverAPreguntar(crear, 'solo_toque', null)).toMatch(/^Escríbeme solo el celular o el correo, sin más texto\. No he creado nada\.\n/);
    const caja = puntoTanda({ ref: 't', nombre: '', pregunta: '', pendiente: { tipo: 'llave' } });
    expect(validarDecision({ tipo: 'llave' }, caja, 'anótale el cel 300 222 3344')).toEqual({ tipo: 'llave', canonico: '3002223344' });
  });
  it('los textos dicen qué tocar y que no hizo nada', () => {
    const t = (p: PuntoDecision, clave: string) => textoVolverAPreguntar(p, 'solo_toque', p.opciones.find(o => o.clave === clave));
    expect(t(viaje(), 'v2')).toMatch(/^Si es «CARTAGENA 3N», tócalo en la lista\. No he cargado nada\./);
    expect(t(nuevo, 'crear')).toMatch(/^Para crear el cliente, toca «Crear»\. No he creado nada\./);
    expect(t(cruce, 'si')).toMatch(/^Para seguir, toca «Sí, van ahí»\. No he cargado nada\./);
    const conCliente = puntoDelResumen('e', huellaDelPlanParaPruebas('ninguna'), '', 'entrega', V);
    expect(t({ ...conCliente, creaCliente: true }, 'si')).toMatch(/^Para cargarlo y crear el cliente, toca «.+»\. No he cargado nada\./);
  });
});

describe('la propuesta de un viaje (2026-10-06): el viaje que reconoce el modelo se propone con [Sí, ese]', () => {
  it('solo los viajes de «¿A qué viaje van?» y de «¿Creo el cliente nuevo?»: la lista, los parecidos y los de fuera de la lista', () => {
    const p = viaje();
    const nuevo = puntoDelNuevo('e', '', 'Luisa Mejía', OPCIONES, V);
    expect(['v1', 'v3', 'xj262'].map(k => esViajePropuesto(p, p.opciones.find(o => o.clave === k)))).toEqual([true, true, true]);
    expect(['nuevo', 'des'].map(k => esViajePropuesto(p, p.opciones.find(o => o.clave === k)))).toEqual([false, false]);
    expect(esViajePropuesto(nuevo, nuevo.opciones.find(o => o.clave === 'p1'))).toBe(true);
    expect(esViajePropuesto(nuevo, nuevo.opciones.find(o => o.clave === 'crear'))).toBe(false);
    const resumen = puntoDelResumen('e', huellaDelPlanParaPruebas('ninguna'), '', 'entrega', V);
    expect(esViajePropuesto(resumen, resumen.opciones.find(o => o.clave === 'xj262'))).toBe(false);
  });
  it('el texto nombra el viaje con su cliente y su código; el parecido, sin repetir el cliente', () => {
    const p = viaje();
    expect(textoPropuesta(p.opciones.find(o => o.clave === 'v2')!)).toBe('¿Van en «CARTAGENA 3N · Lina Pérez · T1 26 14»? Toca «Sí, ese» o responde «sí». No he cargado nada.');
    const nuevo = puntoDelNuevo('e', '', 'Luisa Mejía', OPCIONES, V);
    expect(etiquetaDeViaje(nuevo.opciones.find(o => o.clave === 'p1')!)).toBe('Luisa Mejía · SAN ANDRÉS · T1 26 9');
  });
  it('la propuesta guardada vale solo para la misma pregunta con la misma huella', () => {
    const p = viaje();
    expect(opcionPropuesta(p, { ref: 'ent-1', version: p.version, clave: 'v2' })).toMatchObject({ clave: 'v2', canonico: '2' });
    expect(opcionPropuesta(p, { ref: 'ent-1', version: 'otra', clave: 'v2' })).toBeNull();
    expect(opcionPropuesta(p, { ref: 'ent-2', version: p.version, clave: 'v2' })).toBeNull();
    expect(opcionPropuesta(p, { ref: 'ent-1', version: p.version, clave: 'des' })).toBeNull();
    expect(opcionPropuesta(p, null)).toBeNull();
  });
});

describe('el modelo del llamado de decisión (2026-10-06): propio, gemini-3.5-flash-lite por defecto', () => {
  it('por defecto 3.5-flash-lite aunque la conversación abierta use 3.8; `modelo_decision` lo cambia; uno no permitido cae al de por defecto', () => {
    expect(MODELO_DECISION_POR_DEFECTO).toBe('gemini-3.5-flash-lite');
    expect(modeloDeLaDecision(null)).toEqual({ modelo: 'gemini-3.5-flash-lite', rechazado: null });
    expect(modeloDeLaDecision({ activo: true, modelo: 'gemini-3.8-flash', timeout_ms: 4000 })).toEqual({ modelo: 'gemini-3.5-flash-lite', rechazado: null });
    expect(modeloDeLaDecision({ modelo_decision: 'gemini-3.8-flash' })).toEqual({ modelo: 'gemini-3.8-flash', rechazado: null });
    expect(modeloDeLaDecision({ modelo_decision: 'gpt-9' })).toEqual({ modelo: 'gemini-3.5-flash-lite', rechazado: 'gpt-9' });
  });
});

describe('el modelo ve la pregunta, las opciones con sus ids y lo que se permite', () => {
  it('el contexto y el esquema', () => {
    const c = contextoDecision(viaje(), 'el de Cartagena');
    expect(c).toContain('- v2: 2. CARTAGENA 3N (Lina Pérez · T1 26 14) [número 2]');
    expect(c).toContain('- nuevo: Viaje nuevo');
    expect(c).toContain('No se permite "nombre".');
    expect(c).toContain('Mensaje del comercial: el de Cartagena');
    expect((esquemaDecision() as { properties: { tipo: { enum: string[] } } }).properties.tipo.enum).toEqual(['opcion', 'nombre', 'llave', 'correccion', 'contenido', 'pregunta', 'no_se']);
  });
});

describe('los textos de volver a preguntar', () => {
  it('timeout del modelo: «No te entendí; toca una opción» y la pregunta corta', () => {
    expect(textoVolverAPreguntar(viaje(), 'modelo')).toBe(`${TEXTO_NO_TE_ENTENDI}\nTanda de las 09:28 · ¿De qué viaje son?`);
    expect(textoVolverAPreguntar(viaje(), 'no_se')).toBe('No me quedó claro. Tanda de las 09:28 · ¿De qué viaje son?');
    expect(textoVolverAPreguntar(viaje(), 'fuera')).toBe('Ese número no está en la lista. Tanda de las 09:28 · ¿De qué viaje son?');
    expect(textoVolverAPreguntar(puntoCliente({ ref: 'e', nombre: '', pregunta: '' }), 'pregunta')).toBe('Eso te lo contesto después. Primero: ¿De qué cliente es?');
  });
});

describe('los canónicos que entran por el camino de siempre', () => {
  it('«¿Creo el cliente nuevo?» se lee solo canónico: sí, número, código, descartar, «nuevo X»; lo demás no se entiende', () => {
    const ops = OPCIONES;
    expect(leerConfirmacionNuevoCanonica('sí', ops)).toEqual({ tipo: 'si' });
    expect(leerConfirmacionNuevoCanonica('2', ops)).toEqual({ tipo: 'existente', negocio_id: 'v2' });
    expect(leerConfirmacionNuevoCanonica('9', ops)).toEqual({ tipo: 'no_entendida' });
    expect(leerConfirmacionNuevoCanonica('T1 26 9', ops)).toEqual({ tipo: 'existente', negocio_id: 'v3' });
    expect(leerConfirmacionNuevoCanonica('J 26 2', ops)).toEqual({ tipo: 'codigo', codigo: 'J262' });
    expect(leerConfirmacionNuevoCanonica('descartar', ops)).toEqual({ tipo: 'descartar' });
    expect(leerConfirmacionNuevoCanonica('nuevo Marta Gómez 3005551234', ops)).toEqual({ tipo: 'nombre', nombre: 'Marta Gómez 3005551234' });
    // Lo que antes se adivinaba ya no llega aquí (lo lee el modelo); si llegara, no se entiende.
    for (const t of ['sí, créalo', 'hágame el favor y la registra', 'el de Cartagena', 'Marta Gómez', CANONICO_NO_ES_NUEVO]) {
      expect(leerConfirmacionNuevoCanonica(t, ops)).toEqual({ tipo: 'no_entendida' });
    }
  });
  it('la llave del escrito va detrás del canónico, como la lee el código', () => {
    expect(conLlaveDelTexto('Laura', 'se llama Laura, @laurapc')).toBe('Laura @laurapc');
    expect(conLlaveDelTexto('Laura', 'se llama Laura')).toBe('Laura');
  });
  it('las confirmaciones del entendimiento: «no» en el cruce vuelve a la lista; en «¿es una solicitud?», descarta', () => {
    const cruce = puntoConfirmacion({ ref: 'n', nombre: '', pregunta: '', corta: '', c: 'cruce', botones: [] });
    expect(cruce.opciones.find(o => o.clave === 'no')!.canonico).toBe('no');
    const sin = puntoConfirmacion({ ref: 'n', nombre: '', pregunta: '', corta: '', c: 'sin_solicitud', botones: [] });
    expect(sin.opciones.find(o => o.clave === 'no')!.canonico).toBe('descartar');
  });
});

/** El tipo del punto, para quien lea estas pruebas. */
export type PuntoDePrueba = PuntoDecision;
