// ============================================================
// Asistente público — el dominio (herramientas y candados, §8)
// ------------------------------------------------------------
// Genérico para un asistente que habla con clientes finales (Sabor hoy; sirve al bot de ventas de ONE): el negocio
// vive en el reglamento, no aquí.
//
// Etapa 1 (§8.1), con su candado en código:
//   · `ver_catalogo`      lectura. Solo experiencias vigentes hoy (Bogotá). Vacío o vencido: error que manda a persona.
//   · `ver_funciones`     lectura. Solo funciones futuras de esa experiencia; nunca dice «disponible».
//   · `consultar_reglas`  lectura. Solo políticas publicadas (`pol.*`).
//   · `proponer` (acción `reserva`, = `proponer_reserva` del diseño). No escribe. Exige la autorización `general` (§5.2).
//     El código arma el resumen desde el catálogo y desde lo que el cliente escribió DESPUÉS del «sí»: un nombre, una
//     cédula o un teléfono que solo aparece antes no se usa (el silencio no cuenta). El toque o el «sí» sobre esa
//     propuesta, con su huella vigente, la confirma (D4) y pasa a persona con `reserva_lista`.
//   · `pasar_a_persona`   cierre. `motivo` de lista cerrada; la nota y las etiquetas las arma el código; no repite un
//     motivo en la misma conversación (sin bucles, §6.1), salvo que la persona lo pida otra vez.
//   · `respuesta_fija`    cierre. El modelo elige cuál y el código la manda tal cual (§7): la autorización (Sí / No), la
//     autorización del dato sensible, «no compartas datos de tarjeta», o «esos son los precios autorizados» (§8.8).
//   · `responder`         del núcleo, con su verificador (cifras, fechas y links con respaldo; 600 caracteres).
// Etapa 2 (§8.2): `consultar_cupo`, `apartar`, `generar_link_pago` y `verificar_pago` quedan DECLARADAS Y APAGADAS en
// `HERRAMIENTAS_ETAPA_2`: no se le muestran al modelo, y si las nombra, el núcleo responde que no existen.
// Las autorizaciones NO son herramientas: las registra el código al leer el «sí» o el botón (`autorizacion.ts`).
// ============================================================

import { RF_AUTORIZACION, RF_AUTORIZACION_SENSIBLE, estadoAutorizacion, salidaAutorizacion } from './autorizacion.ts';
import { CLAVES_REGLAS, condicionesVigentes, cuandoBogota, funcionesFuturas, pesos, politicas, vigentes, zonaDe } from './catalogo.ts';
import type { Experiencia } from './catalogo.ts';
import { respuestaFija } from '../reglamento.ts';
import type { ContextoDominio, DeclaracionHerramienta, Dominio, Propuesta, Reglamento, ResultadoHerramienta, Salida } from '../tipos.ts';
import type { FilaPublica, MotivoPersona, TrazaPublica } from './tipos.ts';
import { MOTIVOS_PERSONA } from './tipos.ts';

export const BOT_PUBLICO = 'asistente-publico';
export const PASAR_A_PERSONA = 'pasar_a_persona';
export const RESPUESTA_FIJA = 'respuesta_fija';
export const RF_TARJETA = 'rf.tarjeta';
export const RF_PREFERENCIA_MESA = 'rf.preferencia_mesa';
export const RF_CUPO = 'rf.cupo_lo_confirma_el_equipo';
export const RF_SIGUIENTE_PASO = 'rf.siguiente_paso';
export const RF_DUDA_ABIERTA = 'rf.duda_abierta';
/** §6.4.1: antes de pasar a quien pide una persona, una sola pregunta por qué. */
export const RF_PERSONA_POR_QUE = 'rf.persona_por_que';
/** §8.8: ante «¿por qué ese precio?», «está muy caro» o «hazme un descuento», los precios son los autorizados. */
export const RF_PRECIO_AUTORIZADO = 'rf.precio_autorizado';
export const FIJAS_DEL_MODELO = [RF_AUTORIZACION, RF_AUTORIZACION_SENSIBLE, RF_TARJETA, RF_PREFERENCIA_MESA, RF_CUPO, RF_PERSONA_POR_QUE, RF_PRECIO_AUTORIZADO] as const;

