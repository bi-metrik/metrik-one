// ============================================================
// Modo obras — el puerto en memoria (pruebas y arnés), con la misma forma que `puerto-obras-supabase.ts`
// ------------------------------------------------------------
// Obras, rubros, pagos, ingresos, facturas, operarios y llegadas de juguete (datos INVENTADOS). Lo escrito queda en
// `escrituras`, la verdad contra la que califica el arnés. Los invariantes de la base se imitan aquí (una llegada por
// obra y día, máximo dos obras por día, el valor de la jornada vigente copiado) para que el arnés pruebe lo mismo que
// la migración.
// ============================================================

import { PuertoOneMemoria } from './puerto-memoria.ts';
import type { NegocioMem } from './puerto-memoria.ts';
import type { SoporteGuardado } from './dominio.ts';
import type { CierreObraOne, FacturaOne, LlegadaOne, ObraOne, OperarioOne, PuertoObras, RegistroOne, RubroOne } from './obras-comun.ts';

export interface ObraMem extends ObraOne { vendido: number; activa?: boolean }
export interface PagoMem { id: string; fecha: string; monto: number; negocio_id: string | null; rubro_id: string | null; categoria: string; numero: string | null; huella: string | null; descripcion: string | null; revisado?: boolean; repetido?: boolean }
export interface IngresoMem { id: string; fecha: string; monto: number; negocio_id: string; factura_id: string | null; numero: string | null; huella: string | null; repetido?: boolean }
export interface FacturaMem { id: string; numero: string; fecha: string; monto: number; negocio_id: string; estado: 'abierta' | 'pagada' }
export interface OperarioMem extends OperarioOne { valores?: Array<{ valor: number; desde: string }> }
export interface LlegadaMem { id: string; collaborator_id: string; negocio_id: string; fecha: string; hora: string; valor: number | null }

