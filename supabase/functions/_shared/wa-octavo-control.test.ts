import { describe, expect, it } from 'vitest';
import {
  preguntaPendienteUnificada,
  validar,
  type Decision,
  type EntradaValidador,
  type NegocioCtx,
} from './wa-interprete-reglas.ts';
import {
  armarSegmentos, esNombreNuevo, esSiSinReserva, interpretarConfirmacionNuevo, nombreDestino, pideViajeNuevo, sinPresentacion, type MensajeViaje, type ViajeAbierto,
} from './wa-viajes-reglas.ts';
import { leerEleccionCliente, soloLlaveDelCliente, textoDelCliente, type FichaCliente } from './wa-cliente-reglas.ts';
import { pideRegistrar } from './wa-interprete-reglas.ts';

/**
 * Lo que dejó el octavo control de Vera sobre #1024 (2026-10-05), una prueba por regla. Textos y nombres inventados
 * para estas pruebas (Teodoro Salcedo, Teodoro Ibarra, Ximena Duarte, Bruno Cifuentes), ninguno de la prueba de Vera.
 *   1. El «sí» del resumen con una condición no carga: vuelve a preguntar.
 *   2. En la caja de un viaje NUEVO de X, nombrar a X es contenido de esa caja, no un viaje abierto de X.
 *   3. El nombre tras «¿Para qué cliente es?» pierde la fórmula que lo presenta, en los dos géneros.
 *   4–10. Las vueltas de más: la lista de un solo cliente, «¿Cuál es?», «¿Es la misma persona?», la llave con palabras,
 *   el cliente sin viajes abiertos al corregir, los avisos de la llave y las cortesías.
 */

const SALCEDO: NegocioCtx = { alias: 'n3', id: 'v-salcedo', codigo: 'S 26 3', cliente: 'TEODORO SALCEDO', destino: 'BARICHARA' };
const IBARRA: NegocioCtx = { alias: 'n5', id: 'v-ibarra', codigo: 'I 26 5', cliente: 'TEODORO IBARRA', destino: 'LETICIA' };
const OTRA: NegocioCtx = { alias: 'n7', id: 'v-otra', codigo: 'R 26 7', cliente: 'ROSAURA PINZÓN', destino: 'SANTA MARTA' };
const VIAJES = [SALCEDO, IBARRA, OTRA];
const alias = (id: string) => VIAJES.find(n => n.id === id)?.alias ?? id;

const RESUMEN = preguntaPendienteUnificada({ bandeja: { espera: 'resumen', nombre: 'Teodoro Salcedo', corta: '¿Lo cargo así?' }, alias })!;
const OTRA_PREGUNTA = preguntaPendienteUnificada({ bandeja: { espera: 'otra', nombre: 'Teodoro Salcedo', corta: '¿Lo creo igual?' }, alias })!;

const entrada = (texto: string, o: Partial<EntradaValidador> = {}): EntradaValidador => ({
  texto, bandeja: true, rol: 'operator', pendiente: null, negocios: VIAJES, tanda: null, ...o,
});
const una = (accion: Record<string, unknown>) => ({ acciones: [accion] });
const ejec = (d: Decision) => {
  if (d.tipo !== 'ejecutar') throw new Error(`se esperaba ejecutar y fue ${JSON.stringify(d)}`);
  return d;
};

