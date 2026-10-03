import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  accionesDelEsquema,
  armarContexto,
  atajoExacto,
  CONFIG_INTERPRETE_POR_DEFECTO,
  esEscrito,
  esquemaPara,
  evidenciaValida,
  generacionPara,
  intentDeLaAccion,
  leerConfigInterprete,
  montosDelTexto,
  negociosDelContexto,
  preguntaPendienteUnificada,
  resolverViaje,
  textoRol,
  textosNuevos,
  validar,
  type Decision,
  type EntradaValidador,
  type NegocioCtx,
  type PreguntaUnificada,
} from './wa-interprete-reglas.ts';
import { CONFIG_BANDEJA_POR_DEFECTO } from './wa-bandeja-reglas.ts';
import { CONTADOR_ALLOWED_INTENTS, OPERATOR_ALLOWED_INTENTS, READ_ONLY_ALLOWED_INTENTS, type UserRole } from './types.ts';
import type { ViajeAbierto } from './wa-viajes-reglas.ts';

/**
 * El validador del intérprete conversacional (§3 del diseño), una prueba por regla, la decisión H2 en
 * sus cuatro casos, el interruptor, los atajos, el contexto y los textos. Datos sintéticos: los
 * nombres inventados de la simulación (Carolina Ruiz, Jorge y Lina Pérez, Arena, Clínica del Norte).
 */

// ── Datos sintéticos ────────────────────────────────────────────────────────

const V9: NegocioCtx = { alias: 'n9', id: 'v9', codigo: 'T1 26 9', cliente: 'LUISA MEJÍA', destino: 'SAN ANDRÉS' };
const V11: NegocioCtx = { alias: 'n11', id: 'v11', codigo: 'T1 26 11', cliente: 'CAROLINA RUIZ', destino: 'PUNTA CANA' };
const V12: NegocioCtx = { alias: 'n12', id: 'v12', codigo: 'T1 26 12', cliente: 'JORGE PÉREZ', destino: 'MADRID' };
const V14: NegocioCtx = { alias: 'n14', id: 'v14', codigo: 'T1 26 14', cliente: 'LINA PÉREZ', destino: 'CARTAGENA' };
const VIAJES = [V9, V11, V12, V14];

const A1: NegocioCtx = { alias: 'a1', id: 'neg-a1', codigo: 'C1 26 1', cliente: null, destino: null, nombre: 'Consorcio Arena Ingeniería · chiller torre B' };
const C3: NegocioCtx = { alias: 'c3', id: 'neg-c3', codigo: 'M1 26 3', cliente: null, destino: null, nombre: 'Clínica del Norte · mantenimiento preventivo' };
const E2: NegocioCtx = { alias: 'e2', id: 'neg-e2', codigo: 'C1 26 2', cliente: null, destino: null, nombre: 'Edificio Torre 80 · ductos piso 4' };
const NEGOCIOS = [A1, C3, E2];

const va = (n: NegocioCtx): ViajeAbierto => ({ id: n.id, codigo: n.codigo, cliente: n.cliente, destino: n.destino });
const alias = (id: string) => [...VIAJES, ...NEGOCIOS].find(n => n.id === id)?.alias ?? id;

/** «¿A qué viaje van estos 3 mensajes? 1) Luisa 2) Carolina 3) NUEVO 4) DESCARTAR» (una entrega cerrada). */
const LISTA_ENTREGA = preguntaPendienteUnificada({
  bandeja: { espera: 'viaje', nombre: 'Tanda de las 09:28', corta: '¿A qué viaje van? Número, código, NUEVO y el nombre, o DESCARTAR', opciones: [va(V9), va(V11)] },
  alias,
})!;
const RESUMEN = preguntaPendienteUnificada({ bandeja: { espera: 'resumen', nombre: 'Carolina Ruiz', corta: '¿Así? SÍ o corrige' }, alias })!;
const sesion = (state: string, pending_action = 'W01', options?: Array<{ id: string; label: string }>) =>
  preguntaPendienteUnificada({ sesion: { state, pending_action, options } })!;
const GASTO_CONFIRMAR = sesion('confirming');

const trappvel = (texto: string, o: Partial<EntradaValidador> = {}): EntradaValidador => ({
  texto, bandeja: true, rol: 'operator', pendiente: null, negocios: VIAJES, tanda: null, ...o,
});
const termotech = (texto: string, o: Partial<EntradaValidador> = {}): EntradaValidador => ({
  texto, bandeja: false, rol: 'owner', pendiente: null, negocios: NEGOCIOS, tanda: null, ...o,
});
const una = (accion: Record<string, unknown>) => ({ acciones: [accion] });
const paso = (d: Decision) => (d.tipo === 'ejecutar' ? d.paso : null);
const ejec = (d: Decision) => {
  if (d.tipo !== 'ejecutar') throw new Error(`se esperaba ejecutar y fue ${JSON.stringify(d)}`);
  return d;
};

// ── El interruptor (§8) ─────────────────────────────────────────────────────

