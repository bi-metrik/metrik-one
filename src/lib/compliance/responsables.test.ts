/**
 * Responsable por control + aceptación (R2) — la regla pura.
 *
 * Lo que estas pruebas cuidan: que un control se dé por cubierto SOLO si la
 * aceptación más reciente de su cargo lo incluye con el mismo `updated_at`. Es
 * el indicador que más muerde en auditoría ("controles cuyo responsable o cuya
 * actividad cambió sin nueva aceptación") y el que más fácil se vuelve inerte:
 * si algo lo rompe, la pantalla no se ve rota, se ve tranquila.
 *
 * VISTOS FALLAR (2026-08-22) — cada mutación se aplicó al código y se contó qué
 * tumbó. Una mutación que no tumba nada señala un hueco de cobertura, no una
 * prueba de más:
 *
 *    1. ignorar `updated_at` (basta estar en la foto)           → 5 pruebas
 *    2. tomar la aceptación MÁS ANTIGUA del cargo               → 2 pruebas
 *    3. tratar `sin_cargo` como cubierto                        → 1 prueba
 *    4. `no_incluido` devuelto como cubierto                    → 1 prueba
 *    5. no filtrar por `cargo_id`                               → 1 prueba
 *    6. `updated_at` nulo del control tratado como coincidencia → 1 prueba
 *    7. `pct_nominados` en 0 en vez de `null` sin controles     → 1 prueba
 *   7b. `pct_aceptacion_vigente` en 0 en vez de `null`          → 1 prueba
 *    8. `operadorVeControl` mirando `cargo_responsable_id`      → 2 pruebas
 *    9. `operadorVeControl` sin el guard de `userId`            → 1 prueba
 *   10. desempate de `created_at` por orden del arreglo         → 1 prueba
 *   11. `firma_one` aceptada con el interruptor apagado         → 1 prueba
 *   12. soporte opcional en `documento_cargado`                 → 1 prueba
 *   13. fecha de firma futura permitida                         → 1 prueba
 *   14. `armarSnapshot` descartando `updated_at`                → 1 prueba
 *
 * Reproducible: `node scripts/mutar-responsables.mjs` (15/15 detectadas).
 */

import { describe, it, expect } from 'vitest';
import {
  armarSnapshot,
  claveCargo,
  estadoAceptacionControl,
  indexarEstadosAceptacion,
  indicadoresResponsables,
  mediosDisponibles,
  operadorVeControl,
  validarAceptacion,
  validarCargo,
  FIRMA_ONE_HABILITADA,
  type ComplianceAceptacion,
  type ControlParaCobertura,
} from './responsables';

const HOY = '2026-08-22';
const T1 = '2026-08-01T10:00:00.000Z';
const T2 = '2026-08-10T10:00:00.000Z';
const T3 = '2026-08-20T10:00:00.000Z';

function control(p: Partial<ControlParaCobertura> = {}): ControlParaCobertura {
  return { id: 'ctl-1', cargo_responsable_id: 'cargo-tesorero', updated_at: T1, ...p };
}

function aceptacion(p: Partial<ComplianceAceptacion> = {}): ComplianceAceptacion {
  return {
    id: 'ac-1',
    cargo_id: 'cargo-tesorero',
    persona_nombre: 'Ana Ruiz',
    persona_documento: 'CC 1020304050',
    aceptada_por: null,
    registrada_por: 'user-oficial',
    medio: 'documento_cargado',
    soporte_path: 'ws/aceptaciones/ac-1.pdf',
    fecha_aceptacion: '2026-08-02',
    controles_snapshot: [{ id: 'ctl-1', referencia: 'CTL-001', nombre: 'Debida diligencia', updated_at: T1 }],
    created_at: T2,
    ...p,
  };
}

// ─── La regla de cobertura ─────────────────────────────────────────────────