describe('regla 1 · el «sí» del resumen con una condición no carga', () => {
  it.each([
    'sí, pero espérame que me manda el pasaporte',
    'sí cuando me confirme las fechas',
    'si, aunque falta que me pase la edad del niño',
    'sí, pero no lo cargues todavía',
    'sí pero mañana',
    'dale, después de que hable con ella',
    'sí, ¿y el seguro?',
    'sí, y que no se te olvide el traslado',
  ])('«%s» (propuesto como confirmar o responder sí) → vuelve a preguntar, nunca el «sí» canónico', texto => {
    expect(esSiSinReserva(texto)).toBe(false);
    for (const propuesta of [{ accion: 'confirmar', evidencia: texto }, { accion: 'responder', opcion: 'si', evidencia: texto }]) {
      const d = ejec(validar(una(propuesta), entrada(texto, { pendiente: RESUMEN })));
      expect(d.paso.p).toBe('decir');
      expect(d.rechazo).toBe('V21_si_con_reserva');
    }
  });

  it.each([
    'sí', 'si señor', 'sí, cárguelo por favor', 'dale, de una', 'sí, adelante', 'claro que sí, cárgalo', 'sí, créalo',
    'dale, así está bien', 'sí, todo correcto, gracias', 'Sí, regístralo por favor',
  ])('«%s» es una afirmación sola: va como «sí» al código de hoy', texto => {
    expect(esSiSinReserva(texto)).toBe(true);
    const d = ejec(validar(una({ accion: 'confirmar', evidencia: texto }), entrada(texto, { pendiente: RESUMEN })));
    expect(d.paso).toMatchObject({ p: 'responder_bandeja', canonico: 'sí' });
  });

  it('el modelo parte el «sí» con reserva en confirmar + nota o contenido, o lo toma como acuse: tampoco carga, ni anota, ni calla', () => {
    const texto = 'sí, pero no lo cargues hasta el lunes';
    for (const acciones of [
      [{ accion: 'confirmar', evidencia: 'sí' }, { accion: 'nota_interna', evidencia: 'pero no lo cargues hasta el lunes' }],
      [{ accion: 'confirmar', evidencia: 'sí' }, { accion: 'contenido', evidencia: 'no lo cargues hasta el lunes' }],
      [{ accion: 'acuse', evidencia: texto }],
    ]) {
      expect(ejec(validar({ acciones }, entrada(texto, { pendiente: RESUMEN })))).toMatchObject({ paso: { p: 'decir' }, rechazo: 'V21_si_con_reserva' });
    }
  });

  it('una corrección con el «sí» («sí, pero el 2 es de Rosaura») sigue siendo la corrección (V16), no se vuelve a preguntar', () => {
    const texto = 'sí, pero el 2 es de Rosaura';
    const d = ejec(validar({ acciones: [{ accion: 'confirmar', evidencia: 'sí' }, { accion: 'mover', evidencia: 'el 2 es de Rosaura', n: 2, ref_cliente: 'Rosaura' }] }, entrada(texto, { pendiente: RESUMEN })));
    expect(d.paso).toMatchObject({ p: 'responder_bandeja', interpretacion: { accion: 'mover' } });
  });

  it('el resumen de un viaje nuevo (la caja de Teodoro Salcedo sin viaje): el mismo «sí», que es el que crea el viaje', () => {
    const tanda = { abierta: true, nombre: 'Teodoro Salcedo', cajaId: null, cliente: 'Teodoro Salcedo' };
    const reserva = 'sí, pero créalo cuando me pase el correo';
    const conReserva = ejec(validar(una({ accion: 'confirmar', evidencia: reserva }), entrada(reserva, { pendiente: RESUMEN, tanda })));
    expect(conReserva).toMatchObject({ paso: { p: 'decir' }, rechazo: 'V21_si_con_reserva' });
    const limpio = ejec(validar(una({ accion: 'confirmar', evidencia: 'sí, créalo' }), entrada('sí, créalo', { pendiente: RESUMEN, tanda })));
    expect(limpio.paso).toMatchObject({ p: 'responder_bandeja', canonico: 'sí' });
  });

  it('«¿Lo creo igual?» (contacto de la bandeja) también escribe: la misma lectura; el «no» sigue igual', () => {
    const reserva = 'sí pero revisa primero el correo';
    for (const propuesta of [{ accion: 'confirmar', evidencia: reserva }, { accion: 'responder', opcion: 'si', evidencia: reserva }]) {
      expect(ejec(validar(una(propuesta), entrada(reserva, { pendiente: OTRA_PREGUNTA })))).toMatchObject({ paso: { p: 'decir' }, rechazo: 'V21_si_con_reserva' });
    }
    expect(ejec(validar(una({ accion: 'confirmar', evidencia: 'sí, créalo' }), entrada('sí, créalo', { pendiente: OTRA_PREGUNTA }))).paso).toMatchObject({ canonico: 'sí' });
    expect(ejec(validar(una({ accion: 'cancelar', evidencia: 'no' }), entrada('no', { pendiente: OTRA_PREGUNTA }))).paso).toMatchObject({ canonico: 'no' });
  });
});

