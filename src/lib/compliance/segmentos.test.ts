/**
 * Helpers puros del catálogo de segmentos.
 *
 * `claveSegmento` es lo que decide si la celda "empleado" del Excel resuelve
 * contra el segmento "Empleado" del catálogo. Si esa normalización cambia sin
 * querer, filas enteras de un cargue pasan a marcarse como error — o peor, dos
 * segmentos distintos empiezan a colisionar.
 */

import { describe, it, expect } from 'vitest';
import { claveSegmento, etiquetaSegmento, puedeConfigurarSegmentos } from './segmentos';

describe('claveSegmento', () => {
  it('ignora mayúsculas, tildes y espacios de sobra', () => {
    const esperado = claveSegmento('Contraparte');
    expect(claveSegmento('contraparte')).toBe(esperado);
    expect(claveSegmento('  CONTRAPARTE  ')).toBe(esperado);
    expect(claveSegmento('Cóntrapárte')).toBe(esperado);
    expect(claveSegmento('Contra  parte')).not.toBe(esperado);
  });

  it('colapsa espacios internos repetidos', () => {
    expect(claveSegmento('Persona   Expuesta')).toBe(claveSegmento('Persona Expuesta'));
  });

  it('no confunde dos segmentos distintos', () => {
    expect(claveSegmento('Empleado')).not.toBe(claveSegmento('Empleados'));
    expect(claveSegmento('Proveedor')).not.toBe(claveSegmento('Contraparte'));
  });
});

describe('etiquetaSegmento', () => {
  it('sin segmento_id es una consulta anterior al catálogo, no un error', () => {
    expect(etiquetaSegmento(null, null)).toEqual({ texto: 'Sin segmento', huerfano: false });
  });

  it('segmento_id que no resuelve se marca como huérfano y NO se confunde con "sin segmento"', () => {
    const r = etiquetaSegmento('seg-borrado', null);
    expect(r.huerfano).toBe(true);
    expect(r.texto).not.toBe('Sin segmento');
  });

  it('segmento vigente muestra su nombre', () => {
    expect(etiquetaSegmento('seg-1', 'Empleado')).toEqual({ texto: 'Empleado', huerfano: false });
  });
});

describe('puedeConfigurarSegmentos', () => {
  it('solo el oficial de cumplimiento configura el catálogo', () => {
    expect(puedeConfigurarSegmentos('owner')).toBe(true);
    expect(puedeConfigurarSegmentos('admin')).toBe(true);
  });

  it('los operadores eligen segmento al consultar, pero no tocan el catálogo', () => {
    expect(puedeConfigurarSegmentos('operator')).toBe(false);
    expect(puedeConfigurarSegmentos('supervisor')).toBe(false);
    expect(puedeConfigurarSegmentos('read_only')).toBe(false);
    expect(puedeConfigurarSegmentos(null)).toBe(false);
    expect(puedeConfigurarSegmentos(undefined)).toBe(false);
  });
});
