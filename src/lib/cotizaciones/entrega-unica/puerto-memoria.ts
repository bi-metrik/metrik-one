import type { Pantallazo } from '@/lib/cotizaciones/asistente/armar-con-modelo'
import type { Requisitos } from './esquema'
import type { ConfigEntrega, Entrega, EstadoEntrega, Pieza, PuertoEntrega } from './flujo'

/**
 * El puerto en memoria: la base de ONE de mentira para las pruebas y el QA de la entrega única. No toca
 * Supabase. Lo que «escribe» queda en `estado` para revisarlo (clientes, viajes con su etapa, cotizaciones,
 * historial de etapas con su hora y los PDF).
 */

export interface EstadoMemoria {
  entregas: Map<string, Entrega>
  piezas: Pieza[]
  clientes: { id: string; nombre: string }[]
  viajes: { id: string; contactoId: string | null; responsableStaffId: string | null; etapa: 'Solicitud' | 'Cotización'; modalidad: 'bloqueo'; requisitos: Requisitos }[]
  cotizaciones: { id: string; negocioId: string; consecutivo: string; estado: 'borrador'; totales: Record<string, number>; tarifa: string | null; conBorrador: boolean }[]
  historialEtapas: { negocioId: string; de: string | null; a: string; en: string }[]
  pdfs: { ref: string; nombre: string; bytes: number; pdf: Uint8Array }[]
}

export function puertoEnMemoria(p: {
  config: ConfigEntrega
  pantallazos: Map<string, Pantallazo>
  clientes?: { id: string; nombre: string }[]
  /** Reloj: por defecto el real. */
  ahora?: () => Date
  /** Si no se pasa, el PDF es de mentira (bytes vacíos). */
  renderPdf?: PuertoEntrega['renderPdf']
}): PuertoEntrega & { estado: EstadoMemoria } {
  let n = 0
  const id = (pre: string) => `${pre}-${++n}`
  let consecutivo = 100
  const ahora = p.ahora ?? (() => new Date())
  const estado: EstadoMemoria = { entregas: new Map(), piezas: [], clientes: [...(p.clientes ?? [])], viajes: [], cotizaciones: [], historialEtapas: [], pdfs: [] }
  const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()

  return {
    estado,
    ahora,
    async config() { return p.config },
    async leerEntrega(i) { const e = estado.entregas.get(i); return e ? structuredClone(e) : null },
    async tomar(i, de: EstadoEntrega[], a) {
      const e = estado.entregas.get(i)
      if (!e || !de.includes(e.estado)) return false
      e.estado = a
      return true
    },
    async guardarEntrega(i, cambios) { Object.assign(estado.entregas.get(i)!, structuredClone(cambios)) },
    async piezas(i) { return estado.piezas.filter(x => x.entregaId === i) },
    async leerPantallazo(ref) {
      const x = p.pantallazos.get(ref)
      if (!x) throw new Error(`Pantallazo ${ref} no existe`)
      return x
    },
    async buscarCliente(_ws, nombre) {
      const c = estado.clientes.filter(x => norm(x.nombre) === norm(nombre))
      return c.length === 1 ? { id: c[0].id } : null
    },
    async abrirViaje(e, r, contactoId) {
      const v = { id: id('negocio'), contactoId, responsableStaffId: e.staffId, etapa: 'Solicitud' as const, modalidad: 'bloqueo' as const, requisitos: r }
      estado.viajes.push(v)
      const en = ahora().toISOString()
      estado.historialEtapas.push({ negocioId: v.id, de: null, a: 'Solicitud', en })
      return { negocioId: v.id, responsableStaffId: v.responsableStaffId, en }
    },
    async actualizarViaje(negocioId, r) { estado.viajes.find(v => v.id === negocioId)!.requisitos = r },
    async moverACotizacion(negocioId) {
      const v = estado.viajes.find(x => x.id === negocioId)!
      const en = ahora().toISOString()
      estado.historialEtapas.push({ negocioId, de: v.etapa, a: 'Cotización', en })
      v.etapa = 'Cotización'
      return { en }
    },
    async siguienteConsecutivo() { return `COT-2026-${String(++consecutivo).padStart(4, '0')}` },
    async guardarCotizacion(e, c) {
      const ya = estado.cotizaciones.find(x => x.id === e.cotizacionId)
      const fila = { negocioId: c.negocioId, consecutivo: c.consecutivo, estado: 'borrador' as const, totales: c.totales as Record<string, number>, tarifa: c.tarifa, conBorrador: !!c.borrador }
      if (ya) { Object.assign(ya, fila); return ya.id }
      const nueva = { id: id('cotizacion'), ...fila }
      estado.cotizaciones.push(nueva)
      return nueva.id
    },
    async renderPdf(e, x) {
      if (p.renderPdf) return p.renderPdf(e, x)
      return { pdf: new Uint8Array(), nombre: `Cotización ${e.codigo}.pdf` }
    },
    async subirPdf(e, nombre, pdf) {
      const ref = `memoria://${e.id}/${nombre}`
      estado.pdfs.push({ ref, nombre, bytes: pdf.byteLength, pdf })
      return { ref, url: `https://ejemplo.invalid/${encodeURIComponent(nombre)}` }
    },
    async enlaceRevision(e) { return `https://trappvel.metrikone.co/negocios/entrega/${e.id}` },
  }
}

/** Un `Entrega` nueva en `recibiendo` (lo que hace el webhook al abrir un pedido). */
export function entregaNueva(i: string, ws: string, staffId: string | null, telefono: string, en: string): Entrega {
  return {
    id: i, workspaceId: ws, staffId, telefono, estado: 'recibiendo', codigo: null, negocioId: null, cotizacionId: null,
    contactoId: null, salida: null, preguntas: [], resueltas: [], tipoConfirmado: false, validacion: null, pdfRef: null,
    tiempos: { primerMensaje: en }, uso: [], error: null,
  }
}