describe('regla 2 · en la caja de un viaje nuevo de X, nombrar a X es contenido de esa caja', () => {
  const NUEVA = { abierta: true, nombre: 'Teodoro Salcedo', cajaId: null, cliente: 'Teodoro Salcedo' };
  const contenidoDeLaCaja = (d: Decision) => {
    const x = ejec(d);
    expect(x.paso).toMatchObject({ p: 'registrar', interpretacion: { accion: 'contenido' }, aviso: null });
    expect((x.paso as { interpretacion: { viaje_id?: string } }).interpretacion.viaje_id).toBeUndefined();
    return x;
  };

  it.each([
    ['Teodoro', { accion: 'abrir_viaje', ref_cliente: 'Teodoro' }],
    ['don Teodoro', { accion: 'abrir_viaje', ref_cliente: 'Teodoro' }],
    ['Don Teodoro Salcedo', { accion: 'abrir_viaje', ref_cliente: 'Teodoro Salcedo' }],
    ['Salcedo', { accion: 'abrir_viaje', id: 'n3' }],
    ['Teodoro quiere ir con la esposa en enero', { accion: 'contenido', ref_cliente: 'Teodoro' }],
    ['el señor Salcedo prefiere hotel con piscina', { accion: 'contenido', ref_cliente: 'Salcedo' }],
  ])('«%s» → contenido de la caja nueva (no el viaje S 26 3 de Teodoro Salcedo)', (texto, propuesta) => {
    const d = contenidoDeLaCaja(validar(una({ evidencia: texto, ...propuesta }), entrada(texto, { tanda: NUEVA })));
    expect(d.rechazo).toBe('V5_cliente_de_la_caja_nueva');
  });

  it('abrir_viaje con su contenido en el mismo mensaje: también contenido de la caja nueva', () => {
    const d = validar({ acciones: [{ accion: 'abrir_viaje', ref_cliente: 'Teodoro', evidencia: 'Teodoro' }, { accion: 'contenido', ref_cliente: 'Teodoro', evidencia: 'que sean 4 noches' }] },
      entrada('Teodoro: que sean 4 noches', { tanda: NUEVA }));
    contenidoDeLaCaja(d);
  });

  it('el nombre de pila de OTRO Teodoro con viaje abierto, en la caja de Salcedo: tampoco cambia de viaje', () => {
    contenidoDeLaCaja(validar(una({ accion: 'abrir_viaje', ref_cliente: 'Teodoro', evidencia: 'Teodoro' }), entrada('Teodoro', { tanda: NUEVA, negocios: [IBARRA, OTRA] })));
  });

  it.each([
    ['el de Barichara de Teodoro', { accion: 'abrir_viaje', ref_cliente: 'Teodoro', ref_destino: 'Barichara' }, 'v-salcedo'],
    ['S 26 3', { accion: 'abrir_viaje', ref_codigo: 'S 26 3' }, 'v-salcedo'],
    ['Teodoro Ibarra', { accion: 'abrir_viaje', ref_cliente: 'Teodoro Ibarra' }, 'v-ibarra'],
    ['Rosaura', { accion: 'abrir_viaje', ref_cliente: 'Rosaura' }, 'v-otra'],
  ])('«%s»: un destino, un código o el cliente de OTRO viaje sí cambian de viaje', (texto, propuesta, id) => {
    const d = ejec(validar(una({ evidencia: texto, ...propuesta }), entrada(texto, { tanda: NUEVA })));
    expect(d.paso).toMatchObject({ p: 'registrar', interpretacion: { accion: 'abrir_viaje', viaje_id: id } });
  });

  it('con la caja de un viaje que YA existe (no nuevo), nada cambia: «Teodoro» va a su viaje como hoy', () => {
    const d = ejec(validar(una({ accion: 'abrir_viaje', ref_cliente: 'Teodoro Salcedo', evidencia: 'Teodoro Salcedo' }), entrada('Teodoro Salcedo', {
      tanda: { abierta: true, nombre: 'Rosaura Pinzón', cajaId: 'v-otra', cliente: 'Rosaura Pinzón' },
    })));
    expect(d.paso).toMatchObject({ interpretacion: { accion: 'abrir_viaje', viaje_id: 'v-salcedo' } });
  });

  it('«nuevo» u «otra cotización» siguen abriendo un viaje nuevo (eso no cambia)', () => {
    const d = ejec(validar(una({ accion: 'abrir_viaje', ref_cliente: 'Teodoro Salcedo', evidencia: 'otra cotización para Teodoro Salcedo' }), entrada('otra cotización para Teodoro Salcedo', { tanda: NUEVA })));
    expect(d.paso).toMatchObject({ interpretacion: { accion: 'abrir_viaje', nuevo: 'Teodoro Salcedo' } });
  });
});

