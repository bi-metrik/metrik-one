/**
 * El chat de la simulación del 2026-10-01 (Carolina Ruiz, Punta Cana en familia), de punta a
 * punta, con la salida del modelo GRABADA (`__fixtures__/chat-punta-cana.json`): las cuatro
 * tandas pasan por las mismas funciones puras que corre `wa-entendimiento.ts`.
 *
 * La config sale de ejecutar en PGlite el SQL PROVISIONAL del 2026-09-28 y el de opciones «no
 * definido» del 2026-10-01 sobre el bloque sintético (`solicitud-viaje-sintetica.json`, escrito
 * a mano): nada copiado de producción. Cliente y mensajes son ficticios.
 *
 * Lo que tiene que pasar (encargo brief-max-2026-10-01-correcciones-entendimiento.md):
 * de la tanda 1 a la 4 el mínimo queda completo y sin conflictos falsos.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { aplanarBloques } from './niveles-solicitud.ts';
import {
  aplicarSumas,
  conDeducciones,
  fusionarSugeridos,
  huecos,
  mayusculasDeViaje,
  mensajeAlComercial,
  resumenEntendido,
  validarSalida,
  MAX_PREGUNTAS,
  type CampoEntendible,
} from './wa-entendimiento-reglas.ts';
import { cargarEnExistente, mensajeCargaExistente, origenDeFrase, sugeridosConDeducciones, type Conflicto } from './wa-carga-reglas.ts';
import chat from './__fixtures__/chat-punta-cana.json';
import sintetica from '../../../src/lib/negocios/__fixtures__/solicitud-viaje-sintetica.json';

const RAIZ = path.resolve(__dirname, '../../..');
const SQLS = [
  'sql/trappvel/2026-09-28_solicitud-minimo-deseable-PROVISIONAL.sql',
  'sql/trappvel/2026-10-01_opciones-no-definido-PROVISIONAL.sql',
].map(f => readFileSync(path.join(RAIZ, f), 'utf8'));
const ID = '98281a40-2f67-4d8e-9bc5-6ca1f7a69417';
const HOY = '2026-10-01';
const ENLACE = 'https://trappvel.metrikone.co/negocios/n-sim';

let db: PGlite;
let FIELDS: CampoEntendible[];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create table public.bloque_configs (id uuid primary key, slug text, config_extra jsonb)`);
  await db.query(`insert into public.bloque_configs values ($1, 'condiciones_del_viaje', $2)`, [ID, { label: 'x', fields: sintetica }]);
  for (const sql of SQLS) await db.exec(sql);
  const r = await db.query<{ fields: CampoEntendible[] }>(`select config_extra->'fields' as fields from public.bloque_configs where id = $1`, [ID]);
  FIELDS = r.rows[0].fields;
}, 30_000);
afterAll(async () => { await db.close(); });

type Tanda = (typeof chat.tandas)[number];
type Accion = (data: Record<string, unknown>) => Record<string, unknown>;

interface Paso {
  mensaje: string;
  data: Record<string, unknown>;
  conflictos: Conflicto[];
  descartados: Array<{ slug: string; motivo: string }>;
}

/** Lo que hace `wa-entendimiento.ts` con una tanda, sin base ni WhatsApp. */
function correr(acciones: Record<number, Accion> = {}): Paso[] {
  const pasos: Paso[] = [];
  let data: Record<string, unknown> | null = null;
  chat.tandas.forEach((t: Tanda, i: number) => {
    const texto = t.mensajes.map(m => m.cuerpo.trim()).join('\n---\n');
    const en = `2026-10-01T1${i}:00:00.000Z`;
    if (!data) {
      // Negocio nuevo (`entender` → `crearNegocio` → `mensajeAlComercial`).
      const v = validarSalida(t.salida_modelo, FIELDS, texto, { hoyISO: HOY });
      const sug = conDeducciones(FIELDS, v.sugeridos);
      let d: Record<string, unknown> = {};
      for (const f of FIELDS) if (f.default !== undefined) d[f.slug] = f.default;
      d = fusionarSugeridos(d, FIELDS, sug, { entrega_id: `e${i}`, en }).data;
      d = mayusculasDeViaje(FIELDS, aplicarSumas(FIELDS, d));
      const h = huecos(FIELDS, d);
      const resumen = resumenEntendido(FIELDS, { ...d, ...Object.fromEntries(Object.entries(sug).map(([k, x]) => [k, x.valor])) });
      pasos.push({ mensaje: mensajeAlComercial({ resumen, faltanMinimo: h.minimo.faltan, enlace: ENLACE }), data: d, conflictos: [], descartados: v.descartados });
      data = d;
    } else {
      // Negocio existente (`cargarEnNegocioExistente`).
      const { valores: yaTiene } = aplanarBloques([{ fields: FIELDS, data }]);
      const v = validarSalida(t.salida_modelo, FIELDS, texto, { hoyISO: HOY, conocidos: yaTiene });
      const meta = { entrega_id: `e${i}`, en, origenDe: (f: string) => origenDeFrase(f, t.mensajes) };
      const sug = sugeridosConDeducciones([{ fields: FIELDS, data }], v.sugeridos, meta);
      const r = cargarEnExistente(data, FIELDS, sug, meta);
      const h = huecos(FIELDS, aplicarSumas(FIELDS, r.data));
      pasos.push({
        mensaje: mensajeCargaExistente({
          codigo: 'T1 26 11', fields: FIELDS,
          escritos: r.escritos.map(s => ({ slug: s, valor: r.data[s] })),
          conflictos: r.conflictos,
          actualizados: r.actualizados.map(a => ({ ...a, valor: r.data[a.slug] as string | number })),
          faltanMinimo: h.minimo.faltan, enlace: ENLACE, maxPreguntas: MAX_PREGUNTAS,
        }),
        data: r.data, conflictos: r.conflictos, descartados: v.descartados,
      });
      data = r.data;
    }
    if (acciones[i]) data = acciones[i](data);
  });
  return pasos;
}