describe('interruptor config_extra.bot_conversacional', () => {
  it('ausente, nulo o con un valor mal escrito: apagado (solo `true` literal lo enciende)', () => {
    for (const raw of [undefined, null, {}, { activo: 'true' }, { activo: 1 }, { activo: 'si' }, [], 'activo', { activo: false }]) {
      expect(leerConfigInterprete(raw).activo).toBe(false);
    }
    expect(leerConfigInterprete({ activo: true }).activo).toBe(true);
  });

  it('el apagado por entorno manda sobre la config', () => {
    expect(leerConfigInterprete({ activo: true }, '1').activo).toBe(false);
    expect(leerConfigInterprete({ activo: true }, '0').activo).toBe(true);
    expect(leerConfigInterprete({ activo: true }, undefined).activo).toBe(true);
  });

  it('el modelo sale de la lista blanca; los topes caen al default si se salen', () => {
    expect(leerConfigInterprete({ activo: true, modelo: 'gemini-9-ultra' }).modelo).toBe('gemini-2.5-flash');
    expect(leerConfigInterprete({ activo: true, modelo: 'gemini-3.5-flash-lite' }).modelo).toBe('gemini-3.5-flash-lite');
    expect(leerConfigInterprete({ activo: true, timeout_ms: 100, max_llamadas_hora: 5000 })).toMatchObject({ timeoutMs: 4000, maxLlamadasHora: 120 });
    expect(leerConfigInterprete({ activo: true, timeout_ms: 2500, max_llamadas_hora: '30' })).toMatchObject({ timeoutMs: 2500, maxLlamadasHora: 30 });
    expect(CONFIG_INTERPRETE_POR_DEFECTO).toEqual({ activo: false, modelo: 'gemini-2.5-flash', timeoutMs: 4000, maxLlamadasHora: 120 });
  });

  it('2.5 apaga el razonamiento con thinkingBudget 0; un 3.x va con thinkingLevel MINIMAL y sin thinkingBudget', () => {
    expect(generacionPara('gemini-2.5-flash', {}).thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(generacionPara('gemini-2.5-flash-lite', {}).thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(generacionPara('gemini-3.5-flash-lite', {}).thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' });
    expect(generacionPara('gemini-2.5-flash', {})).toMatchObject({ temperature: 0.1, maxOutputTokens: 512, responseMimeType: 'application/json' });
  });

  it('solo un escrito pasa: no un reenvío, un botón, un audio, una foto ni un texto vacío', () => {
    expect(esEscrito({ type: 'text', text: 'hola' })).toBe(true);
    expect(esEscrito({ type: 'text', text: 'hola', reenviado: true })).toBe(false);
    expect(esEscrito({ type: 'interactive', text: 'Confirmar', interactive_reply: 'btn_confirm' })).toBe(false);
    expect(esEscrito({ type: 'text', text: 'x', interactive_reply: 'btn_confirm' })).toBe(false);
    expect(esEscrito({ type: 'audio', text: '' })).toBe(false);
    expect(esEscrito({ type: 'image', text: 'pie' })).toBe(false);
    expect(esEscrito({ type: 'text', text: '   ' })).toBe(false);
  });
});

// ── Atajos exactos ──────────────────────────────────────────────────────────

describe('atajoExacto: lo exacto sigue por el código de hoy', () => {
  const B = CONFIG_BANDEJA_POR_DEFECTO;
  it('sin contexto: guía, «descartar» o «cancelar» solos (regla 4), REINTENTAR y la palabra de cierre', () => {
    expect(atajoExacto('ayuda', { bandeja: B })).toBe('guia');
    expect(atajoExacto('descartar', { bandeja: B })).toBe('descartar_todo');
    expect(atajoExacto('Cancelar', { bandeja: B })).toBe('descartar_todo');
    expect(atajoExacto('REINTENTAR T1 26 9', { bandeja: B })).toBe('reintentar');
    expect(atajoExacto('listo', { bandeja: B })).toBe('cierre');
    expect(atajoExacto('a ninguno, bótalos', { bandeja: B })).toBeNull();
  });

  it('el fast path solo sin pregunta pendiente', () => {
    expect(atajoExacto('mis números', { bandeja: null, pendiente: null })).toBe('fast_path');
    expect(atajoExacto('Hola', { bandeja: null, pendiente: null })).toBe('fast_path');
    expect(atajoExacto('Hola', { bandeja: null, pendiente: GASTO_CONFIRMAR })).toBeNull();
  });

  it('con pregunta pendiente, la respuesta de forma exacta: número, código, sí corto, NUEVO nombre, DESCARTAR', () => {
    for (const t of ['2', 'T1 26 11', 'NUEVO Marta Gil']) expect(atajoExacto(t, { bandeja: B, pendiente: LISTA_ENTREGA })).toBe('respuesta_exacta');
    expect(atajoExacto('sí', { bandeja: B, pendiente: RESUMEN })).toBe('respuesta_exacta');
    expect(atajoExacto('el 3 es de Luisa', { bandeja: B, pendiente: RESUMEN })).toBe('respuesta_exacta');
    expect(atajoExacto('son de Carolina', { bandeja: B, pendiente: LISTA_ENTREGA })).toBeNull();
    expect(atajoExacto('dale, así está bien', { bandeja: B, pendiente: RESUMEN })).toBeNull();
    expect(atajoExacto('el último no es de ella, es de Jorge', { bandeja: B, pendiente: RESUMEN })).toBeNull();
    // La confirmación del gasto: los botones y las palabras de siempre sí; «ahora sí, guárdalo» y «Peaje» no.
    expect(atajoExacto('si', { bandeja: null, pendiente: GASTO_CONFIRMAR })).toBe('respuesta_exacta');
    expect(atajoExacto('ahora sí, guárdalo', { bandeja: null, pendiente: GASTO_CONFIRMAR })).toBeNull();
    expect(atajoExacto('Peaje', { bandeja: null, pendiente: GASTO_CONFIRMAR })).toBeNull();
    expect(atajoExacto('85 mil', { bandeja: null, pendiente: sesion('collecting') })).toBe('respuesta_exacta');
    expect(atajoExacto('3', { bandeja: null, pendiente: sesion('awaiting_selection') })).toBe('respuesta_exacta');
  });

  it('un encabezado exacto (por código, por nombre o «nuevo» con nombre) es atajo; uno aproximado no', () => {
    expect(atajoExacto('T1 26 9', { bandeja: B, pendiente: null, encabezado: { tipo: 'viaje', viaje: va(V9), por: 'codigo' } })).toBe('encabezado_exacto');
    expect(atajoExacto('nuevo Ana Ríos', { bandeja: B, pendiente: null, encabezado: { tipo: 'nuevo', cliente: 'Ana Ríos' } })).toBe('encabezado_exacto');
    expect(atajoExacto('nuevo cliente', { bandeja: B, pendiente: null, encabezado: { tipo: 'nuevo', cliente: null } })).toBeNull();
    expect(atajoExacto('lo de Cartagena', { bandeja: B, pendiente: null, encabezado: { tipo: 'aproximado', viaje: va(V14), por: 'destino' } })).toBeNull();
  });
});

// ── La pregunta pendiente unificada ─────────────────────────────────────────

describe('preguntaPendienteUnificada: tres capas, una pregunta', () => {
  it('cada estado de la sesión del bot es su capa', () => {
    expect(sesion('confirming').capa).toBe('gasto_confirmar');
    expect(sesion('collecting').capa).toBe('gasto_monto');
    expect(sesion('awaiting_selection').capa).toBe('gasto_negocio');
    expect(sesion('awaiting_image').capa).toBe('soporte');
    expect(sesion('awaiting_timeout_confirm').capa).toBe('continuar');
    expect(sesion('confirming', 'W06').capa).toBe('contacto');
    expect(sesion('awaiting_selection', 'WAC').capa).toBe('actividad');
    expect(sesion('awaiting_selection', 'WUC').capa).toBe('aclaracion');
    expect(preguntaPendienteUnificada({ sesion: { state: 'started' } })).toBeNull();
  });

  it('la pregunta de la bandeja según lo que espera, y la de la tanda', () => {
    expect(LISTA_ENTREGA.capa).toBe('entrega');
    expect(LISTA_ENTREGA.opciones.map(o => o.id)).toEqual(['n9', 'n11', 'nuevo', 'descartar']);
    expect(RESUMEN.capa).toBe('resumen');
    expect(preguntaPendienteUnificada({ bandeja: { espera: 'nombre', nombre: 'x', corta: 'y' } })!.capa).toBe('nombre');
    expect(preguntaPendienteUnificada({ bandeja: { espera: 'otra', nombre: 'x', corta: 'y' } })!.capa).toBe('contacto_bandeja');
    expect(preguntaPendienteUnificada({ tanda: { tipo: 'eleccion', texto: 'Pérez', candidatos: [va(V12), va(V14)] }, alias })!.capa).toBe('tanda_lista');
    expect(preguntaPendienteUnificada({ tanda: { tipo: 'nombre' } })!.capa).toBe('tanda_nombre');
  });

  it('va la última que el usuario vio; la otra entra como «también pendiente»; sin hora gana la sesión del bot', () => {
    const ahora = Date.parse('2026-10-02T15:00:00Z');
    const vieja = '2026-10-02T14:00:00Z';
    const reciente = '2026-10-02T14:55:00Z';
    const b = { espera: 'viaje' as const, nombre: 'Carolina Ruiz', corta: '¿A qué viaje van?' };
    const p1 = preguntaPendienteUnificada({ sesion: { state: 'confirming', pending_action: 'W01', vistaAt: vieja }, bandeja: { ...b, vistaAt: reciente }, ahora })!;
    expect(p1.capa).toBe('entrega');
    expect(p1.tambien).toMatch(/Confirmo el gasto/);
    const p2 = preguntaPendienteUnificada({ sesion: { state: 'confirming', pending_action: 'W01', vistaAt: reciente }, bandeja: { ...b, vistaAt: vieja }, ahora })!;
    expect(p2.capa).toBe('gasto_confirmar');
    const p3 = preguntaPendienteUnificada({ sesion: { state: 'confirming', pending_action: 'W01' }, bandeja: b, ahora })!;
    expect(p3.capa).toBe('gasto_confirmar');
    expect(p3.tambien).toMatch(/Carolina Ruiz/);
  });
});

// ── El contexto ─────────────────────────────────────────────────────────────

describe('el contexto que recibe el modelo', () => {
  it('hasta 40 negocios, y los que comparten una palabra de 4 letras con el mensaje', () => {
    const muchos = Array.from({ length: 45 }, (_, i) => ({ id: `x${i}`, codigo: `T1 26 ${i}`, cliente: `CLIENTE ${i}`, destino: i === 44 ? 'TOKIO' : 'MIAMI' }));
    const ctx = negociosDelContexto(muchos, 'lo de Tokio');
    expect(ctx).toHaveLength(41);
    expect(ctx.at(-1)).toMatchObject({ id: 'x44', alias: 'n41' });
  });

  it('compacto y en orden: empresa y rol, lista con ids, tanda, pregunta con opciones, recientes, mensaje', () => {
    const t = armarContexto({
      empresa: 'agencia de viajes', rol: 'operator', bandeja: true, negocios: VIAJES,
      tanda: { abierta: true, haceMin: 3, caja: '[n11] T1 26 11 · CAROLINA RUIZ', mensajes: 2 },
      pendiente: LISTA_ENTREGA, recientes: [{ tipo: 'reenviado', texto: 'Hola Vale! somos 2' }, { tipo: 'bot', texto: '📌 T1 26 11' }],
      mensaje: 'son de Carolina',
    });
    const l = t.split('\n');
    expect(l[0]).toBe('Empresa: agencia de viajes. Rol de quien escribe: operator.');
    expect(t).toContain('[n14] T1 26 14 · LINA PÉREZ · CARTAGENA');
    expect(t).toContain('Tanda abierta: sí, desde hace 3 min, caja activa [n11] T1 26 11 · CAROLINA RUIZ, 2 mensajes');
    expect(t).toContain('opciones: [n9]');
    expect(t).toContain('↪ Hola Vale! somos 2');
    expect(l.at(-1)).toBe('MENSAJE NUEVO: son de Carolina');
    expect(t.indexOf('PREGUNTA PENDIENTE')).toBeLessThan(t.indexOf('Mensajes recientes'));
  });

  it('sin la bandeja el contexto no lleva viajes ni tanda ni mensajes de clientes', () => {
    const t = armarContexto({ empresa: 'x', rol: 'owner', bandeja: false, negocios: NEGOCIOS, tanda: null, pendiente: null, recientes: [], mensaje: 'Hola' });
    expect(t).toContain('Negocios abiertos');
    expect(t).not.toContain('Tanda abierta');
    expect(t).toContain('Bandeja de solicitudes: no aplica');
  });
});

// ── El esquema (V2 y V3 desde el enum) ──────────────────────────────────────

describe('el esquema por ámbito y por rol', () => {
  it('sin bandeja no hay acciones de la bandeja; el esquema no tiene campo de respuesta y exige evidencia', () => {
    expect(accionesDelEsquema({ bandeja: false, rol: 'owner' })).not.toContain('abrir_viaje');
    expect(accionesDelEsquema({ bandeja: true, rol: 'owner' })).toContain('abrir_viaje');
    const e = esquemaPara({ bandeja: true, rol: 'owner' }) as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(e.properties)).toEqual(['acciones']);
    expect(e.required).toEqual(['acciones']);
    expect(JSON.stringify(e)).not.toContain('respuesta');
    // Plano y sin topes de largo: con `ref` anidado y enums por campo Gemini responde 400 (medido).
    expect(JSON.stringify(e)).not.toContain('maxItems');
    expect(JSON.stringify(e)).toContain('"ref_cliente"');
    expect(JSON.stringify(e)).toContain('"required":["accion","evidencia"]');
  });

  it('lo que el rol no puede hacer no aparece en el enum', () => {
    expect(accionesDelEsquema({ bandeja: false, rol: 'operator' })).not.toContain('consulta');
    expect(accionesDelEsquema({ bandeja: false, rol: 'contador' })).not.toContain('gasto');
    expect(accionesDelEsquema({ bandeja: false, rol: 'read_only' })).not.toContain('actividad');
    expect(accionesDelEsquema({ bandeja: false, rol: 'admin' })).toEqual(expect.arrayContaining(['consulta', 'gasto', 'actividad', 'contacto_nuevo']));
  });
});

// ── El validador, una prueba por regla ──────────────────────────────────────

describe('V0: el esquema', () => {
  it('la referencia plana del esquema (ref_cliente…) se lee como `ref`', () => {
    const d = ejec(validar(una({ accion: 'abrir_viaje', evidencia: 'lo de Cartagena', ref_destino: 'Cartagena' }), trappvel('lo de Cartagena')));
    expect(d.paso).toMatchObject({ interpretacion: { viaje_id: 'v14' } });
  });

  it('JSON roto, acción fuera del enum o más de 6 acciones → fallback', () => {
    expect(validar(null, trappvel('hola'))).toEqual({ tipo: 'fallback', rechazo: 'V0_esquema' });
    expect(validar({ acciones: 'x' }, trappvel('hola'))).toEqual({ tipo: 'fallback', rechazo: 'V0_esquema' });
    expect(validar(una({ accion: 'borrar_todo', evidencia: 'hola' }), trappvel('hola')).tipo).toBe('fallback');
    expect(validar({ acciones: Array.from({ length: 7 }, () => ({ accion: 'acuse', evidencia: 'hola' })) }, trappvel('hola')).tipo).toBe('fallback');
    expect(validar(una({ accion: 'gasto', evidencia: 'hola', monto: '20000' }), termotech('hola')).tipo).toBe('fallback');
  });
});

describe('V1: la evidencia literal', () => {
  it('una evidencia que no está en el mensaje quita la acción; si no queda ninguna, pedir aclaración', () => {
    const d = ejec(validar(una({ accion: 'contenido', evidencia: 'quiere hotel con piscina en Cancún' }), trappvel('ok lo reviso mañana')));
    expect(d.accion).toBe('pedir_aclaracion');
    expect(d.rechazo).toBe('V1_evidencia');
    expect(evidenciaValida('me escribió un cliente nuevo', 'me escribió un cliente nuevo, Daniel Pérez')).toBe(true);
    expect(evidenciaValida('', 'hola')).toBe(false);
  });

  it('una acción sin evidencia también se quita y las demás siguen', () => {
    const d = ejec(validar({ acciones: [{ accion: 'nota_interna' }, { accion: 'contenido', evidencia: 'no quiere escalas' }] }, trappvel('ella me dijo que no quiere escalas')));
    expect(d.accion).toBe('bandeja.contenido');
    expect(d.rechazo).toBe('V1_evidencia');
  });
});

describe('V2: el ámbito', () => {
  it('con prefijo o sin bandeja, las acciones de la bandeja se quitan', () => {
    const d = ejec(validar(una({ accion: 'contenido', evidencia: 'cuánto llevamos' }), termotech('cuánto llevamos')));
    expect(d.accion).toBe('pedir_aclaracion');
    expect(d.rechazo).toBe('V2_ambito');
  });
});

describe('V3: cada rol contra cada acción del bot (types.ts:240-257)', () => {
  const ROLES: UserRole[] = ['owner', 'admin', 'operator', 'supervisor', 'contador', 'read_only'];
  const PERMITIDOS: Record<UserRole, readonly string[] | null> = {
    owner: null, admin: null, operator: OPERATOR_ALLOWED_INTENTS, supervisor: OPERATOR_ALLOWED_INTENTS,
    contador: CONTADOR_ALLOWED_INTENTS, read_only: READ_ONLY_ALLOWED_INTENTS,
  };
  const ACCIONES: Array<{ a: Record<string, unknown>; texto: string }> = [
    { a: { accion: 'gasto', evidencia: 'pagué 20 mil de taxi', monto: 20000 }, texto: 'pagué 20 mil de taxi' },
    { a: { accion: 'consulta', evidencia: 'cómo vamos', tema: 'numeros' }, texto: 'cómo vamos' },
    { a: { accion: 'consulta', evidencia: 'quién me debe', tema: 'cartera' }, texto: 'quién me debe' },
    { a: { accion: 'consulta', evidencia: 'negocios abiertos', tema: 'negocios' }, texto: 'negocios abiertos' },
    { a: { accion: 'actividad', evidencia: 'visité la obra de Arena', texto: 'visité la obra' }, texto: 'visité la obra de Arena' },
    { a: { accion: 'contacto_nuevo', evidencia: 'guarda a Ana Ríos', nombre: 'Ana Ríos' }, texto: 'guarda a Ana Ríos' },
    { a: { accion: 'saludo', evidencia: 'buenas' }, texto: 'buenas' },
  ];
  for (const rol of ROLES) {
    for (const { a, texto } of ACCIONES) {
      it(`${rol} · ${a.accion}${a.tema ? `(${a.tema})` : ''}`, () => {
        const intent = intentDeLaAccion(a.accion as string, a.tema as string | undefined)!;
        const permitido = PERMITIDOS[rol] === null || PERMITIDOS[rol]!.includes(intent);
        const d = ejec(validar(una(a), termotech(texto, { rol })));
        if (permitido) {
          expect(d.rechazo).not.toBe('V3_rol');
        } else {
          expect(d.rechazo).toBe('V3_rol');
          expect(paso(d)).toEqual({ p: 'decir', texto: textoRol(rol) });
        }
      });
    }
  }

  it('una colaboradora (operator) que pregunta por sus solicitudes recibe el texto de su rol, igual que hoy', () => {
    const d = ejec(validar(una({ accion: 'fuera_de_alcance', evidencia: 'cuántas solicitudes tengo abiertas', que: 'consultar solicitudes' }), trappvel('oye cuántas solicitudes tengo abiertas?')));
    expect(paso(d)).toEqual({ p: 'decir', texto: 'Con tu rol solo puedes registrar gastos y actividades de tus negocios.' });
  });

  it('los textos del rol son los de wa-webhook/index.ts (paridad leída del fuente)', () => {
    const fuente = readFileSync('supabase/functions/wa-webhook/index.ts', 'utf8');
    for (const r of ['operator', 'contador', 'read_only'] as UserRole[]) expect(fuente).toContain(`'${textoRol(r)}'`);
  });
});

describe('V4: la tabla de estado completa', () => {
  // Qué acción NO libre vale con cada pregunta pendiente (§3, tabla de V4).
  const TABLA: Array<{ capa: PreguntaUnificada | null; nombre: string; valen: string[] }> = [
    { capa: null, nombre: 'ninguna', valen: [] },
    { capa: LISTA_ENTREGA, nombre: 'entrega', valen: ['responder'] },
    { capa: preguntaPendienteUnificada({ tanda: { tipo: 'eleccion', texto: 'Pérez', candidatos: [va(V12), va(V14)] }, alias }), nombre: 'tanda_lista', valen: ['responder'] },
    { capa: preguntaPendienteUnificada({ bandeja: { espera: 'nombre', nombre: 'x', corta: 'y' } }), nombre: 'nombre', valen: ['responder'] },
    { capa: preguntaPendienteUnificada({ tanda: { tipo: 'nombre' } }), nombre: 'tanda_nombre', valen: ['responder'] },
    { capa: RESUMEN, nombre: 'resumen', valen: ['confirmar', 'mover', 'responder'] },
    { capa: preguntaPendienteUnificada({ bandeja: { espera: 'otra', nombre: 'x', corta: 'y' } }), nombre: 'contacto_bandeja', valen: ['confirmar', 'cancelar', 'responder'] },
    { capa: sesion('confirming', 'W06'), nombre: 'contacto', valen: ['confirmar', 'cancelar', 'responder'] },
    { capa: sesion('awaiting_timeout_confirm'), nombre: 'continuar', valen: ['confirmar', 'cancelar', 'responder'] },
    { capa: GASTO_CONFIRMAR, nombre: 'gasto_confirmar', valen: ['confirmar', 'cancelar', 'corregir_gasto'] },
    { capa: sesion('collecting'), nombre: 'gasto_monto', valen: ['responder'] },
    { capa: sesion('awaiting_selection'), nombre: 'gasto_negocio', valen: ['responder'] },
    { capa: sesion('awaiting_image'), nombre: 'soporte', valen: ['responder'] },
  ];
  const NO_LIBRES = ['confirmar', 'cancelar', 'responder', 'mover', 'corregir_gasto'];
  for (const fila of TABLA) {
    for (const accion of NO_LIBRES) {
      const vale = fila.valen.includes(accion);
      it(`${fila.nombre} · ${accion} ${vale ? 'pasa' : 'se rechaza'}`, () => {
        const a = { accion, evidencia: 'eso', n: 3, campo: 'descripcion', valor: 'eso', opcion: 'zzz' };
        const d = ejec(validar(una(a), trappvel('eso', { pendiente: fila.capa, bandeja: true })));
        if (vale) {
          expect(d.rechazo).not.toBe('V4_estado');
        } else {
          expect(d.rechazo).toBe('V4_estado');
          const esperado = accion === 'mover' ? 'pedir_aclaracion' : accion === 'corregir_gasto' ? 'fuera_de_alcance' : 'acuse';
          expect(d.accion).toBe(esperado);
        }
      });
    }
  }

  it('las libres valen siempre y no contestan la pregunta: se recuerda en una línea', () => {
    const d = ejec(validar(una({ accion: 'consulta', evidencia: 'cómo vamos', tema: 'numeros' }), termotech('cómo vamos', { pendiente: GASTO_CONFIRMAR })));
    expect(d.accion).toBe('bot.consulta');
    expect(d.recordar).toBe(true);
  });
});

describe('V5: el viaje por TODAS las palabras', () => {
  it('«Daniel Pérez» nunca es el viaje de Lina Pérez', () => {
    expect(resolverViaje({ cliente: 'Daniel Pérez' }, VIAJES)).toEqual([]);
    const d = ejec(validar(una({ accion: 'abrir_viaje', evidencia: 'Daniel Pérez', ref: { cliente: 'Daniel Pérez' } }), trappvel('Daniel Pérez')));
    expect(d.paso).toMatchObject({ p: 'registrar', interpretacion: { accion: 'preguntar_viaje', candidatos: [] } });
  });

  it('«Pérez» con dos viajes da la lista con los dos', () => {
    const d = ejec(validar(una({ accion: 'abrir_viaje', evidencia: 'Pérez', ref: { cliente: 'Pérez' } }), trappvel('Pérez')));
    expect(d.paso).toMatchObject({ p: 'registrar', interpretacion: { accion: 'preguntar_viaje', candidatos: ['v12', 'v14'] } });
    expect((d.paso as { aviso: string }).aviso).toMatch(/^¿De qué viaje es «Pérez»\? 1\. .*Jorge Pérez.* · 2\. .*Lina Pérez/);
  });

  it('el destino con un solo candidato abre la caja y la muestra con 📌', () => {
    const d = ejec(validar(una({ accion: 'abrir_viaje', evidencia: 'lo de Cartagena', ref: { destino: 'Cartagena' } }), trappvel('lo de Cartagena')));
    expect(d.paso).toEqual({ p: 'registrar', interpretacion: { accion: 'abrir_viaje', viaje_id: 'v14', con_contenido: false, evidencia: 'lo de Cartagena' }, aviso: '📌 Lina Pérez (T1 26 14)' });
  });

  it('código exacto; cliente y destino a la vez se intersectan', () => {
    expect(resolverViaje({ codigo: 't1 26 12' }, VIAJES).map(v => v.id)).toEqual(['v12']);
    expect(resolverViaje({ cliente: 'Pérez', destino: 'Madrid' }, VIAJES).map(v => v.id)).toEqual(['v12']);
  });
});

describe('V6: el id del contexto', () => {
  it('el id `c3` del contexto se acepta sin volver a resolver (H5)', () => {
    const d = ejec(validar(una({ accion: 'corregir_gasto', evidencia: 'es para la clínica, no para Arena', campo: 'negocio', valor: 'c3' }), termotech('es para la clínica, no para Arena', { pendiente: GASTO_CONFIRMAR })));
    expect(d.paso).toEqual({ p: 'bot_corregir', cambios: [{ campo: 'negocio', valor: { id: 'neg-c3', codigo: 'M1 26 3', nombre: C3.nombre } }] });
  });

  it('un id ajeno se quita y se resuelve por ref', () => {
    const d = ejec(validar(una({ accion: 'abrir_viaje', evidencia: 'lo de Jorge', id: 'n99', ref: { cliente: 'Jorge' } }), trappvel('lo de Jorge')));
    expect(d.rechazo).toBe('V6_id_ajeno');
    expect(d.paso).toMatchObject({ interpretacion: { viaje_id: 'v12' } });
  });
});

describe('V7: un viaje fuera de la lista es un encabezado', () => {
  it('abre la caja y la pregunta sigue pendiente', () => {
    const d = ejec(validar(una({ accion: 'responder', evidencia: 'primero te paso lo de Jorge', ref: { cliente: 'Jorge' } }), trappvel('espera, primero te paso lo de Jorge', { pendiente: LISTA_ENTREGA })));
    expect(d.rechazo).toBe('V7_fuera_de_la_lista');
    expect(d.recordar).toBe(true);
    expect(d.paso).toMatchObject({ p: 'registrar', interpretacion: { accion: 'abrir_viaje', viaje_id: 'v12' } });
  });
});

describe('V8: «nuevo» con nombre', () => {
  it('el nombre del cliente nuevo puede venir en ref.cliente', () => {
    const d = ejec(validar(una({ accion: 'responder', evidencia: 'es una clienta nueva que se llama Marta Gil', opcion: 'nuevo', ref: { cliente: 'Marta Gil' } }), trappvel('ninguno, es una clienta nueva que se llama Marta Gil', { pendiente: LISTA_ENTREGA })));
    expect(d.paso).toMatchObject({ p: 'responder_bandeja', canonico: 'NUEVO Marta Gil' });
  });

  it('un nombre que no está escrito no se toma; sin nombre se pide', () => {
    const d = ejec(validar(una({ accion: 'responder', evidencia: 'es una clienta nueva', opcion: 'nuevo', nuevo_cliente: 'Marta Gil' }), trappvel('es una clienta nueva', { pendiente: LISTA_ENTREGA })));
    expect(d.paso).toEqual({ p: 'decir', texto: '¿Cómo se llama el cliente nuevo? Escríbeme su nombre, o DESCARTAR. Hasta entonces no asigno lo que sigue.' });
  });

  it('un nombre idéntico al cliente de un viaje abierto se pregunta', () => {
    const d = ejec(validar(una({ accion: 'abrir_viaje', evidencia: 'nueva clienta Lina Pérez', nuevo_cliente: 'Lina Pérez' }), trappvel('nueva clienta Lina Pérez')));
    expect(d.rechazo).toBe('V8_nombre_igual');
    expect(d.paso).toMatchObject({ interpretacion: { accion: 'preguntar_viaje', candidatos: ['v14'] } });
  });
});

describe('V9: el monto solo vale si está escrito', () => {
  it('lee las formas de hablar: 25 mil, 18.900, 60 lucas, 1 palo, 340000, $25.000', () => {
    expect(montosDelTexto('almuerzo 25 mil, gasolina 90 mil y peaje 18.900')).toEqual(expect.arrayContaining([25000, 90000, 18900]));
    expect(montosDelTexto('gasté 60 lucas')).toEqual([60000]);
    expect(montosDelTexto('1 palo')).toEqual([1000000]);
    expect(montosDelTexto('por 340000')).toEqual([340000]);
    expect(montosDelTexto('$25.000')).toEqual([25000]);
  });

  it('un monto no escrito queda null y el bot lo pregunta', () => {
    const d = ejec(validar(una({ accion: 'gasto', evidencia: 'pagué la ferretería', monto: 85000, descripcion: 'ferretería' }), termotech('pagué la ferretería')));
    expect(d.rechazo).toBe('V9_monto_no_escrito');
    expect(d.paso).toMatchObject({ p: 'bot_gastos', gastos: [{ monto: null, descripcion: 'ferretería' }] });
  });
});

describe('V10 y V11: gasto partido y gasto sin monto en la confirmación', () => {
  it('V10: un pedazo sin monto al lado de uno con monto es el mismo gasto', () => {
    const d = ejec(validar({ acciones: [
      { accion: 'gasto', evidencia: 'pagué 18.900', monto: 18900 },
      { accion: 'gasto', evidencia: 'de peaje yendo a la obra de Arena', descripcion: 'peaje', negocio: 'Arena' },
    ] }, termotech('pagué 18.900 de peaje yendo a la obra de Arena')));
    expect(d.rechazo).toBe('V10_gasto_partido');
    expect(d.paso).toEqual({ p: 'bot_gastos', enCola: false, gastos: [{ monto: 18900, descripcion: 'peaje', negocio: { id: 'neg-a1', codigo: 'C1 26 1', nombre: A1.nombre } }] });
  });

  it('V11: con la confirmación pendiente, un gasto sin monto es la descripción del que se confirma', () => {
    const d = ejec(validar(una({ accion: 'gasto', evidencia: 'Peaje', descripcion: 'Peaje' }), termotech('Peaje', { pendiente: GASTO_CONFIRMAR })));
    expect(d.paso).toEqual({ p: 'bot_corregir', cambios: [{ campo: 'descripcion', valor: 'Peaje' }] });
  });
});

describe('V12 y V13: el negocio del gasto y corregir el monto', () => {
  it('V12: «oficina» es gasto de la empresa; una palabra de 4 letras con una sola coincidencia es ese negocio', () => {
    const d1 = ejec(validar(una({ accion: 'gasto', evidencia: 'pagué el internet de la oficina, 120 mil', monto: 120000, negocio: 'oficina' }), termotech('pagué el internet de la oficina, 120 mil')));
    expect(d1.paso).toMatchObject({ gastos: [{ negocio: 'empresa' }] });
    const d2 = ejec(validar(una({ accion: 'gasto', evidencia: 'gasté 60 lucas en refrigerante para el chiller', monto: 60000, negocio: 'chiller' }), termotech('gasté 60 lucas en refrigerante para el chiller')));
    expect(d2.paso).toMatchObject({ gastos: [{ negocio: { id: 'neg-a1' } }] });
  });

  it('V13: corregir el monto solo con un valor escrito', () => {
    const ok = ejec(validar(una({ accion: 'corregir_gasto', evidencia: 'no, son 19.800', campo: 'monto', valor: '19800' }), termotech('no, son 19.800', { pendiente: GASTO_CONFIRMAR })));
    expect(ok.paso).toEqual({ p: 'bot_corregir', cambios: [{ campo: 'monto', valor: 19800 }] });
    const no = ejec(validar(una({ accion: 'corregir_gasto', evidencia: 'no, es más', campo: 'monto', valor: '25000' }), termotech('no, es más', { pendiente: GASTO_CONFIRMAR })));
    expect(no.rechazo).toBe('V13_monto_no_escrito');
  });
});

describe('V15: combinaciones permitidas', () => {
  it('abrir + contenido, varios contenidos, varios gastos y corregir ×N pasan', () => {
    expect(ejec(validar({ acciones: [
      { accion: 'abrir_viaje', evidencia: 'Jorge', ref: { cliente: 'Jorge' } }, { accion: 'contenido', evidencia: 'mejor viajan el 10 de enero' },
    ] }, trappvel('Jorge me escribió que mejor viajan el 10 de enero'))).rechazo).toBeNull();
  });

  it('cualquier otra mezcla pide aclaración y no escribe nada', () => {
    const d = ejec(validar({ acciones: [
      { accion: 'gasto', evidencia: 'pagué 20 mil', monto: 20000 }, { accion: 'contenido', evidencia: 'quiere ir a Cancún' },
    ] }, trappvel('pagué 20 mil y quiere ir a Cancún')));
    expect(d.rechazo).toBe('V15_combinacion');
    expect(d.paso.p).toBe('decir');
  });
});

describe('V16: sí con peros no es sí', () => {
  it('«sí, pero el 3 es de Jorge» no confirma: aplica la corrección', () => {
    const d = ejec(validar({ acciones: [
      { accion: 'confirmar', evidencia: 'sí' }, { accion: 'mover', evidencia: 'el 3 es de Jorge', n: 3, ref: { cliente: 'Jorge' } },
    ] }, trappvel('sí, pero el 3 es de Jorge', { pendiente: RESUMEN })));
    expect(d.rechazo).toBe('V16_si_con_peros');
    expect(d.paso).toMatchObject({ p: 'responder_bandeja', canonico: 'el 3 es de T1 26 12' });
  });

  it('en la confirmación del gasto, «sí pero son 19.800» corrige y vuelve a pedir el sí', () => {
    const d = ejec(validar({ acciones: [
      { accion: 'confirmar', evidencia: 'sí' }, { accion: 'corregir_gasto', evidencia: 'son 19.800', campo: 'monto', valor: '19800' },
    ] }, termotech('sí pero son 19.800', { pendiente: GASTO_CONFIRMAR })));
    expect(d.paso).toEqual({ p: 'bot_corregir', cambios: [{ campo: 'monto', valor: 19800 }] });
  });
});

describe('un «sí» sin nada pendiente y «nuevo» que no está escrito (QA con Gemini real)', () => {
  it('«si» sin pregunta es acuse aunque el modelo proponga abrir un viaje nuevo', () => {
    const d = ejec(validar(una({ accion: 'abrir_viaje', evidencia: 'si', nuevo_sin_nombre: true }), trappvel('si', { tanda: { abierta: true } })));
    expect(d).toMatchObject({ accion: 'acuse', paso: { p: 'nada' }, rechazo: 'V4_si_sin_pregunta' });
  });

  it('«Pérez» suelto nunca abre «NUEVO Pérez» (flash-lite lo propuso en la QA)', () => {
    expect(ejec(validar(una({ accion: 'abrir_viaje', evidencia: 'Pérez', nuevo_cliente: 'Pérez' }), trappvel('Pérez'))).rechazo).toBe('V8_nuevo_no_escrito');
  });

  it('un escrito largo tomado como respuesta sin pregunta no se bota: sigue por el código de hoy', () => {
    const d = validar(una({ accion: 'responder', evidencia: 'Jorge me escribió que mejor viajan el 10 de enero', opcion: 'n12' }), trappvel('Jorge me escribió que mejor viajan el 10 de enero'));
    expect(d).toEqual({ tipo: 'fallback', rechazo: 'V4_estado' });
  });

  it('«nuevo» sin nombre solo si el mensaje lo dice', () => {
    expect(ejec(validar(una({ accion: 'abrir_viaje', evidencia: 'te paso uno', nuevo_sin_nombre: true }), trappvel('te paso uno'))).rechazo).toBe('V8_nuevo_no_escrito');
    expect(ejec(validar(una({ accion: 'abrir_viaje', evidencia: 'nuevo cliente', nuevo_sin_nombre: true }), trappvel('nuevo cliente'))).paso).toMatchObject({ interpretacion: { accion: 'abrir_viaje', nuevo: null } });
  });

  it('dos clientes devueltos como dos encabezados son contenido de dos viajes, no dos cajas', () => {
    const d = ejec(validar({ acciones: [
      { accion: 'abrir_viaje', evidencia: 'Carolina confirma que salen el 28', ref_cliente: 'Carolina Ruiz' },
      { accion: 'abrir_viaje', evidencia: 'Luisa pregunta si hay vuelo directo', ref_cliente: 'Luisa Mejía' },
    ] }, trappvel('Carolina confirma que salen el 28 y Luisa pregunta si hay vuelo directo desde Medellín')));
    expect(d.paso).toMatchObject({ p: 'registrar', interpretacion: { accion: 'contenido', varios: ['v11', 'v9'] } });
  });

  it('H2 · «a ninguno» con la lista y la tanda abiertas contesta la lista aunque el modelo diga «tanda»', () => {
    const d = ejec(validar(una({ accion: 'descartar', evidencia: 'a ninguno, bótalos', alcance: 'tanda' }), trappvel('a ninguno, bótalos', { pendiente: LISTA_ENTREGA, tanda: { abierta: true, nombre: 'Carolina Ruiz', cajaId: 'v11' } })));
    expect(d.paso).toMatchObject({ p: 'responder_bandeja', canonico: 'DESCARTAR' });
  });
});

describe('V17 y V18', () => {
  it('V17: el sí al resumen va como «sí» a interpretarRespuestaPlan (que exige lo de hoy)', () => {
    const d = ejec(validar(una({ accion: 'confirmar', evidencia: 'dale, así está bien' }), trappvel('dale, así está bien', { pendiente: RESUMEN })));
    expect(d.paso).toMatchObject({ p: 'responder_bandeja', canonico: 'sí' });
  });

  it('V18: una nota interna no se registra en la bandeja', () => {
    const d = ejec(validar(una({ accion: 'nota_interna', evidencia: 'esta señora es súper regatera' }), trappvel('ojo que esta señora es súper regatera')));
    expect(d.paso).toEqual({ p: 'nota_interna' });
  });
});

// ── H2: descartar descarta la capa a la que se refiere (§5) ─────────────────

describe('H2: con una pregunta pendiente y una tanda abierta a la vez, nada se descarta de más', () => {
  const ambas = (texto: string) => trappvel(texto, { pendiente: LISTA_ENTREGA, tanda: { abierta: true, nombre: 'Carolina Ruiz', cajaId: 'v11' } });

  it('1 · contesta la pregunta («a ninguno, bótalos»): solo la pregunta; la tanda sigue abierta', () => {
    for (const a of [
      { accion: 'responder', evidencia: 'a ninguno, bótalos', opcion: 'descartar' },
      { accion: 'descartar', evidencia: 'bótalos', alcance: 'pregunta' },
    ]) {
      const d = ejec(validar(una(a), ambas('a ninguno, bótalos')));
      expect(d.paso).toEqual({
        p: 'responder_bandeja', canonico: 'DESCARTAR', interpretacion: { accion: 'descartar', canonico: 'DESCARTAR', evidencia: a.evidencia },
        aviso: 'Descarté los mensajes de esa pregunta. La tanda de Carolina Ruiz sigue abierta.',
      });
    }
  });

  it('2 · nombra la tanda: solo la tanda (y sin pregunta pendiente, «bórralo» es la tanda: TV5)', () => {
    const d = ejec(validar(una({ accion: 'descartar', evidencia: 'bórrame lo de Carolina', alcance: 'tanda', ref: { cliente: 'Carolina' } }), ambas('bórrame lo de Carolina')));
    expect(d.paso).toEqual({ p: 'descartar', alcance: 'tanda' });
    const sinPregunta = ejec(validar(una({ accion: 'descartar', evidencia: 'bórralo', alcance: 'todo' }), trappvel('uy no, eso lo mandé por error, bórralo', { tanda: { abierta: true, nombre: 'Carolina Ruiz', cajaId: 'v11' } })));
    expect(sinPregunta.paso).toEqual({ p: 'descartar', alcance: 'tanda' });
    expect(sinPregunta.rechazo).toBe('V14_todo_no_escrito');
  });

  it('3 · «todo» literal: todo lo pendiente', () => {
    const d = ejec(validar(una({ accion: 'descartar', evidencia: 'bota todo lo pendiente', alcance: 'todo' }), ambas('bota todo lo pendiente')));
    expect(d.paso).toEqual({ p: 'descartar', alcance: 'todo' });
  });

  it('4 · con la duda se pregunta y no se descarta', () => {
    const d = ejec(validar(una({ accion: 'descartar', evidencia: 'bórralo', alcance: 'tanda' }), ambas('bórralo')));
    expect(d.paso.p).toBe('decir');
    expect((d.paso as { texto: string }).texto).toMatch(/^¿Descarto lo de la pregunta pendiente o la tanda de Carolina Ruiz\?/);
    const d2 = ejec(validar(una({ accion: 'descartar', evidencia: 'bórralo', alcance: 'todo' }), ambas('bórralo')));
    expect(d2.paso.p).toBe('decir');
  });
});

// ── Ajustes del control sellado de Vera (2026-10-02) ────────────────────────

describe('control de Vera · E1: el nombre de pila de alguien del equipo nunca resuelve un viaje (V5/V6)', () => {
  // Una clienta con el mismo nombre de pila que alguien del equipo (nombres inventados).
  const VT: NegocioCtx = { alias: 'n20', id: 'v20', codigo: 'T1 26 20', cliente: 'TATIANA SALAZAR', destino: 'MEDELLÍN' };
  const conEquipo = (texto: string, o: Partial<EntradaValidador> = {}) => trappvel(texto, { negocios: [...VIAJES, VT], equipo: ['Tatiana Quiroga', 'Mauricio Prueba'], ...o });
  const texto = 'Tatiana: lo de Cartagena, quieren hotel con piscina';

  it('firma + destino de otro viaje: abre el viaje del destino, nunca el de la clienta homónima', () => {
    for (const ab of [
      { accion: 'abrir_viaje', evidencia: 'Tatiana', ref_cliente: 'Tatiana' },
      { accion: 'abrir_viaje', evidencia: 'Tatiana', id: 'n20' },
    ]) {
      const d = ejec(validar({ acciones: [ab, { accion: 'contenido', evidencia: 'lo de Cartagena, quieren hotel con piscina', ref_destino: 'Cartagena' }] }, conEquipo(texto)));
      expect(d.paso).toMatchObject({ p: 'registrar', interpretacion: { accion: 'abrir_viaje', viaje_id: 'v14', con_contenido: true } });
      expect(JSON.stringify(d.paso)).not.toContain('v20');
    }
  });

  it('la firma sola no abre nada: pide aclaración y nada se escribe', () => {
    const d = ejec(validar(una({ accion: 'abrir_viaje', evidencia: 'Tatiana', ref_cliente: 'Tatiana' }), conEquipo('gracias Tatiana')));
    expect(d.accion).toBe('pedir_aclaracion');
    expect(d.rechazo).toBe('V5_firma_del_equipo');
    expect(d.paso.p).toBe('decir');
  });

  it('con el apellido sí nombra a la clienta; sin equipo, la regla de antes no cambia', () => {
    const conApellido = ejec(validar(una({ accion: 'abrir_viaje', evidencia: 'Tatiana Salazar', ref_cliente: 'Tatiana Salazar' }), conEquipo('Tatiana Salazar')));
    expect(conApellido.paso).toMatchObject({ interpretacion: { accion: 'abrir_viaje', viaje_id: 'v20' } });
    const porCodigo = ejec(validar(una({ accion: 'abrir_viaje', evidencia: 'T1 26 20', id: 'n20' }), conEquipo('T1 26 20')));
    expect(porCodigo.paso).toMatchObject({ interpretacion: { accion: 'abrir_viaje', viaje_id: 'v20' } });
    const sinEquipo = ejec(validar(una({ accion: 'abrir_viaje', evidencia: 'Tatiana', ref_cliente: 'Tatiana' }), trappvel('Tatiana', { negocios: [...VIAJES, VT] })));
    expect(sinEquipo.paso).toMatchObject({ interpretacion: { accion: 'abrir_viaje', viaje_id: 'v20' } });
  });

  it('abrir_viaje y contenido que apuntan a viajes distintos: se pregunta con los dos', () => {
    const d = ejec(validar({ acciones: [
      { accion: 'abrir_viaje', evidencia: 'Carolina', ref_cliente: 'Carolina' },
      { accion: 'contenido', evidencia: 'lo de Cartagena con hotel', ref_destino: 'Cartagena' },
    ] }, trappvel('Carolina: lo de Cartagena con hotel')));
    expect(d.rechazo).toBe('V5_abrir_y_contenido_distintos');
    expect(d.paso).toMatchObject({ p: 'registrar', interpretacion: { accion: 'preguntar_viaje', candidatos: ['v11', 'v14'], con_contenido: true } });
    // El mismo viaje por los dos lados: se abre como antes.
    const mismo = ejec(validar({ acciones: [
      { accion: 'abrir_viaje', evidencia: 'Carolina', ref_cliente: 'Carolina' },
      { accion: 'contenido', evidencia: 'lo de Punta Cana con hotel', ref_destino: 'Punta Cana' },
    ] }, trappvel('Carolina: lo de Punta Cana con hotel')));
    expect(mismo.paso).toMatchObject({ interpretacion: { accion: 'abrir_viaje', viaje_id: 'v11', con_contenido: true } });
  });
});

describe('control de Vera · V14: «descartar» con dos capas y con el resumen', () => {
  const ambas = (texto: string) => trappvel(texto, { pendiente: LISTA_ENTREGA, tanda: { abierta: true, nombre: 'Carolina Ruiz', cajaId: 'v11' } });

  it('H2k · lista y tanda abiertas, el mensaje nombra la caja de la tanda: no se confía en alcance=pregunta, se pregunta', () => {
    for (const a of [
      { accion: 'descartar', evidencia: 'bota lo de Carolina', alcance: 'pregunta', ref_cliente: 'Carolina' },
      { accion: 'descartar', evidencia: 'bota lo de Carolina', alcance: 'pregunta' },
      { accion: 'responder', evidencia: 'bota lo de Carolina', opcion: 'descartar' },
    ]) {
      const d = ejec(validar(una(a), ambas('bota lo de Carolina')));
      expect(d.paso.p).toBe('decir');
      expect((d.paso as { texto: string }).texto).toMatch(/^¿Descarto lo de la pregunta pendiente o la tanda de Carolina Ruiz\?/);
    }
    // «a ninguno» que además nombra la caja también se pregunta.
    const ninguno = ejec(validar(una({ accion: 'descartar', evidencia: 'a ninguno, bota lo de Carolina', alcance: 'pregunta' }), ambas('a ninguno, bota lo de Carolina')));
    expect(ninguno.rechazo).toBe('V14_dos_capas');
  });

  it('sin nombrar la caja, «a ninguno, bótalos» sigue contestando la lista; alcance=tanda que la nombra sigue siendo la tanda', () => {
    const lista = ejec(validar(una({ accion: 'descartar', evidencia: 'bótalos', alcance: 'pregunta' }), ambas('a ninguno, bótalos')));
    expect(lista.paso).toMatchObject({ p: 'responder_bandeja', canonico: 'DESCARTAR' });
    const tanda = ejec(validar(una({ accion: 'descartar', evidencia: 'bórrame lo de Carolina', alcance: 'tanda', ref_cliente: 'Carolina' }), ambas('bórrame lo de Carolina')));
    expect(tanda.paso).toEqual({ p: 'descartar', alcance: 'tanda' });
  });

  it('H2c · con el resumen pendiente, «descartar» con número es «mensajes» aunque falte el alcance; nunca todo el resumen', () => {
    for (const a of [
      { accion: 'descartar', evidencia: 'el 3 sobra', n: 3 },
      { accion: 'descartar', evidencia: 'el 3 sobra', n: 3, alcance: 'pregunta' },
      { accion: 'descartar', evidencia: 'el 3 sobra', n: 3, alcance: 'mensajes' },
    ]) {
      const d = ejec(validar(una(a), trappvel('el 3 sobra', { pendiente: RESUMEN })));
      expect(d.paso).toMatchObject({ p: 'responder_bandeja', canonico: 'descartar el 3' });
    }
    // El número escrito que el modelo no devolvió, o uno que no está escrito: se pregunta, no se bota el resumen.
    const sinN = ejec(validar(una({ accion: 'descartar', evidencia: 'el 3 sobra' }), trappvel('el 3 sobra', { pendiente: RESUMEN })));
    expect(sinN.paso.p).toBe('decir');
    expect(sinN.rechazo).toBe('V14_numero_sin_n');
    const otroN = ejec(validar(una({ accion: 'descartar', evidencia: 'el 3 sobra', n: 4 }), trappvel('el 3 sobra', { pendiente: RESUMEN })));
    expect(otroN.rechazo).toBe('V14_numero_no_escrito');
    expect(otroN.paso.p).toBe('decir');
    // Sin números, «bota eso» al resumen sigue siendo DESCARTAR de esa pregunta.
    const todo = ejec(validar(una({ accion: 'descartar', evidencia: 'bota eso', alcance: 'pregunta' }), trappvel('no, bota eso', { pendiente: RESUMEN })));
    expect(todo.paso).toMatchObject({ p: 'responder_bandeja', canonico: 'DESCARTAR' });
  });
});

describe('control de Vera · roles restringidos', () => {
  it('un rol sin `consulta` en su esquema: un gasto sin monto ni negocio no se abre, recibe el texto de su rol', () => {
    expect(accionesDelEsquema({ bandeja: false, rol: 'operator' })).not.toContain('consulta');
    for (const t of ['¿cuánto llevamos gastado este mes?', 'cuánto gasté en peajes', 'dame los gastos de la semana']) {
      const d = ejec(validar(una({ accion: 'gasto', evidencia: t }), termotech(t, { rol: 'operator' })));
      expect(d.paso).toEqual({ p: 'decir', texto: textoRol('operator') });
      expect(d.rechazo).toBe('V3_rol_gasto_vacio');
    }
  });

  it('el mismo rol sigue reportando gastos: con monto, con negocio o «pagué …» (el bot pregunta el monto, como hoy)', () => {
    const conMonto = ejec(validar(una({ accion: 'gasto', evidencia: 'pagué 18.900 de peaje', monto: 18900 }), termotech('pagué 18.900 de peaje', { rol: 'operator' })));
    expect(conMonto.paso).toMatchObject({ p: 'bot_gastos', gastos: [{ monto: 18900 }] });
    const conNegocio = ejec(validar(una({ accion: 'gasto', evidencia: 'gasto del chiller de Arena', negocio: 'Arena' }), termotech('gasto del chiller de Arena', { rol: 'operator' })));
    expect(conNegocio.paso).toMatchObject({ p: 'bot_gastos', gastos: [{ monto: null, negocio: { id: 'neg-a1' } }] });
    const reporte = ejec(validar(una({ accion: 'gasto', evidencia: 'pagué el almuerzo', descripcion: 'almuerzo' }), termotech('pagué el almuerzo', { rol: 'operator' })));
    expect(reporte.paso).toMatchObject({ p: 'bot_gastos', gastos: [{ monto: null, descripcion: 'almuerzo' }] });
    // Con consulta en el esquema (owner), la regla no aplica.
    const owner = ejec(validar(una({ accion: 'gasto', evidencia: 'cuánto gasté' }), termotech('cuánto gasté')));
    expect(owner.paso.p).toBe('bot_gastos');
  });

  it('un acuse a un contador (o solo lectura) que pidió registrar devuelve el texto de su rol, no silencio', () => {
    const c = ejec(validar(una({ accion: 'acuse', evidencia: 'registra un gasto de 50 mil' }), termotech('registra un gasto de 50 mil en Arena', { rol: 'contador' })));
    expect(c.paso).toEqual({ p: 'decir', texto: textoRol('contador') });
    expect(c.rechazo).toBe('V3_rol_acuse');
    const r = ejec(validar(una({ accion: 'acuse', evidencia: 'anota la visita' }), termotech('anota la visita a Clínica del Norte', { rol: 'read_only' })));
    expect(r.paso).toEqual({ p: 'decir', texto: textoRol('read_only') });
    // Un acuse de verdad sigue siendo silencio.
    const ok = ejec(validar(una({ accion: 'acuse', evidencia: 'gracias' }), termotech('gracias, muy amable', { rol: 'contador' })));
    expect(ok.paso).toEqual({ p: 'nada' });
  });
});

// ── Los textos (§4) ─────────────────────────────────────────────────────────

describe('los textos nuevos', () => {
  it('máximo 2 líneas; si preguntan, la pregunta va en la primera; ninguno dice «registrado» antes del sí', () => {
    for (const t of textosNuevos()) {
      const lineas = t.split('\n');
      expect({ t, lineas: lineas.length <= 2 }).toEqual({ t, lineas: true });
      if (t.includes('?')) expect({ t, primera: lineas[0].includes('?') }).toEqual({ t, primera: true });
      expect(t).not.toMatch(/registrad/i);
    }
  });

  it('las puertas del bot del intérprete dicen lo mismo que wa-webhook (paridad leída del fuente)', async () => {
    const fuente = readFileSync('supabase/functions/wa-webhook/index.ts', 'utf8');
    const io = readFileSync('supabase/functions/_shared/wa-interprete.ts', 'utf8');
    for (const k of ['TEXTO_PLAN', 'TEXTO_TOPE']) {
      const m = new RegExp(`export const ${k} = '([^']+)'`).exec(io);
      expect(m).not.toBeNull();
      expect(fuente).toContain(`'${m![1]}'`);
    }
  });
});
