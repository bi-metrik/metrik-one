// ============================================================
// Dominio ONE en modo obras — el operario: su llegada a la obra y sus días (C5, C7), 2026-10-21
// ------------------------------------------------------------
// Diseño: proyectos/imperviun/proyecto-360/docs/diseno/asistente-whatsapp.md, §3.3 (D5, D10).
// Esto es CANDADO, no conducta: el turno de un operario solo tiene dos herramientas (marcar SU llegada y ver SUS días)
// y una pregunta del sistema (el listado de obras). No existe para él registrar pagos, ver pesos, ver la asistencia de
// otros ni el resultado de una obra: no es que el modelo se abstenga, es que no hay con qué. La guarda del texto
// (`sinPesos`) rechaza cualquier cifra en pesos en lo que le sale.
//   · La llegada es solo el mensaje (D10): sin ubicación ni foto. La hora es la del mensaje en el servidor, nunca la
//     que diga el texto; el día, el de Bogotá. No hay llegadas de días anteriores: eso lo registra la oficina.
//   · La obra sale de la base: el código verifica que exista y esté activa antes del botón. Se guarda su id.
//   · Una sola obra: «¿Anoto su llegada a X?». Ninguna o varias: el listado, y tocar la obra ya es la confirmación.
//   · Segunda obra el mismo día: medio y medio. Tercera: no; «¿Cambio alguna?». La misma obra: no se duplica.
//   · La propuesta vence a la medianoche de Bogotá: un toque de ayer no registra hoy lo de ayer.
//   · Un pantallazo o una factura: lo contesta el código por el rol, sin modelo y sin cupo.
//   · Ante el operario nunca se nombra a nadie de la oficina: «la oficina».
// ============================================================

import type { ContextoDominio, DeclaracionHerramienta, Dominio, FilaConversacion, Hechos, Propuesta, ResultadoHerramienta, Respuesta } from '../tipos.ts';
import { MESES_LARGOS, diaBogota, diasDe, fechaCorta, horaBogota, obraCorta, ultimoMensaje } from './obras-comun.ts';
import type { LlegadaOne, ObraOne, PuertoObras } from './obras-comun.ts';

export const BOT_OPERARIO = 'one_operario';
export const ACCIONES_OPERARIO = ['llegada'];

export const TEXTO_PAGOS_OFICINA = 'Los pagos los registra la oficina. Mándeselo a ellos.';
export const TEXTO_OBRA_NUEVA = 'Si es una obra nueva, la oficina la tiene que crear primero.';

export const LECTURAS_OPERARIO: DeclaracionHerramienta[] = [
  {
    name: 'mis_dias',
    description: 'Los días que ESTE operario lleva en el mes: cuántos, en qué obras y cuántos repartidos entre dos obras. Sin pesos. Para «¿cuántos días llevo?». Solo lectura.',
    parameters: { type: 'object', properties: { mes: { type: 'string', description: 'AAAA-MM. Vacío = este mes.' } } },
  },
];

export const CIERRES_OPERARIO: DeclaracionHerramienta[] = [
  {
    name: 'preguntar_obra',
    description: 'Cuando el operario no dijo a qué obra llegó, o lo que dijo no coincide con UNA sola obra activa: el sistema manda el listado de obras activas; tocar una ya anota la llegada. Cierra el turno.',
    parameters: {
      type: 'object',
      properties: {
        motivo: { type: 'string', enum: ['no_dijo', 'no_coincide', 'varias'], description: 'no_dijo: no nombró obra. no_coincide: nombró una que no está activa. varias: lo que dijo sirve para más de una.' },
        texto: { type: 'string', description: 'Una línea de saludo o contexto, de usted («Buenos días, Pedro.»). Sin la pregunta: la pone el sistema.' },
        reglas_usadas: { type: 'array', items: { type: 'string' } },
      },
      required: ['motivo'],
    },
  },
];

const DATOS_PROPONER_OPERARIO: Record<string, unknown> = {
  obra: { type: 'string', description: 'llegada: el código de la obra activa a la que llegó (del Estado), solo si lo que dijo coincide con UNA sola.' },
};

/** La guarda del texto para un operario: ninguna cifra en pesos. Devuelve los errores (vacío = pasa). Pura. */
export function sinPesos(texto: string): string[] {
  return /\$\s?\d|\d[\d.,]*\s?(?:pesos|mil\b|millones|cop\b)/iu.test(texto) ? ['no se le dicen valores en pesos a un operario'] : [];
}

const falla = (error: string, candado: string): { ok: false; error: string; candado: string } => ({ ok: false, error, candado });