const sinCampos = (d: Record<string, unknown>) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith('_')));

describe('el chat de Punta Cana, tanda 1 a 4, sin que nadie toque el negocio', () => {
  it('la config del fixture sale de los dos SQL y marca las opciones «no definido»', () => {
    const marcadas = FIELDS.flatMap(f => (f as { opciones?: Array<{ value: string; no_definido?: boolean }> }).opciones?.filter(o => o.no_definido).map(o => `${f.slug}.${o.value}`) ?? []);
    expect(marcadas).toEqual(['presupuesto.sin_definir', 'categoria_hotel.sin_preferencia']);
  });

  it('tanda 1: «diciembre» y «¿cuánto sale?» no se llenan; el bot pregunta las fechas', () => {
    const [t1] = correr();
    expect(t1.data.fecha_salida).toBeUndefined();
    expect(t1.data.fecha_regreso).toBeUndefined();
    expect(t1.data.presupuesto).toBeUndefined();
    expect(t1.descartados.map(d => d.slug)).toEqual(expect.arrayContaining(['fecha_salida', 'fecha_regreso', 'presupuesto', 'infantes']));
    expect(t1.mensaje).toBe([
      'Entendí: Punta Cana, 2 adultos, 2 ninos.', // el label sintético es el slug
      'Para empezar a cotizar me falta:',
      '1. ¿Desde qué ciudad salen?',
      '2. ¿Qué día salen?',
      '3. ¿Qué día regresan?',
    ].join('\n'));
  });

  it('tanda 2: adultos 2 → 3 se actualiza (era sugerido) e infantes queda en 0 por las edades', () => {
    const [, t2] = correr();
    expect(t2.data.adultos).toBe(3);
    expect(t2.data.infantes).toBe(0);
    expect(t2.data.numero_pasajeros).toBe(5);
    expect(t2.data.fecha_salida).toBe('2026-12-27');
    expect(t2.data.fecha_regreso).toBe('2027-01-02');
    const marcas = t2.data._sugeridos as Record<string, { anterior?: unknown; deduccion?: string }>;
    expect(marcas.adultos.anterior).toBe(2);
    expect(marcas.infantes.deduccion).toBe('Edades 9, 4: ninguno de los 2 niños es menor de 2 años');
    expect(t2.conflictos).toEqual([]);
    expect(t2.mensaje).toContain('Actualicé adultos: 2 → 3.');
    expect(t2.mensaje).toContain('infantes 0');
    expect(t2.mensaje.split('\n').slice(-2)).toEqual(['Para empezar a cotizar me falta:', '1. ¿De qué categoría prefieren el hotel?']);
  });

  it('tanda 3: las fechas nuevas reemplazan las sugeridas, «hablé con mi esposo» no toca adultos y el mínimo se cierra', () => {
    const [, , t3] = correr();
    expect(t3.data.fecha_salida).toBe('2026-12-28');
    expect(t3.data.fecha_regreso).toBe('2027-01-03');
    expect(t3.data.adultos).toBe(3);
    expect(t3.data.presupuesto).toBe('12m_20m');
    expect(t3.conflictos).toEqual([]);
    expect(t3.mensaje).toContain('Actualicé fecha_salida: 27 dic → 28 dic; fecha_regreso: 2 ene → 3 ene.');
    expect(t3.mensaje.endsWith(`Ya está el mínimo para cotizar: ${ENLACE}`)).toBe(true);
  });

  it('tanda 4: termina con el mínimo y el deseable completos, sin un solo conflicto', () => {
    const pasos = correr();
    const fin = pasos[3];
    expect(huecos(FIELDS, fin.data).minimo.faltan).toEqual([]);
    // El tipo de viaje («playa») el modelo lo DEDUCÍA de «Punta Cana»: ya no se carga (QA de #971 v2).
    expect(huecos(FIELDS, fin.data).deseable.faltan.map(f => f.slug)).toEqual(['tipo_viaje']);
    expect(pasos.flatMap(p => p.conflictos)).toEqual([]);
    expect(fin.data._conflictos).toBeUndefined();
    expect(fin.mensaje.endsWith(`Ya está el mínimo para cotizar: ${ENLACE}`)).toBe(true);
    expect(sinCampos(fin.data)).toMatchObject({
      destino: 'PUNTA CANA', ciudad_origen: 'BOGOTÁ', fecha_salida: '2026-12-28', fecha_regreso: '2027-01-03',
      adultos: 3, ninos: 2, infantes: 0, numero_pasajeros: 5, edades_menores: '9, 4',
      categoria_hotel: '4', plan_alimentacion: 'todo_incluido', presupuesto: '12m_20m', equipaje: 'bodega',
      permiso_salida_menores: 'con_ambos_padres',
    });
  });
});