describe('regla 3 · el nombre sin la fórmula que lo presenta', () => {
  it.each([
    ['La clienta es Ximena Duarte', 'Ximena Duarte'],
    ['la cliente es Ximena Duarte', 'Ximena Duarte'],
    ['El cliente es Ximena Duarte', 'Ximena Duarte'],
    ['La señora se llama Ximena Duarte', 'Ximena Duarte'],
    ['el señor es Ximena Duarte', 'Ximena Duarte'],
    ['Su nombre es Ximena Duarte', 'Ximena Duarte'],
    ['Se llama Ximena Duarte', 'Ximena Duarte'],
    ['Para Ximena Duarte', 'Ximena Duarte'],
    ['es para Ximena Duarte', 'Ximena Duarte'],
    ['A nombre de Ximena Duarte', 'Ximena Duarte'],
    ['de Ximena Duarte', 'Ximena Duarte'],
    ['La clienta es: Ximena Duarte', 'Ximena Duarte'],
    ['a nombre de la señora Ximena Duarte', 'Ximena Duarte'],
    ['la clienta Ximena Duarte', 'Ximena Duarte'],
  ])('«%s» → «%s»', (texto, nombre) => {
    expect(sinPresentacion(texto)).toBe(nombre);
    expect(esNombreNuevo(texto)).toBe(nombre);
  });

  it('un nombre que empieza como una fórmula no se corta («Esteban Paredes», «Delia Ruiz»)', () => {
    expect(esNombreNuevo('Esteban Paredes')).toBe('Esteban Paredes');
    expect(esNombreNuevo('Delia Ruiz')).toBe('Delia Ruiz');
    expect(esNombreNuevo('Paraíso Gómez')).toBe('Paraíso Gómez');
  });

  it('tras «nuevo» sin nombre, «La clienta es Ximena Duarte» es el nombre de la caja, sin el prefijo', () => {
    const t = (min: number) => new Date(Date.parse('2026-10-05T14:00:00Z') + min * 60_000).toISOString();
    const m = (n: number, cuerpo: string, reenviado = false): MensajeViaje => ({ n, cuerpo, reenviado, tipo: 'text', en: t(n) });
    const viajes: ViajeAbierto[] = VIAJES.map(v => ({ id: v.id, codigo: v.codigo, cliente: v.cliente, destino: v.destino }));
    const { segmentos } = armarSegmentos([m(1, 'nuevo viaje'), m(2, 'La clienta es Ximena Duarte'), m(3, 'Hola, queremos ir a Leticia', true)], viajes, { horasCajaActiva: 2 });
    expect(segmentos).toHaveLength(1);
    expect(segmentos[0].nombre).toMatchObject({ texto: 'Ximena Duarte', n: 2 });
    expect(segmentos[0].mensajes).toEqual([3]);
  });

  it('el validador también lo quita si el modelo copió la fórmula', () => {
    const NOMBRE = preguntaPendienteUnificada({ bandeja: { espera: 'nombre', nombre: 'Tanda de las 10:02', corta: '¿Para qué cliente es?' }, alias })!;
    const d = ejec(validar(una({ accion: 'responder', nuevo_cliente: 'la clienta es Ximena Duarte', evidencia: 'la clienta es Ximena Duarte' }), entrada('la clienta es Ximena Duarte', { pendiente: NOMBRE })));
    expect(d.paso).toMatchObject({ p: 'responder_bandeja', canonico: 'NUEVO Ximena Duarte' });
  });
});

// ── Vueltas de más (hallazgos 4 a 10) ───────────────────────────────────────

