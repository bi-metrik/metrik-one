// ============================================================
// Bandeja con gastos (2026-10-29, roles de Trappvel) — leer un archivo como dato del viaje Y como soporte de pago
// ------------------------------------------------------------
// La mano derecha de Trappvel (el dueño) abre viajes y registra gastos en la misma conversación. Una foto puede ser el
// pantallazo de lo que pidió un cliente o el recibo de un gasto: el CÓDIGO no lo decide (Mauricio: «que se sienta
// natural, no un formulario»). Se lee con los dos lectores a la vez (el de documentos del viaje y el de soportes de
// ONE) y la fila guarda las dos lecturas en una (`mixta: true`): la conversación muestra las dos y el modelo decide por
// contexto (lo que dijo la persona, el viaje en curso, el gasto en curso).
//   · lo del viaje: `clase` y `texto` (entra a la carga del viaje igual que hoy);
//   · lo del soporte: monto, fecha, comercio, NIT, concepto y titular (los usa el gasto o el ingreso igual que en ONE).
// Un solo preparador baja el archivo una vez (`componer.ts`, opción `adjuntos`); solo la lectura va doble.
// ============================================================

import type { Lector } from '../one/lectura-adjunto.ts';
import type { LecturaAdjunto } from '../tipos.ts';

/** Las dos lecturas en una. `null` si ninguna respondió. Pura. */
export function unirLecturas(viaje: LecturaAdjunto | null, soporte: LecturaAdjunto | null): LecturaAdjunto | null {
  if (!viaje && !soporte) return null;
  const pagoLeido = !!soporte?.legible;
  return {
    legible: !!viaje?.legible || pagoLeido,
    clase: viaje?.clase ?? 'otro',
    texto: viaje?.legible ? viaje.texto ?? null : null,
    // El soporte manda en los datos duros de un pago; si no lo leyó como pago, lo del viaje (un comprobante de pago).
    monto: pagoLeido ? soporte!.monto : viaje?.monto ?? null,
    fecha: pagoLeido ? soporte!.fecha : viaje?.fecha ?? null,
    comercio: pagoLeido ? soporte!.comercio : viaje?.comercio ?? null,
    nit: pagoLeido ? soporte!.nit : null,
    descripcion: pagoLeido ? soporte!.descripcion : null,
    ...(pagoLeido && soporte!.titular_destino ? { titular_destino: soporte!.titular_destino } : {}),
    ...(!viaje?.legible && !pagoLeido ? { motivo: viaje?.motivo ?? soporte?.motivo ?? 'no se pudo leer' } : {}),
    mixta: true,
  };
}

/** El lector de un rol con viajes y gastos: los dos lectores a la vez sobre el mismo archivo. */
export function lectorMixto(viaje: Lector, soporte: Lector): Lector {
  return async (a) => {
    const [v, s] = await Promise.all([viaje(a).catch(() => null), soporte(a).catch(() => null)]);
    return unirLecturas(v, s);
  };
}
