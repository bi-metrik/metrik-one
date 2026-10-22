// ============================================================
// Funciones — el doble en memoria del puerto, para el arnés del asistente y las pruebas
// ------------------------------------------------------------
// Repite las reglas de la migración 20261022170000:
//   · tarifa (`funcion_tarifa`): reemplazo de la función → campaña; preventa rige su precio y deja el completo como
//     contexto;
//   · disponible para el asistente (`funcion_motivo_asistente`): campaña activa + agenda publicada + función activa +
//     futura + venta abierta + cupo del asistente libre;
//   · apartar (origen asistente): misma clave = misma foto; `sin_regla_apartado`, `sin_precio`,
//     `modalidad_no_permitida`, `sin_autorizacion` y `sin_cupo` contra el cupo del asistente; el monto lo calcula aquí,
//     como la base.
// `servicios.test.ts` corre las mismas pruebas contra este doble y contra la base real (PGlite): si se separan, falla.
// ============================================================

import type { LlaveConversacion } from '../agente/publico/tipos.ts';
import type {
  CampanaActiva,
  CupoPublico,
  FuncionDisponible,
  MotivoNoDisponible,
  PropuestaApartado,
  PuertoFunciones,
  RespuestaAutorizacion,
  ResultadoApartar,
  TarifaPublica,
} from './tipos.ts';

export interface CampanaEnMemoria {
  id: string;
  workspaceId: string;
  codigo: string;
  nombre: string;
  experiencia: string;
  estado?: 'borrador' | 'activa' | 'pausada' | 'cerrada';
  publicada?: boolean;
  /** HUECO 4: sin valor, `apartar` responde `sin_regla_apartado`. */
  minutosApartado: number | null;
  precioPersona: number | null;
  precioPreventaPersona?: number | null;
  abonoPersona?: number | null;
  permitePagoTotal?: boolean;
}

export interface FuncionEnMemoria {
  id: string;
  campanaId: string;
  iniciaAt: string;
  capacidad: number;
  cupoAsistente?: number;
  estado?: 'activa' | 'pausada' | 'cancelada';
  cierraVentaAt?: string | null;
  esPreventa?: boolean;
  precioPersona?: number | null;
  precioPreventaPersona?: number | null;
  abonoPersona?: number | null;
  permitePagoTotal?: boolean | null;
  archivada?: boolean;
}

interface ReservaEnMemoria {
  id: string;
  funcionId: string;
  campanaId: string;
  personas: number;
  estado: 'apartada' | 'confirmada' | 'cancelada' | 'vencida';
  venceAt: number;
  clave: string | null;
  origen: 'asistente' | 'equipo';
  tarifa: 'preventa' | 'completa';
  precioUnitario: number;
  modalidad: 'abono' | 'total';
  montoAPagar: number;
  propuesta: PropuestaApartado | null;
}

const llaveTexto = (l: LlaveConversacion) => `${l.workspaceId}|${l.cuentaId}|${l.conversacionId}`;