const B1: NegocioCtx = { alias: 'b1', id: 'v-b1', codigo: 'B 26 1', cliente: 'BRUNO CIFUENTES', destino: 'GUATAPÉ' };
const B2: NegocioCtx = { alias: 'b2', id: 'v-b2', codigo: 'B 26 2', cliente: 'BRUNO CIFUENTES', destino: 'TAYRONA' };
const LISTA_BRUNO = preguntaPendienteUnificada({
  tanda: { tipo: 'eleccion', texto: 'Bruno Cifuentes', candidatos: [B1, B2].map(v => ({ id: v.id, codigo: v.codigo, cliente: v.cliente, destino: v.destino })) },
  alias: id => [B1, B2].find(v => v.id === id)?.alias ?? id,
})!;

describe('hallazgo 4 · la lista de un solo cliente: pedir un viaje nuevo es su viaje nuevo', () => {
  it.each(['va aparte', 'cotízalo por separado', 'no, uno nuevo', 'otra cotización distinta', 'es una cotización diferente', 'no es cliente nuevo, es de antes', 'mejor una nueva'])(
    'el código lee «%s»', texto => expect(pideViajeNuevo(texto)).toBe(true));

  it.each(['no es nuevo', 'no uno nuevo', 'el 2', 'no es otro viaje', 'no va aparte'])('el código NO lee «%s» como viaje nuevo', texto => expect(pideViajeNuevo(texto)).toBe(false));

  it.each([
    ['ábrele una aparte', { accion: 'responder', opcion: 'nuevo' }],
    ['que sea otro, independiente de esos', { accion: 'responder', opcion: 'nuevo' }],
    ['nuevo Bruno Cifuentes', { accion: 'responder', opcion: 'nuevo', nuevo_cliente: 'Bruno Cifuentes' }],
    ['es otra solicitud suya', { accion: 'abrir_viaje', nuevo_sin_nombre: true, cliente_existente: true }],
  ])('el modelo propone «nuevo» para «%s» → viaje nuevo de Bruno Cifuentes, sin pedir el nombre', (texto, propuesta) => {
    const d = ejec(validar(una({ evidencia: texto, ...propuesta }), entrada(texto, { pendiente: LISTA_BRUNO, negocios: [B1, B2, OTRA] })));
    expect(d.paso).toMatchObject({ p: 'registrar', interpretacion: { accion: 'responder', nuevo: 'Bruno Cifuentes' } });
  });

  it('con otro nombre, con la negación o con el destino de uno de sus viajes, no', () => {
    const otra = ejec(validar(una({ accion: 'responder', opcion: 'nuevo', nuevo_cliente: 'Rosaura Pinzón', evidencia: 'nuevo Rosaura Pinzón' }), entrada('nuevo Rosaura Pinzón', { pendiente: LISTA_BRUNO, negocios: [B1, B2, OTRA] })));
    expect(otra.paso).not.toMatchObject({ interpretacion: { nuevo: 'Bruno Cifuentes' } });
    const niega = ejec(validar(una({ accion: 'responder', opcion: 'nuevo', evidencia: 'no es nuevo' }), entrada('no es nuevo', { pendiente: LISTA_BRUNO, negocios: [B1, B2, OTRA] })));
    expect(niega.paso).not.toMatchObject({ interpretacion: { nuevo: 'Bruno Cifuentes' } });
    const destino = ejec(validar(una({ accion: 'responder', opcion: 'nuevo', evidencia: 'el nuevo de Tayrona' }), entrada('el nuevo de Tayrona', { pendiente: LISTA_BRUNO, negocios: [B1, B2, OTRA] })));
    expect(destino.paso).not.toMatchObject({ interpretacion: { nuevo: 'Bruno Cifuentes' } });
  });

  it('el reparto: la interpretación «nuevo del mismo» vuelve la caja de la lista su viaje nuevo (sin abrir otra)', () => {
    const t = (min: number) => new Date(Date.parse('2026-10-05T14:00:00Z') + min * 60_000).toISOString();
    const viajes: ViajeAbierto[] = [B1, B2].map(v => ({ id: v.id, codigo: v.codigo, cliente: v.cliente, destino: v.destino }));
    const ms: MensajeViaje[] = [
      { n: 1, cuerpo: 'Bruno Cifuentes', reenviado: false, tipo: 'text', en: t(1) },
      { n: 2, cuerpo: 'ábrele una aparte', reenviado: false, tipo: 'text', en: t(2), interpretacion: { accion: 'responder', nuevo: 'Bruno Cifuentes' } },
      { n: 3, cuerpo: 'queremos ir a Salento', reenviado: true, tipo: 'text', en: t(3) },
    ];
    const { segmentos, encabezados } = armarSegmentos(ms, viajes, { horasCajaActiva: 2 });
    expect(segmentos).toHaveLength(1);
    expect(segmentos[0].encabezado?.resolucion).toMatchObject({ tipo: 'nuevo', cliente: 'Bruno Cifuentes', mismo: true });
    expect(segmentos[0].mensajes).toEqual([3]);
    expect(encabezados).toEqual([1, 2]);
  });
});

