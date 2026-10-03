import { describe, expect, it } from 'vitest';

/**
 * Control sellado de Vera 2026-10-02b, NU5: «nuevo/nueva» + un sustantivo común de la agencia creaba un
 * cliente con ese sustantivo por nombre, por la respuesta a la lista, por el encabezado y por «el N es de
 * nuevo …». Una sola regla (`calificarNombreNuevo`) para los tres. Nombres y sustantivos INVENTADOS: la
 * regla no puede depender de una lista hecha a la medida de unas frases.
 */
import { calificarNombreNuevo, leerNuevo, textoNombreNuevoEnDuda } from './wa-entendimiento-reglas';
import { interpretarRespuestaNegocio, type OpcionNegocio } from './wa-carga-reglas';
import { armarPlan, armarSegmentos, interpretarRespuestaPlan, resolverEncabezado, type MensajeViaje, type ViajeAbierto } from './wa-viajes-reglas';

const OPS: OpcionNegocio[] = [{ id: 'p', codigo: 'P 26 2', cliente: 'Pedro Prueba5', destino: 'SAN ANDRÉS', nombre: 'SAN ANDRÉS DIC' } as OpcionNegocio];

describe('calificarNombreNuevo: lo que sigue a «nuevo» solo crea cliente si parece un nombre', () => {
  it('nombres de 2 a 4 palabras, compuestos, con trato al comienzo o con el celular: nombre', () => {
    for (const n of ['Daniela Rojas', 'Juan Pablo Gómez Ruiz', 'Ignacio Salgar', 'María de los Ángeles', 'Pérez de la Rosa',
      'doña Rosalba Quiñones', 'Laura Prueba2', 'Concepción Arizmendi', 'Marta Gómez 3005551234', 'Luz Marina Torres', 'Ana Paz']) {
      expect([n, calificarNombreNuevo(n)]).toEqual([n, 'nombre']);
    }
  });

  it('una sola palabra es duda, sea sustantivo inventado o apellido: se pregunta (nunca se crea)', () => {
    for (const n of ['zarandela', 'trompiflo', 'Salgar', 'Pérez', 'doña Rosalba', 'Marta 3005551234']) {
      expect([n, calificarNombreNuevo(n)]).toEqual([n, 'duda']);
    }
  });

  it('vocabulario de la agencia, parentesco, gramática o forma de sustantivo común: duda', () => {
    for (const n of ['brindoleta grupal', 'reserva Zuleta', 'tía de Rosalba Quiñones', 'el esposo de Marta', 'la hija de Ignacio',
      'zarandelación Quiñones', 'trompiflamiento grupal', 'Ignacio y su familia', 'plan Salgar', 'Rosalba 12', 'de la Rosa']) {
      expect([n, calificarNombreNuevo(n)]).toEqual([n, 'duda']);
    }
  });

  it('sin nombre y por encima del tope', () => {
    expect(calificarNombreNuevo(null)).toBe('sin_nombre');
    expect(calificarNombreNuevo('  ')).toBe('sin_nombre');
    expect(calificarNombreNuevo('cotización con hotel 4 estrellas')).toBe('largo');
  });

  it('«nueva, se llama X Y»: el nombre es lo que sigue a «se llama»', () => {
    expect(leerNuevo('nueva, se llama Rosalba Quiñones')).toEqual({ cliente: 'Rosalba Quiñones' });
    expect(leerNuevo('cliente nuevo que se llama Ignacio Salgar')).toEqual({ cliente: 'Ignacio Salgar' });
  });
});

describe('la respuesta a «¿A qué viaje van?»', () => {
  it('lo que no parece un nombre es `nuevo_en_duda`; lo de siempre sigue igual', () => {
    expect(interpretarRespuestaNegocio('nueva zarandela', OPS)).toEqual({ tipo: 'nuevo_en_duda', propuesto: 'zarandela' });
    expect(interpretarRespuestaNegocio('Nuevo trompiflo.', OPS)).toEqual({ tipo: 'nuevo_en_duda', propuesto: 'trompiflo' });
    expect(interpretarRespuestaNegocio('nuevo Salgar', OPS)).toEqual({ tipo: 'nuevo_en_duda', propuesto: 'Salgar' });
    expect(interpretarRespuestaNegocio('nueva tía de Rosalba', OPS)).toEqual({ tipo: 'nuevo_en_duda', propuesto: 'tía de Rosalba' });
    expect(interpretarRespuestaNegocio('nuevo', OPS)).toEqual({ tipo: 'nuevo', cliente: null });
    expect(interpretarRespuestaNegocio('cliente nuevo', OPS)).toEqual({ tipo: 'nuevo', cliente: null });
    expect(interpretarRespuestaNegocio('nueva Daniela Rojas', OPS)).toEqual({ tipo: 'nuevo', cliente: 'Daniela Rojas' });
    expect(interpretarRespuestaNegocio('nuevo: Juan Pablo Gómez Ruiz', OPS)).toEqual({ tipo: 'nuevo', cliente: 'Juan Pablo Gómez Ruiz' });
    expect(interpretarRespuestaNegocio('nueva, se llama Rosalba Quiñones', OPS)).toEqual({ tipo: 'nuevo', cliente: 'Rosalba Quiñones' });
    expect(interpretarRespuestaNegocio('nueva cotización con hotel 4 estrellas', OPS)).toEqual({ tipo: 'no_entendida' });
  });

  it('el texto de la re-pregunta cita lo propuesto y dice cómo seguir', () => {
    expect(textoNombreNuevoEnDuda('zarandela')).toBe('Para crear un cliente nuevo necesito su nombre y apellido; con «zarandela» no lo creo.'
      + ' Responde NUEVO y el nombre completo (ej.: NUEVO Marta Gómez), NUEVO solo para tomarlo de los mensajes, o el número del viaje.');
  });
});