describe('el mismo chat, con Tatiana confirmando en ONE después de la tanda 2', () => {
  // Lo que hizo en la simulación: confirma destino, ciudad, fechas, adultos, niños y edades.
  const confirmar: Accion = d => {
    const m = { ...(d._sugeridos as Record<string, unknown>) };
    for (const s of ['destino', 'ciudad_origen', 'fecha_salida', 'fecha_regreso', 'adultos', 'ninos', 'edades_menores']) delete m[s];
    return { ...d, _sugeridos: m };
  };

  it('las fechas confirmadas quedan en conflicto (eso sí lo decide una persona); adultos no se toca', () => {
    const [, , t3, t4] = correr({ 1: confirmar });
    expect(t3.conflictos.map(c => [c.slug, c.valor])).toEqual([['fecha_salida', '2026-12-28'], ['fecha_regreso', '2027-01-03']]);
    expect(t3.data.adultos).toBe(3);
    expect(t3.mensaje).toContain('No cambié 2 datos que ya tenían otro valor: fecha_salida (en ONE: 27 dic; el cliente dijo: 28 dic); fecha_regreso (en ONE: 2 ene; el cliente dijo: 3 ene).');
    expect((t3.data._conflictos as Record<string, { origen: string }>).fecha_salida.origen).toBe('audio');
    expect(t3.mensaje).toContain('Ya está el mínimo para cotizar');
    expect(huecos(FIELDS, t4.data).minimo.faltan).toEqual([]);
  });
});
