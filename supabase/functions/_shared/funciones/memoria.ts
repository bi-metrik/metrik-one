// ============================================================
// Funciones — el doble en memoria del puerto, para el arnés del asistente y las pruebas
// ------------------------------------------------------------
// Repite las reglas de la migración 20261022170000:
//   · tarifa (`funcion_tarifa`): reemplazo de la función → campaña; preventa rige su precio y deja el completo como
//     contexto;
//   · disponible para el asistente (`funcion_motivo_asistente`): campaña activa + agenda publicada + función activa +
//     futura + venta abierta + cupo del asistente libre;
//   · el estado para N personas (`funcion_estado_asistente`) y las alternativas (`funcion_alternativas`): hasta 3,
//     primero la misma campaña por cercanía, después otras experiencias por fecha (la experiencia es su nombre);
//   · apartar (origen asistente): misma clave = misma foto; `sin_regla_apartado`, `sin_precio`,
//     `modalidad_no_permitida` (sin abono ni pago total), `sin_autorizacion` y `sin_cupo` contra el cupo del asistente;
//     la foto (total, abono por persona, si permite el total, plazo del saldo) la calcula aquí, como la base;
//   · pagos (`funcion_resumen_pago`, `funcion_preparar_pago`, `funcion_vincular_link`): una conversación por pago, las
//     dos cifras sin vencidas, la modalidad fijada al pagar para todas, `apartado_vencido`, `reserva_en_otro_pago`,
//     `ya_realineada` y la realineación del vencimiento;
//   · saldo (`funcion_saldo`, `funcion_preparar_pago_saldo`): pagado = pagos aprobados, saldo = total − pagado, el
//     plazo (`plazoSaldo`), `sin_saldo`, `saldo_vencido`, y el link nuevo deja vencido al anterior.
// `servicios.test.ts` corre las mismas pruebas contra este doble y contra la base real (PGlite): si se separan, falla.
// ============================================================

import type { LlaveConversacion } from '../agente/publico/tipos.ts';
import { diaBogota, fechaTexto, plazoSaldo } from './fecha-texto.ts';
import type {
  Alternativa,
  EstadoAsistente,
  CampanaActiva,
  CupoPublico,
  FuncionDisponible,
  LineaResumenPago,
  Modalidad,
  PropuestaApartado,
  PuertoFunciones,
  RespuestaAutorizacion,
  ResultadoApartar,
  SaldoReserva,
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
  /** Plazo del saldo: días antes de la función (1 por defecto, como la base). */
  diasSaldoAntes?: number;
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
  /** Fin de la preventa (AAAA-MM-DD, inclusive, día de Bogotá). */
  preventaHasta?: string | null;
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
  montoTotal: number;
  abonoUnitario: number | null;
  permitePagoTotal: boolean;
  diasSaldoAntes: number;
  /** La fija el pago inicial. */
  modalidad: Modalidad | null;
  montoAPagar: number | null;
  propuesta: PropuestaApartado | null;
  /** La conversación (`cuenta|conversación`), o `null` si la tomó el equipo. */
  conversacion: string | null;
  realineada: boolean;
}

interface PagoEnMemoria {
  id: string;
  concepto: 'inicial' | 'saldo';
  reservas: string[];
  /** Lo de cada reserva dentro del pago, en el orden de `reservas`. */
  montos: number[];
  estado: 'pendiente' | 'aprobado' | 'fallido' | 'vencido' | 'revisar' | 'anulado';
  monto: number;
  venceAt: number;
  referencia: string | null;
}

/** Por qué el asistente no puede ofrecer una función (como `funcion_motivo_asistente`). */
type MotivoNoDisponible = 'campana_no_activa' | 'funcion_no_activa' | 'funcion_pasada' | 'venta_cerrada' | 'agotada';

const llaveTexto = (l: LlaveConversacion) => `${l.workspaceId}|${l.cuentaId}|${l.conversacionId}`;

