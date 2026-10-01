/**
 * Dos pedidos de Mauricio sobre #971 (2026-10-01):
 *   · C9: «bebé» con una edad de 2 o más es una contradicción entre la palabra y la edad: no llena
 *     infantes con esa persona y se pregunta en el acto. No es clasificar por edad.
 *   · El avance de la solicitud en % tras cada carga, con la misma función que las barras de la
 *     pantalla (`calcularNiveles`).
 * La config es la sintética del bloque con los SQL provisionales aplicados en PGlite.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import sintetica from '../../../src/lib/negocios/__fixtures__/solicitud-viaje-sintetica.json';
import { calcularNiveles as calcularNivelesPantalla } from '../../../src/lib/negocios/niveles-solicitud';
import { mensajeAlComercial, type CampoEntendible } from './wa-entendimiento-reglas.ts';
import { bebesConEdad, guardianPasajeros } from './wa-guardianes.ts';
import { lineaAvance, mensajeCargaExistente } from './wa-carga-reglas.ts';

const RAIZ = path.resolve(__dirname, '../../..');
const SQLS = [
  'sql/trappvel/2026-09-28_solicitud-minimo-deseable-PROVISIONAL.sql',
  'sql/trappvel/2026-10-01_opciones-no-definido-PROVISIONAL.sql',
].map(f => readFileSync(path.join(RAIZ, f), 'utf8'));
const ID = '98281a40-2f67-4d8e-9bc5-6ca1f7a69417';

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

const s = (sug: Record<string, { valor: number | string; frase: string }>) =>
  ({ historia: '', cliente: { nombre: null, telefono: null }, sugeridos: sug, descartados: [] as Array<{ slug: string; motivo: string; pregunta?: string }> });

describe('C9 · «bebé» con una edad de 2 o más', () => {
  it('«mi bebé de 18»: no llena infantes, pregunta en el acto y deja la edad anotada', () => {
    const r = guardianPasajeros(s({ adultos: { valor: 2, frase: 'Viajo con mi esposo' }, infantes: { valor: 1, frase: 'mi bebé' }, edades_menores: { valor: '18', frase: 'mi bebé de 18' } }),
      'Viajo con mi esposo y mi bebé de 18');
    expect(r.sugeridos.infantes).toBeUndefined();
    expect([r.sugeridos.adultos?.valor, r.sugeridos.edades_menores?.valor]).toEqual([2, '18']);
    expect(r.descartados.find(d => d.slug === 'infantes')?.pregunta).toBe('Dijeron «bebé de 18»: ¿viaja como bebé en brazos o con su propio cupo?');
  });

  it('«la bebé de 3»: se pregunta aunque el modelo la haya contado como niña (no se mueve de categoría)', () => {
    const r = guardianPasajeros(s({ ninos: { valor: 1, frase: 'la bebé' }, edades_menores: { valor: '3', frase: 'la bebé de 3' } }), 'vamos 2 adultos y la bebé de 3');
    expect(r.sugeridos.ninos?.valor).toBe(1);
    expect(r.descartados.find(d => d.slug === 'infantes')?.pregunta).toContain('«bebé de 3»');
  });

  it('«el bebé de 1 año» sí llena infantes y no pregunta; «8 meses» tampoco contradice', () => {
    const r = guardianPasajeros(s({ infantes: { valor: 1, frase: 'el bebé de 1 año' }, edades_menores: { valor: '1', frase: 'el bebé de 1 año' } }), 'vamos con el bebé de 1 año');
    expect([r.sugeridos.infantes?.valor, r.descartados]).toEqual([1, []]);
    expect(bebesConEdad('el bebé de 8 meses')).toEqual([]);
    expect(bebesConEdad('mi bebé, que ya tiene 18 añitos').map(x => x.edad)).toEqual([18]);
  });

  it('la pregunta sale primero en el mensaje al comercial, aunque el mínimo esté completo', () => {
    const q = 'Dijeron «bebé de 18»: ¿viaja como bebé en brazos o con su propio cupo?';
    const conFaltas = mensajeAlComercial({ resumen: 'Medellín', faltanMinimo: [{ slug: 'fecha_salida', pregunta: '¿Qué día salen?', label: 'Salida' }], enlace: 'https://x/n', preguntasAntes: [q] });
    expect(conFaltas.split('\n').slice(1, 4)).toEqual(['Para empezar a cotizar me falta:', `1. ${q}`, '2. ¿Qué día salen?']);
    const completo = mensajeCargaExistente({ codigo: 'T1 26 9', fields: [], escritos: [], conflictos: [], faltanMinimo: [], enlace: 'https://x/n', preguntasAntes: [q] });
    expect(completo).toContain(`Antes de cotizar:\n1. ${q}\nYa está el mínimo para cotizar: https://x/n`);
  });
});

describe('Avance en % tras cada carga', () => {
  const valores = { destino: 'CARTAGENA', adultos: 2, ninos: 0, infantes: 0, fecha_salida: '2026-12-20', presupuesto: 'sin_definir' };

  it('la línea: «código · cliente — Mínimo a/b (x %) · Completo c/d (y %)»', () => {
    expect(lineaAvance({ codigo: 'T1 26 11', cliente: 'Carolina', fields: FIELDS, valores }))
      .toMatch(/^T1 26 11 · Carolina — Mínimo \d+\/\d+ \(\d+ %\) · Completo \d+\/\d+ \(\d+ %\)$/);
  });

  it('las cuentas son las de la pantalla (calcularNiveles de src/): el bot y la barra nunca dicen números distintos', () => {
    const casos: Array<Record<string, unknown>> = [valores, {}, { ...valores, ninos: 2, edades_menores: '5, 7' },
      { ...valores, fecha_regreso: '2026-12-28', ciudad_origen: 'MEDELLÍN', categoria_hotel: '4' }];
    for (const v of casos) {
      const pantalla = calcularNivelesPantalla(FIELDS as never, v);
      const m = /Mínimo (\d+)\/(\d+) .* Completo (\d+)\/(\d+)/.exec(lineaAvance({ codigo: 'X', cliente: null, fields: FIELDS, valores: v }))!;
      expect([Number(m[1]), Number(m[2])]).toEqual([pantalla.minimo.completos, pantalla.minimo.total]);
      expect([Number(m[3]), Number(m[4])]).toEqual([pantalla.minimo.completos + pantalla.deseable.completos, pantalla.minimo.total + pantalla.deseable.total]);
    }
  });

  it('completo no cuenta los campos de la agencia ni los condicionales que no aplican', () => {
    const total = (fields: CampoEntendible[], v: Record<string, unknown>) => Number(/Completo \d+\/(\d+)/.exec(lineaAvance({ codigo: null, cliente: null, fields, valores: v }))![1]);
    const base = total(FIELDS, valores);
    const deseable = FIELDS.find(f => (f as { nivel?: string }).nivel === 'deseable')!;
    expect(total(FIELDS.map(f => (f === deseable ? { ...f, lo_llena: 'agencia' } : f)), valores)).toBe(base - 1);
    // edades_menores solo cuenta cuando hay menores.
    expect(total(FIELDS, { ...valores, ninos: 1 })).toBe(base + 1);
  });

  it('va en el mensaje de la carga, y con el mínimo completo se mantiene «Ya está el mínimo» con el enlace', () => {
    const linea = 'T1 26 9 · Luisa — Mínimo 9/9 (100 %) · Completo 12/20 (60 %)';
    const msg = mensajeCargaExistente({ codigo: 'T1 26 9', fields: [], escritos: [], conflictos: [], faltanMinimo: [], enlace: 'https://x/n', avance: linea });
    expect(msg.split('\n')).toEqual(['No encontré datos nuevos para T1 26 9.', linea, 'Ya está el mínimo para cotizar: https://x/n']);
    const nuevo = mensajeAlComercial({ resumen: 'Cartagena', faltanMinimo: [], enlace: 'https://x/n', avance: linea });
    expect(nuevo.split('\n')).toEqual(['Entendí: Cartagena.', linea, 'Ya está el mínimo para cotizar: https://x/n']);
  });
});
