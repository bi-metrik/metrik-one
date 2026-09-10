/**
 * Cargue masivo de sujetos.
 *
 * Es la vía por la que entra y sale gente de la base de un golpe, y desde R3.1
 * salir de la base es salir del motor de monitoreo. Un cierre de más apaga la
 * vigilancia de alguien que sigue adentro; un cierre de menos le sigue cobrando
 * al cliente consultas de gente que ya se fue. Por eso la regla se prueba sola,
 * sin base de datos.
 *
 * VERIFICADO POR MUTACIÓN (2026-09-10) — cada mutación tumbó pruebas:
 *   - dejar que el cargue reabra a quien ya estaba cerrado → caen 2
 *   - el documento repetido dentro del archivo gana el último en vez de rechazarse → cae 1
 *   - aceptar un cierre sin motivo → cae 1
 *   - adivinar la fecha en vez de exigir AAAA-MM-DD → cae 1
 *   - cruzar contra la base por documento crudo y no por `claveContraparte` → cae 1
 *   - contar como alta normal a la que ya viene cerrada → cae 1
 *   - dejar que un correo en blanco pise el que ya estaba guardado → cae 1
 *   - aceptar un correo mal escrito en vez de rechazar la fila → cae 1
 */

import { describe, it, expect } from 'vitest';
import {
  explicarInvalida,
  parsearFechaCargue,
  parsearFilasCargue,
  planTieneEfecto,
  planearCargue,
  type SujetoExistente,
} from './cargue-sujetos';

function fila(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tipo: 'proveedor',
    documento_tipo: 'NIT',
    documento: '900123456',
    nombre: 'Ferretería del Norte SAS',
    correo: '',
    relacion_desde: '',
    relacion_hasta: '',
    motivo: '',
    ...over,
  };
}

function existente(over: Partial<SujetoExistente> = {}): SujetoExistente {
  return {
    id: 'suj-1',
    tipo: 'proveedor',
    documento_tipo: 'NIT',
    documento_numero: '900123456',
    nombre: 'Ferretería del Norte SAS',
    correo: null,
    relacion_hasta: null,
    ...over,
  };
}

/** Atajo: parsea y planea de una, como lo hace la server action. */
function planDe(rows: Record<string, unknown>[], existentes: SujetoExistente[] = []) {
  const { validas, invalidas } = parsearFilasCargue(rows);
  return planearCargue(validas, existentes, invalidas);
}

describe('parsearFechaCargue', () => {
  it('acepta AAAA-MM-DD', () => {
    expect(parsearFechaCargue('2026-09-10')).toBe('2026-09-10');
  });

  it('rechaza el formato colombiano en vez de adivinar el mes', () => {
    expect(parsearFechaCargue('03/04/2026')).toBeNull();
  });

  it('rechaza un día que no existe', () => {
    expect(parsearFechaCargue('2026-02-30')).toBeNull();
  });

  it('rechaza vacío', () => {
    expect(parsearFechaCargue('')).toBeNull();
  });
});

describe('parsearFilasCargue', () => {
  it('normaliza el documento para que cruce con el resto del módulo', () => {
    const { validas } = parsearFilasCargue([fila({ documento: '900.123.456-7' })]);
    expect(validas[0].documento_numero).toBe('9001234567');
    expect(validas[0].clave).toBe('NIT:9001234567');
  });

  it('numera la fila como se ve en la hoja, contando el encabezado', () => {
    const { validas } = parsearFilasCargue([fila(), fila({ documento: '800111222' })]);
    expect(validas.map((v) => v.fila)).toEqual([2, 3]);
  });

  it('una fila en blanco de Excel se salta sin reportarse como error', () => {
    const vacia = { tipo: '', documento_tipo: '', documento: '', nombre: '', correo: '', relacion_desde: '', relacion_hasta: '', motivo: '' };
    const { validas, invalidas } = parsearFilasCargue([fila(), vacia]);
    expect(validas).toHaveLength(1);
    expect(invalidas).toHaveLength(0);
  });

  it('un cierre sin motivo se rechaza, no se aplica callado', () => {
    const { validas, invalidas } = parsearFilasCargue([
      fila({ relacion_hasta: '2026-08-31', motivo: '' }),
    ]);
    expect(validas).toHaveLength(0);
    expect(invalidas[0].motivo).toBe('cierre_sin_motivo');
  });

  it('el mismo documento dos veces rechaza la segunda y dice de qué fila venía', () => {
    const { validas, invalidas } = parsearFilasCargue([
      fila(),
      fila({ documento: '900-123-456', relacion_hasta: '2026-08-31', motivo: 'terminó contrato' }),
    ]);
    expect(validas).toHaveLength(1);
    expect(invalidas[0].motivo).toBe('documento_repetido_fila_2');
  });

  it('la fila rechazada trae un eco para poder encontrarla en el archivo', () => {
    const { invalidas } = parsearFilasCargue([fila({ tipo: 'socio comercial' })]);
    expect(invalidas[0].eco).toContain('Ferretería del Norte SAS');
  });

  it('un tipo que no existe no entra como "otro"', () => {
    const { invalidas } = parsearFilasCargue([fila({ tipo: 'aliado' })]);
    expect(invalidas[0].motivo).toBe('tipo_no_valido');
  });

  it('salida anterior a la entrada se rechaza', () => {
    const { invalidas } = parsearFilasCargue([
      fila({ relacion_desde: '2026-05-01', relacion_hasta: '2026-01-01', motivo: 'x' }),
    ]);
    expect(invalidas[0].motivo).toBe('cierre_antes_del_inicio');
  });
});

