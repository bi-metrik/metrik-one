import { describe, expect, it } from 'vitest';
import { entradaRedaccion, faltantesDelFijo, leerConfigRedaccion, lineasFijas, validarRedaccion } from './wa-redaccion-reglas.ts';
import type { PedidoRedaccion } from './wa-redaccion-reglas.ts';

/**
 * El modelo redacta (PR 2, 2026-10-05): el interruptor y la validación por código. Cada caso trampa es un texto que un
 * modelo podría devolver con un dato inventado, una promesa que no se hizo o una pregunta de más: la validación lo
 * rechaza y sale el fijo. Textos inventados.
 */

const CONSULTA = 'SAN ANDRÉS DIC · Fermín Ocampo (F 26 1) — Mínimo 9/9 (100 %) · Completo 9/10 (90 %)\nLe falta 1 dato para completo: presupuesto aproximado del viaje.';
const CARGA = 'Cargué en SAN ANDRÉS DIC · Fermín Ocampo (F 26 1): destino SAN ANDRÉS, adultos 2, niños 1.\nSAN ANDRÉS DIC · Fermín Ocampo (F 26 1) — Mínimo 6/9 (67 %) · Completo 6/10 (60 %)\nPara empezar a cotizar me falta:\n1. ¿Desde qué ciudad salen?\n2. ¿Qué edad tiene cada niño?\n3. ¿De qué categoría prefieren el hotel?';
const DOS_VIAJES = '¿Para cuál viaje es lo que me escribiste: SAN ANDRÉS DIC · Fermín Ocampo (F 26 1) o CARTAGENA ENE · Gloria Arbeláez (G 26 1)? Dime cuál, o «nuevo» y el nombre del cliente si es un viaje nuevo.';
const RESUMEN = '¿Cargo este viaje?\n\n*Viaje nuevo · Gloria Arbeláez*\nCliente nuevo · cel. 300 777 3344\n\n1. «Hola, queremos ir a Cartagena en enero»\n2. «somos 2 adultos y un niño de 8 años»\n\nPara mover o quitar uno, escríbeme: «el 2 es de Luisa» o «quita el 2».';
const MISMA = 'Ese celular ya lo tenemos a nombre de Paola Andrea Rincón Díaz (último viaje: CARTAGENA MAR). ¿Es la misma persona?';
const NO_CARGUE = 'No entendí «sí, pero espera». No cargué nada.\n¿Cargo este viaje?';

const p = (fijo: string, o: Partial<PedidoRedaccion> = {}): PedidoRedaccion => ({ tipo: 'consulta', fijo, ...o });
const motivo = (texto: string, ped: PedidoRedaccion) => {
  const v = validarRedaccion(texto, ped);
  return v.ok ? 'ok' : v.motivo;
};

describe('el interruptor `bot_conversacional.redaccion`', () => {
  it('apagado por defecto: ausente, nulo, mal escrito o con el intérprete solo', () => {
    for (const raw of [undefined, null, {}, { activo: true }, { redaccion: 'true' }, { redaccion: { activo: 'si' } }, { redaccion: false }, []]) {
      expect(leerConfigRedaccion(raw).activo).toBe(false);
    }
  });
  it('prendido con `true` o `{activo: true}`; el modelo es el suyo, el del intérprete o el de por defecto', () => {
    expect(leerConfigRedaccion({ redaccion: true })).toEqual({ activo: true, modelo: 'gemini-3.8-flash', timeoutMs: 4000 });
    expect(leerConfigRedaccion({ modelo: 'gemini-2.5-flash', redaccion: true }).modelo).toBe('gemini-2.5-flash');
    expect(leerConfigRedaccion({ modelo: 'gemini-2.5-flash', redaccion: { activo: true, modelo: 'gemini-3.7-flash', timeout_ms: 2000 } }))
      .toEqual({ activo: true, modelo: 'gemini-3.7-flash', timeoutMs: 2000 });
    expect(leerConfigRedaccion({ redaccion: { activo: true, modelo: 'gpt-9', timeout_ms: 99999 } })).toEqual({ activo: true, modelo: 'gemini-3.8-flash', timeoutMs: 4000 });
  });
  it('el entorno lo apaga sin tocar la base', () => {
    expect(leerConfigRedaccion({ redaccion: true }, { interpreteApagado: '1' }).activo).toBe(false);
    expect(leerConfigRedaccion({ redaccion: true }, { redaccionApagada: '1' }).activo).toBe(false);
  });
});