export interface OpcionesOperario {
  collaboratorId: string;
  nombre: string;
  ahora?: () => number;
}

export function dominioOperario(puerto: PuertoObras, o: OpcionesOperario): Dominio {
  const ahora = o.ahora ?? (() => Date.now());
  const hoy = () => diaBogota(ahora());

  async function deHoy(): Promise<LlegadaOne[] | 'error'> {
    const d = hoy();
    return await puerto.llegadas({ desde: d, hasta: d, collaboratorId: o.collaboratorId });
  }

  /** La hora de la llegada: la del mensaje que la pide (en el servidor), no la que diga el texto. */
  function horaDe(ctx: ContextoDominio): { hora: string; wamid: string | null } {
    const f = ultimoMensaje(ctx.conversacion);
    return { hora: f?.created_at ?? new Date(ahora()).toISOString(), wamid: f?.wa_message_id ?? null };
  }

  /** El listado de obras activas como propuesta: cada obra es un botón que anota la llegada. */
  async function listado(ctx: ContextoDominio, pregunta: string, hora?: string): Promise<{ ok: true; v: Propuesta } | { ok: false; error: string; candado: string }> {
    const obras = await puerto.obrasActivas();
    if (obras === 'error') return falla('No pude leer las obras ahora. Dígalo así.', 'obras_no_leidas');
    if (!obras.length) return falla('No hay obras activas. Dígale que la oficina tiene que crear la obra primero.', 'sin_obras');
    const h = hora ? { hora, wamid: null } : horaDe(ctx);
    return {
      ok: true,
      v: {
        accion: 'llegada',
        datos: { fecha: diaBogota(Date.parse(h.hora)), hora: h.hora, wamid: h.wamid, opciones: Object.fromEntries(obras.slice(0, 10).map((x) => [x.id, { negocio_id: x.id, obra: obraCorta(x) }])) },
        resumen: pregunta, si: '', no: '',
        extras: obras.slice(0, 10).map((x) => ({ clave: x.id, titulo: obraCorta(x), tipo: 'elige' as const, descripcion: x.nombre })),
        args: { accion: 'llegada', datos: {} },
      },
    };
  }

  async function proponerLlegada(d: Record<string, unknown>, ctx: ContextoDominio): Promise<{ ok: true; v: Propuesta } | { ok: false; error: string; candado: string }> {
    const h = horaDe(ctx);
    const fecha = diaBogota(Date.parse(h.hora));
    if (fecha !== hoy()) return falla('Ese mensaje no es de hoy: las llegadas se anotan el mismo día.', 'dia_anterior');
    const codigo = String(d.obra ?? '').trim();
    // Sin obra, el listado (lo pide el código, no el modelo).
    if (!codigo) return await listado(ctx, '¿A qué obra llegó?');
    const ob = await puerto.obraPorCodigo(codigo);
    if (ob === 'error') return falla('No pude revisar la obra ahora. Dígalo así.', 'obra_no_leida');
    if (!ob) return falla(`No hay una obra activa con código «${codigo}»: llama \`preguntar_obra\` con motivo no_coincide.`, 'obra_inexistente');
    const ya = await deHoy();
    if (ya === 'error') return falla('No pude revisar sus llegadas de hoy. Dígalo así.', 'llegadas_no_leidas');
    const misma = ya.find((l) => l.negocio_id === ob.id);
    if (misma) return falla(`Ya quedó anotada su llegada a ${misma.obra} hoy, ${horaBogota(misma.hora)}: dígalo así, sin proponer.`, 'llegada_repetida');
    const otras = [...new Map(ya.map((l) => [l.negocio_id, l])).values()];
    const base = { negocio_id: ob.id, obra: obraCorta(ob), fecha, hora: h.hora, wamid: h.wamid };
    if (otras.length >= 2) {
      // Tercera obra: no se registra; se ofrece cambiar una de las dos.
      return {
        ok: true,
        v: {
          accion: 'llegada', args: { accion: 'llegada', datos: { obra: ob.codigo } },
          datos: { ...base, cambiar: true, opciones: Object.fromEntries(otras.map((l) => [l.id, { llegada_id: l.id, obra: l.obra }])) },
          resumen: `Hoy ya tiene medio día en *${otras[0].obra}* y medio en *${otras[1].obra}*. ¿Cambio alguna por *${obraCorta(ob)}*?`,
          si: '', no: 'No cambiar',
          extras: otras.map((l) => ({ clave: l.id, titulo: `Cambiar ${l.obra}`.slice(0, 20), tipo: 'elige' as const })),
        },
      };
    }
    if (otras.length === 1) {
      return {
        ok: true,
        v: {
          accion: 'llegada', datos: base, args: { accion: 'llegada', datos: { obra: ob.codigo } },
          resumen: `Hoy ya llegó a *${otras[0].obra}*. Si anoto ${obraCorta(ob)}, el día queda *medio en ${otras[0].obra} y medio en ${obraCorta(ob)}*.`,
          si: 'Sí, mitad y mitad', no: '', extras: [{ clave: 'otra', titulo: 'Otra obra', tipo: 'alt' }],
        },
      };
    }
    return {
      ok: true,
      v: {
        accion: 'llegada', datos: base, args: { accion: 'llegada', datos: { obra: ob.codigo } },
        resumen: `¿Anoto su llegada a *${ob.nombre}*, ${horaBogota(h.hora)}?`,
        si: 'Sí, anotar', no: '', extras: [{ clave: 'otra', titulo: 'Otra obra', tipo: 'alt' }],
      },
    };
  }

  async function ejecutar(p: Propuesta): Promise<Hechos> {
    const d = p.datos;
    const fecha = String(d.fecha);
    const hora = String(d.hora);
    if (fecha !== hoy()) throw new Error('la llegada no es de hoy');
    const eleccion = d.eleccion as string | undefined;
    const opciones = (d.opciones ?? {}) as Record<string, { negocio_id?: string; llegada_id?: string; obra: string }>;
    const huella = String((p as Propuesta & { huella?: string }).huella ?? '');
    const ya = await deHoy();
    if (ya === 'error') throw new Error('no se pudieron leer las llegadas de hoy');
    // Cambiar una de las dos de hoy por la nueva.
    if (d.cambiar === true) {
      const o2 = eleccion ? opciones[eleccion] : undefined;
      if (!o2?.llegada_id) throw new Error('sin llegada que cambiar');
      await puerto.cambiarLlegada({ llegadaId: o2.llegada_id, negocioId: String(d.negocio_id), hora });
      return { lineas: [`✅ Cambiado: hoy queda ${String(d.obra)} en vez de ${o2.obra}.`], escrituras: [{ tipo: 'llegada_cambiada', llegada: o2.llegada_id, negocio_id: d.negocio_id, collaborator_id: o.collaboratorId, fecha }] };
    }
    const negocioId = eleccion ? opciones[eleccion]?.negocio_id : String(d.negocio_id);
    const obra = eleccion ? opciones[eleccion]?.obra : String(d.obra);
    if (!negocioId) throw new Error('sin obra');
    // El listado se tocó: las mismas reglas del día, sin escribir si no aplica.
    const misma = ya.find((l) => l.negocio_id === negocioId);
    if (misma) return { lineas: [`Ya quedó anotada su llegada a ${misma.obra}, ${horaBogota(misma.hora)}.`] };
    const distintas = new Set(ya.map((l) => l.negocio_id));
    if (distintas.size >= 2) return { lineas: [`Hoy ya tiene medio día en ${ya[0].obra} y medio en ${ya.find((l) => l.negocio_id !== ya[0].negocio_id)!.obra}. Si quiere cambiar alguna, dígame a cuál obra llegó.`] };
    const r = await puerto.registrarLlegada({ collaboratorId: o.collaboratorId, negocioId, fecha, hora, waMessageId: (d.wamid as string | null) ?? null, propuestaHuella: huella });
    const linea = distintas.size === 1
      ? `✅ Llegada a ${obra} anotada, ${horaBogota(hora)}. El día queda medio y medio.`
      : eleccion ? `✅ Llegada a ${obra} anotada, ${horaBogota(hora)}. Que le vaya bien.` : '✅ Llegada anotada. Que le vaya bien.';
    return { lineas: [linea], escrituras: [{ tipo: 'llegada', id: r.id, negocio_id: negocioId, obra, collaborator_id: o.collaboratorId, fecha, hora }] };
  }

  async function leer(nombre: string, args: Record<string, unknown>): Promise<ResultadoHerramienta> {
    if (nombre !== 'mis_dias') return { ok: false, datos: null, error: `No existe la herramienta «${nombre}».` };
    const mes = typeof args.mes === 'string' && /^\d{4}-\d{2}$/.test(args.mes) ? args.mes : hoy().slice(0, 7);
    const [a, m] = mes.split('-').map(Number);
    const fin = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
    const ls = await puerto.llegadas({ desde: `${mes}-01`, hasta: fin, collaboratorId: o.collaboratorId });
    if (ls === 'error') return { ok: false, datos: null, error: 'No pude revisar sus días ahora. Dígalo así, sin cifras.' };
    return { ok: true, datos: { mes: MESES_LARGOS[m - 1], ...diasDe(ls) } };
  }

  return {
    bot: BOT_OPERARIO,
    quien: 'operario',
    reenvios: 'mensaje',
    propuestaVenceConRespuesta: true,
    lecturas: LECTURAS_OPERARIO,
    acciones: ACCIONES_OPERARIO,
    datosProponer: DATOS_PROPONER_OPERARIO,
    cierres: CIERRES_OPERARIO,
    leer: (n, a) => leer(n, a),
    async proponer(accion, datos, ctx) {
      if (accion !== 'llegada') return falla('Aquí solo se anota la llegada a la obra.', 'rol');
      const r = await proponerLlegada(datos, ctx);
      return r.ok ? { ok: true, propuesta: r.v } : r;
    },
    ejecutar: (p) => ejecutar(p),
    async cerrar(nombre, args, ctx) {
      if (nombre !== 'preguntar_obra') return falla(`No existe «${nombre}».`, 'cierre_desconocido');
      const h = horaDe(ctx);
      if (diaBogota(Date.parse(h.hora)) !== hoy()) return falla('Ese mensaje no es de hoy.', 'dia_anterior');
      const pregunta = ['¿A qué obra llegó?', ...(args.motivo === 'no_coincide' ? [TEXTO_OBRA_NUEVA] : [])].join('\n');
      const r = await listado(ctx, pregunta);
      if (!r.ok) return r;
      const saludo = String(args.texto ?? '').trim().split('\n')[0].slice(0, 120);
      return { ok: true, salidas: saludo && sinPesos(saludo).length === 0 ? [{ tipo: 'texto', texto: saludo }] : [], propuesta: r.v };
    },
    // «Otra obra»: el listado, sin modelo.
    async alTocar(clave, p, ctx): Promise<Respuesta> {
      if (clave !== 'otra') return { lineas: ['Ese botón ya no aplica.'] };
      const r = await listado(ctx, '¿A qué obra llegó?', String(p.datos.hora ?? '') || undefined);
      return r.ok ? { lineas: [], propuesta: r.v, descarta: true } : { lineas: ['No pude leer las obras ahora. Escríbame en un rato.'] };
    },
    // La propuesta de llegada vence a la medianoche de Bogotá.
    sigueVigente: (p) => p.accion !== 'llegada' || String(p.datos.fecha) === hoy(),
    async vencida(_p, ctx): Promise<Respuesta> {
      const r = await listado(ctx, '¿A qué obra llegó hoy?', new Date(ahora()).toISOString());
      return r.ok ? { lineas: ['Esa ya venció: era de ayer.'], propuesta: r.v } : { lineas: ['Esa ya venció: era de ayer. ¿A qué obra llegó hoy?'] };
    },
    // Un pantallazo o una factura (sin texto): el código contesta por el rol, sin modelo y sin cupo.
    sinModelo(nuevos: FilaConversacion[]) {
      const soloArchivos = nuevos.length > 0 && nuevos.every((f) => f.direccion === 'entrante' && (f.media?.tipo === 'imagen' || f.media?.tipo === 'documento') && !(f.texto ?? '').trim());
      return soloArchivos ? { salida: { tipo: 'texto', texto: TEXTO_PAGOS_OFICINA }, clave: 'rf.operario_pago' } : null;
    },
    async estado(ctx) {
      const [ya, obras] = await Promise.all([deHoy(), puerto.obrasActivas()]);
      const h = horaDe(ctx);
      return [
        `Es operario: solo anota su llegada a la obra de hoy y consulta sus días. Nunca pesos, nunca datos de otros. Ante él, la oficina es «la oficina».`,
        `Hoy: ${fechaCorta(hoy())}. Hora de su último mensaje: ${horaBogota(h.hora)}.`,
        ya === 'error' ? 'Sus llegadas de hoy: no se pudieron leer.' : ya.length
          ? `Sus llegadas de hoy: ${ya.map((l) => `${l.obra} ${horaBogota(l.hora)}`).join(', ')}.`
          : 'Sus llegadas de hoy: ninguna (es su primer mensaje con llegada del día).',
        obras === 'error' ? 'Obras activas: no se pudieron leer.' : obras.length
          ? `Obras activas (código · nombre en ONE · nombre corto): ${obras.map((x: ObraOne) => `${x.codigo} · ${x.nombre} · ${obraCorta(x)}`).join(' | ')}.`
          : 'Obras activas: ninguna.',
      ];
    },
  };
}
