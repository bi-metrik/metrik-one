// ============================================================
// Cartera de honorarios para WhatsApp — una sola consulta, un solo piso
// ============================================================
//
// Existe porque los tres puntos de WhatsApp que hablaban de cartera leian
// `v_facturas_estado`, construida sobre `facturas`, que tiene 0 filas en los 15
// workspaces (medido 2026-08-22). No fallaban: devolvian vacio, y con eso el
// bot afirmaba "No tienes cartera pendiente" y el resumen semanal imprimia
// "Cartera: $0" todos los lunes. Es el mismo defecto que /numeros corrigio en
// el PR #365 y el tablero generico en el #368; falta la superficie de WhatsApp.
//
// La fuente es `v_cartera_negocio`, la misma de esas dos pantallas. Las edge
// functions corren en Deno y no pueden importar de `src/`, asi que el piso de
// materialidad se repite aca como constante propia — no como copia silenciosa:
// si cambia en `src/lib/negocios/tolerancia-saldo.ts` (decision de CFO, se
// cambia en un solo lugar), tiene que cambiar aca. El comentario es el enlace
// que el import no puede ser.

/** Espejo de TOLERANCIA_SALDO_COP en `src/lib/negocios/tolerancia-saldo.ts`. */
export const TOLERANCIA_SALDO_COP = 1000;

/** Un saldo se considera vencido pasados estos dias desde que nacio el negocio. */
export const DIAS_CARTERA_VENCIDA = 30;

/** Fila de `v_cartera_negocio`. Los numericos de Postgres llegan como string. */
export type FilaCartera = {
  codigo: string | null;
  nombre: string | null;
  saldo: number | string;
  dias: number | null;
  workspace_id?: string;
};

export type DeudaCartera = {
  /** Se conserva para poder agrupar por workspace sin volver a la fila cruda. */
  workspaceId: string | null;
  nombre: string;
  codigo: string;
  saldo: number;
  /** Dias desde que nacio el negocio, no vencimiento de factura: no hay factura. */
  dias: number;
  vencida: boolean;
};

/**
 * Las deudas que valen la pena perseguir, de la mas vieja a la mas nueva.
 *
 * Filtra por el piso de materialidad — un residuo de redondeo no es una deuda —
 * y ordena por antiguedad, no por monto: en SOENA la mayoria de los saldos vale
 * exactamente lo mismo, asi que ordenar por plata no ordena nada (PR #325).
 *
 * Pura: no toca DB ni red.
 */
export function deudasDeCartera(filas: FilaCartera[] | null): DeudaCartera[] {
  if (!filas) return [];
  return filas
    .filter((f) => Number(f.saldo) > TOLERANCIA_SALDO_COP)
    .map((f) => ({
      workspaceId: f.workspace_id ?? null,
      nombre: f.nombre ?? 'Sin nombre',
      codigo: f.codigo ?? 'S/C',
      saldo: Number(f.saldo),
      dias: f.dias ?? 0,
      vencida: (f.dias ?? 0) > DIAS_CARTERA_VENCIDA,
    }))
    .sort((a, b) => b.dias - a.dias || b.saldo - a.saldo);
}

/** Las columnas que las tres superficies leen de `v_cartera_negocio`. */
export const COLUMNAS_CARTERA = 'workspace_id, codigo, nombre, saldo, dias';
