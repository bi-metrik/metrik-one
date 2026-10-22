// ============================================================
// Funciones — los servicios del asistente: `consultar_cupo`, `ver_funciones_disponibles`, `campanas_activas` y
// `apartar` (§3 del diseño de la etapa 2)
// ------------------------------------------------------------
// Puros sobre un `PuertoFunciones`: producción en `supabase.ts` (RPC con la llave de servicio), arnés en `memoria.ts`.
// PREPARADOS, SIN CONECTAR al asistente.
//
// Candados en código, además de los de la base:
//   · Las lecturas devuelven exactamente los campos de sus tipos, aunque el puerto traiga más.
//   · `apartar` exige la autorización `general` = `si` de esa conversación ANTES de llamar a la base; sin ella,
//     `sin_autorizacion` y no aparta. La base lo vuelve a verificar dentro del candado.
//   · `apartar` arma la propuesta campo por campo: lo que el llamador agregue por fuera del tipo (una mesa, un monto)
//     no viaja. El monto lo calcula la base y vuelve en el resultado.
//   · Ninguno confirma: `confirmada` solo llega por `funcion_confirmar_pago` (la pasarela o el equipo).
// ============================================================

import type { PasarelaPagos } from './pasarela.ts';
import type {
  CampanasActivas,
  LinkPago,
  CupoPublico,
  FuncionDisponible,
  PropuestaApartado,
  PuertoFunciones,
  Resultado,
  ResultadoApartar,
  ResultadoCupo,
  ResumenPago,
  TarifaPublica,
} from './tipos.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODIGO = /^[A-Za-z0-9][A-Za-z0-9-]{1,19}$/;
const FUENTES = ['anuncio', 'link_campana', 'preguntado', 'desconocida'];

const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

const tarifa = (t: TarifaPublica): TarifaPublica => ({
  tarifa: t.tarifa,
  precio_persona: t.precio_persona,
  precio_completo_persona: t.precio_completo_persona,
  abono_persona: t.abono_persona,
  permite_pago_total: t.permite_pago_total,
});

export async function consultarCupo(puerto: PuertoFunciones, workspaceId: string, funcionId: string): Promise<ResultadoCupo> {
  if (!UUID.test(funcionId) || !UUID.test(workspaceId)) return { ok: false, error: 'funcion_no_existe' };
  const r = await puerto.consultarCupo(workspaceId, funcionId);
  if (!r.ok) return r;
  const c = r.cupo;
  const cupo: CupoPublico = {
    funcion_id: c.funcion_id,
    campana_codigo: c.campana_codigo,
    inicia_at: c.inicia_at,
    disponible: c.disponible,
    motivo: c.motivo,
    cupo_libre: c.cupo_libre,
    agotada: c.agotada,
    tarifa: tarifa(c.tarifa),
  };
  return { ok: true, cupo };
}

/** Las funciones que el asistente puede ofrecer, con su tarifa. Con código, solo las de esa campaña. */
export async function verFuncionesDisponibles(
  puerto: PuertoFunciones,
  workspaceId: string,
  codigoCampana: string | null = null,
): Promise<Resultado<FuncionDisponible[]>> {
  if (!UUID.test(workspaceId)) return { ok: false, error: 'datos_invalidos' };
  const codigo = texto(codigoCampana, 20);
  if (codigo !== null && !CODIGO.test(codigo)) return { ok: true, dato: [] };
  const r = await puerto.verDisponibles(workspaceId, codigo);
  if (!r.ok) return r;
  return {
    ok: true,
    dato: r.dato.map((f) => ({
      funcion_id: f.funcion_id,
      campana_codigo: f.campana_codigo,
      campana: f.campana,
      experiencia: f.experiencia,
      inicia_at: f.inicia_at,
      cupo_libre: f.cupo_libre,
      tarifa: tarifa(f.tarifa),
    })),
  };
}

/** Las campañas activas con agenda publicada. `preguntar` = hay más de una: el asistente pregunta a qué viene. */
export async function campanasActivas(
  puerto: PuertoFunciones,
  workspaceId: string,
): Promise<Resultado<CampanasActivas & { preguntar: boolean }>> {
  if (!UUID.test(workspaceId)) return { ok: false, error: 'datos_invalidos' };
  const r = await puerto.campanasActivas(workspaceId);
  if (!r.ok) return r;
  return { ok: true, dato: { total: r.dato.total, campanas: r.dato.campanas, preguntar: r.dato.total > 1 } };
}

