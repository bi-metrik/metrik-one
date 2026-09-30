import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * El cron de recordatorios de punta a punta, contra una base en memoria que APLICA los filtros
 * (un doble que devuelve siempre la fila no prueba la idempotencia: la idempotencia ES el
 * filtro `enviado_at is null` del update) y contra un DOBLE del envío: la plantilla de Meta
 * todavía no existe y nada de aquí habla con la Graph API.
 *
 * Datos sintéticos. Las `etiqueta` son texto de prueba: no hay aquí ningún dato de persona.
 */

// `wa-recordatorios.ts` importa `wa-respond.ts`, que lee `Deno.env` y habla con la red. No se
// usa (el envío se inyecta por `deps`), pero tiene que poder importarse desde node.
vi.mock('./wa-respond.ts', () => ({ sendTemplate: vi.fn(async () => null) }));

import { procesarRecordatorios, confirmarRecordatorio } from './wa-recordatorios.ts';
import { payloadConfirmacion } from './wa-recordatorios-reglas.ts';

// ── Base en memoria ─────────────────────────────────────────────────────────────────────

type Fila = Record<string, unknown>;
type Tablas = Record<string, Fila[]>;

let seq = 0;
const nuevoId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

/** Llaves únicas que la base real impone y que el doble tiene que imponer también. */
const UNICOS: Record<string, string[]> = {
  wa_recordatorio_eventos: ['recordatorio_id', 'programado_para'],
};

