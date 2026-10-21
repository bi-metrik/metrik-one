// ============================================================
// Dominio ONE en modo obras — gestión (quien registra pagos, ingresos y facturas, y consulta), 2026-10-21
// ------------------------------------------------------------
// Diseño: proyectos/imperviun/proyecto-360/docs/diseno/asistente-whatsapp.md, §3.1, §3.2, §3.4 a §3.7, §4, §5.
// Sobre el dominio ONE de siempre (soportes que se bajan, guardan y leen al llegar; actividades; contactos), cambia:
//   · `pagos` (C1, C2, C3, C19, C22, D2, D3): una propuesta con varias partidas y una sola huella. Cada partida con su
//     obra activa (o «Gasto de empresa», solo si la persona lo tocó), su rubro del workspace, su fecha (la del
//     pantallazo; si no hay, la dicha; si no, la del mensaje, y se avisa) y su número de transacción leído. Un mismo
//     pantallazo en dos partidas solo si suman exactamente lo que dice (D3). Número o imagen ya registrados: se
//     pregunta en la propia propuesta ([Es otro pago] / [Es el mismo]), no se bloquea.
//   · `ingreso` (C4): a la obra y, si hay facturas abiertas de esa obra, a la que paga.
//   · `factura` (C16): número, fecha, total y obra. Marcarla pagada y lo retenido son de la plataforma (D1).
//   · `corregir` (C14): cualquier campo de un pago, un ingreso o una factura, buscado en la base, con antes y después.
//   · lecturas: `ver_obra` (C15, el cierre completo de la base), `asistencia` (C23, D12), `facturas_abiertas`,
//     `buscar_registros`, `uso_del_mes` (§5).
// Lo que no cambia: nada se escribe sin el toque; toda cifra sale de una herramienta en ese turno; la confirmación
// (✅) la arma el código con una consulta hecha DESPUÉS de escribir.
// ============================================================

import { formatCOP } from '../../wa-format.ts';
import { renderizar } from '../render.ts';
import type { ContextoDominio, DeclaracionHerramienta, Dominio, Hechos, Propuesta, ResultadoHerramienta, Respuesta, Salida } from '../tipos.ts';
import { CATEGORIA_LABELS } from '../../types.ts';
import {
  LECTURAS_ONE, OPCION_EMPRESA, dominioOne, empresaDicha, fotosSinUsar, gastosDeLaConversacion, numeroDeFila, soporteDe, ultimaLista,
} from './dominio.ts';
import type { SoporteDeLaConversacion } from './dominio.ts';
import type { Lector } from './lectura-adjunto.ts';
import {
  MESES_LARGOS, diaBogota, diasDe, esDia, fechaCorta, horaBogota, obraCorta, rubroPorNombre,
} from './obras-comun.ts';
import type { CierreObraOne, FacturaOne, ObraOne, PuertoObras, RegistroOne, RubroOne } from './obras-comun.ts';
import { BOT_ONE } from './reglamento.ts';

export const ACCIONES_OBRAS = ['pagos', 'ingreso', 'factura', 'corregir', 'adjuntar_soporte', 'actividad', 'contacto_nuevo'];
const categorias = Object.keys(CATEGORIA_LABELS);
const MAX_PARTIDAS = 10;

type Resultado<T> = { ok: true; v: T } | { ok: false; error: string; candado: string };
const falla = (error: string, candado: string): { ok: false; error: string; candado: string } => ({ ok: false, error, candado });

/** «No es de Impervium» con el nombre del workspace, si cabe en un botón (≤ 20). Pura. */
export function botonNoEsDe(empresa: string): string {
  const t = `No es de ${empresa.trim()}`;
  return [...t].length <= 20 ? t : 'No es de la empresa';
}

const monto = (v: unknown): number => (typeof v === 'number' ? v : /^\d+$/.test(String(v ?? '').trim()) ? Number(v) : NaN);
const corto = (s: string, max: number) => ([...s].length <= max ? s : `${[...s].slice(0, max - 1).join('')}…`);
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : null);

// ── Lo que ve el modelo ──────────────────────────────────────────────────────

export const LECTURAS_OBRAS: DeclaracionHerramienta[] = [
  ...LECTURAS_ONE.filter((l) => l.name === 'buscar_negocios' || l.name === 'gastos_recientes'),
  {
    name: 'ver_obra',
    description: 'El resultado de una obra desde la base, al día de hoy: vendido, gastado por rubro, mano de obra (con jornadas), utilidad hasta hoy, cobrado y por cobrar, y el enlace para verla en ONE. Sin `codigo`: una línea por cada obra activa. Para «¿cómo va Potosí?», «¿cómo vamos?». No trae lo retenido: eso se ve en ONE. Solo lectura.',
    parameters: { type: 'object', properties: { codigo: { type: 'string', description: 'El código de la obra (de las obras activas del Estado o de buscar_negocios). Vacío = todas las activas.' } } },
  },
  {
    name: 'asistencia',
    description: 'Dónde MARCÓ LLEGADA cada operario (no dónde está ahora): por obra con la hora, y quién no ha marcado, para un día; o por obra y por persona con sus días, para un período. Sin pesos. Para «¿dónde está la gente hoy?», «¿dónde está Pedro?», «¿quién estuvo en Potosí la semana pasada?», «¿cuántos días lleva Pedro en octubre?». Solo lectura.',
    parameters: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'AAAA-MM-DD. Vacío = hoy.' },
        hasta: { type: 'string', description: 'AAAA-MM-DD. Vacío = igual a `desde` (un solo día).' },
        codigo: { type: 'string', description: 'Opcional: solo esa obra.' },
      },
    },
  },
  {
    name: 'facturas_abiertas',
    description: 'Las facturas abiertas (sin marcar pagadas en ONE) de una obra o de todas, con número, fecha, total y lo recibido. Solo lectura.',
    parameters: { type: 'object', properties: { codigo: { type: 'string', description: 'Opcional: el código de la obra.' } } },
  },
  {
    name: 'buscar_registros',
    description: 'Busca pagos, ingresos o facturas ya registrados (para corregir uno): por monto aproximado, por obra y por días hacia atrás. Devuelve id, fecha, monto, obra, rubro, factura y número de transacción. Solo lectura.',
    parameters: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['pago', 'ingreso', 'factura'] },
        monto: { type: 'number', description: 'Opcional: el monto que dijo la persona (busca ±5 %).' },
        dias: { type: 'number', description: 'Cuántos días hacia atrás (por defecto 30, máximo 120).' },
        codigo: { type: 'string', description: 'Opcional: la obra.' },
      },
      required: ['tipo'],
    },
  },
  {
    name: 'uso_del_mes',
    description: 'Cuántos mensajes van este mes de los que incluye el plan (cuentan los textos, notas de voz e imágenes que llegan al modelo; los toques no). Solo para «¿cuántos mensajes llevamos?». Solo lectura.',
    parameters: { type: 'object', properties: {} },
  },
];

export const CIERRES_OBRAS: DeclaracionHerramienta[] = [
  {
    name: 'preguntar_destino',
    description: 'Cuando falta la obra de un pago, un ingreso o una factura: el sistema manda la pregunta con las obras activas en orden y, para un pago, «Gasto de empresa» al final. Cierra el turno. No armes tú esa lista.',
    parameters: {
      type: 'object',
      properties: {
        para: { type: 'string', enum: ['pago', 'ingreso', 'factura', 'actividad'] },
        texto: { type: 'string', description: 'La pregunta en una línea, con lo que ya sabes («¿De qué obra es el pago de $1.850.000?»).' },
        reglas_usadas: { type: 'array', items: { type: 'string' } },
      },
      required: ['para', 'texto'],
    },
  },
  {
    name: 'preguntar_rubro',
    description: 'Cuando no sabes el rubro de un pago de obra y no son solo dos candidatos: el sistema manda la lista de rubros del workspace. Cierra el turno. Si dudas entre dos, pregunta tú con esas dos como `opciones` de `responder`.',
    parameters: {
      type: 'object',
      properties: { texto: { type: 'string', description: '«¿Qué rubro?» con lo que ya sabes.' }, reglas_usadas: { type: 'array', items: { type: 'string' } } },
      required: ['texto'],
    },
  },
];