describe('estadoAceptacionControl', () => {
  it('un control sin cargo nominado no está cubierto: no hay a quién pedirle que acepte', () => {
    const r = estadoAceptacionControl(control({ cargo_responsable_id: null }), [aceptacion()]);
    expect(r.cubierto).toBe(false);
    expect(r.motivo).toBe('sin_cargo');
    expect(r.aceptacion).toBeNull();
  });

  it('un cargo que nunca aceptó deja su control sin aceptación', () => {
    const r = estadoAceptacionControl(control(), []);
    expect(r.cubierto).toBe(false);
    expect(r.motivo).toBe('sin_aceptacion');
  });

  it('cubierto cuando la aceptación lo incluye con el MISMO updated_at', () => {
    const r = estadoAceptacionControl(control({ updated_at: T1 }), [aceptacion()]);
    expect(r.cubierto).toBe(true);
    expect(r.motivo).toBe('vigente');
    expect(r.updated_at_aceptado).toBe(T1);
  });

  it('⚠️ el control cambió DESPUÉS de la aceptación: queda desactualizada', () => {
    // Es el corazón del frente. La persona aceptó el control tal como estaba en
    // T1; hoy dice otra cosa (le cambiaron el cargo, la actividad o la
    // periodicidad) y nadie volvió a firmar.
    const r = estadoAceptacionControl(control({ updated_at: T3 }), [aceptacion()]);
    expect(r.cubierto).toBe(false);
    expect(r.motivo).toBe('desactualizada');
    // Se conserva lo que se aceptó, para poder decir contra qué se compara.
    expect(r.updated_at_aceptado).toBe(T1);
  });

  it('el control se asignó al cargo DESPUÉS de la carta: no estaba en la foto', () => {
    const r = estadoAceptacionControl(control({ id: 'ctl-9' }), [aceptacion()]);
    expect(r.cubierto).toBe(false);
    expect(r.motivo).toBe('no_incluido');
    expect(r.updated_at_aceptado).toBeNull();
  });

  it('manda la aceptación MÁS RECIENTE del cargo, no la primera', () => {
    // La vieja cubría el control; la nueva ya no lo incluye. Firmar una carta
    // nueva REEMPLAZA la anterior, no la complementa.
    const vieja = aceptacion({ id: 'ac-vieja', created_at: T1 });
    const nueva = aceptacion({ id: 'ac-nueva', created_at: T3, controles_snapshot: [] });
    const r = estadoAceptacionControl(control(), [vieja, nueva]);
    expect(r.motivo).toBe('no_incluido');
    expect(r.aceptacion?.id).toBe('ac-nueva');
  });

  it('el orden en que llegan las aceptaciones no cambia la respuesta', () => {
    const vieja = aceptacion({ id: 'ac-vieja', created_at: T1 });
    const nueva = aceptacion({ id: 'ac-nueva', created_at: T3, controles_snapshot: [] });
    expect(estadoAceptacionControl(control(), [vieja, nueva]).aceptacion?.id).toBe('ac-nueva');
    expect(estadoAceptacionControl(control(), [nueva, vieja]).aceptacion?.id).toBe('ac-nueva');
  });

  it('con created_at idéntico desempata el id, no el orden del arreglo', () => {
    const a = aceptacion({ id: 'ac-a', created_at: T2 });
    const b = aceptacion({ id: 'ac-b', created_at: T2, controles_snapshot: [] });
    expect(estadoAceptacionControl(control(), [a, b]).aceptacion?.id).toBe('ac-b');
    expect(estadoAceptacionControl(control(), [b, a]).aceptacion?.id).toBe('ac-b');
  });

  it('una aceptación de OTRO cargo no cubre a este control', () => {
    const ajena = aceptacion({ id: 'ac-ajena', cargo_id: 'cargo-hseq' });
    const r = estadoAceptacionControl(control({ cargo_responsable_id: 'cargo-tesorero' }), [ajena]);
    expect(r.cubierto).toBe(false);
    expect(r.motivo).toBe('sin_aceptacion');
  });

  it('un control sin updated_at NO se da por cubierto aunque esté en la foto', () => {
    // No se puede afirmar que no cambió si no se sabe cuándo cambió.
    const r = estadoAceptacionControl(control({ updated_at: null }), [aceptacion()]);
    expect(r.cubierto).toBe(false);
    expect(r.motivo).toBe('desactualizada');
  });

  it('una foto vacía o ausente no cubre nada', () => {
    const sinFoto = aceptacion({ controles_snapshot: undefined as unknown as [] });
    expect(estadoAceptacionControl(control(), [sinFoto]).motivo).toBe('no_incluido');
  });
});

// ─── Indexación de muchos controles ────────────────────────────────────────

describe('indexarEstadosAceptacion', () => {
  it('cada control resuelve contra las aceptaciones de SU cargo', () => {
    const controles: ControlParaCobertura[] = [
      { id: 'ctl-1', cargo_responsable_id: 'cargo-tesorero', updated_at: T1 },
      { id: 'ctl-2', cargo_responsable_id: 'cargo-hseq', updated_at: T1 },
      { id: 'ctl-3', cargo_responsable_id: null, updated_at: T1 },
    ];
    const aceptaciones = [
      aceptacion({ id: 'ac-tes', cargo_id: 'cargo-tesorero' }),
      aceptacion({
        id: 'ac-hseq',
        cargo_id: 'cargo-hseq',
        controles_snapshot: [{ id: 'ctl-2', referencia: 'CTL-002', nombre: 'x', updated_at: T3 }],
      }),
    ];

    const m = indexarEstadosAceptacion(controles, aceptaciones);
    expect(m.get('ctl-1')?.motivo).toBe('vigente');
    // ctl-2 está en la foto de su cargo pero con otro updated_at.
    expect(m.get('ctl-2')?.motivo).toBe('desactualizada');
    expect(m.get('ctl-3')?.motivo).toBe('sin_cargo');
    expect(m.size).toBe(3);
  });

  it('sin aceptaciones, todos los controles con cargo quedan sin aceptación', () => {
    const m = indexarEstadosAceptacion([control(), control({ id: 'ctl-2' })], []);
    expect([...m.values()].every((e) => e.motivo === 'sin_aceptacion')).toBe(true);
  });
});

