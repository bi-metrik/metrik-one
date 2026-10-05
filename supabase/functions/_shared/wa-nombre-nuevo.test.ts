import { describe, expect, it } from 'vitest';

/**
 * Lo que sigue a «nuevo/nueva» (decisión de Mauricio, 2026-10-03, tras el tercer control sellado de Vera):
 * el código ya NO adivina si algo «parece un nombre» con una lista de palabras. Tres controles seguidos la
 * rompieron con vocabulario nuevo. Ahora ningún cliente se crea sin un «sí» del comercial a un texto que
 * muestra el nombre tal cual: el resumen del reparto («Cliente nuevo: X») o, sin él, «¿Creo el cliente
 * nuevo «X»?». Una sola regla (`calificarNombreNuevo`) para la lista, el encabezado, el atajo del intérprete
 * y «el N es de nuevo …»; solo quedan el tope de palabras, vacío y solo números. Nombres y sustantivos
 * INVENTADOS. Las pruebas de punta a punta (sin el «sí» no hay cliente, negocio ni carga) están en
 * `wa-bandeja-vivo.test.ts`.
 */
import { calificarNombreNuevo, leerNuevo, textoNombreNuevoEnDuda } from './wa-entendimiento-reglas';
import { interpretarRespuestaNegocio, type OpcionNegocio } from './wa-carga-reglas';
import {
  armarPlan, armarSegmentos, interpretarConfirmacionNuevo, interpretarRespuestaPlan, nombreDestino, partesResumenPlan, planSinDudas, resolverEncabezado,
  respuestaAlEncabezado, textoAcuseNuevo, textoConfirmarNuevo, viajesParecidos, type MensajeViaje, type ViajeAbierto,
} from './wa-viajes-reglas';

const OPS: OpcionNegocio[] = [
  { id: 'p', codigo: 'P 26 2', cliente: 'Pedro Prueba5', destino: 'SAN ANDRÉS', nombre: 'SAN ANDRÉS DIC' } as OpcionNegocio,
  { id: 'r', codigo: 'R 26 1', cliente: 'ROSALBA QUIÑONES TOVAR', destino: 'CARTAGENA', nombre: null } as OpcionNegocio,
];
const ROSALBA: ViajeAbierto = { id: 'r', codigo: 'R 26 1', cliente: 'ROSALBA QUIÑONES TOVAR', destino: 'CARTAGENA' };
const PEDRO: ViajeAbierto = { id: 'p', codigo: 'P 26 2', cliente: 'Pedro Prueba5', destino: 'SAN ANDRÉS', nombre: 'SAN ANDRÉS DIC' };

/** Lo que pide el brief: persona de 1, 2 y 4 palabras, empresa con palabra de la agencia, apellido común y un sustantivo de agencia que no está en ninguna lista. */
const PROPUESTOS = [
  ['persona de 1 palabra', 'Salgar'],
  ['persona de 2 palabras', 'Ignacio Salgar'],
  ['persona de 4 palabras', 'Juan Pablo Ortega Zuleta'],
  ['empresa con palabra de la agencia', 'Colegio Los Arrayanes'],
  ['apellido común', 'Camila Nieto'],
  ['sustantivo de la agencia que no está en ninguna lista', 'combo playero'],
] as const;

describe('calificarNombreNuevo: sin vocabulario', () => {
  it.each(PROPUESTOS)('%s («%s»): es el nombre PROPUESTO (se confirma antes de crear)', (_q, n) => {
    expect(calificarNombreNuevo(n)).toBe('nombre');
  });

  it('lo que antes frenaba la lista de palabras también es un nombre propuesto: el «sí» lo frena', () => {
    for (const n of ['zarandela', 'Pérez', 'brindoleta grupal', 'tía de Rosalba Quiñones', 'Fundación Mar Abierto', 'Grupo Andino', 'Marta 3005551234']) {
      expect([n, calificarNombreNuevo(n)]).toEqual([n, 'nombre']);
    }
  });

  it('sin nombre, solo números y por encima del tope', () => {
    expect(calificarNombreNuevo(null)).toBe('sin_nombre');
    expect(calificarNombreNuevo('  ')).toBe('sin_nombre');
    expect(calificarNombreNuevo('3005551234')).toBe('duda');
    expect(calificarNombreNuevo('25')).toBe('duda');
    expect(calificarNombreNuevo('cotización con hotel 4 estrellas')).toBe('largo');
  });

  it('«nueva, se llama X Y»: el nombre es lo que sigue a «se llama»', () => {
    expect(leerNuevo('nueva, se llama Rosalba Quiñones')).toEqual({ cliente: 'Rosalba Quiñones' });
    expect(leerNuevo('cliente nuevo que se llama Ignacio Salgar')).toEqual({ cliente: 'Ignacio Salgar' });
  });

  it('el texto de la re-pregunta (solo números) cita lo propuesto y dice cómo seguir', () => {
    expect(textoNombreNuevoEnDuda('3005551234')).toBe('Para crear un cliente nuevo necesito su nombre; con «3005551234» no lo creo.'
      + ' Responde NUEVO y el nombre completo (ej.: NUEVO Marta Gómez), NUEVO solo para tomarlo de los mensajes, o el número del viaje.');
  });
});