describe('la entrada al modelo', () => {
  it('lleva el fijo, los hechos, los botones y los turnos marcados como contexto (no datos)', () => {
    const e = entradaRedaccion(p(MISMA, { tipo: 'confirmacion', botones: ['✅ Sí, es la misma', '❌ No, es otra'], hechos: { viaje: 'CARTAGENA MAR' } }), [
      { quien: 'comercial', texto: 'nueva clienta Paola Rincón 300 555 1234' }, { quien: 'bot', texto: 'No tengo a Paola Rincón tal cual.' },
    ]);
    expect(e).toContain(`TEXTO FIJO:\n<<<\n${MISMA}\n>>>`);
    expect(e).toContain('HECHOS: {"viaje":"CARTAGENA MAR"}');
    expect(e).toContain('[✅ Sí, es la misma] [❌ No, es otra]');
    expect(e).toContain('TURNOS RECIENTES (solo contexto, no son datos):\n- comercial: nueva clienta Paola Rincón 300 555 1234\n- bot: No tengo a Paola Rincón tal cual.');
  });
});

describe('lo que no se toca', () => {
  it('las líneas de lista, la negrita y la línea que la sigue', () => {
    expect(lineasFijas(RESUMEN)).toEqual(['*Viaje nuevo · Gloria Arbeláez*', 'Cliente nuevo · cel. 300 777 3344', '1. «Hola, queremos ir a Cartagena en enero»', '2. «somos 2 adultos y un niño de 8 años»']);
  });
  it('lo que falta, cosa por cosa', () => {
    expect(faltantesDelFijo(CONSULTA)).toEqual(['presupuesto aproximado del viaje']);
    expect(faltantesDelFijo('Le falta para cotizar: categoría de hotel, ciudad de salida y edades de los niños.')).toEqual(['categoría de hotel', 'ciudad de salida', 'edades de los niños']);
  });
});

describe('textos que pasan', () => {
  it.each([
    ['el fijo tal cual', CONSULTA, p(CONSULTA)],
    ['la consulta dicha natural', 'Fermín Ocampo (F 26 1) ya tiene todo lo mínimo: 9/9 (100 %). Para completo solo le falta el presupuesto aproximado del viaje (9/10, 90 %).', p(CONSULTA)],
    ['la carga, con la lista igual', 'Listo, cargué en F 26 1 de Fermín Ocampo: destino SAN ANDRÉS, adultos 2, niños 1. Va en 6/9 (67 %) del mínimo.\nPara empezar a cotizar me falta:\n1. ¿Desde qué ciudad salen?\n2. ¿Qué edad tiene cada niño?\n3. ¿De qué categoría prefieren el hotel?', p(CARGA, { tipo: 'carga' })],
    ['la pregunta de dos viajes, arriba y con los dos', '¿Lo que me escribiste es para SAN ANDRÉS DIC · Fermín Ocampo (F 26 1) o para CARTAGENA ENE · Gloria Arbeláez (G 26 1)? Si es un viaje nuevo, escribe «nuevo» y el nombre del cliente.', p(DOS_VIAJES, { tipo: 'pregunta' })],
    ['el resumen con otra pregunta y otra línea de corrección', '¿Lo cargo así?\n\n*Viaje nuevo · Gloria Arbeláez*\nCliente nuevo · cel. 300 777 3344\n\n1. «Hola, queremos ir a Cartagena en enero»\n2. «somos 2 adultos y un niño de 8 años»\n\nSi uno no va, escríbeme «quita el 2» o muévelo con «el 2 es de Luisa».', p(RESUMEN, { tipo: 'resumen', botones: ['✅ Cargar', '🗑 Descartar'] })],
    ['la confirmación con la pregunta arriba', '¿Es la misma persona? Ese celular ya lo tenemos a nombre de Paola Andrea Rincón Díaz (último viaje: CARTAGENA MAR).', p(MISMA, { tipo: 'confirmacion', botones: ['✅ Sí, es la misma', '❌ No, es otra'] })],
    ['un imperativo al empezar la frase', '¿Para cuál viaje es: SAN ANDRÉS DIC · Fermín Ocampo (F 26 1) o CARTAGENA ENE · Gloria Arbeláez (G 26 1)? Indícame cuál de los dos, o escribe «nuevo» y el nombre del cliente si es un viaje nuevo.', p(DOS_VIAJES, { tipo: 'pregunta' })],
    ['«anoté» por «cargué» (la misma acción)', 'Anoté en SAN ANDRÉS DIC · Fermín Ocampo (F 26 1): destino SAN ANDRÉS, adultos 2, niños 1.\nSAN ANDRÉS DIC · Fermín Ocampo (F 26 1) — Mínimo 6/9 (67 %) · Completo 6/10 (60 %)\nPara empezar a cotizar me falta:\n1. ¿Desde qué ciudad salen?\n2. ¿Qué edad tiene cada niño?\n3. ¿De qué categoría prefieren el hotel?', p(CARGA, { tipo: 'carga' })],
    ['«no cargué» dicho de otra forma, con la misma polaridad', '¿Cargo este viaje? No entendí «sí, pero espera», así que no cargué nada todavía.', p(NO_CARGUE, { tipo: 'resumen' })],
  ])('%s', (_n, texto, ped) => {
    expect(validarRedaccion(texto, ped)).toEqual({ ok: true });
  });
});

