// Lo que llega a `gastos` por WhatsApp, recorrido entero por los handlers reales
// (handleGasto -> resume -> executeRegistro) contra un doble de Supabase que
// guarda lo que se inserta.
//
// El defecto que fija: en los caminos que pasan por la sesion (elegir destino,
// confirmar) el handler de reanudacion recibe `parsed.fields = {}` (lo arma
// asi el webhook), y `showGastoConfirmation` / `proceedEmpresaGasto`
// sobrescribian `parsed_fields` con eso: el gasto se guardaba con
// `mensaje_original` NULL y la descripcion recortada. Medido en produccion: los
// 11 gastos de WhatsApp del 2026-09-12 al 23 tienen `mensaje_original` NULL.
import { describe, expect, it } from 'vitest';
import type { HandlerContext, ParsedFields, SessionContext, SessionState } from '../../types';
import { handleGasto } from './gasto';
import { handleResumeRegistro } from './resume';
import { MSG_PEDIR_MONTO } from './mensajes-gasto';
import { MSG_MONTO } from './monto-pendiente';
import { enrichFields, regexParse } from '../../wa-parse-reglas';

type Fila = Record<string, unknown>;

/** Doble minimo de PostgREST: filtra por igualdad cuando la columna existe y guarda los insert. */
function supabaseFalso(tablas: Record<string, Fila[]>) {
  const insertados: Record<string, Fila[]> = {};
  const actualizados: Record<string, Fila[]> = {};
  function builder(tabla: string) {
    const filtros: Array<[string, unknown]> = [];
    let pendienteInsert: Fila | null = null;
    const filas = () => (tablas[tabla] ?? []).filter((f) =>
      filtros.every(([c, v]) => !(c in f) || f[c] === v));
    const b: Record<string, unknown> = {};
    const encadenar = () => b;
    for (const m of ['select', 'order', 'limit', 'ilike', 'neq', 'gt', 'in', 'not', 'delete']) b[m] = encadenar;
    b.update = (fila: Fila) => { (actualizados[tabla] ??= []).push(fila); return b; };
    b.eq = (c: string, v: unknown) => { filtros.push([c, v]); return b; };
    b.insert = (fila: Fila) => {
      pendienteInsert = { id: `id-${tabla}-${(insertados[tabla]?.length ?? 0) + 1}`, ...fila };
      (insertados[tabla] ??= []).push(pendienteInsert);
      return b;
    };
    const resultado = () => {
      if (pendienteInsert) return { data: pendienteInsert, error: null };
      const f = filas();
      return { data: f[0] ?? null, error: f[0] ? null : { code: 'PGRST116' } };
    };
    b.single = async () => resultado();
    b.maybeSingle = async () => ({ ...resultado(), error: null });
    b.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: filas(), error: null }).then(ok);
    return b;
  }
  return { client: { from: builder, rpc: async () => ({ data: null, error: null }) }, insertados, actualizados };
}

const NEGOCIO = { id: 'neg-1', nombre: 'Barandas Conjunto', codigo: 'B1 26 2', estado: 'abierto', workspace_id: 'ws-1' };

function escenario() {
  const db = supabaseFalso({
    negocios: [NEGOCIO],
    v_proyecto_financiero: [],
    gastos_recurrentes_map: [],
    bot_sessions: [{ id: 'ses-1', context: {} }],
  });
  const enviados: string[] = [];
  const session = { id: 'ses-1', state: 'started' as SessionState, context: {} as SessionContext };
  const ctxPara = (texto: string, fields: ParsedFields, confianza = 0.9): HandlerContext => ({
    user: { workspace_id: 'ws-1', name: 'Julián', user_id: 'u-1', role: 'owner' } as HandlerContext['user'],
    message: { phone: '573000000000', text: texto, type: 'text' } as HandlerContext['message'],
    session: session as HandlerContext['session'],
    parsed: { intent: 'GASTO', confidence: confianza, fields },
    supabase: db.client as unknown as HandlerContext['supabase'],
    sendMessage: async (t: string) => { enviados.push(t); },
    sendOptions: async (t: string, o: string[]) => { enviados.push(`${t}\n${o.join('\n')}`); },
    sendButtons: async (t: string) => { enviados.push(t); },
    updateSession: async (state: SessionState, context?: Partial<SessionContext>) => {
      session.state = state;
      if (context) session.context = { ...session.context, ...context };
    },
  });
  // El webhook arma asi el contexto de una respuesta a un flujo en curso.
  const responder = (texto: string) => handleResumeRegistro(ctxPara(texto, {}, 1));
  return { db, enviados, session, ctxPara, responder };
}