describe('el encabezado', () => {
  const VS: ViajeAbierto[] = [{ id: 'r', codigo: 'R 26 1', cliente: 'ROSALBA QUIÑONES', destino: 'CARTAGENA' }];
  it('«nueva zarandela» es un «nuevo» SIN nombre: el bot pide el nombre; con nombre y apellido, como siempre', () => {
    expect(resolverEncabezado('nueva zarandela', VS)).toEqual({ tipo: 'nuevo', cliente: null, en_duda: 'zarandela' });
    expect(resolverEncabezado('nuevo Salgar', VS)).toEqual({ tipo: 'nuevo', cliente: null, en_duda: 'Salgar' });
    expect(resolverEncabezado('nuevo Ignacio Salgar', VS)).toEqual({ tipo: 'nuevo', cliente: 'Ignacio Salgar' });
    expect(resolverEncabezado('nuevo', VS)).toEqual({ tipo: 'nuevo', cliente: null });
    expect(resolverEncabezado('nueva cotización con hotel 4 estrellas', VS)).toBeNull();
  });

  it('en la tanda, «nueva zarandela» abre una caja sin nombre: el resumen nunca dice «NUEVO zarandela»', () => {
    const ms: MensajeViaje[] = [
      { n: 1, cuerpo: 'nueva zarandela', reenviado: false, tipo: 'text', en: '2026-10-03T10:00:00Z' },
      { n: 2, cuerpo: 'Queremos ir a Cartagena en diciembre', reenviado: true, tipo: 'text', en: '2026-10-03T10:00:05Z' },
    ];
    const { segmentos, encabezados } = armarSegmentos(ms, VS, { horasCajaActiva: 4 });
    const plan = armarPlan({ mensajes: ms, viajes: VS, segmentos, encabezados });
    expect(JSON.stringify(plan)).not.toMatch(/zarandela"/i);
    expect(plan.mensajes.some(m => m.destino?.tipo === 'nuevo' && m.destino.cliente)).toBe(false);
  });
});

describe('«el N es de nuevo …» con el resumen', () => {
  const VS: ViajeAbierto[] = [{ id: 'r', codigo: 'R 26 1', cliente: 'ROSALBA QUIÑONES', destino: 'CARTAGENA' }];
  const ms: MensajeViaje[] = [
    { n: 1, cuerpo: 'Rosalba Quiñones', reenviado: false, tipo: 'text', en: '2026-10-03T10:00:00Z' },
    { n: 2, cuerpo: 'Queremos ir a Cartagena', reenviado: true, tipo: 'text', en: '2026-10-03T10:00:05Z' },
    { n: 3, cuerpo: 'Somos 4 adultos', reenviado: true, tipo: 'text', en: '2026-10-03T10:00:10Z' },
  ];
  const { segmentos, encabezados } = armarSegmentos(ms, VS, { horasCajaActiva: 4 });
  const plan = armarPlan({ mensajes: ms, viajes: VS, segmentos, encabezados });

  it('con algo que no parece un nombre: no entra al borrador y se pide nombre y apellido', () => {
    const r = interpretarRespuestaPlan('el 2 es de nuevo trompiflo', plan, VS);
    expect(r).toEqual({ tipo: 'no_entendida', aviso: 'Para un cliente nuevo escribe su nombre y apellido: «el 2 es de nuevo Marta Gómez». Con «de nuevo trompiflo» no lo creo.' });
    expect(interpretarRespuestaPlan('el 2 es nuevo Salgar', plan, VS)).toMatchObject({ tipo: 'no_entendida' });
    expect(interpretarRespuestaPlan('el 2 es de nueva tía de Rosalba', plan, VS)).toMatchObject({ tipo: 'no_entendida' });
  });

  it('por encima del tope: no se entiende (antes dejaba «NUEVO <todo el texto>» en el borrador)', () => {
    const r = interpretarRespuestaPlan('el 2 es de nuevo grupo de amigos del colegio de Ignacio', plan, VS);
    expect(r.tipo).toBe('no_entendida');
  });

  it('con nombre y apellido, o «se llama …», sigue igual', () => {
    expect(interpretarRespuestaPlan('el 2 es de nuevo Ignacio Salgar', plan, VS)).toMatchObject({ tipo: 'corregir', cambios: [{ a: { tipo: 'nuevo', cliente: 'Ignacio Salgar' } }] });
    expect(interpretarRespuestaPlan('el 2 es de nuevo, se llama Ignacio Salgar', plan, VS)).toMatchObject({ tipo: 'corregir', cambios: [{ a: { tipo: 'nuevo', cliente: 'Ignacio Salgar' } }] });
  });
});
