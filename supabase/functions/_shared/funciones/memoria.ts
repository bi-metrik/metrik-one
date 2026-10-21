// ============================================================
// Funciones — el doble en memoria del puerto, para el arnés del asistente y las pruebas
// ------------------------------------------------------------
// Repite las reglas de `funcion_consultar_cupo` y `funcion_apartar` (migración 20261021120000): ocupan las
// confirmadas y las apartadas sin vencer; los apartados vencidos se marcan al apartar; misma clave = misma reserva;
// cerrada, cancelada o ya empezada = `funcion_cerrada`; pasada la hora de cierre = `venta_cerrada`; sin minutos de
// apartado = `sin_regla_apartado`; sin la última autorización general en `si` = `sin_autorizacion`.
// `servicios.test.ts` corre las mismas pruebas contra este doble y contra la base real (PGlite): si se separan, falla.
// ============================================================

import type { LlaveConversacion } from '../agente/publico/tipos.ts';
import type { PropuestaApartado, PuertoFunciones, RespuestaAutorizacion, ResultadoApartar, ResultadoCupo } from './tipos.ts';

export interface FuncionEnMemoria {
  id: string;
  workspaceId: string;
  iniciaAt: string;
  cupoTotal: number;
  estado?: 'abierta' | 'cerrada' | 'cancelada';
  cierraVentaAt?: string | null;
  /** HUECO 4: sin valor, `apartar` responde `sin_regla_apartado`. */
  minutosApartado: number | null;
}

interface ReservaEnMemoria {
  id: string;
  workspaceId: string;
  funcionId: string;
  personas: number;
  estado: 'apartada' | 'confirmada' | 'cancelada' | 'vencida';
  venceAt: number;
  clave: string;
  propuesta: PropuestaApartado;
}

const llaveTexto = (l: LlaveConversacion) => `${l.workspaceId}|${l.cuentaId}|${l.conversacionId}`;

export function funcionesEnMemoria(o: { ahora?: () => number } = {}) {
  const ahora = o.ahora ?? (() => Date.now());
  const funciones = new Map<string, FuncionEnMemoria>();
  const reservas: ReservaEnMemoria[] = [];
  const autorizaciones = new Map<string, 'si' | 'no'>();
  let n = 0;

  const ocupadas = (funcionId: string) =>
    reservas
      .filter((r) => r.funcionId === funcionId && (r.estado === 'confirmada' || (r.estado === 'apartada' && r.venceAt > ahora())))
      .reduce((s, r) => s + r.personas, 0);

  const vencer = (funcionId: string) => {
    for (const r of reservas) if (r.funcionId === funcionId && r.estado === 'apartada' && r.venceAt <= ahora()) r.estado = 'vencida';
  };

  const puerto: PuertoFunciones = {
    async consultarCupo(workspaceId, funcionId): Promise<ResultadoCupo> {
      const f = funciones.get(funcionId);
      if (!f || f.workspaceId !== workspaceId || Date.parse(f.iniciaAt) <= ahora()) return { ok: false, error: 'funcion_no_existe' };
      const libres = Math.max(f.cupoTotal - ocupadas(f.id), 0);
      const estado = f.estado ?? 'abierta';
      const ventaCerrada = estado === 'abierta' && f.cierraVentaAt != null && Date.parse(f.cierraVentaAt) <= ahora();
      return {
        ok: true,
        cupo: { funcion_id: f.id, inicia_at: f.iniciaAt, estado: ventaCerrada ? 'cerrada' : estado, cupo_libre: libres, agotada: libres === 0 },
      };
    },

    async autorizacionGeneral(llave): Promise<RespuestaAutorizacion> {
      return autorizaciones.get(llaveTexto(llave)) ?? null;
    },

    async apartar(p): Promise<ResultadoApartar> {
      const f = funciones.get(p.funcionId);
      if (!f || f.workspaceId !== p.llave.workspaceId) return { ok: false, error: 'funcion_no_existe' };
      vencer(f.id);
      const previa = reservas.find((r) => r.workspaceId === f.workspaceId && r.clave === p.huellaPropuesta);
      if (previa) {
        if (previa.funcionId !== f.id || previa.personas !== p.personas) return { ok: false, error: 'clave_reusada' };
        return { ok: true, reservaId: previa.id, estado: previa.estado, venceAt: new Date(previa.venceAt).toISOString(), repetida: true };
      }
      if ((f.estado ?? 'abierta') !== 'abierta' || Date.parse(f.iniciaAt) <= ahora()) return { ok: false, error: 'funcion_cerrada' };
      if (f.cierraVentaAt != null && Date.parse(f.cierraVentaAt) <= ahora()) return { ok: false, error: 'venta_cerrada' };
      if (f.minutosApartado == null) return { ok: false, error: 'sin_regla_apartado' };
      if (autorizaciones.get(llaveTexto(p.llave)) !== 'si') return { ok: false, error: 'sin_autorizacion' };
      if (ocupadas(f.id) + p.personas > f.cupoTotal) return { ok: false, error: 'sin_cupo' };
      const r: ReservaEnMemoria = {
        id: `00000000-0000-4000-9000-${(++n).toString(16).padStart(12, '0')}`,
        workspaceId: f.workspaceId,
        funcionId: f.id,
        personas: p.personas,
        estado: 'apartada',
        venceAt: ahora() + f.minutosApartado * 60_000,
        clave: p.huellaPropuesta,
        propuesta: structuredClone(p),
      };
      reservas.push(r);
      return { ok: true, reservaId: r.id, estado: 'apartada', venceAt: new Date(r.venceAt).toISOString(), repetida: false };
    },
  };

  return {
    puerto,
    agregarFuncion(f: FuncionEnMemoria) {
      funciones.set(f.id, { ...f });
    },
    /** Registra una respuesta a la autorización general: la última manda, como en la base. */
    autorizar(llave: LlaveConversacion, respuesta: 'si' | 'no') {
      autorizaciones.set(llaveTexto(llave), respuesta);
    },
    /** Lo que quedó apartado, para que el arnés lo mire (nunca trae mesa: la propuesta no la tiene). */
    reservas: () => reservas.map((r) => ({ ...r, propuesta: structuredClone(r.propuesta) })),
    /** Para probar el vencimiento sin reloj: deja vencido un apartado. */
    vencer(reservaId: string) {
      const r = reservas.find((x) => x.id === reservaId);
      if (r) r.venceAt = ahora() - 1;
    },
  };
}
