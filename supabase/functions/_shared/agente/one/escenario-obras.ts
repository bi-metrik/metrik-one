// ============================================================
// Modo obras — un mundo de prueba y su escenario (pruebas y arnés)
// ------------------------------------------------------------
// Obras, rubros, operarios y facturas INVENTADOS (ninguna es una obra creada en ONE): «Reserva de Potosí» y «RCN Calle
// 26» toman los nombres de clientes que el diseño usa de ejemplo; «Edif. Calle 93» es inventada. Los pantallazos son
// lecturas guionadas por media id (el lector no se llama en las pruebas).
// ============================================================

import type { ConfigAgente } from '../config.ts';
import type { LecturaAdjunto, Modelo, Reglamento } from '../tipos.ts';
import { escenarioOne } from './escenario.ts';
import { atenderPendientes } from '../cola.ts';
import type { EscenarioOne } from './escenario.ts';
import type { Lector } from './lectura-adjunto.ts';
import { dominioObras } from './obras.ts';
import { dominioOperario, sinPesos } from './operario.ts';
import { PuertoObrasMemoria } from './puerto-obras-memoria.ts';
import type { FacturaMem, LlegadaMem, ObraMem, OperarioMem, PagoMem } from './puerto-obras-memoria.ts';
import { reglamentoObras, reglamentoOperario } from './reglamento-obras.ts';
import type { RubroOne } from './obras-comun.ts';

export const EMPRESA_PRUEBA = 'Impermeables de Prueba';

export const OBRAS_PRUEBA: ObraMem[] = [
  { id: 'o-potosi', codigo: 'R1 26 1', nombre: 'Reserva de Potosí', nombre_corto: 'Potosí', empresa: 'Conjunto Reserva de Potosí', etapa: 'ejecucion', vendido: 48_000_000 },
  { id: 'o-rcn', codigo: 'C1 26 2', nombre: 'RCN Calle 26', nombre_corto: 'RCN Calle 26', empresa: 'Canal de Prueba', etapa: 'ejecucion', vendido: 30_000_000 },
  { id: 'o-93', codigo: 'F1 26 1', nombre: 'Edificio Calle 93', nombre_corto: 'Calle 93', empresa: 'Federación de Prueba', etapa: 'cobro', vendido: 50_000_000 },
];

export const RUBROS_PRUEBA: RubroOne[] = [
  { id: 'r-mat', nombre: 'Materiales', descripcion: 'lo que se aplica en la obra', ejemplos: 'sellante, membrana, primer, cemento', categoria: 'materiales' },
  { id: 'r-mox', nombre: 'Mano de obra externa', descripcion: 'contratistas y ayudantes por fuera de la nómina', ejemplos: 'el de la grúa, el soldador', categoria: 'servicios_profesionales' },
  { id: 'r-tra', nombre: 'Transporte', descripcion: 'llevar gente y material a la obra', ejemplos: 'gasolina, acarreo, peajes', categoria: 'transporte' },
  { id: 'r-equ', nombre: 'Equipos', descripcion: 'alquiler de equipos', ejemplos: 'andamio, grúa, caldera', categoria: 'otros' },
  { id: 'r-otr', nombre: 'Otros de obra', descripcion: 'lo demás de la obra', ejemplos: 'almuerzos de obra, papelería de obra', categoria: 'otros' },
];

export const OPERARIOS_PRUEBA: OperarioMem[] = [
  { id: 'op-pedro', nombre: 'Pedro', valores: [{ valor: 140_000, desde: '2026-01-01' }] },
  { id: 'op-jhon', nombre: 'Jhon', valores: [{ valor: 120_000, desde: '2026-01-01' }] },
  { id: 'op-luis', nombre: 'Luis', valores: [{ valor: 130_000, desde: '2026-01-01' }, { valor: 150_000, desde: '2026-10-15' }] },
];

export const FACTURAS_PRUEBA: FacturaMem[] = [
  { id: 'f-231', numero: 'FE-231', fecha: '2026-10-15', monto: 25_000_000, negocio_id: 'o-93', estado: 'abierta' },
];

/** Un pantallazo de Bancolombia de $1.850.000 del 20-oct, transacción 0004587123. */
export const PANTALLAZO_SELLANTE: LecturaAdjunto = { legible: true, monto: 1_850_000, fecha: '2026-10-20', comercio: 'Bancolombia', nit: null, numero_transaccion: '0004587123', descripcion: 'transferencia a Sellantes de Prueba' };

/** Un lector guionado: lo que «dice» cada media id. Sin entrada, ilegible. */
export function lectorGuionado(lecturas: Record<string, LecturaAdjunto>): Lector {
  return async (a) => {
    const k = new TextDecoder().decode(a.bytes);
    return lecturas[k] ?? { legible: false, monto: null, fecha: null, comercio: null, nit: null, numero_transaccion: null, descripcion: null };
  };
}