/** Motivos que sí se repiten: la persona lo vuelve a pedir, o es otra reserva, o es urgente. */
const REPETIBLES: MotivoPersona[] = ['pide_persona', 'reserva_lista', 'datos', 'crisis', 'duda_abierta'];

/** Etapa 2: declaradas para que la etapa 2 no rompa nada; apagadas (el modelo no las ve). */
export const HERRAMIENTAS_ETAPA_2: Array<DeclaracionHerramienta & { encendida: false }> = [
  { name: 'consultar_cupo', encendida: false, description: 'Cupos libres de una función en ONE. Lo calcula la base; el modelo nunca lo estima.', parameters: { type: 'object', properties: { funcion: { type: 'string' } }, required: ['funcion'] } },
  { name: 'apartar', encendida: false, description: 'Aparta tras el «sí» del cliente, con propuesta vigente y autorización registrada; sin sobreventa.', parameters: { type: 'object', properties: { propuesta: { type: 'string' } }, required: ['propuesta'] } },
  { name: 'generar_link_pago', encendida: false, description: 'Link de la pasarela del apartado; monto y referencia salen del apartado.', parameters: { type: 'object', properties: { apartado: { type: 'string' } }, required: ['apartado'] } },
  { name: 'verificar_pago', encendida: false, description: 'Le pregunta a la pasarela si el pago del apartado quedó aprobado. Recibe el id del apartado, nunca un monto ni un soporte. Solo «aprobado» deja confirmar.', parameters: { type: 'object', properties: { apartado: { type: 'string' } }, required: ['apartado'] } },
];

// ── Lo que se deriva de la conversación ──────────────────────────────────────

const filasDe = (ctx: ContextoDominio) => ctx.conversacion as FilaPublica[];

/** Los motivos por los que esta conversación ya pasó a persona. Pura. */
export function motivosYaPasados(filas: FilaPublica[]): MotivoPersona[] {
  return filas.map((f) => (f.traza as TrazaPublica | null)?.persona?.motivo).filter((m): m is MotivoPersona => !!m);
}

/** ¿Ya volvió de una persona? El bot solo atiende en `pending`: un paso a persona previo es un `pending` tras `open`. Pura. */
export function volvioDePersona(filas: FilaPublica[]): boolean {
  return motivosYaPasados(filas).length > 0;
}

/**
 * ¿Ya le salió al cliente `rf.persona_por_que` en esta conversación (§6.4.4)? Cuenta lo publicado (la traza con
 * salida), venga del código («persona» escrito solo) o del modelo (`respuesta_fija`). Pura.
 */
export function porQueYaSalio(filas: FilaPublica[]): boolean {
  return filas.some((f) => {
    const t = f.traza as TrazaPublica | null;
    if (!t?.salida) return false;
    return t.respuesta_fija === RF_PERSONA_POR_QUE
      || (t.herramientas ?? []).some((h) => h.ok && h.nombre === RESPUESTA_FIJA && (h.args as { clave?: unknown } | null)?.clave === RF_PERSONA_POR_QUE);
  });
}

/** ¿El último mensaje que le salió al cliente fue `rf.persona_por_que`? (lo que conteste ahora es la respuesta). Pura. */
export function ultimoFuePorQue(filas: FilaPublica[]): boolean {
  const ultima = filas.filter((f) => (f.traza as TrazaPublica | null)?.salida).at(-1);
  return !!ultima && porQueYaSalio([ultima]);
}

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim();
const digitos = (s: string) => s.replace(/\D/g, '');

/** Lo que el cliente escribió después del «sí» de la autorización general (sin lo enmascarado). Pura. */
export function textoTrasAutorizacion(filas: FilaPublica[], desdeIso: string): string {
  return filas
    .filter((f) => f.direccion === 'entrante' && !f.enmascarado && f.created_at > desdeIso && f.texto)
    .map((f) => f.texto!)
    .join('\n');
}