export async function apartar(puerto: PuertoFunciones, p: PropuestaApartado): Promise<ResultadoApartar> {
  if (!UUID.test(p.funcionId) || !UUID.test(p.llave.workspaceId)) return { ok: false, error: 'funcion_no_existe' };
  if (!Number.isInteger(p.personas) || p.personas < 1 || p.personas > 500) return { ok: false, error: 'personas_invalidas' };
  if (p.modalidad !== 'abono' && p.modalidad !== 'total') return { ok: false, error: 'modalidad_no_permitida' };
  const huella = texto(p.huellaPropuesta, 200);
  if (!huella) return { ok: false, error: 'datos_invalidos' };
  if (!p.atribucion || !FUENTES.includes(p.atribucion.fuente)) return { ok: false, error: 'datos_invalidos' };
  if (!Number.isSafeInteger(p.llave.cuentaId) || !Number.isSafeInteger(p.llave.conversacionId)) {
    return { ok: false, error: 'sin_autorizacion' };
  }

  if ((await puerto.autorizacionGeneral(p.llave)) !== 'si') return { ok: false, error: 'sin_autorizacion' };

  const limpia: PropuestaApartado = {
    llave: { workspaceId: p.llave.workspaceId, cuentaId: p.llave.cuentaId, conversacionId: p.llave.conversacionId },
    canal: p.canal,
    funcionId: p.funcionId,
    personas: p.personas,
    modalidad: p.modalidad,
    nombre: texto(p.nombre, 200),
    documento: texto(p.documento, 40),
    telefono: texto(p.telefono, 40),
    contactoCanal: texto(p.contactoCanal, 200),
    solicitudCliente: texto(p.solicitudCliente, 500),
    atribucion: { fuente: p.atribucion.fuente, ref: texto(p.atribucion.ref, 200) },
    huellaPropuesta: huella,
  };
  return puerto.apartar(limpia);
}

const listaDeReservas = (ids: unknown): string[] | null =>
  Array.isArray(ids) && ids.length >= 1 && ids.length <= 20 && ids.every((x) => typeof x === 'string' && UUID.test(x)) && new Set(ids).size === ids.length
    ? (ids as string[])
    : null;

/** Lo que se paga de cada reserva y el total sin las vencidas, de la base. El asistente lo muestra; no suma. */
export async function resumenPago(puerto: PuertoFunciones, workspaceId: string, reservaIds: string[]): Promise<Resultado<ResumenPago>> {
  const ids = listaDeReservas(reservaIds);
  if (!UUID.test(workspaceId) || !ids) return { ok: false, error: 'datos_invalidos' };
  return puerto.resumenPago(workspaceId, ids);
}

/**
 * Un link de pago para una o varias reservas de la misma conversación (P13). Un pago por función son N llamadas con
 * una reserva cada una. Por dentro: `prepararPago` (candados, realineación una sola vez, monto de la base) → la
 * pasarela crea el link de monto fijo que vence con el pago → `vincularLink` guarda la referencia.
 * Si la pasarela falla, el pago queda preparado sin link y el servicio responde `pasarela_fallo`: sus reservas ya se
 * realinearon, así que para reintentar hay que apartar de nuevo (lo mismo que si el link vence).
 */
export async function generarLinkPago(
  puerto: PuertoFunciones,
  pasarela: PasarelaPagos,
  workspaceId: string,
  reservaIds: string[],
  descripcion: string,
): Promise<Resultado<LinkPago>> {
  const ids = listaDeReservas(reservaIds);
  if (!UUID.test(workspaceId) || !ids) return { ok: false, error: 'datos_invalidos' };
  const p = await puerto.prepararPago(workspaceId, ids);
  if (!p.ok) return p;
  const link = await pasarela.crearLink({
    pagoId: p.dato.pago_id,
    monto: Number(p.dato.monto_esperado),
    venceAt: p.dato.vence_at,
    descripcion: texto(descripcion, 100) ?? 'Reserva',
  });
  if (!link.ok) {
    console.error('[funciones/generar_link_pago] la pasarela falló:', link.error);
    return { ok: false, error: 'pasarela_fallo' };
  }
  const v = await puerto.vincularLink(p.dato.pago_id, link.referencia, link.url);
  if (!v.ok) return v;
  return {
    ok: true,
    dato: { pagoId: p.dato.pago_id, referencia: link.referencia, url: link.url, monto: Number(p.dato.monto_esperado), venceAt: p.dato.vence_at },
  };
}
