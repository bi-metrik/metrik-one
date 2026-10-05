import { describe, expect, it } from 'vitest';
import {
  preguntaPendienteUnificada,
  validar,
  type Decision,
  type EntradaValidador,
  type NegocioCtx,
} from './wa-interprete-reglas.ts';
import { armarSegmentos, esNombreNuevo, esSiSinReserva, sinPresentacion, type MensajeViaje, type ViajeAbierto } from './wa-viajes-reglas.ts';

/**
 * Lo que dejó el octavo control de Vera sobre #1024 (2026-10-05), una prueba por regla. Textos y nombres inventados
 * para estas pruebas (Teodoro Salcedo, Teodoro Ibarra, Ximena Duarte), ninguno de la prueba de Vera.
 *   1. El «sí» del resumen con una condición no carga: vuelve a preguntar.
 *   2. En la caja de un viaje NUEVO de X, nombrar a X es contenido de esa caja, no un viaje abierto de X.
 *   3. El nombre tras «¿Para qué cliente es?» pierde la fórmula que lo presenta, en los dos géneros.
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