/** ¿El dato aparece en lo escrito tras la autorización? Nombre por palabras; cédula y teléfono por dígitos. Pura. */
export function dichoTras(campo: 'nombre' | 'cedula' | 'telefono', valor: string, texto: string): boolean {
  if (campo === 'nombre') {
    const palabras = normal(valor).split(' ').filter((w) => w.length >= 2);
    const t = ` ${normal(texto)} `;
    return palabras.length > 0 && palabras.every((w) => t.includes(` ${w} `));
  }
  const d = digitos(valor);
  if (campo === 'cedula') return d.length >= 5 && d.length <= 11 && digitos(texto).includes(d);
  return d.length >= 7 && digitos(texto).includes(d.slice(-10));
}

// ── El dominio ───────────────────────────────────────────────────────────────

/** La ficha que ve el modelo: lo que escribió Sabor, con las condiciones de HOY y los montos en pesos. Pura. */
export function fichaParaModelo(e: Experiencia, ahoraMs: number): Record<string, unknown> {
  const unidad = (u: string | null) => (u ? ` ${u}` : '');
  const conds = condicionesVigentes(e, ahoraMs);
  return {
    id: e.id, nombre: e.nombre,
    ...(e.historia ? { historia: e.historia } : {}),
    incluye: e.incluye,
    precio_por_persona: pesos(e.precioPersona),
    ...(e.precioPareja !== null ? { precio_por_pareja: pesos(e.precioPareja) } : {}),
    cobro_grupo: e.cobroGrupo ?? 'sin_dato: no digas cómo se cobra un grupo de otro tamaño (duda_abierta)',
    condiciones_vigentes_hoy: conds.map((c) => ({ id: c.id, tipo: c.tipo, monto: `${pesos(c.monto)}${unidad(c.unidad)}`, condicion: c.condicion, hasta: c.hasta, acumulable: c.acumulable ? 'sí' : 'no' })),
    ...(conds.length > 1 && !conds.every((c) => c.acumulable) ? { nota_condiciones: 'No se suman entre sí.' } : {}),
    ...(e.capacidad !== null ? { puestos: `${e.capacidad} (describe la experiencia; NO dice que hay cupo)` } : {}),
    ...(e.disposicion ? { disposicion: e.disposicion } : {}),
    ubicaciones: e.ubicaciones.map((u) => ({ zona: u.zona, descripcion: u.descripcion, recargo: u.recargo !== null ? `${pesos(u.recargo)}${unidad(u.unidad)}` : 'sin recargo' })),
    elige_mesa: e.eligeMesa === 'si' ? 'sí: se anota como preferencia' : e.eligeMesa === 'se_pide' ? 'se pide y el equipo confirma' : e.eligeMesa === 'no' ? 'no se elige mesa' : 'sin_dato',
    ...(e.abono !== null ? { abono: pesos(e.abono) } : {}),
    ...(e.duracion ? { duracion: e.duracion } : {}), ...(e.edadSugerida ? { edad_sugerida: e.edadSugerida } : {}), ...(e.direccion ? { direccion: e.direccion } : {}),
    version: e.version, ...(e.fechaFicha ? { fecha_ficha: e.fechaFicha } : {}),
  };
}

/** La preferencia de mesa vigente en la conversación (la última anotada). Pura. */
export function preferenciaMesa(filas: FilaPublica[]): string | null {
  return filas.map((f) => (f.traza as TrazaPublica | null)?.preferencia_mesa).filter((x): x is string => !!x).at(-1) ?? null;
}

/** La línea fija de la preferencia de mesa en el resumen: nunca una asignación. Pura. */
export function lineaPreferenciaMesa(p: string): string {
  return `Preferencia de mesa: ${p.replace(/\s+/g, ' ').slice(0, 60)} (por confirmar)`;
}

export interface OpcionesDominioPublico {
  reglamento: Reglamento;
  ahoraMs: () => number;
  /** Para la autorización: el link de términos y el nombre del asistente. */
  vars: Record<string, string>;
  /** Simula una herramienta caída (arnés de operación). */
  fallar?: () => boolean;
}