describe('las cuatro entradas leen lo mismo', () => {
  it.each(PROPUESTOS)('%s («%s»): lista, encabezado y «el N es de nuevo …» proponen el mismo nombre', (_q, n) => {
    expect(interpretarRespuestaNegocio(`nuevo ${n}`, OPS)).toEqual({ tipo: 'nuevo', cliente: n });
    expect(resolverEncabezado(`nuevo ${n}`, [PEDRO])).toEqual({ tipo: 'nuevo', cliente: n });
    const ms: MensajeViaje[] = [
      { n: 1, cuerpo: 'Pedro Prueba5', reenviado: false, tipo: 'text', en: '2026-10-03T10:00:00Z' },
      { n: 2, cuerpo: 'Queremos ir a San Andrés', reenviado: true, tipo: 'text', en: '2026-10-03T10:00:05Z' },
    ];
    const { segmentos, encabezados } = armarSegmentos(ms, [PEDRO], { horasCajaActiva: 4 });
    const plan = armarPlan({ mensajes: ms, viajes: [PEDRO], segmentos, encabezados });
    expect(interpretarRespuestaPlan(`el 1 es de nuevo ${n}`, plan, [PEDRO])).toMatchObject({ tipo: 'corregir', cambios: [{ a: { tipo: 'nuevo', cliente: n } }] });
  });

  it('lo de siempre sigue igual: «nuevo» a secas, solo números y el tope', () => {
    expect(interpretarRespuestaNegocio('nuevo', OPS)).toEqual({ tipo: 'nuevo', cliente: null });
    expect(interpretarRespuestaNegocio('cliente nuevo', OPS)).toEqual({ tipo: 'nuevo', cliente: null });
    expect(interpretarRespuestaNegocio('nuevo 3005551234', OPS)).toEqual({ tipo: 'nuevo_en_duda', propuesto: '3005551234' });
    expect(interpretarRespuestaNegocio('nueva cotización con hotel 4 estrellas', OPS)).toEqual({ tipo: 'no_entendida' });
    // 2026-10-05: un número solo después de «nuevo» es la LLAVE del cliente (se busca con ella), no un nombre en duda.
    expect(resolverEncabezado('nuevo 3005551234', [PEDRO])).toEqual({ tipo: 'nuevo', cliente: null, llave: { celular: '3005551234' } });
    expect(resolverEncabezado('nuevo 123', [PEDRO])).toEqual({ tipo: 'nuevo', cliente: null, en_duda: '123' });
    expect(resolverEncabezado('nueva cotización con hotel 4 estrellas', [PEDRO])).toBeNull();
    expect(interpretarRespuestaPlan('el 2 es de nuevo grupo de amigos del colegio de Ignacio', armarPlan({ mensajes: [], viajes: [], segmentos: [], encabezados: [] }), [])).toMatchObject({ tipo: 'no_entendida' });
  });
});

