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
//   · Ninguno confirma: `confirmada` solo llega por `funcion_registrar_pago` (la pasarela) o `funcion_confirmar_pago`
//     (el equipo).
//   · P14b: la modalidad (total o solo la reserva) va en `generar_link_pago`, no en `apartar`. P14a/P14c: el saldo
//     tiene su lectura (`saldo_reserva`) y su link (`generar_link_saldo`).
// ============================================================

import type { PasarelaPagos } from './pasarela.ts';
import type {
  Alternativa,
  CampanaDeConversacion,
  CampanasActivas,
  LinkPago,
  Modalidad,
  CupoPublico,
  FuncionDisponible,
  PropuestaApartado,
  PuertoFunciones,
  Resultado,
  ResultadoApartar,
  ResultadoCupo,
  ResumenPago,
  SaldoReserva,
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
  preventa_hasta: t.preventa_hasta ?? null,
  abono_persona: t.abono_persona,
  permite_pago_total: t.permite_pago_total,
});

const alternativa = (a: Alternativa): Alternativa => ({
  funcion_id: a.funcion_id,
  experiencia: a.experiencia,
  campana: a.campana,
  campana_codigo: a.campana_codigo,
  inicia_at: a.inicia_at,
  inicia_texto: a.inicia_texto,
  tarifa: tarifa(a.tarifa),
  alcanza: true,
  grupo: a.grupo,
});

/**
 * El estado de una función para esas personas (sin números de cupo), su tarifa y, si no alcanza, hasta 3
 * alternativas donde sí caben. Las alternativas las elige la base: el modelo no las inventa.
 */