export interface MundoObras {
  obras?: ObraMem[];
  rubros?: RubroOne[];
  operarios?: OperarioMem[];
  facturas?: FacturaMem[];
  pagos?: PagoMem[];
  llegadas?: LlegadaMem[];
}

export function puertoDePrueba(m: MundoObras = {}): PuertoObrasMemoria {
  return new PuertoObrasMemoria({
    obras: structuredClone(m.obras ?? OBRAS_PRUEBA), rubros: structuredClone(m.rubros ?? RUBROS_PRUEBA),
    operarios: structuredClone(m.operarios ?? OPERARIOS_PRUEBA), facturas: structuredClone(m.facturas ?? FACTURAS_PRUEBA),
    pagos: structuredClone(m.pagos ?? []), llegadas: structuredClone(m.llegadas ?? []),
  });
}

export interface EscenarioObras extends EscenarioOne {
  puerto: PuertoObrasMemoria;
  /** Un pantallazo: `lectura` es lo que el lector «lee» de él. Mismo `contenido` = la misma imagen (misma huella). */
  pantallazo(pie: string, lectura: LecturaAdjunto | null, o?: { despuesMs?: number; contenido?: string }): ReturnType<EscenarioOne['foto']>;
  /** Un pantallazo REENVIADO (la consignación que mandó un cliente), con su texto: es dato, nunca una orden. */
  reenvia(texto: string, lectura: LecturaAdjunto | null): Promise<void>;
}

/**
 * Gestión (Liliana en el diseño; aquí «Lina Gestión») o un operario. Mismo puerto para varios escenarios si se pasa
 * `puerto` (gestión y operarios escriben en la misma base, cada uno desde su teléfono).
 */
export async function escenarioObras(p: {
  modelo: Modelo;
  quien?: { operario: string } | 'gestion';
  puerto?: PuertoObrasMemoria;
  mundo?: MundoObras;
  lector?: Lector | null;
  config?: Partial<ConfigAgente>;
  reglamento?: Reglamento;
}): Promise<EscenarioObras> {
  const puerto = p.puerto ?? puertoDePrueba(p.mundo);
  const lecturas: Record<string, LecturaAdjunto> = {};
  const lector = p.lector === undefined ? lectorGuionado(lecturas) : p.lector;
  const operario = p.quien && p.quien !== 'gestion' ? puerto.operariosMem.find((x) => x.id === (p.quien as { operario: string }).operario) : null;
  const e = await escenarioOne({
    modelo: p.modelo,
    puerto,
    rol: operario ? 'colaborador' : 'admin',
    remitente: operario ? { nombre: operario.nombre, rol: 'operario' } : { nombre: 'Lina Gestión', rol: 'admin' },
    phone: operario ? `5730000${operario.id.length}${operario.id.charCodeAt(3)}` : undefined,
    config: p.config,
    reglamento: p.reglamento ?? (operario ? await reglamentoOperario(EMPRESA_PRUEBA) : await reglamentoObras(EMPRESA_PRUEBA)),
    lector,
    dominio: (pu, ahora) => operario
      ? dominioOperario(pu as PuertoObrasMemoria, { collaboratorId: operario.id, nombre: operario.nombre, ahora })
      : dominioObras(pu as PuertoObrasMemoria, { rol: 'admin', empresa: EMPRESA_PRUEBA, urlApp: 'https://prueba.metrikone.co', ahora, lector }),
    ...(operario ? { guardaTexto: sinPesos } : {}),
  });
  let n = 0;
  return Object.assign(e, {
    puerto,
    pantallazo(pie: string, lectura: LecturaAdjunto | null, o: { despuesMs?: number; contenido?: string } = {}) {
      const contenido = o.contenido ?? `pantallazo-${++n}-${Math.random().toString(36).slice(2, 8)}`;
      if (lectura) lecturas[contenido] = lectura;
      return e.foto(pie, { despuesMs: o.despuesMs, archivo: { bytes: new TextEncoder().encode(contenido), mime: 'image/jpeg' } });
    },
    async reenvia(texto: string, lectura: LecturaAdjunto | null) {
      const contenido = `reenvio-${++n}`;
      const id = `media-fw-${n}`;
      if (lectura) lecturas[contenido] = lectura;
      puerto.archivos.set(id, { bytes: new TextEncoder().encode(contenido), mime: 'image/jpeg' });
      e.reloj.avanzar(5_000);
      e.almacen.entrante({ workspaceId: e.deps.workspaceId, phone: e.deps.phone, clase: 'reenvio', texto: texto || null, media: { tipo: 'imagen', id } });
      await atenderPendientes(e.deps);
    },
  });
}