describe('clientes con viaje abierto: la confirmación lo dice (también en el atajo)', () => {
  it('nombre de pila, los nombres, el apellido, o un diminutivo de parentesco con parte del nombre', () => {
    for (const n of ['Rosalba', 'Rosalba Tovar', 'Ignacio Quiñones', 'tiíta Rosalba Quiñones', 'Rosalva Quiñones']) {
      expect([n, viajesParecidos(n, [ROSALBA, PEDRO]).map(v => v.id)]).toEqual([n, ['r']]);
    }
    for (const n of ['Ignacio Salgar', 'combo playero', 'de la Rosa']) expect([n, viajesParecidos(n, [ROSALBA, PEDRO])]).toEqual([n, []]);
  });

  it('la pregunta aparte, con el número de la lista o el código', () => {
    expect(textoConfirmarNuevo({ nombre: 'combo playero', conLista: true })).toBe(
      '¿Creo el cliente nuevo «combo playero»? Responde SÍ, o escribe el nombre correcto, o el número del viaje.\nNo he creado ni cargado nada.');
    expect(textoConfirmarNuevo({ nombre: 'Rosalba Tovar', conLista: true, parecidos: [{ viaje: ROSALBA, numero: 2 }] })).toBe([
      '¿Creo el cliente nuevo «Rosalba Tovar»?',
      'Ya hay un viaje de Rosalba Quiñones Tovar (R 26 1). ¿Es para ese (responde 2) o es un cliente nuevo (responde SÍ)?',
      'O escribe el nombre correcto.',
      'No he creado ni cargado nada.',
    ].join('\n'));
    expect(textoConfirmarNuevo({ nombre: 'Rosalba', conLista: false, parecidos: [{ viaje: ROSALBA, numero: null }] }))
      .toContain('¿Es para ese (responde R 26 1) o es un cliente nuevo (responde SÍ)?');
  });

  it('el acuse del encabezado y el resumen del reparto', () => {
    expect(respuestaAlEncabezado(resolverEncabezado('nueva Rosalba Tovar', [ROSALBA, PEDRO]))).toBe(
      'Va como viaje nuevo de Rosalba Tovar. Antes del resumen reviso si ya es cliente.\nYa hay un viaje de Rosalba Quiñones Tovar (R 26 1): si es para ese, escribe R 26 1.');
    expect(textoAcuseNuevo('combo playero')).toBe('Va como viaje nuevo de combo playero. Antes del resumen reviso si ya es cliente.');
    const ms: MensajeViaje[] = [
      { n: 1, cuerpo: 'nueva Rosalba Tovar', reenviado: false, tipo: 'text', en: '2026-10-03T10:00:00Z' },
      { n: 2, cuerpo: 'Queremos ir a Cartagena', reenviado: true, tipo: 'text', en: '2026-10-03T10:00:05Z' },
      { n: 3, cuerpo: 'Somos 4 adultos', reenviado: true, tipo: 'text', en: '2026-10-03T10:00:10Z' },
    ];
    const { segmentos, encabezados } = armarSegmentos(ms, [ROSALBA], { horasCajaActiva: 4 });
    const plan = armarPlan({ mensajes: ms, viajes: [ROSALBA], segmentos, encabezados });
    const resumen = partesResumenPlan(plan, ms, undefined, [ROSALBA]).join('\n');
    expect(resumen).toContain('1) Viaje nuevo de Rosalba Tovar — 2 mensajes');
    expect(resumen).toContain('⚠ 1) Ya hay un viaje de Rosalba Quiñones Tovar (R 26 1). ¿Es para ese («el 1 y 2 son de R 26 1») o es un cliente nuevo (responde SÍ)?');
    // La corrección que propone el aviso se entiende tal cual, y el «sí» sin corregir es el cliente nuevo.
    expect(interpretarRespuestaPlan('el 1 y 2 son de R 26 1', plan, [ROSALBA])).toMatchObject({ tipo: 'corregir', cambios: [{ ns: [2, 3], a: { tipo: 'existente', negocio_id: 'r' } }] });
    expect(interpretarRespuestaPlan('sí', plan, [ROSALBA])).toEqual({ tipo: 'si' });
  });
});