export async function consultarCupo(puerto: PuertoFunciones, workspaceId: string, funcionId: string, personas = 1): Promise<ResultadoCupo> {
  if (!UUID.test(funcionId) || !UUID.test(workspaceId)) return { ok: false, error: 'funcion_no_existe' };
  if (!Number.isInteger(personas) || personas < 1 || personas > 500) return { ok: false, error: 'personas_invalidas' };
  const r = await puerto.consultarCupo(workspaceId, funcionId, personas);
  if (!r.ok) return r;
  const c = r.cupo;
  const cupo: CupoPublico = {
    funcion_id: c.funcion_id,
    campana_codigo: c.campana_codigo,
    inicia_at: c.inicia_at,
    inicia_texto: c.inicia_texto,
    estado: c.estado,
    tarifa: tarifa(c.tarifa),
    alternativas: (c.alternativas ?? []).map(alternativa),
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
      inicia_texto: f.inicia_texto,
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

/**
 * P10: la campaña de donde viene el cliente, para marcar la conversación. Primero por el id del anuncio (Click to
 * WhatsApp); si no hay, por el código que el cliente escribió («HP-OCT26»). `null` = no se sabe: el asistente pregunta.
 */
export async function campanaDeLaConversacion(
  puerto: PuertoFunciones,
  workspaceId: string,
  o: { adId?: string | null; codigo?: string | null },
): Promise<Resultado<CampanaDeConversacion | null>> {
  if (!UUID.test(workspaceId)) return { ok: false, error: 'datos_invalidos' };
  const ad = texto(o.adId, 100);
  if (ad && /^[A-Za-z0-9_.:-]{1,100}$/.test(ad)) {
    const r = await puerto.campanaPorAnuncio(workspaceId, ad);
    if (!r.ok || r.dato) return r;
  }
  const codigo = texto(o.codigo, 20);
  if (codigo && CODIGO.test(codigo)) return puerto.campanaPorCodigo(workspaceId, codigo);
  return { ok: true, dato: null };
}

export async function apartar(puerto: PuertoFunciones, p: PropuestaApartado): Promise<ResultadoApartar> {
  if (!UUID.test(p.funcionId) || !UUID.test(p.llave.workspaceId)) return { ok: false, error: 'funcion_no_existe' };
  if (!Number.isInteger(p.personas) || p.personas < 1 || p.personas > 500) return { ok: false, error: 'personas_invalidas' };
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
    nombre: texto(p.nombre, 200),
    documento: texto(p.documento, 40),
    telefono: texto(p.telefono, 40),
    contactoCanal: texto(p.contactoCanal, 200),
    solicitudCliente: texto(p.solicitudCliente, 500),
    atribucion: { fuente: p.atribucion.fuente, ref: texto(p.atribucion.ref, 200) },
    huellaPropuesta: huella,
  };
  const r = await puerto.apartar(limpia);
  if (!r.ok && r.error === 'sin_cupo') {
    return { ok: false, error: 'sin_cupo', estado: r.estado, alternativas: (r.alternativas ?? []).map(alternativa) };
  }
  return r;
}

const listaDeReservas = (ids: unknown): string[] | null =>
  Array.isArray(ids) && ids.length >= 1 && ids.length <= 20 && ids.every((x) => typeof x === 'string' && UUID.test(x)) && new Set(ids).size === ids.length
    ? (ids as string[])
    : null;

/**
 * Lo que se paga de cada reserva y la suma sin las vencidas, con las dos cifras (`total` y `solo_reserva`) y las
 * `modalidades` que sirven para todas. El asistente pregunta una vez cuál quiere el cliente; no suma.
 */
export async function resumenPago(puerto: PuertoFunciones, workspaceId: string, reservaIds: string[]): Promise<Resultado<ResumenPago>> {
  const ids = listaDeReservas(reservaIds);
  if (!UUID.test(workspaceId) || !ids) return { ok: false, error: 'datos_invalidos' };
  return puerto.resumenPago(workspaceId, ids);
}

/**
 * El pago ya preparado por la base → la pasarela crea el link de monto fijo que vence con el pago → `vincularLink`.
 * Lo usan los servicios del asistente y la pantalla del equipo (regenerar el link del saldo en la lista del día).
 */
export async function crearLinkDelPago(
  puerto: Pick<PuertoFunciones, 'vincularLink'>,
  pasarela: PasarelaPagos,
  p: Resultado<{ pago_id: string; monto_esperado: number; vence_at: string }>,
  descripcion: string,
  quien: string,
): Promise<Resultado<LinkPago>> {
  if (!p.ok) return p;
  const link = await pasarela.crearLink({
    pagoId: p.dato.pago_id,
    monto: Number(p.dato.monto_esperado),
    venceAt: p.dato.vence_at,
    descripcion: texto(descripcion, 100) ?? 'Reserva',
  });
  if (!link.ok) {
    console.error(`[funciones/${quien}] la pasarela falló:`, link.error);
    return { ok: false, error: 'pasarela_fallo' };
  }
  const v = await puerto.vincularLink(p.dato.pago_id, link.referencia, link.url);
  if (!v.ok) return v;
  return {
    ok: true,
    dato: { pagoId: p.dato.pago_id, referencia: link.referencia, url: link.url, monto: Number(p.dato.monto_esperado), venceAt: p.dato.vence_at },
  };
}

/**
 * Un link de pago para una o varias reservas de la misma conversación (P13). Un pago por función son N llamadas con
 * una reserva cada una. `modalidad` (P14b) la elige el cliente al pagar, entre las `modalidades` de `resumen_pago`, y
 * vale para todas las reservas del link. Por dentro: `prepararPago` (candados, modalidad, realineación una sola vez,
 * monto de la base) → la pasarela crea el link de monto fijo que vence con el pago → `vincularLink` guarda la referencia.
 * Si la pasarela falla, el pago queda preparado sin link y el servicio responde `pasarela_fallo`: sus reservas ya se
 * realinearon, así que para reintentar hay que apartar de nuevo (lo mismo que si el link vence).
 */
export async function generarLinkPago(
  puerto: PuertoFunciones,
  pasarela: PasarelaPagos,
  workspaceId: string,
  reservaIds: string[],
  modalidad: Modalidad,
  descripcion: string,
): Promise<Resultado<LinkPago>> {
  const ids = listaDeReservas(reservaIds);
  if (!UUID.test(workspaceId) || !ids) return { ok: false, error: 'datos_invalidos' };
  if (modalidad !== 'abono' && modalidad !== 'total') return { ok: false, error: 'modalidad_no_permitida' };
  return crearLinkDelPago(puerto, pasarela, await puerto.prepararPago(workspaceId, ids, modalidad), descripcion, 'generar_link_pago');
}

/**
 * El link del SALDO (P14a, P14c) para una o varias reservas confirmadas de la misma conversación: por el saldo exacto
 * que calcula la base, y vence en el plazo de la campaña. Se puede generar de nuevo: el link anterior queda vencido.
 * Pasado el plazo responde `saldo_vencido` (solo una persona del equipo manda otro, o se cobra en el evento).
 */
export async function generarLinkSaldo(
  puerto: PuertoFunciones,
  pasarela: PasarelaPagos,
  workspaceId: string,
  reservaIds: string[],
  descripcion: string,
): Promise<Resultado<LinkPago>> {
  const ids = listaDeReservas(reservaIds);
  if (!UUID.test(workspaceId) || !ids) return { ok: false, error: 'datos_invalidos' };
  return crearLinkDelPago(puerto, pasarela, await puerto.prepararPagoSaldo(workspaceId, ids), descripcion, 'generar_link_saldo');
}

/** Lo pagado, el saldo, su plazo y su estado, de la base. El asistente lo lee; no resta. */
export async function saldoReserva(puerto: PuertoFunciones, reservaId: string): Promise<Resultado<SaldoReserva>> {
  if (!UUID.test(reservaId)) return { ok: false, error: 'reserva_no_existe' };
  return puerto.saldo(reservaId);
}