describe('planearCargue', () => {
  it('quien no está en la base es un alta', () => {
    const plan = planDe([fila()]);
    expect(plan.items[0].accion).toBe('alta');
    expect(plan.resumen.alta).toBe(1);
  });

  it('quien ya está y llega con fecha de salida es un cierre', () => {
    const plan = planDe(
      [fila({ relacion_hasta: '2026-08-31', motivo: 'terminó contrato' })],
      [existente()],
    );
    expect(plan.items[0].accion).toBe('cierre');
    expect(plan.items[0].sujeto_id).toBe('suj-1');
  });

  it('EL CARGUE NO REABRE: volver a subir el archivo viejo no resucita a un cerrado', () => {
    const plan = planDe([fila()], [existente({ relacion_hasta: '2026-07-31' })]);
    expect(plan.items[0].accion).toBe('sin_cambio');
    expect(plan.items[0].detalle).toContain('no reabre');
  });

  it('un cerrado que vuelve a llegar con fecha de salida tampoco se re-cierra', () => {
    const plan = planDe(
      [fila({ relacion_hasta: '2026-08-31', motivo: 'terminó contrato' })],
      [existente({ relacion_hasta: '2026-07-31' })],
    );
    expect(plan.items[0].accion).toBe('sin_cambio');
  });

  it('el que ya está igual no genera escritura', () => {
    const plan = planDe([fila()], [existente()]);
    expect(plan.items[0].accion).toBe('sin_cambio');
    expect(planTieneEfecto(plan)).toBe(false);
  });

  it('un cambio de nombre o de tipo se muestra con el antes y el después', () => {
    const plan = planDe(
      [fila({ tipo: 'contratista', nombre: 'Ferretería del Norte S.A.S.' })],
      [existente()],
    );
    expect(plan.items[0].accion).toBe('actualizacion');
    expect(plan.items[0].detalle).toContain('proveedor → contratista');
    expect(plan.items[0].detalle).toContain('Ferretería del Norte S.A.S.');
  });

  it('el cruce contra la base usa la clave normalizada, no la escritura', () => {
    const plan = planDe(
      [fila({ documento: '900123456' })],
      [existente({ documento_numero: '900.123.456', documento_tipo: ' nit ' })],
    );
    expect(plan.items[0].accion).toBe('sin_cambio');
  });

  it('alta que ya viene cerrada se marca aparte, no se disfraza de alta', () => {
    const plan = planDe([fila({ relacion_hasta: '2026-08-31', motivo: 'ya no se le compra' })]);
    expect(plan.items[0].accion).toBe('alta_cerrada');
    expect(plan.resumen.alta).toBe(0);
  });

  it('las filas rechazadas viajan en el plan y se cuentan', () => {
    const plan = planDe([fila({ tipo: 'aliado' }), fila({ documento: '800111222' })]);
    expect(plan.invalidas).toHaveLength(1);
    expect(plan.resumen.invalidas).toBe(1);
    expect(plan.items).toHaveLength(1);
  });

  it('un plan de puros sin cambio no ofrece botón', () => {
    expect(planTieneEfecto(planDe([fila()], [existente()]))).toBe(false);
    expect(planTieneEfecto(planDe([fila()]))).toBe(true);
  });
});

describe('el correo en el cargue', () => {
  it('un correo mal escrito rechaza la fila en vez de guardarse', () => {
    const { invalidas } = parsearFilasCargue([fila({ correo: 'juan@' })]);
    expect(invalidas[0].motivo).toBe('correo_invalido');
  });

  it('sin correo la fila entra igual: el tercero se carga y se invita después', () => {
    const { validas, invalidas } = parsearFilasCargue([fila({ correo: '' })]);
    expect(invalidas).toHaveLength(0);
    expect(validas[0].correo).toBeNull();
  });

  it('el correo se guarda en minúsculas', () => {
    const { validas } = parsearFilasCargue([fila({ correo: '  Compras@Ferre.CO ' })]);
    expect(validas[0].correo).toBe('compras@ferre.co');
  });

  it('un correo nuevo sobre un sujeto existente es una actualización', () => {
    const plan = planDe([fila({ correo: 'compras@ferre.co' })], [existente()]);
    expect(plan.items[0].accion).toBe('actualizacion');
    expect(plan.items[0].detalle).toContain('compras@ferre.co');
  });

  it('el archivo sin correo NO borra el que ya está guardado', () => {
    const plan = planDe([fila({ correo: '' })], [existente({ correo: 'compras@ferre.co' })]);
    expect(plan.items[0].accion).toBe('sin_cambio');
  });
});

describe('explicarInvalida', () => {
  it('el documento repetido dice en qué fila estaba el original', () => {
    expect(explicarInvalida('documento_repetido_fila_7')).toContain('fila 7');
  });

  it('un motivo desconocido se muestra crudo en vez de desaparecer', () => {
    expect(explicarInvalida('motivo_que_nadie_previo')).toBe('motivo_que_nadie_previo');
  });
});