export function funcionesEnMemoria(o: { ahora?: () => number } = {}) {
  const ahora = o.ahora ?? (() => Date.now());
  const campanas = new Map<string, CampanaEnMemoria>();
  const funciones = new Map<string, FuncionEnMemoria>();
  const reservas: ReservaEnMemoria[] = [];
  const autorizaciones = new Map<string, 'si' | 'no'>();
  let n = 0;
  const nuevoId = () => `00000000-0000-4000-9000-${(++n).toString(16).padStart(12, '0')}`;

  const ocupadas = (funcionId: string) =>
    reservas
      .filter((r) => r.funcionId === funcionId && (r.estado === 'confirmada' || (r.estado === 'apartada' && r.venceAt > ahora())))
      .reduce((s, r) => s + r.personas, 0);

  const vencer = (funcionId: string) => {
    for (const r of reservas) if (r.funcionId === funcionId && r.estado === 'apartada' && r.venceAt <= ahora()) r.estado = 'vencida';
  };

  const cupoAsistente = (f: FuncionEnMemoria) => f.cupoAsistente ?? f.capacidad;

  /** `funcion_tarifa`. */
  const tarifaDe = (f: FuncionEnMemoria, c: CampanaEnMemoria): TarifaPublica => {
    const completo = f.precioPersona ?? c.precioPersona ?? null;
    const preventa = f.precioPreventaPersona ?? c.precioPreventaPersona ?? null;
    return {
      tarifa: f.esPreventa ? 'preventa' : 'completa',
      precio_persona: f.esPreventa ? preventa : completo,
      precio_completo_persona: f.esPreventa ? completo : null,
      abono_persona: f.abonoPersona ?? c.abonoPersona ?? null,
      permite_pago_total: f.permitePagoTotal ?? c.permitePagoTotal ?? true,
    };
  };

  /** `funcion_motivo_asistente`; `oculta` = para el asistente la función no existe. */
  const motivoDe = (f: FuncionEnMemoria, c: CampanaEnMemoria): MotivoNoDisponible | 'oculta' | null => {
    if (f.archivada || !c.publicada) return 'oculta';
    if ((c.estado ?? 'activa') !== 'activa') return 'campana_no_activa';
    if ((f.estado ?? 'activa') !== 'activa') return 'funcion_no_activa';
    if (Date.parse(f.iniciaAt) <= ahora()) return 'funcion_pasada';
    if (f.cierraVentaAt != null && Date.parse(f.cierraVentaAt) <= ahora()) return 'venta_cerrada';
    if (cupoAsistente(f) - ocupadas(f.id) <= 0) return 'agotada';
    return null;
  };

  const de = (workspaceId: string, funcionId: string) => {
    const f = funciones.get(funcionId);
    const c = f ? campanas.get(f.campanaId) : undefined;
    return f && c && c.workspaceId === workspaceId ? { f, c } : null;
  };

  const libres = (f: FuncionEnMemoria) => Math.max(cupoAsistente(f) - ocupadas(f.id), 0);

  const puerto: PuertoFunciones = {
    async consultarCupo(workspaceId, funcionId) {
      const x = de(workspaceId, funcionId);
      if (!x) return { ok: false, error: 'funcion_no_existe' };
      const motivo = motivoDe(x.f, x.c);
      if (motivo === 'oculta') return { ok: false, error: 'funcion_no_existe' };
      const cupo: CupoPublico = {
        funcion_id: x.f.id,
        campana_codigo: x.c.codigo,
        inicia_at: x.f.iniciaAt,
        disponible: motivo === null,
        motivo,
        cupo_libre: motivo === null ? libres(x.f) : 0,
        agotada: motivo === 'agotada',
        tarifa: tarifaDe(x.f, x.c),
      };
      return { ok: true, cupo };
    },

    async verDisponibles(workspaceId, codigoCampana) {
      const codigo = codigoCampana?.trim().toUpperCase() ?? null;
      const dato: FuncionDisponible[] = [...funciones.values()]
        .map((f) => ({ f, c: campanas.get(f.campanaId)! }))
        .filter(({ f, c }) => c && c.workspaceId === workspaceId && (codigo === null || c.codigo === codigo) && motivoDe(f, c) === null)
        .sort((a, b) => Date.parse(a.f.iniciaAt) - Date.parse(b.f.iniciaAt) || a.f.id.localeCompare(b.f.id))
        .map(({ f, c }) => ({
          funcion_id: f.id, campana_codigo: c.codigo, campana: c.nombre, experiencia: c.experiencia,
          inicia_at: f.iniciaAt, cupo_libre: libres(f), tarifa: tarifaDe(f, c),
        }));
      return { ok: true, dato };
    },

    async campanasActivas(workspaceId) {
      const lista: CampanaActiva[] = [...campanas.values()]
        .filter((c) => c.workspaceId === workspaceId && (c.estado ?? 'activa') === 'activa' && c.publicada)
        .sort((a, b) => a.codigo.localeCompare(b.codigo))
        .map((c) => ({
          campana_id: c.id, codigo: c.codigo, nombre: c.nombre, experiencia: c.experiencia, desde: null, hasta: null,
          funciones_disponibles: [...funciones.values()].filter((f) => f.campanaId === c.id && motivoDe(f, c) === null).length,
        }));
      return { ok: true, dato: { total: lista.length, campanas: lista } };
    },

    async autorizacionGeneral(llave): Promise<RespuestaAutorizacion> {
      return autorizaciones.get(llaveTexto(llave)) ?? null;
    },

    async apartar(p): Promise<ResultadoApartar> {
      const x = de(p.llave.workspaceId, p.funcionId);
      if (!x) return { ok: false, error: 'funcion_no_existe' };
      const { f, c } = x;
      vencer(f.id);
      const previa = reservas.find((r) => r.clave === p.huellaPropuesta && campanas.get(r.campanaId)?.workspaceId === c.workspaceId);
      if (previa) {
        if (previa.funcionId !== f.id || previa.personas !== p.personas || previa.modalidad !== p.modalidad) return { ok: false, error: 'clave_reusada' };
        return foto(previa, true);
      }
      const motivo = motivoDe(f, c);
      if (motivo === 'oculta') return { ok: false, error: 'funcion_no_existe' };
      if (motivo !== null && motivo !== 'agotada') return { ok: false, error: motivo };
      if (c.minutosApartado == null) return { ok: false, error: 'sin_regla_apartado' };
      if (autorizaciones.get(llaveTexto(p.llave)) !== 'si') return { ok: false, error: 'sin_autorizacion' };
      const t = tarifaDe(f, c);
      if (t.precio_persona == null) return { ok: false, error: 'sin_precio' };
      let abono: number | null;
      if (p.modalidad === 'abono' && t.abono_persona != null) abono = t.abono_persona;
      else if (p.modalidad === 'total' && t.permite_pago_total) abono = null;
      else return { ok: false, error: 'modalidad_no_permitida' };
      if (ocupadas(f.id) + p.personas > cupoAsistente(f)) return { ok: false, error: 'sin_cupo' };
      const r: ReservaEnMemoria = {
        id: nuevoId(), funcionId: f.id, campanaId: c.id, personas: p.personas, estado: 'apartada',
        venceAt: ahora() + c.minutosApartado * 60_000, clave: p.huellaPropuesta, origen: 'asistente',
        tarifa: t.tarifa, precioUnitario: t.precio_persona, modalidad: p.modalidad,
        montoAPagar: p.personas * (abono ?? t.precio_persona), propuesta: structuredClone(p),
      };
      reservas.push(r);
      return foto(r, false);
    },
  };

  function foto(r: ReservaEnMemoria, repetida: boolean): ResultadoApartar {
    return {
      ok: true, reservaId: r.id, estado: r.estado, venceAt: new Date(r.venceAt).toISOString(), repetida, campanaId: r.campanaId,
      tarifa: r.tarifa, precioUnitario: r.precioUnitario, montoTotal: r.personas * r.precioUnitario, modalidad: r.modalidad,
      montoAPagar: r.montoAPagar,
    };
  }

  return {
    puerto,
    agregarCampana(c: CampanaEnMemoria) {
      campanas.set(c.id, { estado: 'activa', publicada: true, permitePagoTotal: true, ...c, codigo: c.codigo.toUpperCase() });
    },
    agregarFuncion(f: FuncionEnMemoria) {
      funciones.set(f.id, { ...f });
    },
    /** Lo que agrega el equipo: ocupa contra la capacidad y le resta al asistente. */
    apartarEquipo(funcionId: string, personas: number): boolean {
      const f = funciones.get(funcionId);
      if (!f || ocupadas(f.id) + personas > f.capacidad) return false;
      reservas.push({
        id: nuevoId(), funcionId, campanaId: f.campanaId, personas, estado: 'apartada', venceAt: ahora() + 3_600_000, clave: null,
        origen: 'equipo', tarifa: 'completa', precioUnitario: 1, modalidad: 'total', montoAPagar: personas, propuesta: null,
      });
      return true;
    },
    /** Registra una respuesta a la autorización general: la última manda, como en la base. */
    autorizar(llave: LlaveConversacion, respuesta: 'si' | 'no') {
      autorizaciones.set(llaveTexto(llave), respuesta);
    },
    /** Lo que quedó apartado, para que el arnés lo mire (nunca trae mesa, puesto ni monto del asistente). */
    reservas: () => reservas.map((r) => ({ ...r, propuesta: r.propuesta ? structuredClone(r.propuesta) : null })),
    /** Para probar el vencimiento sin reloj: deja vencido un apartado. */
    vencer(reservaId: string) {
      const r = reservas.find((x) => x.id === reservaId);
      if (r) r.venceAt = ahora() - 1;
    },
  };
}