// ─── Indicadores ───────────────────────────────────────────────────────────

describe('indicadoresResponsables', () => {
  it('cuenta nominados, vigentes y desactualizados por separado', () => {
    const controles: ControlParaCobertura[] = [
      { id: 'a', cargo_responsable_id: 'c1', updated_at: T1 }, // vigente
      { id: 'b', cargo_responsable_id: 'c1', updated_at: T3 }, // desactualizada
      { id: 'c', cargo_responsable_id: 'c2', updated_at: T1 }, // sin aceptación
      { id: 'd', cargo_responsable_id: null, updated_at: T1 }, // sin cargo
    ];
    const ac = aceptacion({
      cargo_id: 'c1',
      controles_snapshot: [
        { id: 'a', referencia: 'A', nombre: 'a', updated_at: T1 },
        { id: 'b', referencia: 'B', nombre: 'b', updated_at: T1 },
      ],
    });

    const ind = indicadoresResponsables(indexarEstadosAceptacion(controles, [ac]));
    expect(ind.total).toBe(4);
    expect(ind.con_cargo).toBe(3);
    expect(ind.pct_nominados).toBe(75);
    expect(ind.vigentes).toBe(1);
    expect(ind.pct_aceptacion_vigente).toBe(25);
    expect(ind.desactualizados).toBe(1);
    expect(ind.sin_aceptacion).toBe(1);
    expect(ind.sin_cargo).toBe(1);
  });

  it('sin controles los porcentajes son null, NUNCA 0 ni 100', () => {
    // Un workspace sin matriz cargada no está "0% nominado" ni "100% al día":
    // no hay nada que medir, y las dos cifras mienten en direcciones opuestas.
    const ind = indicadoresResponsables(new Map());
    expect(ind.total).toBe(0);
    expect(ind.pct_nominados).toBeNull();
    expect(ind.pct_aceptacion_vigente).toBeNull();
  });

  it('el estado de arranque de ALMA: 18 controles, ninguno nominado', () => {
    const controles = Array.from({ length: 18 }, (_, i) => ({
      id: `ctl-${i}`,
      cargo_responsable_id: null,
      updated_at: T1,
    }));
    const ind = indicadoresResponsables(indexarEstadosAceptacion(controles, []));
    expect(ind.pct_nominados).toBe(0);
    expect(ind.pct_aceptacion_vigente).toBe(0);
    expect(ind.sin_cargo).toBe(18);
  });
});

// ─── Visibilidad del operador (la regresión que había que evitar) ──────────

describe('operadorVeControl', () => {
  it('el operador ve el control donde es el usuario responsable', () => {
    expect(operadorVeControl({ responsable_id: 'user-1' }, 'user-1')).toBe(true);
  });

  it('no ve el control de otro', () => {
    expect(operadorVeControl({ responsable_id: 'user-2' }, 'user-1')).toBe(false);
  });

  it('⚠️ nominar el cargo NO le da acceso: nominar no es ejecutar', () => {
    // Si el acceso colgara del cargo, este control sería visible para cualquiera
    // que ocupara el cargo — y eso exigiría darle cuenta a cada responsable, que
    // es justo lo que el dictamen descarta.
    const ctl = { responsable_id: null, cargo_responsable_id: 'cargo-tesorero' };
    expect(operadorVeControl(ctl, 'user-1')).toBe(false);
  });

  it('un control sin responsable no lo ve nadie por omisión', () => {
    expect(operadorVeControl({ responsable_id: null }, 'user-1')).toBe(false);
  });

  it('sin usuario no ve nada, aunque el control tampoco tenga responsable', () => {
    // `null === null` sería true: sin este guard, una sesión sin usuario vería
    // todos los controles huérfanos.
    expect(operadorVeControl({ responsable_id: null }, null)).toBe(false);
    expect(operadorVeControl({ responsable_id: null }, undefined)).toBe(false);
  });
});

// ─── Cargos ────────────────────────────────────────────────────────────────

