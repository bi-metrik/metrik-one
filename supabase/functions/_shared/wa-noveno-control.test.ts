import { describe, expect, it } from 'vitest';
import {
  claveDeNombre, directorioDesde, leerEleccionCliente, nombreEnElDirectorio, resolverConDirectorio, tramosDelNombre, type FichaCliente,
} from './wa-cliente-reglas.ts';
import { leerConsultaBandeja, relataAlCliente, textoTandaEnResumen } from './wa-consulta-bandeja.ts';
import { esSiSinReserva, resolverEncabezado } from './wa-viajes-reglas.ts';
import { opcionNombrada } from './wa-carga-reglas.ts';
import { leerNuevo } from './wa-entendimiento-reglas.ts';
import { validar, type Decision, type EntradaValidador } from './wa-interprete-reglas.ts';

/**
 * Lo que dejó el noveno control de Vera (2026-10-05), una prueba por regla, con textos y nombres inventados para estas
 * pruebas (Renata Osorio, Bernardo Lizcano, Casa Mirador), ninguno de los hallazgos de Vera.
 */

const ficha = (id: string, nombre: string, o: Partial<FichaCliente> = {}): FichaCliente => ({ id, nombre, cel4: null, correo: false, abiertos: [], ...o });
const RENATA = ficha('c-ro', 'RENATA OSORIO', { cel4: '4411' });
const RENATA_2 = ficha('c-ro2', 'RENATA OSORIO', { correo: true });
/** Un directorio que contesta por cualquier nombre o tramo: lo que tiene exacto, o nada. */
const dirCon = (...fichas: FichaCliente[]) => ({
  porNombre: (n: string) => fichas.filter(f => claveDeNombre(f.nombre) === claveDeNombre(n)),
  porLlave: () => [] as FichaCliente[],
});

describe('regla 1 · el nombre del cliente por la parte que el directorio tiene exacta', () => {
  it('los tramos: solo de palabras que pueden ser de un nombre, del más largo al más corto y de atrás hacia adelante', () => {
    expect(tramosDelNombre('mi clienta de siempre Renata Osorio')).toEqual(['siempre Renata Osorio', 'Renata Osorio', 'siempre Renata']);
    expect(tramosDelNombre('Renata Osorio Barichara')).toEqual(['Renata Osorio Barichara', 'Osorio Barichara', 'Renata Osorio']);
  });

  it.each([
    'mi clienta Renata Osorio',
    'corresponde a Renata Osorio',
    'se trata de la señora Renata Osorio',
    'va a nombre de Renata Osorio',
    'Renata Osorio Barichara',
    'esta persona es Renata Osorio',
  ])('«%s» → Renata Osorio, que ya existe (no se crea otra)', texto => {
    const dir = dirCon(RENATA);
    expect(nombreEnElDirectorio(texto, dir)).toEqual({ nombre: 'Renata Osorio', dudoso: false });
    expect(resolverConDirectorio(dir, { nombre: texto, llave: { celular: '3009990000' } })).toMatchObject({ tipo: 'existente', ficha: { id: 'c-ro' } });
  });

  it('con homónimos, pregunta cuál (también con la preposición delante)', () => {
    const r = resolverConDirectorio(dirCon(RENATA, RENATA_2), { nombre: 'para Renata Osorio', llave: null });
    expect(r).toMatchObject({ tipo: 'elegir', motivo: 'homonimos' });
  });

  it('sin coincidencia, un nombre que arranca con una fórmula pregunta «¿cómo se llama?», nunca crea con el prefijo', () => {
    const dir = dirCon();
    expect(nombreEnElDirectorio('la persona que viaja es Bernardo Lizcano', dir).dudoso).toBe(true);
    expect(resolverConDirectorio(dir, { nombre: 'la persona que viaja es Bernardo Lizcano', llave: { celular: '3001112233' } })).toMatchObject({ tipo: 'sin_nombre' });
    expect(resolverConDirectorio(dir, { nombre: 'su esposo Bernardo Lizcano', llave: null })).toMatchObject({ tipo: 'sin_nombre' });
  });

  it('un nombre limpio, o una empresa con artículo, sigue como cliente nuevo', () => {
    const dir = dirCon();
    expect(resolverConDirectorio(dir, { nombre: 'Bernardo Lizcano', llave: { celular: '3001112233' } })).toMatchObject({ tipo: 'nuevo', nombre: 'Bernardo Lizcano' });
    expect(resolverConDirectorio(dir, { nombre: 'La Casa Mirador', llave: { correo: 'reservas@casamirador.co' } })).toMatchObject({ tipo: 'nuevo' });
  });

  it('el encabezado «nuevo …» suelta la preposición que introduce el nombre', () => {
    expect(leerNuevo('nuevo para Renata Osorio')).toEqual({ cliente: 'Renata Osorio' });
    expect(leerNuevo('nueva a nombre de Renata Osorio')).toEqual({ cliente: 'Renata Osorio' });
    expect(leerNuevo('nuevo Delgado Ruiz')).toEqual({ cliente: 'Delgado Ruiz' });
  });

  it('lo que el directorio no consultó no cuenta como «no hay nadie» (sigue siendo un error)', () => {
    expect(resolverConDirectorio(directorioDesde(new Map(), new Map()), { nombre: 'Renata Osorio', llave: null })).toMatchObject({ tipo: 'error' });
  });
});