const ficha = (id: string, o: Partial<FichaCliente> = {}): FichaCliente => ({ id, nombre: 'BRUNO CIFUENTES', cel4: null, correo: false, abiertos: [], ...o });

describe('hallazgo 5 · «¿Cuál es?» de los homónimos', () => {
  const OPS = [ficha('f1', { cel4: '4410' }), ficha('f2', { correo: true }), ficha('f3')];
  it.each([
    ['me refiero al segundo que me mostraste', 'f2'],
    ['creo que es el tercero de la lista', 'f3'],
    ['es el del correo', 'f2'],
    ['el que tiene el correo', 'f2'],
    ['la ficha que no tiene celular ni nada', 'f3'],
    ['el que no tiene datos', 'f3'],
    ['el del celular', 'f1'],
  ])('«%s» → %s', (texto, id) => {
    const r = leerEleccionCliente(texto, OPS);
    expect(r).toMatchObject({ tipo: 'ficha', ficha: { id } });
  });

  it('dos ordinales, o el dato que comparten dos, no eligen', () => {
    expect(leerEleccionCliente('el primero o el segundo', OPS)).toBeNull();
    expect(leerEleccionCliente('el del correo', [ficha('a', { correo: true }), ficha('b', { correo: true })])).toBeNull();
  });
});

describe('hallazgo 6 · «¿Es la misma persona?» con una afirmación larga', () => {
  const MISMA = preguntaPendienteUnificada({ tanda: { tipo: 'cliente', texto: 'Ese celular ya lo tenemos a nombre de Bruno Cifuentes. ¿Es la misma persona?', esLaMisma: true } })!;
  it('empieza por «sí» y no tiene reserva: va a la tanda como «sí»', () => {
    const texto = 'sí, es él, se registró hace dos años con otro correo';
    for (const propuesta of [{ accion: 'confirmar', evidencia: texto }, { accion: 'responder', opcion: 'si', evidencia: texto }]) {
      expect(ejec(validar(una(propuesta), entrada(texto, { pendiente: MISMA }))).paso).toMatchObject({ p: 'registrar', interpretacion: { accion: 'confirmar', canonico: 'sí' } });
    }
  });
  it.each(['sí, pero déjame confirmar', 'creo que sí es él', 'sí? no estoy seguro', 'sí, aunque no sé si es el papá'])('«%s» vuelve a preguntar', texto => {
    expect(ejec(validar(una({ accion: 'confirmar', evidencia: texto }), entrada(texto, { pendiente: MISMA }))).paso.p).toBe('decir');
  });
  it('si la pregunta no es «¿Es la misma persona?», el «sí» del modelo no vale', () => {
    const OTRA_CLIENTE = preguntaPendienteUnificada({ tanda: { tipo: 'cliente', texto: '¿Me pasas su celular o su correo?' } })!;
    expect(ejec(validar(una({ accion: 'confirmar', evidencia: 'sí, es él' }), entrada('sí, es él', { pendiente: OTRA_CLIENTE }))).paso.p).toBe('decir');
  });
});

describe('hallazgo 7 · la llave con palabras de más, en la caja de un viaje nuevo', () => {
  it.each(['anótale a don Bruno el cel 300 111 2222', 'regístrale el correo bruno.c@correo.co a Bruno', 'apunta: Bruno Cifuentes 300 111 2222'])('«%s» es la llave', texto => {
    expect(soloLlaveDelCliente(texto, 'Bruno Cifuentes')).not.toBeNull();
  });
  it.each(['el de la esposa es 300 111 2222', 'anótale a Rosaura el cel 300 111 2222', 'quiere ir el 12, cel 300 111 2222'])('«%s» no', texto => {
    expect(soloLlaveDelCliente(texto, 'Bruno Cifuentes')).toBeNull();
  });
});

