// ============================================================
// Funciones — los servicios `consultar_cupo` y `apartar` del asistente (§3 del diseño de la etapa 2)
// ------------------------------------------------------------
// Puros sobre un `PuertoFunciones`: producción en `supabase.ts` (RPC con la llave de servicio), arnés en `memoria.ts`.
// PREPARADOS, SIN CONECTAR al asistente.
//
// Candados en código, además de los de la base:
//   · `consultarCupo` devuelve exactamente los cinco campos de `CupoPublico`, aunque el puerto traiga más.
//   · `apartar` exige la autorización `general` = `si` de esa conversación ANTES de llamar a la base; sin ella,
//     `sin_autorizacion` y no aparta. La base lo vuelve a verificar dentro del candado.
//   · `apartar` arma la propuesta campo por campo: lo que el llamador agregue por fuera del tipo (una mesa) no viaja.
//   · Ninguno confirma: `confirmada` solo llega por `funcion_confirmar_pago` (la pasarela o el equipo). El texto
//     «reservado» sigue prohibido hasta el pago aprobado (§8.4 del diseño de la etapa 1).
// ============================================================

import type { PropuestaApartado, PuertoFunciones, ResultadoApartar, ResultadoCupo } from './tipos.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

export async function consultarCupo(puerto: PuertoFunciones, workspaceId: string, funcionId: string): Promise<ResultadoCupo> {
  if (!UUID.test(funcionId) || !UUID.test(workspaceId)) return { ok: false, error: 'funcion_no_existe' };
  const r = await puerto.consultarCupo(workspaceId, funcionId);
  if (!r.ok) return r;
  const { funcion_id, inicia_at, estado, cupo_libre, agotada } = r.cupo;
  return { ok: true, cupo: { funcion_id, inicia_at, estado, cupo_libre, agotada } };
}

export async function apartar(puerto: PuertoFunciones, p: PropuestaApartado): Promise<ResultadoApartar> {
  if (!UUID.test(p.funcionId) || !UUID.test(p.llave.workspaceId)) return { ok: false, error: 'funcion_no_existe' };
  if (!Number.isInteger(p.personas) || p.personas < 1 || p.personas > 500) return { ok: false, error: 'personas_invalidas' };
  const huella = texto(p.huellaPropuesta, 200);
  if (!huella) return { ok: false, error: 'datos_invalidos' };
  if (!Number.isSafeInteger(p.llave.cuentaId) || !Number.isSafeInteger(p.llave.conversacionId)) {
    return { ok: false, error: 'sin_autorizacion' };
  }

  if ((await puerto.autorizacionGeneral(p.llave)) !== 'si') return { ok: false, error: 'sin_autorizacion' };

  const limpia: PropuestaApartado = {
    llave: { workspaceId: p.llave.workspaceId, cuentaId: p.llave.cuentaId, conversacionId: p.llave.conversacionId },
    canal: p.canal,
    funcionId: p.funcionId,
    personas: p.personas,
    nombre: texto(p.nombre, 200),
    documento: texto(p.documento, 40),
    telefono: texto(p.telefono, 40),
    contactoCanal: texto(p.contactoCanal, 200),
    solicitudCliente: texto(p.solicitudCliente, 500),
    huellaPropuesta: huella,
  };
  return puerto.apartar(limpia);
}
