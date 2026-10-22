// ============================================================
// Funciones — el puerto de producción: RPC de la migración 20261022170000 con la llave de servicio
// ------------------------------------------------------------
// Se llama con la llave de servicio, nunca desde el navegador. Con esa llave la base deja leer lo disponible, consultar
// el cupo y apartar (origen `asistente`), y NO deja cancelar, publicar ni dar de alta (no se conceden a service_role).
//
// El cliente es estructural (lo que usa de supabase-js) para que el mismo archivo corra en Deno y en las pruebas.
// ============================================================

import type { LlaveConversacion } from '../agente/publico/tipos.ts';
import { codigoDeError } from './tipos.ts';
import type {
  CampanasActivas,
  CupoPublico,
  FuncionDisponible,
  PagoPreparado,
  PropuestaApartado,
  PuertoFunciones,
  RespuestaAutorizacion,
  ResultadoApartar,
  ResumenPago,
} from './tipos.ts';

type Respuesta<T> = { data: T | null; error: { message: string } | null };

interface Consulta<T> extends PromiseLike<Respuesta<T>> {
  eq(columna: string, valor: unknown): Consulta<T>;
  order(columna: string, o: { ascending: boolean }): Consulta<T>;
  limit(n: number): Consulta<T>;
}

export interface ClienteFunciones {
  rpc(nombre: string, args: Record<string, unknown>): PromiseLike<Respuesta<unknown>>;
  from(tabla: string): { select(columnas: string): Consulta<unknown[]> };
}

/** Los datos que viajan a `funcion_apartar`. Sin mesa, sin puesto y sin MONTO: la base rechaza uno con `dato_no_admitido`. Pura. */
export function datosDeApartado(p: PropuestaApartado): Record<string, unknown> {
  return {
    canal: p.canal,
    chatwoot_cuenta_id: p.llave.cuentaId,
    chatwoot_conversacion_id: p.llave.conversacionId,
    nombre: p.nombre,
    documento: p.documento,
    telefono: p.telefono,
    contacto_canal: p.contactoCanal,
    solicitud_cliente: p.solicitudCliente,
    atribucion_fuente: p.atribucion.fuente,
    atribucion_ref: p.atribucion.ref,
  };
}

export function puertoFuncionesSupabase(db: ClienteFunciones): PuertoFunciones {
  return {
    async consultarCupo(workspaceId, funcionId) {
      const { data, error } = await db.rpc('funcion_consultar_cupo', { p_workspace_id: workspaceId, p_funcion_id: funcionId });
      if (error || !data) return { ok: false, error: codigoDeError(error?.message) };
      return { ok: true, cupo: data as CupoPublico };
    },

    async verDisponibles(workspaceId, codigoCampana) {
      const { data, error } = await db.rpc('funcion_ver_disponibles', { p_workspace_id: workspaceId, p_codigo_campana: codigoCampana });
      if (error || !data) return { ok: false, error: codigoDeError(error?.message) };
      return { ok: true, dato: data as FuncionDisponible[] };
    },

    async campanasActivas(workspaceId) {
      const { data, error } = await db.rpc('funcion_campanas_activas', { p_workspace_id: workspaceId });
      if (error || !data) return { ok: false, error: codigoDeError(error?.message) };
      return { ok: true, dato: data as CampanasActivas };
    },

    async autorizacionGeneral(llave: LlaveConversacion): Promise<RespuestaAutorizacion> {
      const { data, error } = await db
        .from('chatwoot_consentimientos')
        .select('respuesta')
        .eq('workspace_id', llave.workspaceId)
        .eq('cuenta_id', llave.cuentaId)
        .eq('conversacion_id', llave.conversacionId)
        .eq('tipo', 'general')
        .order('created_at', { ascending: false })
        .limit(1);
      if (error || !data || data.length === 0) return null;
      const r = (data[0] as { respuesta?: string }).respuesta;
      return r === 'si' ? 'si' : r === 'no' ? 'no' : null;
    },

    async resumenPago(workspaceId, reservaIds) {
      const { data, error } = await db.rpc('funcion_resumen_pago', { p_workspace_id: workspaceId, p_reserva_ids: reservaIds });
      if (error || !data) return { ok: false, error: codigoDeError(error?.message) };
      const r = data as ResumenPago;
      return { ok: true, dato: { ...r, total: Number(r.total) } };
    },

    async prepararPago(workspaceId, reservaIds) {
      const { data, error } = await db.rpc('funcion_preparar_pago', { p_workspace_id: workspaceId, p_reserva_ids: reservaIds });
      if (error || !data) return { ok: false, error: codigoDeError(error?.message) };
      const r = data as PagoPreparado;
      return { ok: true, dato: { ...r, monto_esperado: Number(r.monto_esperado) } };
    },

    async vincularLink(pagoId, referencia, url) {
      const { error } = await db.rpc('funcion_vincular_link', { p_pago_id: pagoId, p_referencia: referencia, p_link_url: url });
      if (error) return { ok: false, error: codigoDeError(error.message) };
      return { ok: true, dato: null };
    },

    async apartar(p): Promise<ResultadoApartar> {
      const { data, error } = await db.rpc('funcion_apartar', {
        p_workspace_id: p.llave.workspaceId,
        p_funcion_id: p.funcionId,
        p_personas: p.personas,
        p_modalidad: p.modalidad,
        p_datos: datosDeApartado(p),
        p_clave_idempotencia: p.huellaPropuesta,
        p_origen: 'asistente',
      });
      if (error || !data) return { ok: false, error: codigoDeError(error?.message) };
      const r = data as {
        reserva_id: string; estado: 'apartada' | 'confirmada' | 'cancelada' | 'vencida'; vence_at: string | null; repetida: boolean;
        campana_id: string; tarifa: 'preventa' | 'completa'; precio_unitario: number; monto_total: number | string;
        modalidad: 'abono' | 'total'; monto_a_pagar: number | string;
      };
      return {
        ok: true,
        reservaId: r.reserva_id,
        estado: r.estado,
        venceAt: r.vence_at,
        repetida: r.repetida,
        campanaId: r.campana_id,
        tarifa: r.tarifa,
        precioUnitario: Number(r.precio_unitario),
        montoTotal: Number(r.monto_total),
        modalidad: r.modalidad,
        montoAPagar: Number(r.monto_a_pagar),
      };
    },
  };
}