/** `completeSession` escribe en la base, no en la sesion en memoria: se mira la base. */
const sesionCerrada = (db: ReturnType<typeof supabaseFalso>) =>
  db.actualizados.bot_sessions?.at(-1)?.state === 'completed';

const gastoGuardado = (db: ReturnType<typeof supabaseFalso>) => {
  const filas = db.insertados.gastos ?? [];
  expect(filas).toHaveLength(1);
  return filas[0];
};

describe('gasto que pasa por elegir destino (el camino real del 2026-09-15)', () => {
  const mensaje = '14400 para impresión de documentos para abrir la cuenta en bancolombia';
  const fields: ParsedFields = {
    amount: 14400,
    concept: 'impresión documentos',
    descripcion: 'impresión de documentos para abrir la cuenta en bancolombia',
    mensaje_original: mensaje,
  };

  it('eligiendo "gasto de empresa": descripcion completa y mensaje original guardados', async () => {
    const e = escenario();
    await handleGasto(e.ctxPara(mensaje, fields));
    expect(e.session.state).toBe('awaiting_selection');
    await e.responder('2'); // 1 = el negocio, 2 = gasto de empresa
    expect(e.session.state).toBe('confirming');
    // La confirmacion muestra lo que se va a guardar.
    expect(e.enviados.at(-1)).toContain('📝 impresión de documentos para abrir la cuenta en bancolombia');
    await e.responder('si');
    const g = gastoGuardado(e.db);
    expect(g.descripcion).toBe('impresión de documentos para abrir la cuenta en bancolombia');
    expect(g.mensaje_original).toBe(mensaje);
    expect(g.tipo).toBe('empresa');
  });

  it('eligiendo un negocio: igual, y queda atado al negocio', async () => {
    const e = escenario();
    await handleGasto(e.ctxPara(mensaje, fields));
    await e.responder('1');
    expect(e.enviados.at(-1)).toContain('📝 impresión de documentos para abrir la cuenta en bancolombia');
    await e.responder('si');
    const g = gastoGuardado(e.db);
    expect(g.negocio_id).toBe('neg-1');
    expect(g.descripcion).toBe('impresión de documentos para abrir la cuenta en bancolombia');
    expect(g.mensaje_original).toBe(mensaje);
  });
});

describe('gasto con codigo de negocio y confianza alta (se registra sin confirmar)', () => {
  it('DEWALT: la descripcion completa llega al insert y al mensaje de exito', async () => {
    const mensaje = 'Gasto en DEWALT por valor de  15.000 en ESCOBILLAS TALADRO correspondiente al proyecto B1 26 2';
    const e = escenario();
    await handleGasto(e.ctxPara(mensaje, {
      amount: 15000, project_code: 'B1 26 2', concept: 'escobillas taladro',
      descripcion: 'DEWALT en ESCOBILLAS TALADRO', mensaje_original: mensaje,
    }));
    const g = gastoGuardado(e.db);
    expect(g.descripcion).toBe('DEWALT en ESCOBILLAS TALADRO');
    expect(g.mensaje_original).toBe(mensaje);
    expect(e.enviados.some((t) => t.includes('✅') && t.includes('📝 DEWALT en ESCOBILLAS TALADRO'))).toBe(true);
  });

  it('una descripcion de mas de 40 caracteres se guarda entera (antes: "Categoria — $monto")', async () => {
    const detalle = 'GASTOS DE TRANSPORTE ENTREGA BARANDAS en camion de estacas hasta el conjunto del norte';
    const e = escenario();
    await handleGasto(e.ctxPara('x', { amount: 900000, project_code: 'B1 26 2', descripcion: detalle, mensaje_original: 'x' }));
    expect(gastoGuardado(e.db).descripcion).toBe(detalle);
  });
});

// Lo que el parser le entrega a `handleGasto` por un mensaje sin monto: las reglas
// deterministas (sin Gemini) y el `mensaje_original` que inyecta el webhook.
function primerMensaje(texto: string): ParsedFields {
  const r = enrichFields(regexParse(texto), texto);
  expect(r.intent).toBe('GASTO');
  expect(r.fields.amount).toBeUndefined();
  return { ...r.fields, mensaje_original: texto };
}