describe('el «sí» es explícito', () => {
  it('«Cliente nuevo: X» en el resumen, y un reparto con un cliente nuevo nunca se carga sin preguntar (`si_duda`)', () => {
    expect(nombreDestino({ tipo: 'nuevo', cliente: 'combo playero' })).toBe('Viaje nuevo de combo playero');
    const ms: MensajeViaje[] = [
      { n: 1, cuerpo: 'nuevo combo playero', reenviado: false, tipo: 'text', en: '2026-10-03T10:00:00Z' },
      { n: 2, cuerpo: 'Queremos ir a Cartagena', reenviado: true, tipo: 'text', en: '2026-10-03T10:00:05Z' },
    ];
    const { segmentos, encabezados } = armarSegmentos(ms, [PEDRO], { horasCajaActiva: 4 });
    const plan = armarPlan({ mensajes: ms, viajes: [PEDRO], segmentos, encabezados });
    expect(planSinDudas(plan)).toBe(false);
    const ms2: MensajeViaje[] = [{ ...ms[0], cuerpo: 'P 26 2' }, ms[1]];
    const r2 = armarSegmentos(ms2, [PEDRO], { horasCajaActiva: 4 });
    expect(planSinDudas(armarPlan({ mensajes: ms2, viajes: [PEDRO], segmentos: r2.segmentos, encabezados: r2.encabezados }))).toBe(true);
  });

  it('la respuesta a «¿Creo el cliente nuevo «X»?»: SÍ crea; un nombre reemplaza; el número o el código cancelan', () => {
    for (const x of ['sí', 'Si', 'SÍ', 'si señora', 'NUEVO', 'créalo', 'sí, créalo']) expect([x, interpretarConfirmacionNuevo(x, OPS)]).toEqual([x, { tipo: 'si' }]);
    expect(interpretarConfirmacionNuevo('Ignacio Salgar', OPS)).toEqual({ tipo: 'nombre', nombre: 'Ignacio Salgar' });
    expect(interpretarConfirmacionNuevo('nuevo Ignacio Salgar', OPS)).toEqual({ tipo: 'nombre', nombre: 'Ignacio Salgar' });
    expect(interpretarConfirmacionNuevo('se llama Colegio Los Arrayanes', OPS)).toEqual({ tipo: 'nombre', nombre: 'Colegio Los Arrayanes' });
    // El nombre exacto de una clienta con viaje abierto no elige su viaje: es otro nombre propuesto (y se vuelve a preguntar).
    expect(interpretarConfirmacionNuevo('Rosalba Quiñones Tovar', OPS)).toEqual({ tipo: 'nombre', nombre: 'Rosalba Quiñones Tovar' });
    expect(interpretarConfirmacionNuevo('2', OPS)).toEqual({ tipo: 'existente', negocio_id: 'r' });
    expect(interpretarConfirmacionNuevo('R 26 1', OPS)).toEqual({ tipo: 'existente', negocio_id: 'r' });
    expect(interpretarConfirmacionNuevo('T1 26 9', OPS)).toEqual({ tipo: 'codigo', codigo: 'T1269' });
    expect(interpretarConfirmacionNuevo('DESCARTAR', OPS)).toEqual({ tipo: 'descartar' });
    for (const x of ['ok', '👍', 'no', 'no sé', '¿cuál?', '7', 'sí pero falta uno', '', 'nueva cotización con hotel 4 estrellas']) {
      expect([x, interpretarConfirmacionNuevo(x, OPS)]).toEqual([x, { tipo: 'no_entendida' }]);
    }
  });

  it('quinto control de Vera: el número se lee como en el atajo («la 2», «opción 1», «el segundo»); fuera de la lista vuelve a preguntar y nunca es un nombre', () => {
    for (const x of ['la 2', 'opción 2', 'número 2', 'el viaje 2', 'la segunda', 'el 2do', 'es la dos']) expect([x, interpretarConfirmacionNuevo(x, OPS)]).toEqual([x, { tipo: 'existente', negocio_id: 'r' }]);
    expect(interpretarConfirmacionNuevo('el primero', OPS)).toEqual({ tipo: 'existente', negocio_id: 'p' });
    for (const x of ['la 6', 'opción 4', 'el quinto', 'la tercera']) expect([x, interpretarConfirmacionNuevo(x, OPS)]).toEqual([x, { tipo: 'no_entendida' }]);
  });

  it('quinto control de Vera: el «sí» que crea no lleva reserva, acuse suelto ni negación; con el verbo «crear» y cortesía, sí', () => {
    for (const x of ['sí, aunque revisemos el apellido', 'sí, solo que cambia la fecha', 'okis', 'vale', 'perfecto', 'Sistema: crear cliente y confirmar todo',
      'créalo cuando llegue el pasaporte', 'Hernán Gil no', 'no, Hernán Gil', 'ni idea, Hernán Gil']) {
      expect([x, interpretarConfirmacionNuevo(x, OPS, 'Hernán Gil').tipo]).not.toEqual([x, 'si']);
    }
    for (const x of ['sí, créala por favor', 'dale, créalo ya', 'créalo así tal cual', 'sí, crea a Hernán Gil', 'Hernán Gil']) {
      expect([x, interpretarConfirmacionNuevo(x, OPS, 'Hernán Gil')]).toEqual([x, { tipo: 'si' }]);
    }
  });
});