export function funcionesEnMemoria(o: { ahora?: () => number } = {}) {
  const ahora = o.ahora ?? (() => Date.now());
  const campanas = new Map<string, CampanaEnMemoria>();
  const funciones = new Map<string, FuncionEnMemoria>();
  const reservas: ReservaEnMemoria[] = [];
  const autorizaciones = new Map<string, 'si' | 'no'>();
  const pagos = new Map<string, PagoEnMemoria>();
  const anuncios = new Map<string, string>(); // ad_id → campana_id
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
    // P4: con el interruptor encendido, hasta la fecha de fin inclusive (día de Bogotá).
    const enPreventa = !!f.esPreventa && (!f.preventaHasta || diaBogota(ahora()) <= f.preventaHasta);
    return {
      tarifa: enPreventa ? 'preventa' : 'completa',
      precio_persona: enPreventa ? preventa : completo,
      precio_completo_persona: enPreventa ? completo : null,
      preventa_hasta: enPreventa ? f.preventaHasta ?? null : null,
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

  /** `funcion_estado_asistente`. */
  const estadoDe = (f: FuncionEnMemoria, c: CampanaEnMemoria, personas: number): EstadoAsistente => {
    const m = motivoDe(f, c);
    if (m !== null && m !== 'agotada') return 'no_disponible';
    const o = ocupadas(f.id);
    if (o + personas <= cupoAsistente(f)) return 'alcanza';
    if (o + personas <= f.capacidad) return 'llena_para_asistente';
    return 'llena';
  };

  /** `funcion_alternativas`. */
  const alternativasDe = (f: FuncionEnMemoria, c: CampanaEnMemoria, personas: number): Alternativa[] => {
    const t0 = Date.parse(f.iniciaAt);
    return [...funciones.values()]
      .map((f2) => ({ f2, c2: campanas.get(f2.campanaId) }))
      .filter((x): x is { f2: FuncionEnMemoria; c2: CampanaEnMemoria } => !!x.c2)
      .filter(({ f2, c2 }) => c2.workspaceId === c.workspaceId && f2.id !== f.id && (c2.id === c.id || c2.experiencia !== c.experiencia)
        && motivoDe(f2, c2) === null && ocupadas(f2.id) + personas <= cupoAsistente(f2))
      .map(({ f2, c2 }) => {
        const misma = c2.id === c.id;
        const t = Date.parse(f2.iniciaAt);
        return { f2, c2, misma, orden: misma ? Math.abs(t - t0) : t };
      })
      .sort((a, b) => Number(a.misma === false) - Number(b.misma === false) || a.orden - b.orden || a.f2.id.localeCompare(b.f2.id))
      .slice(0, 3)
      .map(({ f2, c2, misma }) => ({
        funcion_id: f2.id, experiencia: c2.experiencia, campana: c2.nombre, campana_codigo: c2.codigo, inicia_at: f2.iniciaAt,
        inicia_texto: fechaTexto(f2.iniciaAt), tarifa: tarifaDe(f2, c2), alcanza: true as const,
        grupo: misma ? ('misma_campana' as const) : ('otra_experiencia' as const),
      }));
  };

  const puerto: PuertoFunciones = {
    resumenPago,
    prepararPago,
    prepararPagoSaldo,
    async saldo(reservaId) {
      const r = reservas.find((x) => x.id === reservaId);
      return r ? { ok: true, dato: saldoDe(r) } : { ok: false, error: 'reserva_no_existe' };
    },
    vincularLink,
    async consultarCupo(workspaceId, funcionId, personas) {
      const x = de(workspaceId, funcionId);
      if (!x) return { ok: false, error: 'funcion_no_existe' };
      const estado = estadoDe(x.f, x.c, personas);
      const cupo: CupoPublico = {
        funcion_id: x.f.id,
        campana_codigo: x.c.codigo,
        inicia_at: x.f.iniciaAt,
        inicia_texto: fechaTexto(x.f.iniciaAt),
        estado,
        tarifa: tarifaDe(x.f, x.c),
        alternativas: estado === 'alcanza' ? [] : alternativasDe(x.f, x.c, personas),
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
          inicia_at: f.iniciaAt, inicia_texto: fechaTexto(f.iniciaAt), tarifa: tarifaDe(f, c),
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

    async campanaPorAnuncio(workspaceId, adId) {
      const c = campanas.get(anuncios.get(`${workspaceId}|${adId.trim()}`) ?? '');
      return { ok: true, dato: c && c.publicada ? campanaJson(c) : null };
    },

    async campanaPorCodigo(workspaceId, codigo) {
      const c = [...campanas.values()].find((x) => x.workspaceId === workspaceId && x.codigo === codigo.trim().toUpperCase());
      return { ok: true, dato: c && c.publicada ? campanaJson(c) : null };
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
        if (previa.funcionId !== f.id || previa.personas !== p.personas) return { ok: false, error: 'clave_reusada' };
        return foto(previa, true);
      }
      const motivo = motivoDe(f, c);
      if (motivo === 'oculta') return { ok: false, error: 'funcion_no_existe' };
      if (motivo !== null && motivo !== 'agotada') return { ok: false, error: motivo };
      if (c.minutosApartado == null) return { ok: false, error: 'sin_regla_apartado' };
      if (autorizaciones.get(llaveTexto(p.llave)) !== 'si') return { ok: false, error: 'sin_autorizacion' };
      const t = tarifaDe(f, c);
      if (t.precio_persona == null) return { ok: false, error: 'sin_precio' };
      if (t.abono_persona == null && !t.permite_pago_total) return { ok: false, error: 'modalidad_no_permitida' };
      if (ocupadas(f.id) + p.personas > cupoAsistente(f)) {
        return { ok: false, error: 'sin_cupo', estado: estadoDe(f, c, p.personas), alternativas: alternativasDe(f, c, p.personas) };
      }
      const r: ReservaEnMemoria = {
        id: nuevoId(), funcionId: f.id, campanaId: c.id, personas: p.personas, estado: 'apartada',
        venceAt: ahora() + c.minutosApartado * 60_000, clave: p.huellaPropuesta, origen: 'asistente',
        tarifa: t.tarifa, precioUnitario: t.precio_persona, montoTotal: p.personas * t.precio_persona,
        abonoUnitario: t.abono_persona, permitePagoTotal: t.permite_pago_total, diasSaldoAntes: c.diasSaldoAntes ?? 1,
        modalidad: null, montoAPagar: null, propuesta: structuredClone(p),
        conversacion: `${p.llave.cuentaId}|${p.llave.conversacionId}`, realineada: false,
      };
      reservas.push(r);
      return foto(r, false);
    },
  };

  /** `funcion_campana_json` (sin el cierre automático por fecha: el doble no lo necesita). */
  function campanaJson(c: CampanaEnMemoria) {
    const estado = c.estado ?? 'activa';
    return { campana_id: c.id, codigo: c.codigo, nombre: c.nombre, experiencia: c.experiencia, estado, activa: estado === 'activa' && !!c.publicada };
  }

  /** `funcion_reservas_de_un_pago`: del workspace, sin repetidas, de una conversación. */
  const deUnPago = (workspaceId: string, ids: string[]) => {
    if (ids.length === 0 || ids.length > 20 || new Set(ids).size !== ids.length) return { error: 'datos_invalidos' as const };
    const rs = ids.map((id) => reservas.find((r) => r.id === id && campanas.get(r.campanaId)?.workspaceId === workspaceId));
    if (rs.some((r) => !r)) return { error: 'reserva_no_existe' as const };
    const lista = rs as ReservaEnMemoria[];
    const convs = new Set(lista.map((r) => r.conversacion));
    if (convs.size > 1 || (lista.length > 1 && convs.has(null))) return { error: 'distinta_conversacion' as const };
    return { lista };
  };
  const vigente = (r: ReservaEnMemoria) => r.estado === 'apartada' && r.venceAt > ahora();

  async function resumenPago(workspaceId: string, ids: string[]): ReturnType<PuertoFunciones['resumenPago']> {
    const x = deUnPago(workspaceId, ids);
    if ('error' in x) return { ok: false, error: x.error! };
    const lineas: LineaResumenPago[] = x.lista
      .map((r) => ({
        reserva_id: r.id, funcion_id: r.funcionId, inicia_at: funciones.get(r.funcionId)!.iniciaAt, personas: r.personas,
        precio_unitario: r.precioUnitario, tarifa: r.tarifa, monto_total: r.montoTotal, monto_reserva: montoReserva(r),
        permite_pago_total: r.permitePagoTotal, vigente: vigente(r), estado: r.estado,
      }))
      .sort((a, b) => Date.parse(a.inicia_at) - Date.parse(b.inicia_at) || a.reserva_id.localeCompare(b.reserva_id));
    const vivas = lineas.filter((l) => l.vigente);
    const conAbono = vivas.length > 0 && vivas.every((l) => l.monto_reserva !== null);
    const conTotal = vivas.length > 0 && vivas.every((l) => l.permite_pago_total);
    return {
      ok: true,
      dato: {
        reservas: lineas,
        total: vivas.reduce((s, l) => s + l.monto_total, 0),
        solo_reserva: conAbono ? vivas.reduce((s, l) => s + (l.monto_reserva ?? 0), 0) : null,
        modalidades: [...(conTotal ? ['total' as const] : []), ...(conAbono ? ['abono' as const] : [])],
        vencidas: lineas.filter((l) => !l.vigente).map((l) => l.reserva_id),
      },
    };
  }

  async function prepararPago(workspaceId: string, ids: string[], modalidad: Modalidad): ReturnType<PuertoFunciones['prepararPago']> {
    if (modalidad !== 'abono' && modalidad !== 'total') return { ok: false, error: 'modalidad_no_permitida' };
    const x = deUnPago(workspaceId, ids);
    if ('error' in x) return { ok: false, error: x.error! };
    for (const r of x.lista) vencer(r.funcionId);
    const orden = [...x.lista].sort((a, b) => a.id.localeCompare(b.id));
    const mala = orden.find((r) => !vigente(r));
    if (mala) return { ok: false, error: mala.estado === 'vencida' || mala.estado === 'apartada' ? 'apartado_vencido' : 'reserva_inactiva' };
    const enOtro = new Set([...pagos.values()].filter((p) => p.estado === 'pendiente').flatMap((p) => p.reservas));
    if (orden.some((r) => enOtro.has(r.id))) return { ok: false, error: 'reserva_en_otro_pago' };
    if (orden.some((r) => r.realineada)) return { ok: false, error: 'ya_realineada' };
    if (orden.some((r) => (modalidad === 'abono' ? r.abonoUnitario === null : !r.permitePagoTotal))) {
      return { ok: false, error: 'modalidad_no_permitida' };
    }
    const minutos = Math.min(...orden.map((r) => campanas.get(r.campanaId)!.minutosApartado ?? Infinity));
    if (!Number.isFinite(minutos)) return { ok: false, error: 'sin_regla_apartado' };
    const vence = ahora() + minutos * 60_000;
    for (const r of orden) {
      r.venceAt = vence;
      r.realineada = true;
      r.modalidad = modalidad;
      r.montoAPagar = modalidad === 'total' ? r.montoTotal : r.personas * r.abonoUnitario!;
    }
    const montos = orden.map((r) => r.montoAPagar!);
    const pago: PagoEnMemoria = {
      id: nuevoId(), concepto: 'inicial', reservas: orden.map((r) => r.id), montos, estado: 'pendiente',
      monto: montos.reduce((s, m) => s + m, 0), venceAt: vence, referencia: null,
    };
    pagos.set(pago.id, pago);
    return { ok: true, dato: { pago_id: pago.id, monto_esperado: pago.monto, vence_at: new Date(vence).toISOString(), reservas: pago.reservas } };
  }

  const montoReserva = (r: ReservaEnMemoria) => (r.abonoUnitario === null ? null : r.personas * r.abonoUnitario);

  /** `funcion_saldo_de`. */
  function saldoDe(r: ReservaEnMemoria): SaldoReserva {
    const aprobados = [...pagos.values()].filter((p) => p.estado === 'aprobado' && p.reservas.includes(r.id));
    const pagado = aprobados.reduce((s, p) => s + p.montos[p.reservas.indexOf(r.id)], 0);
    const conSaldo = aprobados.some((p) => p.concepto === 'saldo');
    const plazo = plazoSaldo(funciones.get(r.funcionId)!.iniciaAt, r.diasSaldoAntes);
    const saldo = r.montoTotal - pagado;
    const vivo = [...pagos.values()].find((p) => p.estado === 'pendiente' && p.concepto === 'saldo' && p.reservas.includes(r.id));
    return {
      reserva_id: r.id, monto_total: r.montoTotal, pagado, saldo, modalidad: r.modalidad, plazo_at: plazo,
      estado: r.estado !== 'confirmada' ? null : saldo <= 0 ? (conSaldo ? 'pagado' : 'sin_saldo') : ahora() < Date.parse(plazo) ? 'pendiente' : 'vencido',
      link: vivo ? { pago_id: vivo.id, url: vivo.referencia ? `https://checkout.ejemplo/${vivo.referencia}` : null, vence_at: new Date(vivo.venceAt).toISOString(), monto: vivo.monto } : null,
    };
  }

  /** `funcion_preparar_pago_saldo` con la llave del asistente (el doble es el asistente: sin persona del equipo). */
  async function prepararPagoSaldo(workspaceId: string, ids: string[]): ReturnType<PuertoFunciones['prepararPagoSaldo']> {
    const x = deUnPago(workspaceId, ids);
    if ('error' in x) return { ok: false, error: x.error! };
    const orden = [...x.lista].sort((a, b) => a.id.localeCompare(b.id));
    let vence = Infinity;
    const montos: number[] = [];
    for (const r of orden) {
      const f = funciones.get(r.funcionId)!;
      if (r.estado !== 'confirmada') return { ok: false, error: 'reserva_inactiva' };
      if ((f.estado ?? 'activa') === 'cancelada') return { ok: false, error: 'funcion_cerrada' };
      if (Date.parse(f.iniciaAt) <= ahora()) return { ok: false, error: 'funcion_pasada' };
      const s = saldoDe(r);
      if (s.saldo <= 0) return { ok: false, error: 'sin_saldo' };
      if (ahora() >= Date.parse(s.plazo_at)) return { ok: false, error: 'saldo_vencido' };
      vence = Math.min(vence, Date.parse(s.plazo_at));
      montos.push(s.saldo);
    }
    for (const p of pagos.values()) {
      if (p.estado === 'pendiente' && p.concepto === 'saldo' && p.reservas.some((id) => ids.includes(id))) p.estado = 'vencido';
    }
    const pago: PagoEnMemoria = {
      id: nuevoId(), concepto: 'saldo', reservas: orden.map((r) => r.id), montos, estado: 'pendiente',
      monto: montos.reduce((s, m) => s + m, 0), venceAt: vence, referencia: null,
    };
    pagos.set(pago.id, pago);
    return { ok: true, dato: { pago_id: pago.id, monto_esperado: pago.monto, vence_at: new Date(vence).toISOString(), reservas: pago.reservas } };
  }

  async function vincularLink(pagoId: string, referencia: string): ReturnType<PuertoFunciones['vincularLink']> {
    const p = pagos.get(pagoId);
    if (!p) return { ok: false, error: 'error_base' };
    if (p.referencia !== null && p.referencia !== referencia) return { ok: false, error: 'pago_con_link' };
    p.referencia = referencia;
    return { ok: true, dato: null };
  }

  function foto(r: ReservaEnMemoria, repetida: boolean): ResultadoApartar {
    return {
      ok: true, reservaId: r.id, estado: r.estado, venceAt: new Date(r.venceAt).toISOString(), repetida, campanaId: r.campanaId,
      tarifa: r.tarifa, precioUnitario: r.precioUnitario, montoTotal: r.montoTotal, montoReserva: montoReserva(r),
      permitePagoTotal: r.permitePagoTotal,
    };
  }

  return {
    puerto,
    /** Los pagos preparados, para que el arnés los mire. */
    pagos: () => [...pagos.values()].map((p) => ({ ...p, reservas: [...p.reservas], montos: [...p.montos] })),
    /**
     * Lo que hace el aviso aprobado de la pasarela con el monto esperado: el inicial confirma sus apartados vigentes
     * (el doble no modela `pendiente_persona`); el del saldo solo suma a lo pagado.
     */
    aprobarPago(pagoId: string) {
      const p = pagos.get(pagoId);
      if (!p || p.estado !== 'pendiente') return;
      if (p.concepto === 'inicial') {
        for (const id of p.reservas) {
          const r = reservas.find((x) => x.id === id);
          if (r && vigente(r)) r.estado = 'confirmada';
        }
      }
      p.estado = 'aprobado';
    },
    /** Lo que haría el aviso de la pasarela con un pago fallido o vencido: deja de estar pendiente. */
    cerrarPago(pagoId: string, estado: 'fallido' | 'vencido') {
      const p = pagos.get(pagoId);
      if (p) p.estado = estado;
    },
    agregarCampana(c: CampanaEnMemoria) {
      campanas.set(c.id, { estado: 'activa', publicada: true, permitePagoTotal: true, ...c, codigo: c.codigo.toUpperCase() });
    },
    /** Lo que hace el equipo en el ⋮ de la campaña (`funcion_guardar_anuncio`). */
    asociarAnuncio(campanaId: string, adId: string) {
      const c = campanas.get(campanaId);
      if (c) anuncios.set(`${c.workspaceId}|${adId}`, campanaId);
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
        origen: 'equipo', tarifa: 'completa', precioUnitario: 1, montoTotal: personas, abonoUnitario: null, permitePagoTotal: true,
        diasSaldoAntes: 1, modalidad: null, montoAPagar: null, propuesta: null, conversacion: null, realineada: false,
      });
      return true;
    },
    /** Registra una respuesta a la autorización general: la última manda, como en la base. */
    autorizar(llave: LlaveConversacion, respuesta: 'si' | 'no') {
      autorizaciones.set(llaveTexto(llave), respuesta);
    },
    /** Lo que quedó apartado, para que el arnés lo mire (nunca trae mesa, puesto ni monto del asistente). */
    reservas: () => reservas.map((r) => ({ ...r, propuesta: r.propuesta ? structuredClone(r.propuesta) : null })),
    /** Para probar el plazo del saldo sin reloj: cambia la foto del plazo de una reserva. */
    cambiarPlazo(reservaId: string, dias: number) {
      const r = reservas.find((x) => x.id === reservaId);
      if (r) r.diasSaldoAntes = dias;
    },
    /** Para probar el vencimiento sin reloj: deja vencido un apartado. */
    vencer(reservaId: string) {
      const r = reservas.find((x) => x.id === reservaId);
      if (r) r.venceAt = ahora() - 1;
    },
  };
}