describe('claveCargo', () => {
  it('el mismo cargo escrito distinto resuelve a la misma clave', () => {
    expect(claveCargo('Coordinador COMPLIANCE')).toBe(claveCargo('Coordinador Compliance'));
    expect(claveCargo('  Coordinador   compliance ')).toBe(claveCargo('Coordinador Compliance'));
    expect(claveCargo('Coordinador jurídico predial')).toBe(claveCargo('Coordinador Juridico Predial'));
  });

  it('cargos distintos no colisionan', () => {
    expect(claveCargo('Tesorero')).not.toBe(claveCargo('Jefe HSEQ'));
  });

  it('vacío y nulo dan cadena vacía', () => {
    expect(claveCargo(null)).toBe('');
    expect(claveCargo('   ')).toBe('');
  });
});

describe('validarCargo', () => {
  it('exige nombre', () => {
    expect(validarCargo('  ')).toBe('nombre_requerido');
    expect(validarCargo('Tesorero')).toBeNull();
  });

  it('acota la longitud', () => {
    expect(validarCargo('x'.repeat(121))).toMatch(/muy_largo/);
  });
});

// ─── Medio de aceptación ───────────────────────────────────────────────────

describe('firma en ONE apagada', () => {
  it('la costura existe pero el interruptor está en false', () => {
    expect(FIRMA_ONE_HABILITADA).toBe(false);
  });

  it('la pantalla solo puede ofrecer el documento cargado', () => {
    expect(mediosDisponibles()).toEqual(['documento_cargado']);
  });

  it('⚠️ la validación rechaza firma_one aunque llegue por fuera del formulario', () => {
    // Una server action exportada es un endpoint alcanzable aunque ninguna
    // pantalla la invoque: esconder la opción en la UI no es apagarla.
    const err = validarAceptacion(
      { cargo_id: 'c1', persona_nombre: 'Ana', persona_documento: 'CC 1', medio: 'firma_one' },
      HOY,
    );
    expect(err).toMatch(/firma_one_no_habilitada/);
  });
});

// ─── Validación del formulario ─────────────────────────────────────────────

describe('validarAceptacion', () => {
  const base = {
    cargo_id: 'c1',
    persona_nombre: 'Ana Ruiz',
    persona_documento: 'CC 1020304050',
    medio: 'documento_cargado' as const,
    soporte_path: 'ws/ac.pdf',
  };

  it('acepta el caso normal', () => {
    expect(validarAceptacion(base, HOY)).toBeNull();
  });

  it('exige cargo', () => {
    expect(validarAceptacion({ ...base, cargo_id: ' ' }, HOY)).toBe('cargo_requerido');
  });

  it('exige nombre y documento de la persona', () => {
    expect(validarAceptacion({ ...base, persona_nombre: ' ' }, HOY)).toBe('persona_nombre_requerido');
    expect(validarAceptacion({ ...base, persona_documento: '' }, HOY)).toMatch(/documento_requerido/);
  });

  it('⚠️ documento_cargado sin soporte no es documento cargado', () => {
    expect(validarAceptacion({ ...base, soporte_path: null }, HOY)).toMatch(/soporte_requerido/);
  });

  it('la fecha puede ser pasada: la firma es un hecho que ya ocurrió', () => {
    // Contrasta con la vigencia de una liberación, que se fuerza a hoy.
    expect(validarAceptacion({ ...base, fecha_aceptacion: '2026-08-15' }, HOY)).toBeNull();
  });

  it('la fecha no puede ser futura', () => {
    expect(validarAceptacion({ ...base, fecha_aceptacion: '2026-08-23' }, HOY)).toMatch(/futuro/);
  });

  it('rechaza fecha con formato inválido', () => {
    expect(validarAceptacion({ ...base, fecha_aceptacion: '22/08/2026' }, HOY)).toMatch(/formato/);
  });
});

// ─── Snapshot ──────────────────────────────────────────────────────────────

describe('armarSnapshot', () => {
  it('conserva el updated_at de cada control, que es lo que la regla compara', () => {
    const foto = armarSnapshot([
      { id: 'a', referencia: 'CTL-001', nombre_control: 'Debida diligencia', updated_at: T1 },
    ]);
    expect(foto).toEqual([{ id: 'a', referencia: 'CTL-001', nombre: 'Debida diligencia', updated_at: T1 }]);
  });

  it('un updated_at nulo deja el control fuera de toda coincidencia futura', () => {
    const foto = armarSnapshot([{ id: 'a', referencia: null, nombre_control: null, updated_at: null }]);
    expect(foto[0].updated_at).toBe('');
    // Y por lo tanto no cubre.
    const r = estadoAceptacionControl(
      { id: 'a', cargo_responsable_id: 'c1', updated_at: T1 },
      [aceptacion({ cargo_id: 'c1', controles_snapshot: foto })],
    );
    expect(r.cubierto).toBe(false);
  });
});