describe('hallazgo 8 · un cliente sin viajes abiertos, nombrado al corregir', () => {
  it('con la lista pendiente, «es de Marcela Ortiz» (sin viajes abiertos) es su viaje nuevo, no «no encontré»', () => {
    const d = ejec(validar(una({ accion: 'responder', ref_cliente: 'Marcela Ortiz', evidencia: 'es de Marcela Ortiz' }), entrada('es de Marcela Ortiz', { pendiente: LISTA_BRUNO, negocios: [B1, B2, OTRA] })));
    expect(d.paso).toMatchObject({ p: 'registrar', interpretacion: { accion: 'abrir_viaje', nuevo: 'Marcela Ortiz' } });
  });
  it('«no, era de Marcela Ortiz» como encabezado: lo mismo', () => {
    const d = ejec(validar(una({ accion: 'abrir_viaje', ref_cliente: 'Marcela Ortiz', evidencia: 'no, era de Marcela Ortiz' }), entrada('no, era de Marcela Ortiz', { tanda: { abierta: true, cajaId: 'v-otra', cliente: 'Rosaura Pinzón' } })));
    expect(d.paso).toMatchObject({ interpretacion: { accion: 'abrir_viaje', nuevo: 'Marcela Ortiz' } });
  });
  it('un nombre de pila suelto, o sin contexto de corrección, sigue como hoy', () => {
    const pila = ejec(validar(una({ accion: 'abrir_viaje', ref_cliente: 'Marcela', evidencia: 'no, era de Marcela' }), entrada('no, era de Marcela')));
    expect(pila.paso).toMatchObject({ interpretacion: { accion: 'preguntar_viaje' } });
    const sinContexto = ejec(validar(una({ accion: 'abrir_viaje', ref_cliente: 'Marcela Ortiz', evidencia: 'Marcela Ortiz' }), entrada('Marcela Ortiz')));
    expect(sinContexto.paso).toMatchObject({ interpretacion: { accion: 'preguntar_viaje' } });
  });
});

describe('hallazgo 9 · los avisos de la llave', () => {
  it('celular distinto del de la ficha: se dice que no se cambia', () => {
    const r = { tipo: 'existente' as const, ficha: ficha('f1', { cel4: '7788' }), por: 'nombre' as const, nombre: 'Bruno Cifuentes', llave: { celular: '3001112222' } };
    expect(textoDelCliente(r)).toContain('Su ficha tiene otro celular (…7788); el que me diste (…2222) no lo cambio.');
  });
  it('la ficha sin celular: el acuse y el resumen dicen que se le agrega', () => {
    const f = ficha('f1');
    expect(textoDelCliente({ tipo: 'existente', ficha: f, por: 'nombre', nombre: 'Bruno Cifuentes', llave: { celular: '3001112222' } })).toContain('Le agrego a su ficha el cel. 300 111 2222.');
    expect(nombreDestino({ tipo: 'nuevo', cliente: 'Bruno Cifuentes', contacto: f, llave: { celular: '3001112222' }, resuelto: true }))
      .toBe('Viaje nuevo de Bruno Cifuentes (ya es cliente: sin celular ni correo, sin viajes; le agrego a su ficha el cel. 300 111 2222)');
  });
  it('la llave que es la de la ficha: nada que decir', () => {
    expect(textoDelCliente({ tipo: 'existente', ficha: ficha('f1', { cel4: '2222' }), por: 'llave', nombre: null, llave: { celular: '3001112222' } })).not.toMatch(/ficha/);
  });
});

describe('hallazgo 10 · cortesías y roles', () => {
  it.each(['sí, créaselo', 'sí, regístraselo por favor', 'dale, ábremelo'])('«%s» a «¿Creo el cliente nuevo …?» es el «sí»', texto => {
    expect(interpretarConfirmacionNuevo(texto, [], 'Bruno Cifuentes')).toEqual({ tipo: 'si' });
  });
  it.each(['legalízame el peaje de ayer', 'súbeme esta factura', 'tanqueé la camioneta', 'pagamos el parqueadero'])('«%s» pide registrar (un rol que no registra recibe el texto de su rol)', texto => {
    expect(pideRegistrar(texto)).toBe(true);
  });
});