const PARTIDA = {
  type: 'object',
  properties: {
    monto: { type: 'number', description: 'El valor en pesos (1.850.000 → 1850000). Con pantallazo, el del pantallazo salvo que la persona haya elegido otro.' },
    negocio: { type: 'string', description: 'El código de la obra (de las obras activas). Vacío si es gasto de empresa.' },
    empresa: { type: 'boolean', description: 'true = gasto de empresa (no es de ninguna obra). Solo si la persona tocó «Gasto de empresa» o lo dijo después de esa lista.' },
    empresa_dicho_en: { type: 'string', description: 'Gasto de empresa: el #n de esa respuesta.' },
    rubro: { type: 'string', description: 'El rubro de obra, tal cual de la lista del Estado. Gasto de empresa: vacío.' },
    categoria: { type: 'string', enum: categorias, description: 'Solo gasto de empresa (o un workspace sin rubros): la categoría.' },
    descripcion: { type: 'string', description: 'El concepto con las palabras de la persona («sellante»), corto, sin monto ni obra.' },
    fecha: { type: 'string', description: 'AAAA-MM-DD, solo si la persona la dijo («ayer», «el 15»). Con pantallazo manda la del pantallazo.' },
    soporte: { type: 'string', description: 'El #n del pantallazo o el PDF, si llegó uno. Un mismo #n en dos partidas solo si el pago se partió entre dos obras.' },
    otro_pago: { type: 'boolean', description: 'true solo si la persona ya dijo que es otro pago aunque repita el número de transacción.' },
    monto_elegido: { type: 'boolean', description: 'true solo si la persona eligió un valor distinto del que dice el pantallazo.' },
  },
};

const DATOS_PROPONER_OBRAS: Record<string, unknown> = {
  partidas: { type: 'array', items: PARTIDA, description: 'pagos: uno por pago (todo lo que llegó junto o sin confirmar va en la MISMA propuesta). Un pago partido entre dos obras = dos partidas con el mismo soporte que suman el pago.' },
  monto: { type: 'number', description: 'ingreso / factura: el valor. corregir: el valor nuevo, si cambia.' },
  negocio: { type: 'string', description: 'ingreso / factura / actividad: el código de la obra. corregir: la obra nueva, si cambia.' },
  factura: { type: 'string', description: 'ingreso: el número de la factura que paga (de facturas_abiertas). factura: el número de la factura emitida. corregir: la factura nueva de un ingreso.' },
  sin_factura: { type: 'boolean', description: 'ingreso: true si la persona dijo que no es de factura (un anticipo).' },
  fecha: { type: 'string', description: 'ingreso / factura: AAAA-MM-DD si la persona la dijo. corregir: la fecha nueva.' },
  soporte: { type: 'string', description: 'ingreso / factura: el #n del pantallazo o el PDF. adjuntar_soporte: ese #n.' },
  otro_pago: { type: 'boolean', description: 'factura: true si la persona ya dijo que es otra aunque repita número.' },
  monto_elegido: { type: 'boolean', description: 'ingreso / factura: true solo si la persona eligió un valor distinto del que dice el pantallazo o el PDF.' },
  tipo: { type: 'string', description: 'corregir: pago, ingreso o factura. actividad: llamada, reunion, correo, visita, mensaje o nota.' },
  id: { type: 'string', description: 'corregir: el id que devolvió buscar_registros.' },
  rubro: { type: 'string', description: 'corregir: el rubro nuevo de un pago.' },
  gasto: { type: 'string', description: 'adjuntar_soporte: el pago (G1, G2… del Estado).' },
  monto_distinto: { type: 'boolean', description: 'adjuntar_soporte: true si la persona ya dijo que va así aunque el monto leído sea otro.' },
  texto: { type: 'string', description: 'actividad: lo que pasó.' },
  nombre: { type: 'string', description: 'contacto_nuevo: el nombre.' },
  telefono: { type: 'string', description: 'contacto_nuevo: el celular, solo si lo escribió.' },
  cargo: { type: 'string' },
  decisor: { type: 'boolean' },
};

// ── Las partidas de un pago ──────────────────────────────────────────────────

export interface PartidaPago {
  monto: number;
  fecha: string;
  /** De dónde salió la fecha: el pantallazo, lo que dijo la persona o el día del mensaje. */
  fecha_de: 'soporte' | 'dicha' | 'mensaje';
  negocio_id: string | null;
  negocio: string | null;
  obra: string | null;
  obra_corta: string | null;
  rubro_id: string | null;
  rubro: string | null;
  categoria: string;
  descripcion: string | null;
  numero: string | null;
  repetido: boolean;
  /** Lo ya registrado con el mismo número o la misma imagen, en una línea. */
  repite: string | null;
  huella: string | null;
  foto: string | null;
  media_id: string | null;
  ref: string | null;
  soporte_n: number | null;
  /** Lo que pidió el modelo para esta partida (para volver a armarla). */
  args: Record<string, unknown>;
}

const lineaRegistro = (r: RegistroOne) => `${fechaCorta(r.fecha)} en ${r.obra ?? 'gasto de empresa'}${r.rubro ? `, ${r.rubro}` : ''}, ${formatCOP(r.monto)}`;

function lineaPartida(p: PartidaPago): string {
  const destino = p.obra ? `*${p.obra}*` : '*Gasto de empresa*';
  const rubro = p.rubro ? `, en *${p.rubro}*` : p.obra ? '' : ` (${CATEGORIA_LABELS[p.categoria] ?? p.categoria})`;
  return `*${formatCOP(p.monto)}* del ${fechaCorta(p.fecha)} a ${destino}${rubro}${p.descripcion ? ` (${corto(p.descripcion, 60)})` : ''}`;
}

function avisosPartida(p: PartidaPago, hoy: string): string[] {
  return [
    p.soporte_n === null ? 'No tengo el pantallazo; si lo mandas, le agrego el número de la transacción.' : p.numero ? `Transacción ${p.numero}.` : 'Sin número de transacción.',
    ...(p.fecha_de === 'mensaje' ? [`Fecha: la del mensaje (${fechaCorta(p.fecha === hoy ? hoy : p.fecha)}); no venía en el pantallazo.`] : []),
    ...(p.repite ? [`⚠️ Ese pago ya está registrado el ${p.repite}.`] : []),
  ];
}

// ── El dominio ───────────────────────────────────────────────────────────────

export interface OpcionesObras {
  rol: string;
  /** El nombre del workspace (el botón «No es de …»). */
  empresa: string;
  /** La URL base del workspace en ONE («https://x.metrikone.co»), para «Ver en ONE». */
  urlApp: string | null;
  ahora?: () => number;
  lector?: Lector | null;
}