function crearDb(t: Tablas) {
  function from(tabla: string) {
    if (!t[tabla]) throw new Error(`tabla inesperada en el doble: ${tabla}`);
    const filtros: Array<(f: Fila) => boolean> = [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: Fila | null = null;
    let orden: { col: string; asc: boolean } | null = null;
    let tope: number | null = null;

    const ejecutar = () => {
      if (op === 'insert') {
        const fila = { id: nuevoId(), created_at: new Date().toISOString(), ...payload };
        const unico = UNICOS[tabla];
        if (unico && t[tabla].some((x) => unico.every((c) => x[c] === fila[c]))) {
          return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
        }
        t[tabla].push(fila);
        return { data: [{ ...fila }], error: null };
      }
      let filas = t[tabla].filter((f) => filtros.every((p) => p(f)));
      if (op === 'update') {
        for (const f of filas) Object.assign(f, payload);
        return { data: filas.map((f) => ({ ...f })), error: null };
      }
      if (orden) {
        const { col, asc } = orden;
        filas = [...filas].sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')) * (asc ? 1 : -1));
      }
      if (tope !== null) filas = filas.slice(0, tope);
      return { data: filas.map((f) => ({ ...f })), error: null };
    };

    const api = {
      select() { return api; },
      insert(p: Fila) { op = 'insert'; payload = p; return api; },
      update(p: Fila) { op = 'update'; payload = p; return api; },
      eq(col: string, v: unknown) { filtros.push((f) => f[col] === v); return api; },
      is(col: string, v: null) { filtros.push((f) => (f[col] ?? null) === v); return api; },
      not(col: string, cmp: string, v: null) {
        if (cmp !== 'is' || v !== null) throw new Error(`not(${cmp}) no implementado en el doble`);
        filtros.push((f) => (f[col] ?? null) !== null);
        return api;
      },
      in(col: string, vals: unknown[]) { filtros.push((f) => vals.includes(f[col])); return api; },
      order(col: string, o?: { ascending?: boolean }) { orden = { col, asc: o?.ascending !== false }; return api; },
      limit(n: number) { tope = n; return api; },
      // Awaitable en cualquier punto de la cadena, como el builder de PostgREST.
      then<R>(res: (v: { data: Fila[] | null; error: { message: string } | null }) => R) {
        return Promise.resolve(ejecutar()).then(res);
      },
    };
    return api;
  }
  // El doble no implementa el tipo de PostgREST: los llamadores lo pasan con `as never`,
  // igual que `wa-carga-ejecucion.test.ts`.
  return { from };
}

// ── Escenario ───────────────────────────────────────────────────────────────────────────

const PLANTILLAS = JSON.stringify({
  recordatorio: { name: 'metrik_recordatorio_prueba', lang: 'es', params: ['etiqueta', 'hora'] },
  recordatorio_escalamiento: { name: 'metrik_recordatorio_escala_prueba', lang: 'es', params: ['etiqueta', 'hora'] },
});

const REC = '11111111-1111-4111-8111-111111111111';
const PRINCIPAL = '573000000001';
const ESCALA = '573000000002';

let db: ReturnType<typeof crearDb>;
let tablas: Tablas;
let enviados: Array<{ phone: string; name: string; componentes: unknown }>;

function entorno(extra: Record<string, string> = {}) {
  const vars: Record<string, string | undefined> = {
    WA_RECORDATORIOS: 'on',
    WA_ALERT_TEMPLATES: PLANTILLAS,
    ...extra,
  };
  return (k: string) => vars[k];
}

const envioDoble = vi.fn(async (phone: string, name: string, _lang: string, componentes: unknown) => {
  enviados.push({ phone, name, componentes });
  return `wamid.${enviados.length}`;
});

beforeEach(() => {
  seq = 0;
  enviados = [];
  envioDoble.mockClear();
  tablas = {
    wa_recordatorios: [{
      id: REC,
      workspace_id: null,
      destinatario_phone: PRINCIPAL,
      escalamiento_phone: ESCALA,
      etiqueta: 'pendiente de prueba',
      horarios: ['07:00:00', '19:00:00'],
      escalamiento_minutos: 30,
      activo: true,
    }],
    wa_recordatorio_eventos: [],
  };
  db = crearDb(tablas);
});

/** 19:30 del 30-sep en Bogotá = 1-oct 00:30 en UTC: las dos dosis del día ya vencieron. */
const LAS_1930 = new Date('2026-10-01T00:30:00Z');

function correr(ahora: Date, extraEnv: Record<string, string> = {}) {
  return procesarRecordatorios(db as never, {
    ahora: () => ahora,
    env: entorno(extraEnv),
    enviarPlantilla: envioDoble as never,
  });
}

describe('la bandera manda', () => {
  it('apagada no manda nada ni crea ledger', async () => {
    const r = await procesarRecordatorios(db as never, {
      ahora: () => LAS_1930,
      env: entorno({ WA_RECORDATORIOS: 'off' }),
      enviarPlantilla: envioDoble as never,
    });
    expect(r).toMatchObject({ ok: true, apagado: true, motivo: 'bandera_apagada', enviados: 0 });
    expect(enviados).toEqual([]);
    expect(tablas.wa_recordatorio_eventos).toEqual([]);
  });

  it('prendida pero sin plantilla declarada tampoco manda: no degrada a texto libre', async () => {
    const r = await procesarRecordatorios(db as never, {
      ahora: () => LAS_1930,
      env: entorno({ WA_ALERT_TEMPLATES: '' }),
      enviarPlantilla: envioDoble as never,
    });
    expect(r).toMatchObject({ apagado: true, motivo: 'sin_plantilla' });
    expect(enviados).toEqual([]);
    expect(tablas.wa_recordatorio_eventos).toEqual([]);
  });
});

describe('envío e idempotencia', () => {
  it('manda las dos dosis vencidas del día y deja el ledger con su wamid', async () => {
    const r = await correr(LAS_1930);
    expect(r).toMatchObject({ ok: true, enviados: 2, omitidos: 0, errores: 0 });
    expect(enviados.map((e) => e.phone)).toEqual([PRINCIPAL, PRINCIPAL]);
    expect(enviados[0].name).toBe('metrik_recordatorio_prueba');
    const eventos = tablas.wa_recordatorio_eventos;
    expect(eventos).toHaveLength(2);
    expect(eventos.map((e) => e.programado_para)).toEqual([
      '2026-09-30T12:00:00.000Z', // 07:00 Bogotá
      '2026-10-01T00:00:00.000Z', // 19:00 Bogotá
    ]);
    expect(eventos.every((e) => e.enviado_at && e.wa_envio_id)).toBe(true);
  });

  it('dos corridas seguidas NO mandan dos veces la misma dosis', async () => {
    await correr(LAS_1930);
    const segunda = await correr(new Date('2026-10-01T00:31:00Z'));
    expect(segunda).toMatchObject({ enviados: 0, omitidos: 2 });
    expect(enviados).toHaveLength(2);
    expect(tablas.wa_recordatorio_eventos).toHaveLength(2);
  });

  it('el reclamo del envío es el que decide: si la dosis ya está estampada, no sale', async () => {
    // Se simula la corrida que se adelantó: el evento existe y ya tiene `enviado_at`.
    tablas.wa_recordatorio_eventos.push({
      id: nuevoId(), recordatorio_id: REC, programado_para: '2026-10-01T00:00:00.000Z',
      enviado_at: '2026-10-01T00:00:10.000Z', confirmado_at: null, escalado_at: null,
    });
    const r = await correr(LAS_1930);
    expect(r.enviados).toBe(1); // solo la de las 07:00
    expect(r.omitidos).toBe(1);
  });

  it('el botón dinámico solo se manda cuando la plantilla lo declara', async () => {
    await correr(LAS_1930);
    expect((enviados[0].componentes as unknown[]).some((c) => (c as { type: string }).type === 'button')).toBe(false);

    enviados = [];
    tablas.wa_recordatorio_eventos = [];
    await correr(LAS_1930, { WA_RECORDATORIO_BOTON_DINAMICO: 'on' });
    const boton = (enviados[0].componentes as Array<{ type: string; parameters?: Array<{ payload?: string }> }>)
      .find((c) => c.type === 'button');
    const evento = tablas.wa_recordatorio_eventos[0];
    expect(boton?.parameters?.[0].payload).toBe(payloadConfirmacion(String(evento.id)));
  });

  it('corre en domingo y en festivo: la regla de día hábil NO aplica a este tipo', async () => {
    // 2026-01-01 es festivo en Colombia y además jueves; 2026-01-04 es domingo.
    for (const [dia, iso] of [['festivo', '2026-01-02T00:30:00Z'], ['domingo', '2026-01-05T00:30:00Z']]) {
      tablas.wa_recordatorio_eventos = [];
      enviados = [];
      const r = await correr(new Date(iso));
      expect(r.enviados, `${dia} debe salir igual`).toBe(2);
    }
  });
});

describe('confirmación', () => {
  it('con dos dosis pendientes marca la más reciente, y solo esa', async () => {
    await correr(LAS_1930);
    const [temprana, reciente] = tablas.wa_recordatorio_eventos;
    // Las dos salieron en la misma corrida: se separa `enviado_at` como en la vida real.
    temprana.enviado_at = '2026-09-30T12:00:05.000Z';
    reciente.enviado_at = '2026-10-01T00:00:05.000Z';

    const r = await confirmarRecordatorio(db as never, PRINCIPAL, 'rec_ok', {
      ahora: () => new Date('2026-10-01T00:05:00Z'),
    });
    expect(r).toMatchObject({ confirmado: true, eventoId: reciente.id });
    expect(reciente.confirmado_at).toBe('2026-10-01T00:05:00.000Z');
    expect(reciente.confirmado_por).toBe(PRINCIPAL);
    expect(temprana.confirmado_at ?? null).toBeNull();
  });

  it('el payload con id marca esa dosis exacta, aunque no sea la última', async () => {
    await correr(LAS_1930);
    const [temprana, reciente] = tablas.wa_recordatorio_eventos;
    const r = await confirmarRecordatorio(db as never, PRINCIPAL, payloadConfirmacion(String(temprana.id)), {
      ahora: () => new Date('2026-10-01T00:06:00Z'),
    });
    expect(r).toMatchObject({ confirmado: true, eventoId: temprana.id });
    expect(reciente.confirmado_at ?? null).toBeNull();
  });

  it('el número de escalamiento también puede confirmar', async () => {
    await correr(LAS_1930);
    const r = await confirmarRecordatorio(db as never, `+57 300 000 0002`, 'rec_ok', {
      ahora: () => new Date('2026-10-01T01:05:00Z'),
    });
    expect(r.confirmado).toBe(true);
    expect(tablas.wa_recordatorio_eventos.find((e) => e.id === r.eventoId)!.confirmado_por).toBe(ESCALA);
  });

  it('un número ajeno no confirma nada', async () => {
    await correr(LAS_1930);
    const r = await confirmarRecordatorio(db as never, '573009999999', 'rec_ok', { ahora: () => new Date() });
    expect(r).toMatchObject({ confirmado: false, motivo: 'sin_evento' });
    expect(tablas.wa_recordatorio_eventos.every((e) => (e.confirmado_at ?? null) === null)).toBe(true);
  });

  it('dos toques del mismo botón no confirman dos veces', async () => {
    await correr(LAS_1930);
    const primera = await confirmarRecordatorio(db as never, PRINCIPAL, 'rec_ok', { ahora: () => new Date('2026-10-01T00:05:00Z') });
    const segunda = await confirmarRecordatorio(db as never, PRINCIPAL, payloadConfirmacion(String(primera.eventoId)), {
      ahora: () => new Date('2026-10-01T00:06:00Z'),
    });
    expect(segunda).toMatchObject({ confirmado: false, motivo: 'ya_confirmado' });
    const evento = tablas.wa_recordatorio_eventos.find((e) => e.id === primera.eventoId)!;
    expect(evento.confirmado_at).toBe('2026-10-01T00:05:00.000Z');
  });
});

describe('escalamiento', () => {
  it('sin confirmación a los 30 minutos se escala UNA sola vez', async () => {
    await correr(LAS_1930); // dos dosis enviadas a las 00:30Z
    enviados = [];

    const treintaDespues = new Date('2026-10-01T01:00:00Z');
    const r = await correr(treintaDespues);
    expect(r.escalados).toBe(2); // las dos dosis del día siguen sin confirmar
    // Por cada dosis: se le repite al principal y se le avisa al de escalamiento.
    expect(enviados.map((e) => e.phone)).toEqual([PRINCIPAL, ESCALA, PRINCIPAL, ESCALA]);
    expect(enviados[1].name).toBe('metrik_recordatorio_escala_prueba');
    expect(tablas.wa_recordatorio_eventos.every((e) => e.escalado_at === treintaDespues.toISOString())).toBe(true);

    enviados = [];
    const otra = await correr(new Date('2026-10-01T01:15:00Z'));
    expect(otra.escalados).toBe(0);
    expect(enviados).toEqual([]);
  });

  it('lo confirmado no se escala', async () => {
    await correr(LAS_1930);
    for (const e of tablas.wa_recordatorio_eventos) e.confirmado_at = '2026-10-01T00:40:00.000Z';
    enviados = [];
    const r = await correr(new Date('2026-10-01T01:00:00Z'));
    expect(r.escalados).toBe(0);
    expect(enviados).toEqual([]);
  });

  it('antes del plazo no se escala', async () => {
    await correr(LAS_1930);
    enviados = [];
    const r = await correr(new Date('2026-10-01T00:55:00Z')); // 25 min
    expect(r.escalados).toBe(0);
  });

  it('sin plantilla de escalamiento se escala igual y solo se pierde el aviso al segundo número', async () => {
    const soloRecordatorio = JSON.stringify({
      recordatorio: { name: 'metrik_recordatorio_prueba', lang: 'es', params: ['etiqueta', 'hora'] },
    });
    await correr(LAS_1930, { WA_ALERT_TEMPLATES: soloRecordatorio });
    enviados = [];
    const r = await correr(new Date('2026-10-01T01:00:00Z'), { WA_ALERT_TEMPLATES: soloRecordatorio });
    expect(r.escalados).toBe(2);
    expect(enviados.map((e) => e.phone)).toEqual([PRINCIPAL, PRINCIPAL]);
  });
});

describe('cuando Meta rechaza', () => {
  it('la dosis queda estampada (no se reintenta cada 15 min) y el escalamiento la cubre', async () => {
    const rechaza = vi.fn(async () => null);
    const r = await procesarRecordatorios(db as never, {
      ahora: () => LAS_1930,
      env: entorno(),
      enviarPlantilla: rechaza as never,
    });
    expect(r).toMatchObject({ enviados: 0, errores: 2 });
    expect(tablas.wa_recordatorio_eventos.every((e) => e.enviado_at && !e.wa_envio_id)).toBe(true);

    const siguiente = await procesarRecordatorios(db as never, {
      ahora: () => new Date('2026-10-01T00:45:00Z'),
      env: entorno(),
      enviarPlantilla: rechaza as never,
    });
    expect(siguiente.enviados).toBe(0);
    expect(siguiente.omitidos).toBe(2); // no se reintenta
  });
});