describe('regla 2 · el nombre de la consulta de viajes', () => {
  it('lo que la lectura deja como nombre se resuelve después por su parte exacta (sin lista de exclusión que alcance)', () => {
    const c = leerConsultaBandeja('¿qué viajes tiene abiertos hoy en día Renata Osorio?', { reenviado: false });
    expect(c?.tipo).toBe('viajes');
    const dicho = (c as { cliente: string | null }).cliente!;
    expect(nombreEnElDirectorio(dicho, dirCon(RENATA)).nombre).toBe('Renata Osorio');
  });
});

describe('regla 3 · el relato del cliente es contenido, en cualquier posición', () => {
  it.each([
    'Renata Osorio pregunta si tienen algo para Barichara',
    'la señora anda preguntando qué viajes hay en enero',
    'él quiere saber qué le falta a su reserva',
    'me escribió preguntando si el hotel tiene piscina',
    'dijeron que si les cotizo lo de Barichara',
    'Bernardo está consultando qué tiene abierto',
  ])('«%s»: relato, no consulta', texto => {
    expect(relataAlCliente(texto)).toBe(true);
    expect(leerConsultaBandeja(texto, { reenviado: false })).toBeNull();
  });

  it.each(['te pregunto: ¿qué viajes tiene abiertos?', '¿qué le falta al de Barichara?', 'quiero saber qué le falta'])('«%s»: el comercial pregunta (no es relato)', texto => {
    expect(relataAlCliente(texto)).toBe(false);
  });

  const entrada = (texto: string, o: Partial<EntradaValidador> = {}): EntradaValidador => ({
    texto, bandeja: true, rol: 'operator', pendiente: null, negocios: [], tanda: { abierta: true, nombre: 'Renata Osorio', cajaId: null, cliente: 'Renata Osorio' }, ...o,
  });
  const paso = (d: Decision) => (d.tipo === 'ejecutar' ? d.paso : null);

  it('el modelo hace de quien pregunta un cliente nuevo sin que el escrito diga «nuevo»: es contenido', () => {
    const texto = 'Bernardo pregunta si el paquete a Mompox incluye traslados';
    const d = validar({ acciones: [
      { accion: 'abrir_viaje', evidencia: 'Bernardo', nuevo_cliente: 'Bernardo' },
      { accion: 'contenido', evidencia: 'pregunta si el paquete a Mompox incluye traslados' },
    ] }, entrada(texto));
    expect(paso(d)).toMatchObject({ p: 'registrar', interpretacion: { accion: 'contenido' } });
  });

  it.each([
    ['viajes', 'Renata pregunta qué viajes tienen abiertos para enero'],
    ['numeros', 'el señor anda preguntando cómo vamos con lo de él'],
  ])('el modelo lo manda a la consulta (%s): con la bandeja es contenido', (tema, texto) => {
    const d = validar({ acciones: [{ accion: 'consulta', tema, evidencia: texto }] }, entrada(texto));
    expect(paso(d)).toMatchObject({ p: 'registrar', interpretacion: { accion: 'contenido' } });
  });
});