export function dominioObras(puerto: PuertoObras, o: OpcionesObras): Dominio {
  const base = dominioOne(puerto, { rol: o.rol, ahora: o.ahora, lector: o.lector });
  const ahora = o.ahora ?? (() => Date.now());
  const hoy = () => diaBogota(ahora());
  const noEsDe = botonNoEsDe(o.empresa);
  const enlace = (negocioId: string) => (o.urlApp ? `${o.urlApp}/negocios/${negocioId}` : null);

  async function obraReal(codigo: unknown): Promise<Resultado<ObraOne>> {
    const c = String(codigo ?? '').trim();
    if (!c) return falla('Falta la obra: el código de una obra activa (Estado o buscar_negocios).', 'sin_obra');
    const ob = await puerto.obraPorCodigo(c);
    if (ob === 'error') return falla('No pude revisar la obra ahora. Dilo así, sin decir que no existe.', 'obra_no_leida');
    if (!ob) return falla(`No hay una obra activa con código «${c}». Las activas están en el Estado; si es una obra nueva, la oficina la crea primero en ONE (con su cotización y su contrato).`, 'obra_inexistente');
    return { ok: true, v: ob };
  }

  // ── Lecturas ──

  function datosCierre(c: CierreObraOne, conDetalle: boolean): Record<string, unknown> {
    const d: Record<string, unknown> = {
      obra: c.nombre, codigo: c.codigo, al: fechaCorta(hoy()),
      utilidad_hasta_hoy: formatCOP(c.utilidad), ...(pct(c.utilidad, c.vendido) ? { utilidad_pct: pct(c.utilidad, c.vendido) } : {}),
      vendido: formatCOP(c.vendido),
    };
    if (!conDetalle) return { ...d, gastado: formatCOP(c.gastos_total + c.mano_obra) };
    return {
      ...d,
      por_rubro: c.por_rubro.filter((r) => r.total > 0).map((r) => ({ rubro: r.rubro, total: formatCOP(r.total) })),
      mano_de_obra: formatCOP(c.mano_obra), jornadas: Number(c.jornadas.toFixed(1)),
      ...(c.jornadas_sin_valor ? { jornadas_sin_valor: c.jornadas_sin_valor } : {}),
      cobrado: formatCOP(c.cobrado), por_cobrar: formatCOP(c.por_cobrar),
      nota: 'Faltan los gastos que no se han registrado.',
      ...(enlace(c.negocio_id) ? { ver_en_one: enlace(c.negocio_id) } : {}),
    };
  }

  async function leer(nombre: string, args: Record<string, unknown>, ctx: ContextoDominio): Promise<ResultadoHerramienta> {
    if (nombre === 'buscar_negocios' || nombre === 'gastos_recientes') return base.leer(nombre, args, ctx);
    if (nombre === 'ver_obra') {
      if (args.codigo) {
        const ob = await obraReal(args.codigo);
        if (!ob.ok) return { ok: false, datos: null, error: ob.error };
        const c = await puerto.cierreObra(ob.v.id);
        if (c === 'error' || !c) return { ok: false, datos: null, error: 'No pude revisar la obra ahora. Di «no pude revisar ahora», sin cifras.' };
        return { ok: true, datos: datosCierre(c, true), sobre: ob.v.codigo };
      }
      const cs = await puerto.cierresActivos();
      if (cs === 'error') return { ok: false, datos: null, error: 'No pude revisar las obras ahora. Di «no pude revisar ahora», sin cifras.' };
      return { ok: true, datos: { al: fechaCorta(hoy()), obras: cs.map((c) => datosCierre(c, false)), ...(cs.length ? {} : { nota: 'No hay obras activas.' }) } };
    }
    if (nombre === 'asistencia') return await asistencia(args);
    if (nombre === 'facturas_abiertas') {
      let negocioId: string | null = null;
      if (args.codigo) {
        const ob = await obraReal(args.codigo);
        if (!ob.ok) return { ok: false, datos: null, error: ob.error };
        negocioId = ob.v.id;
      }
      const fs = await puerto.facturasAbiertas(negocioId);
      if (fs === 'error') return { ok: false, datos: null, error: 'No pude leer las facturas ahora.' };
      return { ok: true, datos: { facturas: fs.map(factParaModelo), ...(fs.length ? {} : { nota: 'No hay facturas abiertas.' }) } };
    }
    if (nombre === 'buscar_registros') {
      const tipo = ['pago', 'ingreso', 'factura'].includes(String(args.tipo)) ? args.tipo as RegistroOne['tipo'] : 'pago';
      const dias = Math.min(120, Math.max(1, Math.round(Number(args.dias) || 30)));
      let negocioId: string | null = null;
      if (args.codigo) {
        const ob = await obraReal(args.codigo);
        if (!ob.ok) return { ok: false, datos: null, error: ob.error };
        negocioId = ob.v.id;
      }
      const m = Number(args.monto);
      const desde = diaBogota(ahora() - (dias - 1) * 86400000);
      const rs = await puerto.buscarRegistros({ tipo, monto: Number.isFinite(m) && m > 0 ? m : null, desde, negocioId, limite: 8 });
      if (rs === 'error') return { ok: false, datos: null, error: 'No pude buscar ahora.' };
      return { ok: true, datos: { registros: rs.map(regParaModelo), ...(rs.length ? {} : { nota: 'Ninguno con eso.' }) } };
    }
    if (nombre === 'uso_del_mes') {
      const mes = hoy().slice(0, 7);
      const u = await puerto.mensajesDelMes(mes);
      if (u === 'error') return { ok: false, datos: null, error: 'No pude contarlo ahora.' };
      return { ok: true, datos: { mes: MESES_LARGOS[Number(mes.slice(5)) - 1], mensajes: u.total, incluidos: 800 } };
    }
    return { ok: false, datos: null, error: `No existe la herramienta «${nombre}».` };
  }

  const factParaModelo = (f: FacturaOne) => ({ numero: f.numero, fecha: fechaCorta(f.fecha), total: formatCOP(f.monto), recibido: formatCOP(f.recibido), obra: f.obra });
  const regParaModelo = (r: RegistroOne) => ({
    id: r.id, tipo: r.tipo, fecha: fechaCorta(r.fecha), monto: formatCOP(r.monto), obra: r.obra ?? 'gasto de empresa',
    ...(r.rubro ? { rubro: r.rubro } : {}), ...(r.factura ? { factura: r.factura } : {}), ...(r.numero ? { transaccion: r.numero } : {}),
    ...(r.descripcion ? { descripcion: corto(r.descripcion, 60) } : {}),
  });

  async function asistencia(args: Record<string, unknown>): Promise<ResultadoHerramienta> {
    const desde = esDia(args.desde) ? args.desde : hoy();
    const hasta = esDia(args.hasta) ? args.hasta : desde;
    if (hasta < desde) return { ok: false, datos: null, error: '`hasta` es antes de `desde`.' };
    let negocioId: string | null = null;
    if (args.codigo) {
      const ob = await puerto.obraPorCodigo(String(args.codigo));
      if (ob === 'error') return { ok: false, datos: null, error: 'No pude revisar la obra ahora.' };
      if (!ob) return { ok: false, datos: null, error: `No hay una obra activa con código «${String(args.codigo)}».` };
      negocioId = ob.id;
    }
    const [ls, ops] = await Promise.all([puerto.llegadas({ desde, hasta, negocioId }), puerto.operarios()]);
    if (ls === 'error' || ops === 'error') return { ok: false, datos: null, error: 'No pude revisar la asistencia ahora. Dilo así, sin nombres ni cifras.' };
    const nota = 'Son las marcas de llegada: dónde llegó cada uno, no dónde está ahora.';
    if (desde === hasta) {
      const porObra = new Map<string, Array<{ persona: string; hora: string }>>();
      for (const l of [...ls].sort((a, b) => a.hora.localeCompare(b.hora))) {
        const xs = porObra.get(l.obra) ?? [];
        xs.push({ persona: l.persona, hora: horaBogota(l.hora) });
        porObra.set(l.obra, xs);
      }
      const marcaron = new Set(ls.map((l) => l.collaborator_id));
      const dos = new Map<string, number>();
      for (const l of ls) dos.set(l.collaborator_id, (dos.get(l.collaborator_id) ?? 0) + 1);
      return {
        ok: true,
        datos: {
          dia: `${desde === hoy() ? 'hoy, ' : ''}${fechaCorta(desde)}`,
          por_obra: [...porObra.entries()].map(([obra, llegadas]) => ({ obra, llegadas })),
          ...(negocioId ? {} : { sin_marcar_llegada: ops.filter((p) => !marcaron.has(p.id)).map((p) => p.nombre) }),
          medio_y_medio: ls.filter((l) => (dos.get(l.collaborator_id) ?? 0) >= 2).map((l) => l.persona).filter((v, i, a) => a.indexOf(v) === i),
          nota,
        },
      };
    }
    const porPersona = new Map<string, typeof ls>();
    for (const l of ls) porPersona.set(l.persona, [...(porPersona.get(l.persona) ?? []), l]);
    const porObra = new Map<string, Map<string, Set<string>>>();
    for (const l of ls) {
      const m = porObra.get(l.obra) ?? new Map<string, Set<string>>();
      m.set(l.persona, (m.get(l.persona) ?? new Set()).add(l.fecha));
      porObra.set(l.obra, m);
    }
    return {
      ok: true,
      datos: {
        desde: fechaCorta(desde), hasta: fechaCorta(hasta),
        por_obra: [...porObra.entries()].map(([obra, m]) => ({ obra, personas: [...m.entries()].map(([persona, dias]) => ({ persona, dias: dias.size })) })),
        por_persona: [...porPersona.entries()].map(([persona, xs]) => ({ persona, ...diasDe(xs) })),
        nota: `${nota} Un día con dos obras cuenta en las dos (medio día en cada una).`,
      },
    };
  }

  // ── Proponer ──

  async function partidasDe(lista: Array<Record<string, unknown>>, ctx: ContextoDominio): Promise<Resultado<PartidaPago[]>> {
    const rubros = await puerto.rubros();
    if (rubros === 'error') return falla('No pude leer los rubros ahora. Dilo así.', 'rubros_no_leidos');
    const out: PartidaPago[] = [];
    for (const [i, a] of lista.entries()) {
      const cual = lista.length > 1 ? ` (partida ${i + 1})` : '';
      const m = monto(a.monto);
      if (!Number.isFinite(m) || m <= 0) return falla(`Falta el valor${cual}: un número mayor que cero. Pregúntalo si no se lee.`, 'monto');
      const codigo = String(a.negocio ?? '').trim();
      const deEmpresa = a.empresa === true;
      if (!codigo && !deEmpresa) return falla(`Falta la obra${cual}: llama \`preguntar_destino\` (para: pago). No la supongas.`, 'sin_destino');
      if (codigo && deEmpresa) return falla(`Una partida va a una obra O es gasto de empresa${cual}.`, 'destino_doble');
      if (deEmpresa && !empresaDicha(ctx.conversacion, a.empresa_dicho_en)) {
        return falla('«Gasto de empresa» solo si la persona lo tocó en la lista de `preguntar_destino` (o lo dijo después de esa lista): pon en `empresa_dicho_en` ese #n. Si no se le ha preguntado, llama `preguntar_destino`.', 'empresa_sin_respaldo');
      }
      let obra: ObraOne | null = null;
      if (codigo) {
        const ob = await obraReal(codigo);
        if (!ob.ok) return ob;
        obra = ob.v;
      }
      let rubro: RubroOne | null = null;
      let categoria = 'otros';
      if (obra && rubros.length) {
        rubro = rubroPorNombre(rubros, a.rubro);
        if (!rubro) {
          return falla(a.rubro
            ? `«${String(a.rubro)}» no es un rubro de obra. Los rubros son: ${rubros.map((r) => r.nombre).join(', ')}. No se crean rubros por aquí: pregunta en cuál lo deja.`
            : `Falta el rubro${cual}. Dedúcelo de lo que dijo la persona con la lista del Estado; si dudas entre dos, pregunta con esas dos; si no hay pista, \`preguntar_rubro\`.`, 'rubro');
        }
        categoria = rubro.categoria;
      } else {
        const c = String(a.categoria ?? 'otros');
        if (!categorias.includes(c)) return falla(`Categoría inválida. Usa una de: ${categorias.join(', ')}.`, 'categoria');
        categoria = c;
      }
      let s: SoporteDeLaConversacion | null = null;
      if (a.soporte !== undefined && a.soporte !== null && String(a.soporte).trim() !== '') {
        const f = soporteDe(ctx.conversacion, a.soporte);
        if ('error' in f) return falla(f.error, 'foto');
        s = f;
      }
      // La fecha: la del pantallazo manda; si no hay, la que dijo la persona; si no, la del mensaje (y se avisa).
      const fila = s ? ctx.conversacion.find((x) => x.id === s!.fila) : null;
      const delMensaje = fila ? diaBogota(Date.parse(fila.created_at)) : hoy();
      let fecha = delMensaje;
      let fechaDe: PartidaPago['fecha_de'] = 'mensaje';
      if (s?.lectura?.fecha && esDia(s.lectura.fecha) && s.lectura.fecha <= hoy()) {
        fecha = s.lectura.fecha; fechaDe = 'soporte';
      } else if (esDia(a.fecha)) {
        if (a.fecha > hoy()) return falla('La fecha es posterior a hoy: pregúntala.', 'fecha_futura');
        fecha = a.fecha; fechaDe = 'dicha';
      }
      out.push({
        monto: m, fecha, fecha_de: fechaDe, negocio_id: obra?.id ?? null, negocio: obra?.codigo ?? null, obra: obra?.nombre ?? null,
        obra_corta: obra ? obraCorta(obra) : null, rubro_id: rubro?.id ?? null, rubro: rubro?.nombre ?? null, categoria,
        descripcion: String(a.descripcion ?? '').trim() || null,
        numero: s?.lectura?.numero_transaccion ?? null, repetido: false, repite: null,
        huella: (s && ctx.conversacion.find((x) => x.id === s!.fila)?.media?.huella) ?? null,
        foto: s?.fila ?? null, media_id: s?.mediaId ?? null, ref: s?.ref ?? null, soporte_n: s?.n ?? null, args: a,
      });
      // El valor de la nota y el del pantallazo no coinciden: no se elige en silencio.
      const leido = s?.lectura?.legible ? s.lectura.monto : null;
      const comparten = lista.filter((x) => s && numeroDeFila(x.soporte) === s.n).length;
      if (leido !== null && comparten === 1 && Math.abs(leido - m) > 1 && a.monto_elegido !== true) {
        return falla(`El pantallazo #${s!.n} dice ${formatCOP(leido)} y la partida es de ${formatCOP(m)}. No elijas: pregunta «¿Cuál es?» con los dos valores como \`opciones\` de \`responder\`. Si la persona ya eligió el otro, pon monto_elegido: true.`, 'monto_distinto');
      }
    }
    // D3: un mismo pantallazo en varias partidas = un pago partido; tienen que sumar exactamente lo que dice.
    const porSoporte = new Map<string, PartidaPago[]>();
    for (const p of out) if (p.foto) porSoporte.set(p.foto, [...(porSoporte.get(p.foto) ?? []), p]);
    for (const ps of porSoporte.values()) {
      if (ps.length < 2) continue;
      const fila = ctx.conversacion.find((x) => x.id === ps[0].foto);
      const leido = fila?.media?.lectura?.legible ? fila.media.lectura.monto : null;
      const suma = ps.reduce((a, p) => a + p.monto, 0);
      if (leido !== null && leido !== undefined && Math.abs(suma - leido) > 1) {
        return falla(`Las partidas del pantallazo #${ps[0].soporte_n} suman ${formatCOP(suma)} y el pago es de ${formatCOP(leido)}: un pago partido tiene que sumar exacto. Pregunta cómo se reparte.`, 'reparto');
      }
      if (new Set(ps.map((p) => p.negocio_id)).size < ps.length) return falla('Un pago partido va a obras distintas.', 'reparto');
    }
    // Número de transacción o imagen ya registrados: se pregunta en la propuesta, no se bloquea.
    for (const p of out) {
      const previos = p.numero ? await puerto.pagosConNumero(p.numero) : p.huella ? await puerto.pagosConHuella(p.huella) : [];
      if (previos === 'error') return falla('No pude revisar si ese pago ya está registrado. Dilo así; no lo registres todavía.', 'repetido_no_leido');
      if (previos.length) {
        p.repetido = true;
        p.repite = previos.map(lineaRegistro).join('; ');
      }
    }
    return { ok: true, v: out };
  }

  async function proponerPagos(d: Record<string, unknown>, ctx: ContextoDominio, uno?: { cola: PartidaPago[] }): Promise<Resultado<Propuesta>> {
    const lista = Array.isArray(d.partidas) ? d.partidas.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>> : [];
    if (!lista.length) return falla('Faltan las `partidas` del pago (una por pago).', 'sin_partidas');
    if (lista.length > MAX_PARTIDAS) return falla(`Máximo ${MAX_PARTIDAS} pagos por propuesta: propón los primeros.`, 'muchas_partidas');
    const r = await partidasDe(lista, ctx);
    if (!r.ok) return r;
    return { ok: true, v: propuestaPagos(r.v, uno?.cola ?? []) };
  }

  function propuestaPagos(ps: PartidaPago[], cola: PartidaPago[]): Propuesta {
    const datos = { partidas: ps, ...(cola.length ? { cola } : {}) };
    const args = { accion: 'pagos', datos: { partidas: ps.map((p) => p.args) } };
    if (ps.length === 1) {
      const p = ps[0];
      // Número o imagen repetidos: la pregunta es la propuesta misma (§3.1).
      if (p.repetido) {
        return {
          accion: 'pagos', datos, args,
          resumen: [`Ese pago ya está registrado el ${p.repite}.`, `Este: ${lineaPartida(p)}.`, '¿Es otro pago?'].join('\n'),
          si: 'Es otro pago', no: 'Es el mismo', ...(p.negocio ? { sobre: p.negocio } : {}),
        };
      }
      return {
        accion: 'pagos', datos, args,
        resumen: [`Registro el pago de ${lineaPartida(p)}.`, ...avisosPartida(p, hoy())].join('\n'),
        si: 'Sí, regístralo', no: noEsDe, extras: [{ clave: 'cambiar', titulo: 'Cambiar algo', tipo: 'alt' }],
        ...(p.negocio ? { sobre: p.negocio } : {}),
      };
    }
    const total = ps.reduce((a, p) => a + p.monto, 0);
    const lineas = ps.map((p, i) => `${i + 1}. ${lineaPartida(p)}${p.numero ? ` · Tx ${p.numero}` : p.soporte_n === null ? ' · sin pantallazo' : ''}${p.fecha_de === 'mensaje' ? ' · fecha del mensaje' : ''}${p.repite ? ` · ⚠️ ya está registrado el ${p.repite}` : ''}`);
    return {
      accion: 'pagos', datos, args,
      resumen: [`Registro ${ps.length} pagos:`, ...lineas, `Total: *${formatCOP(total)}*`].join('\n'),
      si: `Registrar los ${ps.length}`, no: noEsDe, extras: [{ clave: 'uno', titulo: 'Revisar uno a uno', tipo: 'alt' }],
    };
  }

  async function proponerIngreso(d: Record<string, unknown>, ctx: ContextoDominio): Promise<Resultado<Propuesta>> {
    const m = monto(d.monto);
    if (!Number.isFinite(m) || m <= 0) return falla('Falta el valor del ingreso.', 'monto');
    const ob = await obraReal(d.negocio);
    if (!ob.ok) return ob;
    let s: SoporteDeLaConversacion | null = null;
    if (d.soporte !== undefined && d.soporte !== null && String(d.soporte).trim() !== '') {
      const f = soporteDe(ctx.conversacion, d.soporte);
      if ('error' in f) return falla(f.error, 'foto');
      s = f;
      const leido = f.lectura?.legible ? f.lectura.monto : null;
      if (leido !== null && Math.abs(leido - m) > 1 && d.monto_elegido !== true) {
        return falla(`El pantallazo #${f.n} dice ${formatCOP(leido)} y el ingreso es de ${formatCOP(m)}. Pregunta cuál con los dos valores como opciones.`, 'monto_distinto');
      }
    }
    const abiertas = await puerto.facturasAbiertas(ob.v.id);
    if (abiertas === 'error') return falla('No pude leer las facturas de la obra ahora. Dilo así.', 'facturas_no_leidas');
    let factura: FacturaOne | null = null;
    const nf = String(d.factura ?? '').trim();
    if (nf) {
      factura = abiertas.find((f) => f.numero.toLowerCase().replace(/\s/g, '') === nf.toLowerCase().replace(/\s/g, '')) ?? null;
      if (!factura) return falla(`La obra no tiene una factura abierta «${nf}». ${abiertas.length ? `Las abiertas: ${abiertas.map((f) => `${f.numero} (${formatCOP(f.monto)})`).join(', ')}.` : 'No tiene facturas abiertas: el ingreso queda sin factura.'}`, 'factura_inexistente');
    } else if (d.sin_factura !== true) {
      if (abiertas.length === 1) factura = abiertas[0];
      else if (abiertas.length > 1) {
        return falla(`La obra tiene varias facturas abiertas: ${abiertas.map((f) => `${f.numero} (total ${formatCOP(f.monto)}, recibido ${formatCOP(f.recibido)})`).join('; ')}. Pregunta cuál paga, con esas como \`opciones\` y «No es de factura».`, 'varias_facturas');
      }
    }
    const fila = s ? ctx.conversacion.find((x) => x.id === s!.fila) : null;
    let fecha = fila ? diaBogota(Date.parse(fila.created_at)) : hoy();
    if (s?.lectura?.fecha && esDia(s.lectura.fecha) && s.lectura.fecha <= hoy()) fecha = s.lectura.fecha;
    else if (esDia(d.fecha) && d.fecha <= hoy()) fecha = d.fecha;
    const numero = s?.lectura?.numero_transaccion ?? null;
    const huella = fila?.media?.huella ?? null;
    const previos = numero ? await puerto.pagosConNumero(numero) : huella ? await puerto.pagosConHuella(huella) : [];
    if (previos === 'error') return falla('No pude revisar si ese pago ya está registrado. Dilo así.', 'repetido_no_leido');
    const repite = previos.length ? previos.map(lineaRegistro).join('; ') : null;
    const cliente = ob.v.empresa ? ` (cliente ${ob.v.empresa})` : '';
    const datos = {
      monto: m, fecha, negocio_id: ob.v.id, negocio: ob.v.codigo, obra: ob.v.nombre, obra_corta: obraCorta(ob.v),
      factura_id: factura?.id ?? null, factura: factura?.numero ?? null, factura_total: factura?.monto ?? null,
      numero, repetido: !!repite, huella, foto: s?.fila ?? null, media_id: s?.mediaId ?? null, ref: s?.ref ?? null,
    };
    const linea = `Ingreso de *${formatCOP(m)}* ${fecha === hoy() ? 'hoy ' : ''}${fechaCorta(fecha)} · Obra *${ob.v.nombre}*${cliente}${factura ? ` · Paga la factura *${factura.numero}* de ${formatCOP(factura.monto)}` : ' · Sin factura'}.`;
    if (repite) {
      return { ok: true, v: { accion: 'ingreso', datos, resumen: [`Ese pago ya está registrado el ${repite}.`, `Este: ${linea}`, '¿Es otro pago?'].join('\n'), si: 'Es otro pago', no: 'Es el mismo', sobre: ob.v.codigo } };
    }
    return {
      ok: true,
      v: {
        accion: 'ingreso', datos, resumen: [linea, ...(numero ? [`Transacción ${numero}.`] : [])].join('\n'), sobre: ob.v.codigo,
        si: 'Sí, regístralo', no: factura ? 'No es de factura' : 'No',
        extras: factura ? [{ clave: 'otra_factura', titulo: 'Es otra factura', tipo: 'alt' }] : [],
      },
    };
  }

  async function proponerFactura(d: Record<string, unknown>, ctx: ContextoDominio): Promise<Resultado<Propuesta>> {
    const numero = String(d.factura ?? '').trim().replace(/\s+/g, ' ');
    if (!numero) return falla('Falta el número de la factura.', 'sin_numero');
    let s: SoporteDeLaConversacion | null = null;
    if (d.soporte !== undefined && d.soporte !== null && String(d.soporte).trim() !== '') {
      const f = soporteDe(ctx.conversacion, d.soporte);
      if ('error' in f) return falla(f.error, 'foto');
      s = f;
    }
    let m = monto(d.monto);
    const leido = s?.lectura?.legible ? s.lectura.monto : null;
    if ((!Number.isFinite(m) || m <= 0) && leido) m = leido;
    if (!Number.isFinite(m) || m <= 0) return falla('Falta el valor total de la factura.', 'monto');
    if (leido !== null && leido !== undefined && Math.abs(leido - m) > 1 && d.monto_elegido !== true) {
      return falla(`El PDF dice ${formatCOP(leido)} y la factura es de ${formatCOP(m)}. Pregunta cuál, con los dos valores como opciones.`, 'monto_distinto');
    }
    const ob = await obraReal(d.negocio);
    if (!ob.ok) return ob;
    let fecha = hoy();
    if (s?.lectura?.fecha && esDia(s.lectura.fecha) && s.lectura.fecha <= hoy()) fecha = s.lectura.fecha;
    else if (esDia(d.fecha) && d.fecha <= hoy()) fecha = d.fecha;
    const previas = await puerto.facturasConNumero(numero);
    if (previas === 'error') return falla('No pude revisar si esa factura ya está. Dilo así.', 'repetida_no_leida');
    const cliente = ob.v.empresa ? ` (${ob.v.empresa})` : '';
    const datos = { numero, fecha, monto: m, negocio_id: ob.v.id, negocio: ob.v.codigo, obra: ob.v.nombre, obra_corta: obraCorta(ob.v), repetido: previas.length > 0, foto: s?.fila ?? null, media_id: s?.mediaId ?? null, ref: s?.ref ?? null };
    const linea = `Registro la factura *${numero}* del ${fechaCorta(fecha)} por *${formatCOP(m)}* a *${ob.v.nombre}*${cliente}.`;
    if (previas.length && d.otro_pago !== true) {
      return {
        ok: true,
        v: { accion: 'factura', datos, sobre: ob.v.codigo, resumen: [`Ya hay una factura ${numero}: ${previas.map((f) => `${fechaCorta(f.fecha)}, ${formatCOP(f.monto)}${f.obra ? `, ${f.obra}` : ''}`).join('; ')}.`, linea, '¿Es otra factura?'].join('\n'), si: 'Es otra factura', no: 'Es la misma' },
      };
    }
    return { ok: true, v: { accion: 'factura', datos, sobre: ob.v.codigo, resumen: linea, si: 'Sí, regístrala', no: 'No', extras: [{ clave: 'cambiar', titulo: 'Cambiar algo', tipo: 'alt' }] } };
  }

  async function proponerCorreccion(d: Record<string, unknown>): Promise<Resultado<Propuesta>> {
    const tipo = ['pago', 'ingreso', 'factura'].includes(String(d.tipo)) ? d.tipo as RegistroOne['tipo'] : null;
    if (!tipo) return falla('Falta `tipo`: pago, ingreso o factura.', 'sin_tipo');
    const id = String(d.id ?? '').trim();
    if (!id) return falla('Falta el `id` del registro: búscalo con buscar_registros.', 'sin_id');
    const r = await puerto.registro(tipo, id);
    if (r === 'error') return falla('No pude leer ese registro ahora.', 'registro_no_leido');
    if (!r) return falla('Ese registro no existe: búscalo con buscar_registros.', 'registro_inexistente');
    if (r.revisado) return falla('Ese pago ya lo revisó la oficina: se corrige en ONE. Dilo así.', 'revisado');
    const cambios: Record<string, unknown> = {};
    const antes: string[] = [];
    const despues: string[] = [];
    if (d.negocio) {
      const ob = await obraReal(d.negocio);
      if (!ob.ok) return ob;
      if (ob.v.id !== r.negocio_id) { cambios.negocioId = ob.v.id; antes.push(`Obra ${r.obra ?? 'gasto de empresa'}`); despues.push(`Obra ${ob.v.nombre}`); }
    }
    if (d.rubro && tipo === 'pago') {
      const rubros = await puerto.rubros();
      if (rubros === 'error') return falla('No pude leer los rubros ahora.', 'rubros_no_leidos');
      const ru = rubroPorNombre(rubros, d.rubro);
      if (!ru) return falla(`«${String(d.rubro)}» no es un rubro. Los rubros son: ${rubros.map((x) => x.nombre).join(', ')}.`, 'rubro');
      if (ru.id !== r.rubro_id) { cambios.rubroId = ru.id; cambios.categoria = ru.categoria; antes.push(`Rubro ${r.rubro ?? '—'}`); despues.push(`Rubro ${ru.nombre}`); }
    }
    if (d.fecha !== undefined && d.fecha !== '') {
      if (!esDia(d.fecha) || d.fecha > hoy()) return falla('La fecha nueva no es válida (AAAA-MM-DD, no futura).', 'fecha');
      if (d.fecha !== r.fecha) { cambios.fecha = d.fecha; antes.push(`Fecha ${fechaCorta(r.fecha)}`); despues.push(`Fecha ${fechaCorta(d.fecha)}`); }
    }
    if (d.monto !== undefined && d.monto !== null && d.monto !== '') {
      const m = monto(d.monto);
      if (!Number.isFinite(m) || m <= 0) return falla('El valor nuevo tiene que ser mayor que cero.', 'monto');
      if (Math.abs(m - r.monto) > 1) { cambios.monto = m; antes.push(`Valor ${formatCOP(r.monto)}`); despues.push(`Valor ${formatCOP(m)}`); }
    }
    if (d.factura && tipo === 'ingreso') {
      const negocioId = (cambios.negocioId as string | undefined) ?? r.negocio_id;
      const fs = await puerto.facturasAbiertas(negocioId);
      if (fs === 'error') return falla('No pude leer las facturas ahora.', 'facturas_no_leidas');
      const f = fs.find((x) => x.numero.toLowerCase() === String(d.factura).trim().toLowerCase());
      if (!f) return falla(`No hay una factura abierta «${String(d.factura)}» en esa obra.`, 'factura_inexistente');
      if (f.id !== r.factura_id) { cambios.facturaId = f.id; antes.push(`Factura ${r.factura ?? 'ninguna'}`); despues.push(`Factura ${f.numero}`); }
    }
    if (!Object.keys(cambios).length) return falla('No hay nada que cambiar: lo pedido ya está así.', 'sin_cambios');
    const que = tipo === 'pago' ? 'el pago' : tipo === 'ingreso' ? 'el ingreso' : 'la factura';
    return {
      ok: true,
      v: {
        accion: 'corregir', datos: { tipo, id, cambios, etiqueta: `${que} de ${formatCOP(r.monto)} del ${fechaCorta(r.fecha)}`, negocio_id: (cambios.negocioId as string | undefined) ?? r.negocio_id },
        resumen: [`✏️ Cambio ${que} de ${formatCOP(r.monto)} del ${fechaCorta(r.fecha)}${r.obra ? ` (${r.obra})` : ''}:`, `Antes: ${antes.join(' · ')}`, `Después: ${despues.join(' · ')}`].join('\n'),
        si: 'Sí, cámbialo', no: 'No',
      },
    };
  }

  async function proponer(accion: string, datos: Record<string, unknown>, ctx: ContextoDominio): Promise<{ ok: true; propuesta: Propuesta } | { ok: false; error: string; candado: string }> {
    if (['adjuntar_soporte', 'actividad', 'contacto_nuevo'].includes(accion)) return base.proponer(accion, datos, ctx);
    if (!['owner', 'admin'].includes(o.rol)) return falla('El rol de quien escribe no permite registrar por aquí. Dilo en una línea.', 'rol');
    const r = accion === 'pagos' ? await proponerPagos(datos, ctx)
      : accion === 'ingreso' ? await proponerIngreso(datos, ctx)
        : accion === 'factura' ? await proponerFactura(datos, ctx)
          : accion === 'corregir' ? await proponerCorreccion(datos)
            : falla(`Acción desconocida. Usa una de: ${ACCIONES_OBRAS.join(', ')}.`, 'accion_desconocida');
    return r.ok ? { ok: true, propuesta: r.v } : r;
  }

  // ── Ejecutar ──

  const huellaDe = (p: Propuesta) => String((p as Propuesta & { huella?: string }).huella ?? crypto.randomUUID().slice(0, 12));

  /** «Potosí lleva $14.320.000 en materiales», con una consulta hecha después de escribir. null = no se pudo. */
  async function totalRubro(negocioId: string, rubro: string | null, obra: string): Promise<string | null> {
    const c = await puerto.cierreObra(negocioId).catch(() => 'error' as const);
    if (c === 'error' || !c) return null;
    if (rubro) {
      const t = c.por_rubro.find((x) => x.rubro.toLowerCase() === rubro.toLowerCase());
      return t ? `${obra} lleva ${formatCOP(t.total)} en ${rubro.toLowerCase()}.` : null;
    }
    return `${obra} lleva ${formatCOP(c.gastos_total)} en gastos.`;
  }

  async function ejecutar(p: Propuesta, ctx: ContextoDominio): Promise<Hechos> {
    if (['adjuntar_soporte', 'actividad', 'contacto_nuevo'].includes(p.accion)) return base.ejecutar(p, ctx);
    const huella = huellaDe(p);
    const msj = ultimoTexto(ctx);
    if (p.accion === 'pagos') {
      const ps = (p.datos.partidas ?? []) as PartidaPago[];
      const hechos: Array<{ p: PartidaPago; id: string; soporte: string }> = [];
      const fallas: PartidaPago[] = [];
      for (const [i, x] of ps.entries()) {
        try {
          const r = await puerto.registrarPago({
            monto: x.monto, fecha: x.fecha, categoria: x.categoria, rubroId: x.rubro_id, descripcion: x.descripcion, negocioId: x.negocio_id,
            numero: x.numero, repetido: x.repetido, huella: x.huella, mediaId: x.media_id, ref: x.ref, propuestaHuella: `${huella}:${i}`, mensajeOriginal: msj,
          });
          hechos.push({ p: x, id: r.id, soporte: r.soporte });
        } catch (err) {
          console.error('[agente-obras] pago:', err);
          fallas.push(x);
        }
      }
      if (!hechos.length) throw new Error('no se registró ningún pago');
      const lineas: string[] = [];
      if (hechos.length === 1 && !fallas.length) {
        const h = hechos[0].p;
        const t = h.negocio_id ? await totalRubro(h.negocio_id, h.rubro, h.obra_corta ?? h.obra ?? '') : null;
        lineas.push(`✅ Guardado.${t ? ` ${t}` : ''}`);
      } else {
        lineas.push(`✅ Guardados ${hechos.length} pagos por ${formatCOP(hechos.reduce((a, h) => a + h.p.monto, 0))}.`);
      }
      if (hechos.some((h) => h.soporte === 'fallo')) lineas.push('⚠️ No pude guardar un pantallazo: súbelo después desde ONE.');
      if (fallas.length) lineas.push(`No pude guardar ${fallas.length === 1 ? `el de ${formatCOP(fallas[0].monto)}` : `${fallas.length} pagos`}, pero no se perdió.`);
      return {
        lineas,
        escrituras: hechos.map((h) => ({
          tipo: 'gasto', id: h.id, monto: h.p.monto, negocio: h.p.negocio, etiqueta: h.p.obra ?? 'Gasto de empresa', soporte: h.soporte === 'guardado',
          fecha: h.p.fecha, rubro: h.p.rubro, numero: h.p.numero, repetido: h.p.repetido, ...(h.soporte === 'guardado' && h.p.foto ? { foto: h.p.foto } : {}),
        })),
        ...(fallas.length ? { consumidos: [], nombrados: [] } : {}),
        // Lo que falló vuelve como propuesta (trasEjecutar).
        ...(fallas.length ? { fallidas: fallas } as Record<string, unknown> : {}),
      } as Hechos;
    }
    const d = p.datos;
    if (p.accion === 'ingreso') {
      const r = await puerto.registrarIngreso({
        monto: Number(d.monto), fecha: String(d.fecha), negocioId: String(d.negocio_id), facturaId: (d.factura_id as string | null) ?? null,
        numero: (d.numero as string | null) ?? null, repetido: d.repetido === true, huella: (d.huella as string | null) ?? null,
        mediaId: (d.media_id as string | null) ?? null, ref: (d.ref as string | null) ?? null, propuestaHuella: huella, mensajeOriginal: msj,
      });
      let linea = '✅ Guardado.';
      if (d.factura_id) {
        const fs = await puerto.facturasAbiertas(String(d.negocio_id)).catch(() => 'error' as const);
        const f = fs !== 'error' ? fs.find((x) => x.id === d.factura_id) : null;
        linea = f ? `✅ Guardado. La ${f.numero} tiene ${formatCOP(f.recibido)} recibidos de ${formatCOP(f.monto)}. Cuando quede pagada, se marca en ONE.` : '✅ Guardado. Cuando la factura quede pagada, se marca en ONE.';
      } else {
        const c = await puerto.cierreObra(String(d.negocio_id)).catch(() => 'error' as const);
        if (c !== 'error' && c) linea = `✅ Guardado. ${String(d.obra_corta)} lleva ${formatCOP(c.cobrado)} cobrados.`;
      }
      return {
        lineas: [linea, ...(r.soporte === 'fallo' ? ['⚠️ No pude guardar el pantallazo: súbelo después desde ONE.'] : [])],
        escrituras: [{ tipo: 'ingreso', id: r.id, monto: Number(d.monto), negocio: d.negocio, factura: d.factura ?? null, fecha: d.fecha, numero: d.numero ?? null, ...(r.soporte === 'guardado' && d.foto ? { foto: d.foto } : {}) }],
      };
    }
    if (p.accion === 'factura') {
      const r = await puerto.registrarFactura({
        numero: String(d.numero), fecha: String(d.fecha), monto: Number(d.monto), negocioId: String(d.negocio_id), repetido: d.repetido === true,
        mediaId: (d.media_id as string | null) ?? null, ref: (d.ref as string | null) ?? null, propuestaHuella: huella,
      });
      const fs = await puerto.facturasAbiertas(String(d.negocio_id)).catch(() => 'error' as const);
      const f = fs !== 'error' ? fs.find((x) => x.id === r.id) : null;
      const c = await puerto.cierreObra(String(d.negocio_id)).catch(() => 'error' as const);
      const linea = c !== 'error' && c && f
        ? `✅ Guardada. ${String(d.obra_corta)} tiene ${formatCOP(c.facturado)} facturados y ${formatCOP(f.recibido)} recibidos de esa factura.`
        : '✅ Guardada.';
      return { lineas: [linea], escrituras: [{ tipo: 'factura', id: r.id, numero: d.numero, monto: Number(d.monto), negocio: d.negocio, fecha: d.fecha, ...(r.soporte === 'guardado' && d.foto ? { foto: d.foto } : {}) }] };
    }
    if (p.accion === 'corregir') {
      await puerto.corregirRegistro({ tipo: d.tipo as RegistroOne['tipo'], id: String(d.id), cambios: d.cambios as never });
      return { lineas: [`✅ Cambiado ${String(d.etiqueta)}.`], escrituras: [{ tipo: 'correccion', registro: d.tipo, id: d.id, cambios: d.cambios }] };
    }
    throw new Error(`acción desconocida: ${p.accion}`);
  }

  function ultimoTexto(ctx: ContextoDominio): string | null {
    const f = [...ctx.conversacion].reverse().find((x) => x.direccion === 'entrante' && x.clase !== 'toque' && (x.texto ?? '').trim());
    return f?.texto?.trim() ?? null;
  }

  // ── Toques que no son el «sí» ──

  async function siguienteDeCola(cola: PartidaPago[], ctx: ContextoDominio, lineas: string[]): Promise<Respuesta | null> {
    if (!cola.length) return null;
    const [primera, ...resto] = cola;
    const r = await partidasDe([primera.args], ctx);
    if (!r.ok) return { lineas: [...lineas, `No pude armar el siguiente pago (${formatCOP(primera.monto)}): ${r.error.split('.')[0]}.`] };
    const p = propuestaPagos(r.v, resto);
    return { lineas, propuesta: { ...p, args: { accion: 'pagos', datos: { partidas: [primera.args] } } } };
  }

  async function alTocar(clave: string, p: Propuesta, ctx: ContextoDominio): Promise<Respuesta> {
    if (clave === 'cambiar') return { lineas: ['¿Qué cambio? Dímelo y lo ajusto.'] };
    if (clave === 'uno' && p.accion === 'pagos') {
      const ps = (p.datos.partidas ?? []) as PartidaPago[];
      const sig = await siguienteDeCola(ps, ctx, []);
      return sig ? { ...sig, descarta: true, lineas: [`Van uno por uno (${ps.length}).`] } : { lineas: ['No quedó nada por revisar.'], descarta: true };
    }
    if (clave === 'otra_factura' && p.accion === 'ingreso') {
      const fs = await puerto.facturasAbiertas(String(p.datos.negocio_id));
      const otras = fs === 'error' ? [] : fs.filter((f) => f.id !== p.datos.factura_id);
      return otras.length
        ? { lineas: [`¿Cuál factura paga? Las abiertas de ${String(p.datos.obra_corta)}: ${otras.map((f) => `${f.numero} (${formatCOP(f.monto)})`).join(', ')}.`] }
        : { lineas: [`${String(p.datos.obra_corta)} no tiene otra factura abierta. Si es una nueva, mándame la factura para registrarla primero.`] };
    }
    return { lineas: ['Ese botón ya no aplica.'] };
  }

  async function trasRechazar(p: Propuesta, ctx: ContextoDominio): Promise<Respuesta | null> {
    if (p.accion === 'pagos' && Array.isArray(p.datos.cola) && p.datos.cola.length) return await siguienteDeCola(p.datos.cola as PartidaPago[], ctx, ['Listo, ese no lo registré.']);
    // «No es de factura»: el mismo ingreso, sin factura.
    if (p.accion === 'ingreso' && p.datos.factura_id && !p.datos.repetido) {
      const args = (p.args?.datos ?? {}) as Record<string, unknown>;
      const r = await proponerIngreso({ ...args, factura: '', sin_factura: true }, ctx);
      if (r.ok) return { lineas: [], propuesta: { ...r.v, args: { accion: 'ingreso', datos: { ...args, factura: '', sin_factura: true } } } };
    }
    return null;
  }

  return {
    ...base,
    bot: BOT_ONE,
    lecturas: LECTURAS_OBRAS,
    acciones: ACCIONES_OBRAS,
    datosProponer: DATOS_PROPONER_OBRAS,
    cierres: CIERRES_OBRAS,
    leer,
    proponer,
    ejecutar,
    alTocar,
    trasRechazar,
    // Una propuesta pendiente nunca vence en silencio (C19).
    pendienteSinConfirmar(p) {
      if (p.accion === 'pagos') {
        const n = ((p.datos.partidas ?? []) as unknown[]).length + ((p.datos.cola ?? []) as unknown[]).length;
        return n === 1 ? '1 pago' : `${n} pagos`;
      }
      if (p.accion === 'ingreso') return '1 ingreso';
      if (p.accion === 'factura') return '1 factura';
      if (p.accion === 'corregir') return '1 cambio';
      return null;
    },
    cubre(vieja, nueva) {
      if (vieja.accion !== nueva.accion) return false;
      if (vieja.accion === 'corregir') return vieja.datos.id === nueva.datos.id;
      if (vieja.accion !== 'pagos') return vieja.datos.negocio_id === nueva.datos.negocio_id;
      const nuevas = [...(nueva.datos.partidas ?? []) as PartidaPago[], ...(nueva.datos.cola ?? []) as PartidaPago[]];
      const viejas = [...(vieja.datos.partidas ?? []) as PartidaPago[], ...(vieja.datos.cola ?? []) as PartidaPago[]];
      return viejas.every((v) => nuevas.some((n) => (v.foto ? n.foto === v.foto : Math.abs(n.monto - v.monto) <= 1)));
    },
    async trasEjecutar(p, h, huella, ctx) {
      // La siguiente partida de una revisión uno a uno, o lo que no se pudo guardar.
      const fallidas = (h as Hechos & { fallidas?: PartidaPago[] }).fallidas ?? [];
      const cola = [...fallidas, ...(p.accion === 'pagos' && Array.isArray(p.datos.cola) ? p.datos.cola as PartidaPago[] : [])];
      if (cola.length) {
        const ctx2 = { ...ctx, conversacion: ctx.conversacion.map((f) => f) };
        const sig = await siguienteDeCola(cola, ctx2, h.lineas);
        if (sig?.propuesta) return { lineas: sig.lineas, propuesta: sig.propuesta };
        if (sig) return { lineas: sig.lineas };
      }
      return base.trasEjecutar ? await base.trasEjecutar(p.accion === 'pagos' ? { ...p, accion: 'gasto' } : p, h, huella, ctx) : null;
    },
    async cerrar(nombre, args) {
      if (nombre === 'preguntar_rubro') {
        const rs = await puerto.rubros();
        if (rs === 'error') return falla('No pude leer los rubros ahora. Dilo así.', 'rubros_no_leidos');
        if (!rs.length) return falla('Este workspace no tiene rubros de obra: usa la categoría.', 'sin_rubros');
        const render = renderizar(String(args.texto ?? '').split('\n')[0].slice(0, 200) || '¿Qué rubro?', rs.slice(0, 10).map((r) => ({ titulo: r.nombre, ...(r.ejemplos ? { descripcion: r.ejemplos } : {}) })), { turno: crypto.randomUUID().slice(0, 8), topeTexto: 1000, final: true });
        return render.ok ? { ok: true, salidas: [render.salida], datos: { rubros: rs.map((r) => r.nombre) } } : falla(render.error, 'formato_meta');
      }
      if (nombre !== 'preguntar_destino') return falla(`No existe «${nombre}».`, 'cierre_desconocido');
      const obras = await puerto.obrasActivas();
      if (obras === 'error') return falla('No pude leer las obras ahora. Dilo así.', 'obras_no_leidas');
      const pago = args.para === 'pago' || args.para === 'gasto';
      if (!obras.length) return falla(pago ? 'No hay obras activas: pregunta si es gasto de empresa.' : 'No hay obras activas: dilo (la oficina crea la obra en ONE).', 'sin_obras');
      const opciones = [
        ...obras.slice(0, pago ? 9 : 10).map((x) => ({ titulo: obraCorta(x), descripcion: `${x.codigo} · ${x.nombre}` })),
        ...(pago ? [{ titulo: OPCION_EMPRESA }] : []),
      ];
      const pregunta = String(args.texto ?? '').trim().split('\n')[0].slice(0, 200) || '¿De qué obra es?';
      const render = renderizar(pregunta, opciones, { turno: crypto.randomUUID().slice(0, 8), topeTexto: 1000, final: true });
      return render.ok ? { ok: true, salidas: [render.salida], datos: { obras: obras.map((x) => ({ obra: obraCorta(x), codigo: x.codigo })), empresa: pago } } : falla(render.error, 'formato_meta');
    },
    async estado(ctx) {
      const [obras, rubros] = await Promise.all([puerto.obrasActivas(), puerto.rubros()]);
      const pagos = gastosDeLaConversacion(ctx.conversacion).slice(-5);
      return [
        'Su rol: gestión (registra pagos, ingresos y facturas; consulta obras, asistencia y el uso del mes). Marcar una factura pagada y lo retenido son de ONE, no de aquí.',
        obras === 'error' ? 'Obras activas: no se pudieron leer.' : obras.length
          ? `Obras activas (código · nombre en ONE · nombre corto): ${obras.map((x) => `${x.codigo} · ${x.nombre} · ${obraCorta(x)}${x.empresa ? ` (cliente ${x.empresa})` : ''}`).join(' | ')}.`
          : 'Obras activas: ninguna.',
        rubros === 'error' ? 'Rubros: no se pudieron leer.' : rubros.length
          ? `Rubros de obra: ${rubros.map((r) => `${r.nombre}${r.descripcion ? ` (${r.descripcion})` : ''}${r.ejemplos ? `: ${r.ejemplos}` : ''}`).join(' | ')}.`
          : 'Rubros de obra: ninguno (usa la categoría).',
        `Hoy: ${fechaCorta(hoy())} (${hoy()}).`,
        ultimaLista(ctx.conversacion),
        fotosSinUsar(ctx.conversacion),
        pagos.length ? `Pagos registrados en esta conversación: ${pagos.map((g) => `${g.ref} · ${formatCOP(g.monto)} · ${g.etiqueta} · ${g.soporte ? 'con soporte' : 'sin soporte'}`).join(' | ')}.` : 'Pagos registrados en esta conversación: ninguno.',
      ];
    },
  };
}

export type { Salida };