// Termotech, 2026-09-23: "Registrar gasto" (boton del menu) -> "18900" -> "1" -> "Peaje".
// El detalle se perdia por dos lados: el primer mensaje no se recordaba, y el texto libre
// sobre la confirmacion se rechazaba con "Presiona un botón...".
describe('flujo guiado: el primer mensaje no trae monto', () => {
  it('"Registrar gasto de peaje" -> "18900": se recuerda el detalle del primer mensaje', async () => {
    const e = escenario();
    await handleGasto(e.ctxPara('Registrar gasto de peaje', primerMensaje('Registrar gasto de peaje'), 0.85));
    expect(e.enviados).toEqual([MSG_PEDIR_MONTO]);
    expect(e.session.state).toBe('collecting');
    await e.responder('18900');
    expect(e.session.state).toBe('awaiting_selection');
    await e.responder('1');
    expect(e.enviados.at(-1)).toContain('📝 peaje');
    await e.responder('si');
    const g = gastoGuardado(e.db);
    expect(g.descripcion).toBe('peaje');
    expect(g.categoria).toBe('transporte');
    expect(g.monto).toBe(18900);
    expect(g.mensaje_original).toBe('Registrar gasto de peaje / 18900');
    expect(g.negocio_id).toBe('neg-1');
  });

  it('"Registrar gasto" -> "18900 peaje": el detalle viene con el monto', async () => {
    const e = escenario();
    await handleGasto(e.ctxPara('Registrar gasto', primerMensaje('Registrar gasto'), 0.85));
    await e.responder('18900 peaje');
    await e.responder('1');
    await e.responder('si');
    const g = gastoGuardado(e.db);
    expect(g.descripcion).toBe('peaje');
    expect(g.monto).toBe(18900);
    expect(g.mensaje_original).toBe('Registrar gasto / 18900 peaje');
  });

  it('detalle en los dos mensajes: se une sin repetir', async () => {
    const e = escenario();
    await handleGasto(e.ctxPara('Registrar gasto de peaje', primerMensaje('Registrar gasto de peaje'), 0.85));
    await e.responder('18.900 peaje');
    await e.responder('2'); // gasto de empresa
    await e.responder('si');
    expect(gastoGuardado(e.db).descripcion).toBe('peaje');
  });

  it('"Registrar gasto" -> "18900" -> "1" -> "si": sin detalle, sin inventar', async () => {
    const e = escenario();
    await handleGasto(e.ctxPara('Registrar gasto', primerMensaje('Registrar gasto'), 0.85));
    await e.responder('18900');
    await e.responder('1');
    await e.responder('si');
    const g = gastoGuardado(e.db);
    expect(g.descripcion).toMatch(/^Otros gastos operativos — \$\s?18\.900$/);
    expect(g.mensaje_original).toBe('Registrar gasto / 18900');
  });

  it('respuesta sin monto: vuelve a pedirlo sin expulsar, y guarda el detalle que traiga', async () => {
    const e = escenario();
    await handleGasto(e.ctxPara('Registrar gasto', primerMensaje('Registrar gasto'), 0.85));
    await e.responder('peaje');
    expect(e.session.state).toBe('collecting');
    expect(e.enviados.at(-1)).toContain(MSG_PEDIR_MONTO);
    expect(e.enviados.at(-1)).not.toContain('❌');
    await e.responder('18900');
    await e.responder('1');
    await e.responder('si');
    const g = gastoGuardado(e.db);
    expect(g.descripcion).toBe('peaje');
    expect(g.mensaje_original).toBe('Registrar gasto / peaje / 18900');
  });

  it('tres respuestas seguidas sin monto: suelta la conversacion, sin registrar', async () => {
    const e = escenario();
    await handleGasto(e.ctxPara('Registrar gasto', primerMensaje('Registrar gasto'), 0.85));
    await e.responder('mmm');
    await e.responder('no recuerdo bien');
    expect(e.session.state).toBe('collecting');
    expect(sesionCerrada(e.db)).toBe(false);
    await e.responder('déjame ver');
    expect(sesionCerrada(e.db)).toBe(true);
    expect(e.enviados.at(-1)).toBe(MSG_MONTO.rendicion);
    expect(e.db.insertados.gastos).toBeUndefined();
  });

  it('"cancelar" cancela', async () => {
    const e = escenario();
    await handleGasto(e.ctxPara('Registrar gasto', primerMensaje('Registrar gasto'), 0.85));
    await e.responder('cancelar');
    expect(sesionCerrada(e.db)).toBe(true);
    expect(e.enviados.at(-1)).toBe('❌ Cancelado.');
  });

  it('otra orden ("mis números"): suelta el gasto y pide repetirla, no la atrapa', async () => {
    const e = escenario();
    await handleGasto(e.ctxPara('Registrar gasto', primerMensaje('Registrar gasto'), 0.85));
    await e.responder('mis números');
    expect(sesionCerrada(e.db)).toBe(true);
    expect(e.enviados.at(-1)).toBe(MSG_MONTO.otraOrden);
    expect(e.db.insertados.gastos).toBeUndefined();
  });
});

