import { describe, it, expect } from 'vitest';
import {
  CATALOGO_SUGERIDO,
  advertenciaEnlace,
  clasificarEnlace,
  estadoDocumento,
  extraerDriveFileId,
  fechaVencimiento,
  validarCodigo,
  validarPeriodicidad,
  validarUrlVersion,
  versionVigenteEn,
} from './documentos';

describe('clasificarEnlace', () => {
  it('reconoce un archivo de Drive', () => {
    expect(clasificarEnlace('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view')).toBe('archivo_drive');
    expect(clasificarEnlace('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp')).toBe('archivo_drive');
  });

  it('distingue la carpeta del archivo: una carpeta no es una version', () => {
    expect(clasificarEnlace('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp')).toBe('carpeta');
  });

  it('marca el documento nativo de Google como editable', () => {
    expect(clasificarEnlace('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit')).toBe('doc_editable');
    expect(clasificarEnlace('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit')).toBe('doc_editable');
  });

  it('acepta enlaces fuera de Drive y rechaza lo que no es https', () => {
    expect(clasificarEnlace('https://alma.sharepoint.com/manual.pdf')).toBe('externo');
    expect(clasificarEnlace('http://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view')).toBe('invalido');
    expect(clasificarEnlace('')).toBe('invalido');
    expect(clasificarEnlace(null)).toBe('invalido');
  });
});

describe('validarUrlVersion', () => {
  it('rechaza la carpeta, que es el caso que obliga al auditor a buscar adentro', () => {
    expect(validarUrlVersion('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp')).toBe('url_es_carpeta');
  });

  it('deja pasar el doc editable pero lo advierte', () => {
    const url = 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit';
    expect(validarUrlVersion(url)).toBeNull();
    expect(advertenciaEnlace(url)).toContain('congelado');
  });

  it('no advierte sobre un archivo congelado', () => {
    expect(advertenciaEnlace('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view')).toBeNull();
  });
});

describe('extraerDriveFileId', () => {
  it('saca el id de las tres formas de enlace', () => {
    expect(extraerDriveFileId('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view')).toBe('1AbCdEfGhIjKlMnOp');
    expect(extraerDriveFileId('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp');
    expect(extraerDriveFileId('https://alma.sharepoint.com/manual.pdf')).toBeNull();
  });
});

describe('versionVigenteEn', () => {
  // El limite superior es EXCLUYENTE: la version nueva arranca el mismo dia en
  // que cierra la anterior. Ningun dia tiene dos respuestas ni queda sin una.
  const versiones = [
    { version: '3.0', vigente_desde: '2026-06-01', vigente_hasta: null },
    { version: '2.0', vigente_desde: '2025-03-15', vigente_hasta: '2026-06-01' },
    { version: '1.0', vigente_desde: '2024-01-10', vigente_hasta: '2025-03-15' },
  ];

  it('responde la pregunta del auditor sobre una fecha pasada', () => {
    expect(versionVigenteEn(versiones, '2025-12-31')?.version).toBe('2.0');
  });

  it('el dia del corte pertenece a la version nueva, no a la que cierra', () => {
    expect(versionVigenteEn(versiones, '2026-06-01')?.version).toBe('3.0');
    expect(versionVigenteEn(versiones, '2026-05-31')?.version).toBe('2.0');
  });

  it('devuelve la abierta para hoy y nada para antes de la primera', () => {
    expect(versionVigenteEn(versiones, '2026-09-03')?.version).toBe('3.0');
    expect(versionVigenteEn(versiones, '2023-12-31')).toBeNull();
  });
});

describe('estadoDocumento', () => {
  const anual = { obligatorio: true, periodicidad_meses: 12 };
  const sinVencimiento = { obligatorio: true, periodicidad_meses: null };

  it('una pieza obligatoria sin version falta', () => {
    expect(estadoDocumento(anual, null, '2026-09-03')).toBe('faltante');
  });

  it('una pieza no obligatoria sin version no pinta rojo', () => {
    expect(estadoDocumento({ obligatorio: false, periodicidad_meses: null }, null, '2026-09-03')).toBeNull();
  });

  it('el enlace roto gana sobre el vencimiento: no es evidencia vieja, es evidencia ausente', () => {
    const v = { fecha_aprobacion: '2020-01-01', vigente_desde: '2020-01-01', url_estado: 'rota' };
    expect(estadoDocumento(anual, v, '2026-09-03')).toBe('link_roto');
    expect(estadoDocumento(anual, { ...v, url_estado: 'sin_permiso' }, '2026-09-03')).toBe('link_roto');
  });

  it('cuenta el vencimiento desde la aprobacion, no desde el inicio de vigencia', () => {
    // Aprobada en agosto de 2025, empezo a regir en enero de 2026. Con
    // periodicidad anual ya esta vencida, aunque lleve ocho meses rigiendo.
    const v = { fecha_aprobacion: '2025-08-01', vigente_desde: '2026-01-01', url_estado: 'ok' };
    expect(fechaVencimiento(anual, v)).toBe('2026-08-01');
    expect(estadoDocumento(anual, v, '2026-09-03')).toBe('vencido');
  });

  it('avisa antes de vencer', () => {
    const v = { fecha_aprobacion: '2025-09-20', vigente_desde: '2025-09-20', url_estado: 'ok' };
    expect(estadoDocumento(anual, v, '2026-09-03')).toBe('por_vencer');
    expect(estadoDocumento(anual, v, '2026-08-01')).toBe('vigente');
  });

  it('sin periodicidad no vence nunca', () => {
    const v = { fecha_aprobacion: '2019-01-01', vigente_desde: '2019-01-01', url_estado: 'ok' };
    expect(fechaVencimiento(sinVencimiento, v)).toBeNull();
    expect(estadoDocumento(sinVencimiento, v, '2026-09-03')).toBe('vigente');
  });

  it('sin fecha de aprobacion cuenta desde el inicio de vigencia', () => {
    const v = { fecha_aprobacion: null, vigente_desde: '2026-08-15', url_estado: 'ok' };
    expect(fechaVencimiento(anual, v)).toBe('2027-08-15');
  });
});

describe('validaciones de entrada', () => {
  it('el codigo es la cita que un auditor escribe a mano', () => {
    expect(validarCodigo('MAN-SARLAFT')).toBeNull();
    expect(validarCodigo('man sarlaft')).toBe('codigo_formato_invalido');
    expect(validarCodigo('-MAN')).toBe('codigo_formato_invalido');
    expect(validarCodigo('M')).toBe('codigo_largo_invalido');
  });

  it('la periodicidad vacia es valida y significa que no vence', () => {
    expect(validarPeriodicidad('')).toBeNull();
    expect(validarPeriodicidad(null)).toBeNull();
    expect(validarPeriodicidad('12')).toBeNull();
    expect(validarPeriodicidad('0')).toBe('periodicidad_minimo_1');
    expect(validarPeriodicidad('121')).toBe('periodicidad_maximo_120');
    expect(validarPeriodicidad('doce')).toBe('periodicidad_no_numerica');
  });
});

describe('CATALOGO_SUGERIDO', () => {
  it('no repite codigos: el codigo es la llave del expediente', () => {
    const codigos = CATALOGO_SUGERIDO.map((p) => p.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it('todos los codigos pasan la validacion que aplica la aplicacion', () => {
    for (const pieza of CATALOGO_SUGERIDO) {
      expect(validarCodigo(pieza.codigo)).toBeNull();
    }
  });
});
