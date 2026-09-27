// Espejo Deno de `src/lib/negocios/cartera.ts`. Lo que se prueba es lo que dice la
// alerta W25 (`metrik_alerta_saldo_vencido`): cuanto esta vencido y desde hace cuanto.
import { describe, expect, it } from 'vitest';
import { deudasDeCartera, vencimientoDeFila, type FilaCartera } from './cartera';

function fila(over: Partial<FilaCartera> = {}): FilaCartera {
  return { workspace_id: 'ws', codigo: 'V0001', nombre: 'Caso', saldo: 1_000_000, dias: 10, ...over };
}

// ALMA (A1 26 1) medido el 2026-09-27: 12 cuotas de $400.000, pagadas 3, la 4
// esperada el 15-sep sin pagar. La alerta decia "$3.600.000 vencidos, 159 dias".
const alma = fila({
  codigo: 'A1 26 1', saldo: '3600000', dias: 159,
  con_cronograma: true, saldo_vencido: '400000', dias_mora: 12,
});

describe('cartera (edge)', () => {
  it('ALMA: vencida solo la cuota que paso su fecha, con dias de mora', () => {
    const [d] = deudasDeCartera([alma]);
    expect(d).toMatchObject({ saldo: 3_600_000, vencido: 400_000, dias: 12, vencida: true, conCronograma: true });
  });

  it('con cronograma al dia no hay alerta, aunque el negocio tenga 200 dias', () => {
    const [d] = deudasDeCartera([
      fila({ saldo: 3_200_000, dias: 200, con_cronograma: true, saldo_vencido: 0, dias_mora: null }),
    ]);
    expect(d).toMatchObject({ vencido: 0, dias: 0, vencida: false });
  });

  it('con cronograma no espera 30 dias: una cuota vencida hace 5 dias ya alerta', () => {
    const [d] = deudasDeCartera([fila({ con_cronograma: true, saldo_vencido: 100_000, dias_mora: 5 })]);
    expect(d).toMatchObject({ vencido: 100_000, dias: 5, vencida: true });
  });

  it('sin cronograma sigue la regla de 30 dias sobre todo el saldo', () => {
    const [a, b] = deudasDeCartera([fila({ codigo: 'A', dias: 31 }), fila({ codigo: 'B', dias: 30 })]);
    expect(a).toMatchObject({ codigo: 'A', vencido: 1_000_000, vencida: true });
    expect(b).toMatchObject({ codigo: 'B', vencido: 0, vencida: false });
  });

  it('lo vencido nunca pasa del saldo', () => {
    expect(vencimientoDeFila(fila({ saldo: 50_000, con_cronograma: true, saldo_vencido: 90_000, dias_mora: 3 })).vencido)
      .toBe(50_000);
  });
});
