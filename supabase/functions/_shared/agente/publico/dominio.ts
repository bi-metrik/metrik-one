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
//     autorización del dato sensible, o «no compartas datos de tarjeta».
//   · `responder`         del núcleo, con su verificador (cifras, fechas y links con respaldo; 600 caracteres).
// Etapa 2 (§8.2): `consultar_cupo`, `apartar`, `generar_link_pago` y `verificar_pago` quedan DECLARADAS Y APAGADAS en
// `HERRAMIENTAS_ETAPA_2`: no se le muestran al modelo, y si las nombra, el núcleo responde que no existen.
// Las autorizaciones NO son herramientas: las registra el código al leer el «sí» o el botón (`autorizacion.ts`).
// ============================================================

import { RF_AUTORIZACION, RF_AUTORIZACION_SENSIBLE, estadoAutorizacion, salidaAutorizacion } from './autorizacion.ts';
import { cuandoBogota, funcionesFuturas, pesos, politicas, vigentes } from './catalogo.ts';
import { respuestaFija } from '../reglamento.ts';
import type { ContextoDominio, DeclaracionHerramienta, Dominio, Propuesta, Reglamento, ResultadoHerramienta, Salida } from '../tipos.ts';
import type { FilaPublica, MotivoPersona, TrazaPublica } from './tipos.ts';
import { MOTIVOS_PERSONA } from './tipos.ts';

export const BOT_PUBLICO = 'asistente-publico';
export const PASAR_A_PERSONA = 'pasar_a_persona';
export const RESPUESTA_FIJA = 'respuesta_fija';
export const RF_TARJETA = 'rf.tarjeta';
export const FIJAS_DEL_MODELO = [RF_AUTORIZACION, RF_AUTORIZACION_SENSIBLE, RF_TARJETA] as const;

/** Motivos que sí se repiten: la persona lo vuelve a pedir, o es otra reserva, o es urgente. */
const REPETIBLES: MotivoPersona[] = ['pide_persona', 'reserva_lista', 'datos', 'crisis'];

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
  const claves = politicas(r).map((p) => p.clave);
  const caida = () => { if (o.fallar?.()) throw new Error('herramienta caída (simulada)'); };

  const lecturas: DeclaracionHerramienta[] = [
    {
      name: 'ver_catalogo',
      description: 'Las experiencias vigentes hoy: nombre, qué incluye, precio por persona, abono, duración, edad sugerida, dirección, versión y fecha de la ficha. Úsala antes de decir cualquier precio, qué incluye o dónde queda. Si no hay ninguna vigente, no inventes ni uses una anterior: pasa a persona con motivo `falla`.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'ver_funciones',
      description: 'Las funciones futuras de una experiencia (día y hora, hora de Bogotá), con su id. No dice si hay cupo: nunca digas que hay cupo ni que está disponible. «Pa\'l finde» no es una función: muestra las opciones y pregunta cuál.',
      parameters: { type: 'object', properties: { experiencia: { type: 'string', description: 'El id de la experiencia que devolvió ver_catalogo.' } }, required: ['experiencia'] },
    },
    {
      name: 'consultar_reglas',
      description: `Una política publicada por su clave. Claves: ${claves.length ? claves.join(', ') : '(ninguna publicada)'}. Si la que preguntan no está, di que no la tienes y ofrece pasar con una persona.`,
      parameters: { type: 'object', properties: { clave: { type: 'string', enum: claves.length ? claves : ['ninguna'] } }, required: ['clave'] },
    },
  ];

  const cierres: DeclaracionHerramienta[] = [
    {
      name: PASAR_A_PERSONA,
      description: 'Pasa la conversación a una persona del equipo. El sistema arma la nota interna, pone la etiqueta y le dice al cliente qué sigue. Usa el motivo exacto: reserva_lista (lo pone el sistema tras la confirmación, no lo uses tú), restriccion, celebracion, grupo, pide_persona, queja, pago (soporte, «ya pagué», doble cobro), no_entiende (dos turnos sin entender o frustración), menor, crisis, abuso, datos (borrar datos o revocar la autorización), falla.',
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
      description: `Manda una respuesta fija, tal cual la escribe el sistema. ${RF_AUTORIZACION}: antes de pedir nombre, cédula o teléfono para la reserva (pide la autorización con Sí / No; es la ÚNICA forma de pedirla: nunca la redactes tú en responder). ${RF_AUTORIZACION_SENSIBLE}: si la persona menciona una restricción alimentaria, alergia o dato de salud (no repitas el dato). ${RF_TARJETA}: si escribe o pide escribir datos de tarjeta.`,
      parameters: { type: 'object', properties: { clave: { type: 'string', enum: [...FIJAS_DEL_MODELO] } }, required: ['clave'] },
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
            experiencias: vs.map((e) => ({
              id: e.id, nombre: e.nombre, incluye: e.incluye, precio_por_persona: pesos(e.precioPersona), ...(e.abono !== null ? { abono: pesos(e.abono) } : {}),
              ...(e.duracion ? { duracion: e.duracion } : {}), ...(e.edadSugerida ? { edad_sugerida: e.edadSugerida } : {}), ...(e.direccion ? { direccion: e.direccion } : {}),
              version: e.version, ...(e.fechaFicha ? { fecha_ficha: e.fechaFicha } : {}),
            })),
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
        const p = politicas(r).find((x) => x.clave === String(args.clave ?? ''));
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
      const total = exp.precioPersona * personas;
      const resumen = [
        'Revisa tu reserva:',
        `• ${exp.nombre}`,
        `• ${cuandoBogota(fun.inicio)}`,
        `• ${personas} ${personas === 1 ? 'persona' : 'personas'} · ${pesos(exp.precioPersona)} c/u · total ${pesos(total)}`,
        `• ${campos.nombre} · C.C. ${digitos(campos.cedula)} · Tel. ${digitos(campos.telefono)}`,
        '¿Está bien? Una persona del equipo te confirma el cupo y el pago.',
      ].join('\n');
      const propuesta: Propuesta = {
        accion: 'reserva',
        datos: { experiencia: exp.id, experiencia_version: exp.version, funcion: fun.id, inicio: fun.inicio, personas, nombre: campos.nombre, cedula: digitos(campos.cedula), telefono: digitos(campos.telefono), total },
        resumen, si: 'Sí, está bien', no: 'Corregir',
      };
      return { ok: true, propuesta };
    },

    async ejecutar(p) {
      // Etapa 1: confirmar no escribe ninguna reserva (cupos y pago son etapa 2). Pasa a persona con el resumen.
      return { lineas: [respuestaFija(r, 'rf.persona.reserva_lista') || respuestaFija(r, 'rf.persona')], escrituras: [{ tipo: 'persona', motivo: 'reserva_lista', datos: p.datos }] };
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
        ...(pasados.length ? [`Ya pasó a persona por: ${[...new Set(pasados)].join(', ')} (no repitas esos motivos salvo pide_persona).`] : []),
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
        const texto = respuestaFija(r, `rf.persona.${motivo}`) || respuestaFija(r, 'rf.persona');
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
        return { ok: false, error: `Usa una de: ${FIJAS_DEL_MODELO.join(', ')}.`, candado: 'fija_desconocida' };
      }
      return { ok: false, error: `No existe «${nombre}».`, candado: 'cierre_desconocido' };
    },
  };
}