const llave = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export class PuertoObrasMemoria extends PuertoOneMemoria implements PuertoObras {
  obras: ObraMem[];
  rubrosMem: RubroOne[];
  pagos: PagoMem[];
  ingresos: IngresoMem[];
  facturas: FacturaMem[];
  operariosMem: OperarioMem[];
  llegadasMem: LlegadaMem[];
  mensajes = { total: 0, gestion: 0, operario: 0 };
  private k = 0;

  constructor(p: { obras?: ObraMem[]; rubros?: RubroOne[]; pagos?: PagoMem[]; ingresos?: IngresoMem[]; facturas?: FacturaMem[]; operarios?: OperarioMem[]; llegadas?: LlegadaMem[] } = {}) {
    const obras = p.obras ?? [];
    super({ negocios: obras.map((o): NegocioMem => ({ id: o.id, codigo: o.codigo, nombre: o.nombre, empresa: o.empresa, contacto: null, etapa: o.etapa, valor: o.vendido })) });
    this.obras = obras;
    this.rubrosMem = p.rubros ?? [];
    this.pagos = p.pagos ?? [];
    this.ingresos = p.ingresos ?? [];
    this.facturas = p.facturas ?? [];
    this.operariosMem = p.operarios ?? [];
    this.llegadasMem = p.llegadas ?? [];
  }

  private nid(prefijo: string) { return `${prefijo}-${++this.k}`; }
  private activas() { return this.obras.filter((o) => o.activa !== false); }
  private nombreObra(id: string | null) { return id ? this.obras.find((o) => o.id === id)?.nombre ?? null : null; }
  private sop(mediaId: string | null, ref: string | null): SoporteGuardado { return ref || mediaId ? (mediaId && this.mediaRota.has(mediaId) && !ref ? 'fallo' : 'guardado') : 'sin'; }

  async obrasActivas(): Promise<ObraOne[] | 'error'> { return this.caida ? 'error' : this.activas(); }
  async obraPorCodigo(codigo: string): Promise<ObraOne | null | 'error'> {
    if (this.caida) return 'error';
    return this.activas().find((o) => llave(o.codigo) === llave(codigo)) ?? null;
  }
  async rubros(): Promise<RubroOne[] | 'error'> { return this.caida ? 'error' : this.rubrosMem; }

  private reg(x: PagoMem | IngresoMem, tipo: 'pago' | 'ingreso'): RegistroOne {
    const rubro = 'rubro_id' in x ? this.rubrosMem.find((r) => r.id === x.rubro_id) : undefined;
    const f = 'factura_id' in x ? this.facturas.find((y) => y.id === x.factura_id) : undefined;
    return {
      tipo, id: x.id, fecha: x.fecha, monto: x.monto, negocio_id: x.negocio_id, obra: this.nombreObra(x.negocio_id), numero: x.numero,
      ...(rubro ? { rubro_id: rubro.id, rubro: rubro.nombre } : {}), ...('categoria' in x ? { categoria: x.categoria, descripcion: x.descripcion, revisado: x.revisado } : {}),
      ...(f ? { factura_id: f.id, factura: f.numero } : {}),
    };
  }

  async pagosConNumero(numero: string): Promise<RegistroOne[] | 'error'> {
    return [...this.pagos.filter((x) => x.numero === numero).map((x) => this.reg(x, 'pago')), ...this.ingresos.filter((x) => x.numero === numero).map((x) => this.reg(x, 'ingreso'))];
  }
  async pagosConHuella(huella: string): Promise<RegistroOne[] | 'error'> {
    return [...this.pagos.filter((x) => x.huella === huella).map((x) => this.reg(x, 'pago')), ...this.ingresos.filter((x) => x.huella === huella).map((x) => this.reg(x, 'ingreso'))];
  }

  private fact(f: FacturaMem): FacturaOne {
    const recibido = this.ingresos.filter((i) => i.factura_id === f.id).reduce((a, i) => a + i.monto, 0);
    return { id: f.id, numero: f.numero, fecha: f.fecha, monto: f.monto, negocio_id: f.negocio_id, obra: this.nombreObra(f.negocio_id), recibido, estado: f.estado };
  }
  async facturasAbiertas(negocioId: string | null): Promise<FacturaOne[] | 'error'> {
    return this.facturas.filter((f) => f.estado === 'abierta' && (!negocioId || f.negocio_id === negocioId)).map((f) => this.fact(f));
  }
  async facturasConNumero(numero: string): Promise<FacturaOne[] | 'error'> {
    return this.facturas.filter((f) => f.numero.toLowerCase() === numero.toLowerCase()).map((f) => this.fact(f));
  }

  async registrarPago(p: Parameters<PuertoObras['registrarPago']>[0]) {
    const id = this.nid('pago');
    const soporte = this.sop(p.mediaId, p.ref);
    this.pagos.push({ id, fecha: p.fecha, monto: p.monto, negocio_id: p.negocioId, rubro_id: p.rubroId, categoria: p.categoria, numero: p.numero, huella: p.huella, descripcion: p.descripcion, repetido: p.repetido });
    const obra = this.obras.find((o) => o.id === p.negocioId);
    this.escrituras.push({ tipo: 'gasto', id, monto: p.monto, negocio: obra?.codigo ?? null, fecha: p.fecha, rubro: this.rubrosMem.find((r) => r.id === p.rubroId)?.nombre ?? null, categoria: p.categoria, numero: p.numero, repetido: p.repetido, soporte: soporte === 'guardado', huella_propuesta: p.propuestaHuella });
    return { id, soporte };
  }
  async registrarIngreso(p: Parameters<PuertoObras['registrarIngreso']>[0]) {
    const id = this.nid('ingreso');
    this.ingresos.push({ id, fecha: p.fecha, monto: p.monto, negocio_id: p.negocioId, factura_id: p.facturaId, numero: p.numero, huella: p.huella, repetido: p.repetido });
    this.escrituras.push({ tipo: 'ingreso', id, monto: p.monto, negocio: this.obras.find((o) => o.id === p.negocioId)?.codigo ?? null, factura: this.facturas.find((f) => f.id === p.facturaId)?.numero ?? null, fecha: p.fecha, numero: p.numero });
    return { id, soporte: this.sop(p.mediaId, p.ref) };
  }
  async registrarFactura(p: Parameters<PuertoObras['registrarFactura']>[0]) {
    const id = this.nid('factura');
    this.facturas.push({ id, numero: p.numero, fecha: p.fecha, monto: p.monto, negocio_id: p.negocioId, estado: 'abierta' });
    this.escrituras.push({ tipo: 'factura', id, numero: p.numero, monto: p.monto, negocio: this.obras.find((o) => o.id === p.negocioId)?.codigo ?? null, fecha: p.fecha });
    return { id, soporte: this.sop(p.mediaId, p.ref) };
  }

  async buscarRegistros(p: Parameters<PuertoObras['buscarRegistros']>[0]): Promise<RegistroOne[] | 'error'> {
    const cerca = (m: number) => p.monto === null || Math.abs(m - p.monto) <= p.monto * 0.05;
    if (p.tipo === 'factura') {
      return this.facturas.filter((f) => f.fecha >= p.desde && cerca(f.monto) && (!p.negocioId || f.negocio_id === p.negocioId))
        .map((f) => ({ tipo: 'factura' as const, id: f.id, fecha: f.fecha, monto: f.monto, negocio_id: f.negocio_id, obra: this.nombreObra(f.negocio_id), numero: f.numero }));
    }
    const xs = p.tipo === 'pago' ? this.pagos : this.ingresos;
    return xs.filter((x) => x.fecha >= p.desde && cerca(x.monto) && (!p.negocioId || x.negocio_id === p.negocioId)).slice(-p.limite).reverse().map((x) => this.reg(x, p.tipo as 'pago' | 'ingreso'));
  }
  async registro(tipo: RegistroOne['tipo'], id: string): Promise<RegistroOne | null | 'error'> {
    if (tipo === 'factura') {
      const f = this.facturas.find((x) => x.id === id);
      return f ? { tipo, id, fecha: f.fecha, monto: f.monto, negocio_id: f.negocio_id, obra: this.nombreObra(f.negocio_id), numero: f.numero } : null;
    }
    const x = (tipo === 'pago' ? this.pagos : this.ingresos).find((y) => y.id === id);
    return x ? this.reg(x, tipo) : null;
  }
  async corregirRegistro(p: Parameters<PuertoObras['corregirRegistro']>[0]) {
    const c = p.cambios;
    const x = (p.tipo === 'pago' ? this.pagos : p.tipo === 'ingreso' ? this.ingresos : this.facturas).find((y) => y.id === p.id) as Record<string, unknown> | undefined;
    if (!x) throw new Error('no existe');
    if (x.revisado) throw new Error('ya se revisó');
    if (c.negocioId !== undefined) x.negocio_id = c.negocioId;
    if (c.rubroId !== undefined) x.rubro_id = c.rubroId;
    if (c.categoria !== undefined) x.categoria = c.categoria;
    if (c.fecha !== undefined) x.fecha = c.fecha;
    if (c.monto !== undefined) x.monto = c.monto;
    if (c.facturaId !== undefined) x.factura_id = c.facturaId;
    this.escrituras.push({ tipo: 'correccion', registro: p.tipo, id: p.id, cambios: c });
  }

  private valorDe(collaboratorId: string, fecha: string): number | null {
    const vs = (this.operariosMem.find((o) => o.id === collaboratorId)?.valores ?? []).filter((v) => v.desde <= fecha).sort((a, b) => b.desde.localeCompare(a.desde));
    return vs[0]?.valor ?? null;
  }

  private cierre(o: ObraMem): CierreObraOne {
    const ps = this.pagos.filter((x) => x.negocio_id === o.id);
    const porRubro = new Map<string, number>();
    for (const x of ps) {
      const r = this.rubrosMem.find((y) => y.id === x.rubro_id)?.nombre ?? x.categoria;
      porRubro.set(r, (porRubro.get(r) ?? 0) + x.monto);
    }
    const orden = (r: string) => { const i = this.rubrosMem.findIndex((y) => y.nombre === r); return i < 0 ? 1000 : i; };
    let mano = 0; let jornadas = 0; let sinValor = 0;
    for (const l of this.llegadasMem.filter((x) => x.negocio_id === o.id)) {
      const n = this.llegadasMem.filter((y) => y.collaborator_id === l.collaborator_id && y.fecha === l.fecha).length;
      jornadas += 1 / n;
      if (l.valor === null) sinValor++; else mano += l.valor / n;
    }
    const gastos = ps.reduce((a, x) => a + x.monto, 0);
    const cobrado = this.ingresos.filter((x) => x.negocio_id === o.id).reduce((a, x) => a + x.monto, 0);
    const fs = this.facturas.filter((f) => f.negocio_id === o.id).map((f) => this.fact(f));
    const retenido = fs.filter((f) => f.estado === 'pagada').reduce((a, f) => a + (f.monto - f.recibido), 0);
    return {
      negocio_id: o.id, codigo: o.codigo, nombre: o.nombre, nombre_corto: o.nombre_corto, estado: 'abierto', vendido: o.vendido,
      por_rubro: [...porRubro.entries()].sort((a, b) => orden(a[0]) - orden(b[0])).map(([rubro, total]) => ({ rubro, total })),
      gastos_total: gastos, mano_obra: mano, jornadas, jornadas_sin_valor: sinValor, utilidad: o.vendido - gastos - mano,
      facturado: fs.reduce((a, f) => a + f.monto, 0), cobrado, retenido, por_cobrar: o.vendido - cobrado - retenido,
    };
  }
  async cierreObra(negocioId: string): Promise<CierreObraOne | null | 'error'> {
    if (this.caida) return 'error';
    const o = this.obras.find((x) => x.id === negocioId);
    return o ? this.cierre(o) : null;
  }
  async cierresActivos(): Promise<CierreObraOne[] | 'error'> { return this.caida ? 'error' : this.activas().map((o) => this.cierre(o)); }

  async llegadas(p: Parameters<PuertoObras['llegadas']>[0]): Promise<LlegadaOne[] | 'error'> {
    if (this.caida) return 'error';
    return this.llegadasMem
      .filter((l) => l.fecha >= p.desde && l.fecha <= p.hasta && (!p.negocioId || l.negocio_id === p.negocioId) && (!p.collaboratorId || l.collaborator_id === p.collaboratorId))
      .map((l) => {
        const o = this.obras.find((x) => x.id === l.negocio_id);
        return { id: l.id, collaborator_id: l.collaborator_id, persona: this.operariosMem.find((x) => x.id === l.collaborator_id)?.nombre ?? '?', negocio_id: l.negocio_id, obra: o ? (o.nombre_corto || o.nombre) : '?', fecha: l.fecha, hora: l.hora };
      });
  }
  async operarios(): Promise<OperarioOne[] | 'error'> { return this.operariosMem.map(({ id, nombre }) => ({ id, nombre })); }
  async mensajesDelMes(): Promise<{ total: number; gestion: number; operario: number } | 'error'> { return this.mensajes; }

  async registrarLlegada(p: Parameters<PuertoObras['registrarLlegada']>[0]): Promise<{ id: string }> {
    const del = this.llegadasMem.filter((l) => l.collaborator_id === p.collaboratorId && l.fecha === p.fecha);
    if (del.some((l) => l.negocio_id === p.negocioId)) throw new Error('llegada repetida (unique)');
    if (new Set(del.map((l) => l.negocio_id)).size >= 2) throw new Error('llegada: ya hay dos obras ese día');
    const id = this.nid('llegada');
    this.llegadasMem.push({ id, collaborator_id: p.collaboratorId, negocio_id: p.negocioId, fecha: p.fecha, hora: p.hora, valor: this.valorDe(p.collaboratorId, p.fecha) });
    this.escrituras.push({ tipo: 'llegada', id, collaborator_id: p.collaboratorId, negocio: this.obras.find((o) => o.id === p.negocioId)?.codigo ?? null, fecha: p.fecha, hora: p.hora });
    return { id };
  }
  async cambiarLlegada(p: Parameters<PuertoObras['cambiarLlegada']>[0]): Promise<void> {
    const l = this.llegadasMem.find((x) => x.id === p.llegadaId);
    if (!l) throw new Error('no existe');
    l.negocio_id = p.negocioId;
    l.hora = p.hora;
    this.escrituras.push({ tipo: 'llegada_cambiada', id: l.id, collaborator_id: l.collaborator_id, negocio: this.obras.find((o) => o.id === p.negocioId)?.codigo ?? null, fecha: l.fecha });
  }
}
