import { describe, expect, it } from 'vitest';
import {
  decisionDeFila,
  mapListItem,
  mapMetrics,
  type DualRowCruda,
} from './dual-mapeo';

// Fila tal como la devuelve `GET /api/v1/compliance/dual/list`: columnas de la
// tabla, no el vocabulario de la pantalla.
const FILA: DualRowCruda = {
  id: '11111111-1111-1111-1111-111111111111',
  fecha: '2026-08-30T14:22:00.000Z',
  workspace_origen: 'alma-afi',
  modo: 'documento',
  payload: { identificacion: '79123456', nombre: null, tipo: 'natural' },
  informa_match_count: 2,
  valida_match_count: 0,
  clasificacion: 'solo_informa',
  auditada: false,
  auditor_decision: 'pendiente',
  stub_mode: false,
};

describe('mapListItem', () => {
  it('traduce las columnas al vocabulario de la pantalla', () => {
    const item = mapListItem(FILA);
    expect(item.dual_id).toBe(FILA.id);
    expect(item.count_informa).toBe(2);
    expect(item.count_valida).toBe(0);
    expect(item.identificacion).toBe('79123456');
    expect(item.tipo).toBe('natural');
  });

  it('no deja ningun campo en undefined', () => {
    // La UI pintaba `undefined` en cada celda porque leia nombres que no existen.
    // Cualquier `undefined` que se cuele aqui vuelve a ese bug.
    const item = mapListItem(FILA) as Record<string, unknown>;
    for (const [k, v] of Object.entries(item)) {
      expect(v, `campo ${k}`).not.toBeUndefined();
    }
  });

  it('trata "pendiente" como ausencia de veredicto, no como veredicto', () => {
    expect(decisionDeFila('pendiente')).toBeNull();
    expect(decisionDeFila(null)).toBeNull();
    expect(decisionDeFila('valida_falso_negativo')).toBe('valida_falso_negativo');
    expect(mapListItem(FILA).decision).toBeNull();
  });

  it('sobrevive a un payload vacio o nulo', () => {
    const item = mapListItem({ ...FILA, payload: null, informa_match_count: null, valida_match_count: null });
    expect(item.identificacion).toBeNull();
    expect(item.nombre).toBeNull();
    expect(item.tipo).toBeNull();
    expect(item.count_informa).toBe(0);
    expect(item.count_valida).toBe(0);
  });

  it('marca el stub, que es lo que distingue evidencia de ficcion', () => {
    expect(mapListItem({ ...FILA, stub_mode: true }).stub_mode).toBe(true);
    // Una fila sin el campo no puede pasar por real por accidente al reves:
    // el default es `false`, que es lo que dice la columna en la base.
    expect(mapListItem({ ...FILA, stub_mode: null }).stub_mode).toBe(false);
  });
});

describe('mapMetrics', () => {
  it('desanida recall y precision, que vienen bajo "metricas"', () => {
    const m = mapMetrics({
      total_consultas: 13,
      metricas: { recall: 0.5, precision: 1, positivos_auditados: 4, cumple_umbral_vera: false },
    });
    expect(m.recall).toBe(0.5);
    expect(m.precision).toBe(1);
    expect(m.positivos_auditados).toBe(4);
  });

  it('con una respuesta vacia no rompe el tablero', () => {
    // El tablero moria en `metrics.total_consultas.toString()`. Ningun campo
    // numerico puede volver undefined, ni `por_lista` dejar de ser un arreglo.
    const m = mapMetrics({});
    expect(m.total_consultas).toBe(0);
    expect(m.pct_zero_zero).toBe(0);
    expect(m.pct_divergencia).toBe(0);
    expect(m.pendientes_auditoria).toBe(0);
    expect(m.positivos_auditados).toBe(0);
    expect(m.cumple_umbral_vera).toBe(false);
    expect(m.recall).toBeNull();
    expect(m.precision).toBeNull();
    expect(Array.isArray(m.por_lista)).toBe(true);
    expect(() => m.total_consultas.toString()).not.toThrow();
  });

  it('completa con cero los veredictos que nadie emitio', () => {
    const m = mapMetrics({ veredictos: { valida_correcto: 3 } });
    expect(m.veredictos.valida_correcto).toBe(3);
    expect(m.veredictos.valida_falso_negativo).toBe(0);
    expect(m.veredictos.inconcluso).toBe(0);
    // Seis categorias exactas: la tabla del tablero itera sobre ellas.
    expect(Object.keys(m.veredictos)).toHaveLength(6);
  });

  it('conserva cuantas consultas en stub quedaron fuera del calculo', () => {
    const m = mapMetrics({ total_consultas: 13, stub_excluidas: 21, incluye_stub: false });
    expect(m.total_consultas).toBe(13);
    expect(m.stub_excluidas).toBe(21);
    expect(m.incluye_stub).toBe(false);
  });
});