describe('hechos trampa: la validación rechaza y sale el fijo', () => {
  it.each([
    // Datos inventados (muchos vienen de los turnos: el comercial los escribió, pero no son hechos de este texto).
    ['un número que no está', 'Fermín Ocampo (F 26 1) va al 95 % de completo; le falta presupuesto aproximado del viaje.', CONSULTA, 'numero'],
    ['un número en letras que no está', 'A Fermín Ocampo (F 26 1) le faltan cinco cosas: presupuesto aproximado del viaje.', CONSULTA, 'numero'],
    ['un código de viaje distinto', 'F 26 2 ya tiene todo lo mínimo. Le falta presupuesto aproximado del viaje.', CONSULTA, 'numero'],
    ['un nombre que no está', 'Juan Pérez (F 26 1) ya tiene lo mínimo; le falta presupuesto aproximado del viaje.', CONSULTA, 'nombre'],
    ['un nombre al empezar la frase', 'Jaime ya tiene lo mínimo en F 26 1: 9/9 (100 %); le falta presupuesto aproximado del viaje.', CONSULTA, 'nombre'],
    ['un destino de los turnos', 'Fermín Ocampo (F 26 1) va para Cancún; le falta presupuesto aproximado del viaje.', CONSULTA, 'nombre'],
    ['una fecha que no está', 'Fermín Ocampo (F 26 1) sale en enero; le falta presupuesto aproximado del viaje.', CONSULTA, 'fecha'],
    ['un celular que no está', '¿Es la misma persona? Ese celular (300 555 9999) ya es de Paola Andrea Rincón Díaz (último viaje: CARTAGENA MAR).', MISMA, 'numero'],
    ['un celular recompuesto con pedazos del fijo', '¿Cargo este viaje?\n\n*Viaje nuevo · Gloria Arbeláez*\nCliente nuevo · cel. 300 777 3344\n\n1. «Hola, queremos ir a Cartagena en enero»\n2. «somos 2 adultos y un niño de 8 años»\n\nSu cel es 3344 777 300. Para mover o quitar uno, escríbeme: «el 2 es de Luisa» o «quita el 2».', RESUMEN, 'celular'],
    ['un correo', '¿Es la misma persona? Ese celular ya es de Paola Andrea Rincón Díaz (paola@correo.com, último viaje: CARTAGENA MAR).', MISMA, 'correo'],
    ['un enlace', 'Fermín Ocampo (F 26 1): 9/9 (100 %). Le falta presupuesto aproximado del viaje. Míralo en https://otro.sitio/x', CONSULTA, 'enlace_nuevo'],
    // Promesas que no se hicieron.
    ['«cargué» cuando el fijo dice «no cargué»', '¿Cargo este viaje? No entendí «sí, pero espera»; ya lo cargué.', NO_CARGUE, 'promesa'],
    ['«te aviso» que el fijo no promete', 'Fermín Ocampo (F 26 1) va 9/9 (100 %); le falta presupuesto aproximado del viaje. Te aviso cuando esté.', CONSULTA, 'promesa'],
    ['«ya está completo» cuando no lo está', 'Fermín Ocampo (F 26 1) ya está completo: 9/9 (100 %). Le falta presupuesto aproximado del viaje.', CONSULTA, 'afirmacion'],
    ['«creé el cliente»', '¿Cargo este viaje? Ya creé a Gloria Arbeláez.\n\n*Viaje nuevo · Gloria Arbeláez*\nCliente nuevo · cel. 300 777 3344\n\n1. «Hola, queremos ir a Cartagena en enero»\n2. «somos 2 adultos y un niño de 8 años»\n\nPara mover o quitar uno, escríbeme: «el 2 es de Luisa» o «quita el 2».', RESUMEN, 'promesa'],
    // Lo que no se toca.
    ['se come un faltante', 'Fermín Ocampo (F 26 1) ya tiene lo mínimo (9/9, 100 %) y va 9/10 (90 %) de completo.', CONSULTA, 'faltante'],
    ['cambia una línea de la lista', 'Cargué en F 26 1: destino SAN ANDRÉS, adultos 2, niños 1. 6/9 (67 %), 6/10 (60 %).\nPara empezar a cotizar me falta:\n1. ¿Desde qué ciudad salen?\n2. ¿Cuántos años tienen los niños?\n3. ¿De qué categoría prefieren el hotel?', CARGA, 'lista'],
    ['cambia el orden de las opciones', '¿Para cuál viaje es: CARTAGENA ENE · Gloria Arbeláez (G 26 1) o SAN ANDRÉS DIC · Fermín Ocampo (F 26 1)?', `¿Para cuál viaje es?\n1. SAN ANDRÉS DIC · Fermín Ocampo (F 26 1)\n2. CARTAGENA ENE · Gloria Arbeláez (G 26 1)`, 'lista'],
    ['pierde una cita', '¿Para cuál viaje es lo que me escribiste: SAN ANDRÉS DIC · Fermín Ocampo (F 26 1) o CARTAGENA ENE · Gloria Arbeláez (G 26 1)? Dime cuál.', DOS_VIAJES, 'cita'],
    ['inventa una cita', '¿Cargo este viaje?\n\n*Viaje nuevo · Gloria Arbeláez*\nCliente nuevo · cel. 300 777 3344\n\n1. «Hola, queremos ir a Cartagena en enero»\n2. «somos 2 adultos y un niño de 8 años»\n\nPara mover o quitar uno, escríbeme: «el 2 es de Luisa» o «quita el 2». O «descartar».', RESUMEN, 'cita_nueva'],
    // Preguntas.
    ['una pregunta que el fijo no hace', '¿Quieres que te diga cómo va? Fermín Ocampo (F 26 1): 9/9 (100 %), le falta presupuesto aproximado del viaje.', CONSULTA, 'pregunta_nueva'],
    ['dos preguntas', '¿Es la misma persona? ¿Seguro? Ese celular ya lo tenemos a nombre de Paola Andrea Rincón Díaz (último viaje: CARTAGENA MAR).', MISMA, 'preguntas'],
    ['la pregunta abajo', 'Ese celular ya lo tenemos a nombre de Paola Andrea Rincón Díaz (último viaje: CARTAGENA MAR).\n¿Es la misma persona?', MISMA, 'pregunta_abajo'],
    // Terceros, emojis y largo.
    ['una instrucción para el cliente', 'Fermín Ocampo (F 26 1): 9/9 (100 %). Dile que te mande el presupuesto aproximado del viaje.', CONSULTA, 'terceros'],
    ['un emoji nuevo', 'Fermín Ocampo (F 26 1) va 9/9 (100 %) 🎉 Le falta presupuesto aproximado del viaje.', CONSULTA, 'emoji'],
    ['más largo de la cuenta', `${CONSULTA} ${'Y además te cuento que todo va bien. '.repeat(5)}`, CONSULTA, 'largo'],
  ])('%s → %s', (_n, texto, fijo, esperado) => {
    expect(motivo(texto, p(fijo, { tipo: 'consulta' }))).toBe(esperado);
  });

  it('lo que dicen los turnos no es fuente: un dato que solo está en ellos se rechaza igual', () => {
    // El comercial escribió «son 5 estrellas» y «Juan»; el texto fijo no lo dice.
    expect(motivo('Fermín Ocampo (F 26 1) quiere hotel de 5 estrellas; le falta presupuesto aproximado del viaje.', p(CONSULTA))).toBe('numero');
  });

  it('un dato de los hechos sí cuenta como fuente', () => {
    const ped = p('Cargué en F 26 1. Le falta para cotizar: ciudad de salida.', { tipo: 'carga', hechos: { cliente: 'Fermín Ocampo', viaje: 'SAN ANDRÉS DIC' } });
    expect(validarRedaccion('Listo, cargué en F 26 1 de Fermín Ocampo (SAN ANDRÉS DIC). Le falta para cotizar: ciudad de salida.', ped)).toEqual({ ok: true });
  });

  it('con botones, el texto no pasa de los 1024 caracteres del cuerpo', () => {
    const fijo = `¿Cargo este viaje?\n${'x'.repeat(980)}`;
    expect(motivo(`¿Cargo este viaje?\n${'x'.repeat(980)}${' y algo más'.repeat(4)}`, p(fijo, { botones: ['✅ Cargar'] }))).toBe('largo');
  });
});