describe('regla 4 · el «sí» con otro verbo de seguir adelante', () => {
  it.each(['sí, súbelo', 'sí señor, déjalo creado de una vez', 'sí, móntalo', 'dale, súbemelo así', 'claro, regístralo y déjalo listo'])('«%s» es el «sí»', texto => {
    expect(esSiSinReserva(texto)).toBe(true);
  });
  it.each(['sí, súbelo pero mañana', 'sí, déjalo hasta que confirme', 'sí, súbelo cuando llegue el pasaporte', 'sí, el 2 súbelo a Barichara', 'sí, súbelo?', 'sí, no lo subas'])('«%s» tiene reserva', texto => {
    expect(esSiSinReserva(texto)).toBe(false);
  });
});

describe('regla 5 · «¿Cuál es?» por el dato dicho con otras palabras', () => {
  const VIAJERA = ficha('a', 'RENATA OSORIO', { cel4: '4411', cerrado: { codigo: 'R 25 3', nombre: 'BARICHARA' } });
  const NUEVA = ficha('b', 'RENATA OSORIO', { correo: true });
  it.each([
    ['la que ya viajó con nosotros', 'a'],
    ['la que nunca ha viajado', 'b'],
    ['la del email', 'b'],
    ['la que tiene correo electrónico', 'b'],
  ])('«%s» → %s', (texto, id) => {
    expect(leerEleccionCliente(texto, [VIAJERA, NUEVA])).toMatchObject({ tipo: 'ficha', ficha: { id } });
  });
  it('si las dos cumplen el dato, no elige', () => {
    expect(leerEleccionCliente('la que ya viajó', [VIAJERA, { ...NUEVA, abiertos: [{ codigo: 'R 26 1', nombre: 'MOMPOX' }] }])).toBeNull();
  });
});

describe('regla 6 · un pedido de acción con el vocabulario de la consulta no es consulta', () => {
  it.each(['borra lo que te mandé', 'quita lo que te he pasado', '¿me pasas lo que te mandé al de Barichara? pásalo', 'descarta lo que llevo'])('«%s»', texto => {
    expect(leerConsultaBandeja(texto, { reenviado: false })).toBeNull();
  });
  it('la consulta sigue valiendo', () => {
    expect(leerConsultaBandeja('¿qué te he pasado?', { reenviado: false })).toEqual({ tipo: 'tanda' });
  });
});

describe('regla 7 · la tanda con el resumen pendiente', () => {
  it('cuenta los mensajes del resumen', () => {
    expect(textoTandaEnResumen({ nombre: 'Renata Osorio', n: 3 })).toBe('La tanda de Renata Osorio ya se cerró con 3 mensajes y espera tu respuesta al resumen («sí» para cargarla).');
  });
});

describe('regla 8 · las listas con el demostrativo plural y el verbo de ir', () => {
  const OPS = [{ id: 'x', codigo: 'R 26 1', cliente: 'RENATA OSORIO', destino: 'BARICHARA' }, { id: 'y', codigo: 'B 26 2', cliente: 'BERNARDO LIZCANO', destino: 'MOMPOX' }];
  it.each(['esos van en el de Barichara', 'estas van para el de Mompox', 'vayan al de Barichara'])('«%s»', texto => {
    expect(opcionNombrada(texto, OPS)).not.toBeNull();
  });
});

describe('regla 9 · abrir o montar un viaje sin decir «nuevo»', () => {
  it.each([
    ['ábrele un viaje a Bernardo Lizcano', 'Bernardo Lizcano'],
    ['móntale una cotización a Renata Osorio', 'Renata Osorio'],
    ['créale un viaje para Bernardo Lizcano', 'Bernardo Lizcano'],
  ])('«%s» → viaje nuevo de %s', (texto, cliente) => {
    expect(resolverEncabezado(texto, [])).toMatchObject({ tipo: 'nuevo', cliente });
  });
  it('«ábrele un viaje» sin nombre: viaje nuevo, se pide el nombre', () => {
    expect(resolverEncabezado('ábrele un viaje', [])).toMatchObject({ tipo: 'nuevo', cliente: null });
  });
  it('«a» sin el pronombre de a quién sigue sin ser un nombre («monta un viaje a Barichara»)', () => {
    expect(resolverEncabezado('monta un viaje a Barichara', [])).not.toMatchObject({ tipo: 'nuevo', cliente: 'Barichara' });
  });
});