describe('texto libre sobre la confirmacion de un gasto', () => {
  async function hastaConfirmar(e: ReturnType<typeof escenario>, primero = 'Registrar gasto') {
    await handleGasto(e.ctxPara(primero, primerMensaje(primero), 0.85));
    await e.responder('18900');
    await e.responder('1');
    expect(e.session.state).toBe('confirming');
  }

  it('"Peaje" es la descripcion: re-muestra la confirmacion con ella y se guarda', async () => {
    const e = escenario();
    await hastaConfirmar(e);
    expect(e.enviados.at(-1)).not.toContain('📝');
    await e.responder('Peaje');
    expect(e.session.state).toBe('confirming');
    const confirmacion = e.enviados.at(-1)!;
    expect(confirmacion).toContain('📝 Peaje');
    expect(confirmacion).toContain('Barandas Conjunto');
    expect(confirmacion).not.toContain('Presiona un botón');
    await e.responder('si');
    const g = gastoGuardado(e.db);
    expect(g.descripcion).toBe('Peaje');
    // La descripcion nueva dice la categoria.
    expect(g.categoria).toBe('transporte');
    expect(g.negocio_id).toBe('neg-1');
    expect(g.mensaje_original).toBe('Registrar gasto / 18900 / Peaje');
  });

  it('corregir: la descripcion nueva REEMPLAZA a la anterior', async () => {
    const e = escenario();
    await hastaConfirmar(e, 'Registrar gasto de peaje');
    expect(e.enviados.at(-1)).toContain('📝 peaje');
    await e.responder('almuerzo del equipo');
    expect(e.enviados.at(-1)).toContain('📝 almuerzo del equipo');
    await e.responder('si');
    const g = gastoGuardado(e.db);
    expect(g.descripcion).toBe('almuerzo del equipo');
    expect(g.categoria).toBe('alimentacion');
  });

  it('en un gasto de empresa tambien', async () => {
    const e = escenario();
    await handleGasto(e.ctxPara('Registrar gasto', primerMensaje('Registrar gasto'), 0.85));
    await e.responder('18900');
    await e.responder('2');
    await e.responder('parqueadero centro');
    expect(e.enviados.at(-1)).toContain('💰 Gasto de empresa');
    expect(e.enviados.at(-1)).toContain('📝 parqueadero centro');
    await e.responder('si');
    const g = gastoGuardado(e.db);
    expect(g.tipo).toBe('empresa');
    expect(g.descripcion).toBe('parqueadero centro');
  });

  it('una respuesta corta sigue confirmando o cancelando', async () => {
    const e = escenario();
    await hastaConfirmar(e);
    await e.responder('Sí, confirmo');
    expect(gastoGuardado(e.db).monto).toBe(18900);

    const f = escenario();
    await hastaConfirmar(f);
    await f.responder('No gracias');
    expect(sesionCerrada(f.db)).toBe(true);
    expect(f.enviados.at(-1)).toBe('❌ Cancelado.');
    expect(f.db.insertados.gastos).toBeUndefined();
  });

  it('otro monto no se toma como descripcion: repite los botones', async () => {
    const e = escenario();
    await hastaConfirmar(e);
    await e.responder('fueron 20000');
    expect(e.enviados.at(-1)).toBe('Presiona un botón para confirmar o cancelar.');
    expect(e.session.context.parsed_fields?.descripcion).toBeUndefined();
  });

  it('un texto que no deja detalle tras limpiarlo repite los botones', async () => {
    const e = escenario();
    await hastaConfirmar(e);
    await e.responder('gasto');
    expect(e.enviados.at(-1)).toBe('Presiona un botón para confirmar o cancelar.');
  });
});

describe('sin monto', () => {
  it('pregunta el monto como pregunta normal, no como error', async () => {
    const e = escenario();
    await handleGasto(e.ctxPara('Registrar gasto', { mensaje_original: 'Registrar gasto' }));
    expect(e.enviados).toEqual([MSG_PEDIR_MONTO]);
    expect(MSG_PEDIR_MONTO).not.toContain('❌');
    expect(e.db.insertados.gastos).toBeUndefined();
    // Y se queda esperando la respuesta, con lo que traia el mensaje.
    expect(e.session.state).toBe('collecting');
    expect(e.session.context.pending_action).toBe('W01');
    expect(e.session.context.parsed_fields?.mensaje_original).toBe('Registrar gasto');
  });
});

describe('categoria que el parser invento', () => {
  it('no llega al insert: cae a una valida', async () => {
    const e = escenario();
    await handleGasto(e.ctxPara('x', {
      amount: 50000, project_code: 'B1 26 2', category_hint: 'tintos', descripcion: 'tintos reunion', mensaje_original: 'x',
    }));
    expect(gastoGuardado(e.db).categoria).toBe('alimentacion');
  });
});