export function dominioPublico(o: OpcionesDominioPublico): Dominio {
  const r = o.reglamento;
  const claves: string[] = [...CLAVES_REGLAS];
  const caida = () => { if (o.fallar?.()) throw new Error('herramienta caída (simulada)'); };

  const lecturas: DeclaracionHerramienta[] = [
    {
      name: 'ver_catalogo',
      description: 'La ficha de cada experiencia vigente hoy: historia, qué incluye, precio por persona y por pareja, cómo se cobra un grupo (si la ficha lo dice), condiciones especiales VIGENTES HOY con su condición completa, puestos (describen la experiencia, nunca dicen que hay cupo), disposición, ubicaciones con su recargo, si se elige mesa, abono, duración, edad sugerida y dirección. Úsala antes de decir cualquier precio, condición o dato de la experiencia; lo que no esté aquí no lo deduzcas (duda abierta). Nunca sumes dos condiciones ni apliques una fuera de su condición. Si no hay ninguna vigente, pasa a persona con motivo `falla`.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'ver_funciones',
      description: 'Las funciones futuras de una experiencia (día y hora, hora de Bogotá), con su id. No dice si hay cupo: nunca digas que hay cupo ni que está disponible. «Pa\'l finde» no es una función: muestra las opciones y pregunta cuál.',
      parameters: { type: 'object', properties: { experiencia: { type: 'string', description: 'El id de la experiencia que devolvió ver_catalogo.' } }, required: ['experiencia'] },
    },
    {
      name: 'consultar_reglas',
      description: `La información general publicada, por clave: ${claves.join(', ')}. Si devuelve \`sin_dato\`, no adivines ni deduzcas («seguro hay parqueadero cerca»): pasa a persona con motivo \`duda_abierta\` (el sistema le dice al cliente que no tienes ese dato confirmado).`,
      parameters: { type: 'object', properties: { clave: { type: 'string', enum: claves } }, required: ['clave'] },
    },
  ];

  const cierres: DeclaracionHerramienta[] = [
    {
      name: PASAR_A_PERSONA,
      description: 'Pasa la conversación a una persona del equipo. El sistema arma la nota interna, pone la etiqueta y le dice al cliente qué sigue. Usa el motivo exacto: reserva_lista (lo pone el sistema tras la confirmación, no lo uses tú), restriccion, celebracion, grupo, pide_persona, queja, pago (soporte, «ya pagué», doble cobro), no_entiende (dos turnos sin entender o frustración), menor, crisis, abuso, duda_abierta (pregunta del tema que la ficha y las reglas no contestan: no adivines), datos (borrar datos o revocar la autorización), falla.',
      parameters: {
        type: 'object',
        properties: {
          motivo: { type: 'string', enum: MOTIVOS_PERSONA.filter((m) => m !== 'reserva_lista') },
          pidio: { type: 'string', description: 'En una línea, qué pidió el cliente (sin datos de salud ni de tarjeta).' },
        },
        required: ['motivo', 'pidio'],
      },
    },
    {
      name: RESPUESTA_FIJA,
      description: `Manda una respuesta fija, tal cual la escribe el sistema. ${RF_AUTORIZACION}: antes de pedir nombre, cédula o teléfono para la reserva (pide la autorización con Sí / No; es la ÚNICA forma de pedirla: nunca la redactes tú en responder). ${RF_AUTORIZACION_SENSIBLE}: si la persona menciona una restricción alimentaria, alergia o dato de salud (no repitas el dato). ${RF_TARJETA}: si escribe o pide escribir datos de tarjeta. ${RF_PREFERENCIA_MESA}: si pide una mesa o zona (pon en \`preferencia\` lo que pidió; el sistema la anota como preferencia, nunca como asignada, y dice el recargo de la zona si lo hay). ${RF_CUPO}: si pregunta si hay cupo o pide que se lo asegures. ${RF_PERSONA_POR_QUE}: si pide una persona sin decir para qué (una sola vez por conversación; si ya la mandaste o ya lo atendió una persona, usa pasar_a_persona). ${RF_PRECIO_AUTORIZADO}: si pregunta por qué ese precio, dice que está caro o pide un descuento o una rebaja (no negocies ni pases a persona solo por eso).`,
      parameters: {
        type: 'object',
        properties: {
          clave: { type: 'string', enum: [...FIJAS_DEL_MODELO] },
          preferencia: { type: 'string', description: 'Solo con rf.preferencia_mesa: la mesa o zona que pidió, con sus palabras.' },
        },
        required: ['clave'],
      },
    },
  ];

  return {
    bot: BOT_PUBLICO,
    lecturas,
    acciones: ['reserva'],
    datosProponer: {
      experiencia: { type: 'string', description: 'id de ver_catalogo' },
      funcion: { type: 'string', description: 'id de ver_funciones' },
      personas: { type: 'integer' },
      nombre: { type: 'string', description: 'como lo escribió el cliente después de autorizar' },
      cedula: { type: 'string' },
      telefono: { type: 'string' },
      preferencia_mesa: { type: 'string', description: 'Opcional: la mesa o zona que pidió el cliente (queda como preferencia por confirmar)' },
    },
    cierres,

    async leer(nombre, args): Promise<ResultadoHerramienta> {
      caida();
      const ahora = o.ahoraMs();
      if (nombre === 'ver_catalogo') {
        const vs = vigentes(r, ahora);
        if (!vs.length) return { ok: false, datos: null, error: 'No hay ninguna experiencia vigente publicada. No inventes ni uses una anterior: llama pasar_a_persona con motivo falla.' };
        return {
          ok: true,
          datos: {
            experiencias: vs.map((e) => fichaParaModelo(e, ahora)),
          },
        };
      }
      if (nombre === 'ver_funciones') {
        const exp = String(args.experiencia ?? '');
        if (!vigentes(r, ahora).some((e) => e.id === exp)) return { ok: false, datos: null, error: `«${exp}» no es una experiencia vigente. Usa un id de ver_catalogo.` };
        const fs = funcionesFuturas(r, exp, ahora);
        if (!fs.length) return { ok: true, datos: { funciones: [], nota: 'No hay funciones futuras publicadas para esta experiencia.' } };
        return { ok: true, datos: { funciones: fs.map((f) => ({ id: f.id, cuando: cuandoBogota(f.inicio) })) }, sobre: exp };
      }
      if (nombre === 'consultar_reglas') {
        const clave = String(args.clave ?? '');
        if (!claves.includes(clave)) return { ok: false, datos: null, error: `Clave desconocida. Usa una de: ${claves.join(', ')}.` };
        const p = politicas(r).find((x) => x.clave === clave);
        // Sin ficha: no hay dato. El modelo no deduce: duda abierta y persona (§8.3).
        if (!p) return { ok: true, datos: { clave, sin_dato: true, que_hacer: 'No hay ficha: llama pasar_a_persona con motivo duda_abierta. No adivines.' } };
        if (!p) return { ok: false, datos: null, error: `No hay una política publicada con esa clave. Claves: ${claves.join(', ') || '(ninguna)'}.` };
        return { ok: true, datos: { clave: p.clave, politica: p.texto } };
      }
      return { ok: false, datos: null, error: `No existe la herramienta «${nombre}».` };
    },

    async proponer(accion, datos, ctx) {
      if (accion !== 'reserva') return { ok: false, error: 'La única acción es reserva.', candado: 'accion_desconocida' };
      const filas = filasDe(ctx);
      const aut = estadoAutorizacion(filas, 'general');
      if (aut.estado !== 'si') {
        return { ok: false, error: `Falta la autorización de datos (${aut.estado === 'no' ? 'dijo que no: no tomes datos, sigue informando y ofrece una persona' : 'pídela con respuesta_fija rf.autorizacion antes de tomar nombre, cédula o teléfono'}).`, candado: 'sin_autorizacion' };
      }
      const ahora = o.ahoraMs();
      const exp = vigentes(r, ahora).find((e) => e.id === String(datos.experiencia ?? ''));
      if (!exp) return { ok: false, error: 'La experiencia no es una vigente de ver_catalogo.', candado: 'experiencia_invalida' };
      const fun = funcionesFuturas(r, exp.id, ahora, 100).find((f) => f.id === String(datos.funcion ?? ''));
      if (!fun) return { ok: false, error: 'La función no es una función futura de esa experiencia (usa un id de ver_funciones).', candado: 'funcion_invalida' };
      const personas = Number(datos.personas);
      if (!Number.isInteger(personas) || personas < 1 || personas > 50) return { ok: false, error: 'El número de personas tiene que ser un entero entre 1 y 50.', candado: 'personas_invalidas' };
      const tras = textoTrasAutorizacion(filas, aut.at);
      const faltan: string[] = [];
      const campos = { nombre: String(datos.nombre ?? '').trim(), cedula: String(datos.cedula ?? '').trim(), telefono: String(datos.telefono ?? '').trim() };
      for (const k of ['nombre', 'cedula', 'telefono'] as const) {
        if (!campos[k] || !dichoTras(k, campos[k], tras)) faltan.push(k === 'cedula' ? 'cédula' : k === 'telefono' ? 'teléfono' : 'nombre');
      }
      if (faltan.length) {
        return { ok: false, error: `Falta ${faltan.join(', ')} escrito por el cliente después de autorizar (lo que dijo antes no cuenta). Pídelo.`, candado: 'dato_sin_autorizacion' };
      }
      // La mesa: PREFERENCIA (§8.4.2), la del estado o la que trae el modelo, y solo si la ficha deja elegirla.
      const pedida = String(datos.preferencia_mesa ?? '').trim() || preferenciaMesa(filas);
      if (pedida && exp.eligeMesa !== 'si' && exp.eligeMesa !== 'se_pide') {
        return { ok: false, error: exp.eligeMesa === 'no' ? 'En esta función no se elige mesa: díselo al cliente y propón sin preferencia de mesa.' : 'La ficha no dice si se elige mesa: no la anotes; propón sin ella.', candado: 'mesa_no_se_elige' };
      }
      // Sin total (§8.4.4): precios unitarios de la ficha y «el equipo te confirma el total» (D17 abierta).
      const resumen = [
        'Revisa tu reserva:',
        `• ${exp.nombre}`,
        `• ${cuandoBogota(fun.inicio)}`,
        `• ${personas} ${personas === 1 ? 'persona' : 'personas'} · ${pesos(exp.precioPersona)} por persona${exp.precioPareja !== null ? ` (${pesos(exp.precioPareja)} por pareja)` : ''}`,
        ...(pedida ? [`• ${lineaPreferenciaMesa(pedida)}`] : []),
        `• ${campos.nombre} · C.C. ${digitos(campos.cedula)} · Tel. ${digitos(campos.telefono)}`,
        'El equipo de Sabor te confirma el total, el cupo y el pago. ¿Está bien?',
      ].join('\n');
      const propuesta: Propuesta = {
        accion: 'reserva',
        datos: { experiencia: exp.id, experiencia_version: exp.version, funcion: fun.id, inicio: fun.inicio, personas, nombre: campos.nombre, cedula: digitos(campos.cedula), telefono: digitos(campos.telefono), ...(pedida ? { preferencia_mesa: pedida } : {}) },
        resumen, si: 'Sí, está bien', no: 'Corregir',
      };
      return { ok: true, propuesta };
    },

    async ejecutar(p) {
      // Etapa 1: confirmar no escribe ninguna reserva (cupos y pago son etapa 2). Pasa a persona con el resumen.
      return { lineas: [respuestaFija(r, RF_SIGUIENTE_PASO) || respuestaFija(r, 'rf.persona.reserva_lista') || respuestaFija(r, 'rf.persona')], escrituras: [{ tipo: 'persona', motivo: 'reserva_lista', datos: p.datos }] };
    },

    async estado(ctx) {
      const filas = filasDe(ctx);
      const g = estadoAutorizacion(filas, 'general');
      const sen = estadoAutorizacion(filas, 'sensible');
      const pasados = motivosYaPasados(filas);
      const lineaG = g.estado === 'si' ? 'sí (puedes pedir nombre, cédula y teléfono)'
        : g.estado === 'no' ? 'dijo que no: no tomes datos personales; sigue informando y ofrece una persona'
          : g.estado === 'pedida' ? 'pedida, sin respuesta: no pidas datos personales; si la persona los da igual, pide la autorización otra vez con respuesta_fija'
            : 'no pedida: antes de pedir nombre, cédula o teléfono, llama respuesta_fija rf.autorizacion';
      return [
        `Autorización de datos para la reserva: ${lineaG}.`,
        ...(sen.estado !== 'no_pedida' ? [`Dato de salud: ${sen.estado === 'si' ? 'autorizado (ya pasó a persona)' : sen.estado === 'no' ? 'no autorizado: no lo menciones ni lo guardes' : 'autorización pedida, sin respuesta'}.`] : []),
        ...(preferenciaMesa(filas) ? [`Preferencia de mesa anotada (por confirmar, no asignada): ${preferenciaMesa(filas)}.`] : []),
        ...(pasados.length ? [`Ya pasó a persona por: ${[...new Set(pasados)].join(', ')} (no repitas esos motivos salvo pide_persona). Si pide una persona otra vez: pasar_a_persona motivo pide_persona, sin preguntar por qué.`] : []),
        ...(!pasados.length && porQueYaSalio(filas) ? [ultimoFuePorQue(filas)
          ? 'Tu último mensaje fue la pregunta de para qué quiere una persona (rf.persona_por_que). Si ahora pide algo que resuelves, contéstalo y TERMINA el mensaje ofreciéndole otra vez pasar con una persona del equipo. Si es algo que no resuelves, pasa con ese motivo. Si insiste en una persona o dice que solo quiere hablar con alguien: pasar_a_persona motivo pide_persona. No vuelvas a preguntar por qué.'
          : 'Ya le preguntaste por qué quiere una persona (rf.persona_por_que): no lo vuelvas a preguntar. Si vuelve a pedir una persona o dice que solo quiere hablar con alguien: pasar_a_persona motivo pide_persona.'] : []),
      ];
    },

    async cerrar(nombre, args, ctx) {
      const filas = filasDe(ctx);
      if (nombre === PASAR_A_PERSONA) {
        const motivo = String(args.motivo ?? '') as MotivoPersona;
        if (!MOTIVOS_PERSONA.includes(motivo) || motivo === 'reserva_lista') return { ok: false, error: `Motivo desconocido. Usa uno de: ${MOTIVOS_PERSONA.filter((m) => m !== 'reserva_lista').join(', ')}.`, candado: 'motivo_desconocido' };
        if (!REPETIBLES.includes(motivo) && motivosYaPasados(filas).includes(motivo)) {
          return { ok: false, error: `Esta conversación ya pasó a persona por «${motivo}» y la devolvieron: atiéndela tú (sin volver a pasarla por lo mismo).`, candado: 'motivo_repetido' };
        }
        // La duda abierta dice `rf.duda_abierta` («no tengo ese dato confirmado…») y no adivina (§8.3).
        const texto = (motivo === 'duda_abierta' ? respuestaFija(r, RF_DUDA_ABIERTA) : '') || respuestaFija(r, `rf.persona.${motivo}`) || respuestaFija(r, 'rf.persona');
        return { ok: true, salidas: [{ tipo: 'texto', texto }], datos: { motivo }, privado: { persona: { motivo, pidio: String(args.pidio ?? '').slice(0, 200) } } };
      }
      if (nombre === RESPUESTA_FIJA) {
        const clave = String(args.clave ?? '');
        if (clave === RF_AUTORIZACION) {
          const g = estadoAutorizacion(filas, 'general');
          if (g.estado === 'si') return { ok: false, error: 'Ya autorizó: sigue con los datos que falten.', candado: 'ya_autorizo' };
          return { ok: true, salidas: [salidaAutorizacion(r, 'general', o.vars)], privado: { pide_autorizacion: 'general' } };
        }
        if (clave === RF_AUTORIZACION_SENSIBLE) {
          const sen = estadoAutorizacion(filas, 'sensible');
          if (sen.estado === 'si' || sen.estado === 'no') return { ok: false, error: 'Ya respondió sobre el dato de salud: no lo vuelvas a pedir.', candado: 'sensible_ya_respondida' };
          return { ok: true, salidas: [salidaAutorizacion(r, 'sensible', o.vars)], privado: { pide_autorizacion: 'sensible', enmascarar: true } };
        }
        if (clave === RF_TARJETA) {
          const s: Salida = { tipo: 'texto', texto: respuestaFija(r, RF_TARJETA) };
          return { ok: true, salidas: [s], privado: { enmascarar: true } };
        }
        if (clave === RF_PERSONA_POR_QUE) {
          // §6.4.4 y §6.4.5: una sola vez por conversación, y nunca a quien vuelve de una persona.
          if (volvioDePersona(filas)) return { ok: false, error: 'Ya lo atendió una persona y lo devolvieron: si pide una persona, pasar_a_persona motivo pide_persona, sin preguntar.', candado: 'persona_por_que_tras_persona' };
          if (porQueYaSalio(filas)) return { ok: false, error: 'Ya le preguntaste por qué quiere una persona: no lo vuelvas a preguntar. Si pide una persona, pasar_a_persona motivo pide_persona.', candado: 'persona_por_que_repetida' };
          return { ok: true, salidas: [{ tipo: 'texto', texto: respuestaFija(r, RF_PERSONA_POR_QUE) }] };
        }
        if (clave === RF_PRECIO_AUTORIZADO) {
          // Un reglamento publicado antes del 25-oct no la trae: sin texto no sale un mensaje vacío.
          const texto = respuestaFija(r, RF_PRECIO_AUTORIZADO);
          if (!texto) return { ok: false, error: 'Sin ese texto: contesta con responder que esos son los precios publicados, sin negociar ni prometer descuentos.', candado: 'fija_sin_texto' };
          return { ok: true, salidas: [{ tipo: 'texto', texto }] };
        }
        if (clave === RF_CUPO) return { ok: true, salidas: [{ tipo: 'texto', texto: respuestaFija(r, RF_CUPO) }] };
        if (clave === RF_PREFERENCIA_MESA) {
          const pedida = String(args.preferencia ?? '').trim();
          if (!pedida) return { ok: false, error: 'Pon en `preferencia` la mesa o zona que pidió el cliente.', candado: 'preferencia_vacia' };
          const vs = vigentes(r, o.ahoraMs());
          const exp = vs.find((e) => zonaDe(e, pedida)) ?? (vs.length === 1 ? vs[0] : null);
          if (!exp || (exp.eligeMesa !== 'si' && exp.eligeMesa !== 'se_pide')) {
            return {
              ok: false, candado: 'mesa_no_se_elige',
              error: exp?.eligeMesa === 'no' ? 'En esta función no se elige mesa: díselo al cliente con responder y no la anotes.' : 'La ficha no dice si se elige mesa: no la anotes; es una duda abierta (pasar_a_persona duda_abierta).',
            };
          }
          // La zona con sobrecosto se dice con su monto, armado por el código desde la ficha (§8.4.2).
          const zona = zonaDe(exp, pedida);
          const recargo = zona && zona.recargo !== null ? `La zona ${zona.descripcion || zona.zona} tiene un recargo de ${pesos(zona.recargo)}${zona.unidad ? ` ${zona.unidad}` : ''}.` : '';
          const texto = [respuestaFija(r, RF_PREFERENCIA_MESA), recargo].filter(Boolean).join(' ');
          return { ok: true, salidas: [{ tipo: 'texto', texto }], privado: { preferencia_mesa: pedida.slice(0, 80) } };
        }
        return { ok: false, error: `Usa una de: ${FIJAS_DEL_MODELO.join(', ')}.`, candado: 'fija_desconocida' };
      }
      return { ok: false, error: `No existe «${nombre}».`, candado: 'cierre_desconocido' };
    },
  };
}
