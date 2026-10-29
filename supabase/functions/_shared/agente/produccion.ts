// ============================================================
// Núcleo conversacional — los puertos de producción (Supabase, Meta, la extracción de hoy)
// ------------------------------------------------------------
// · `almacenSupabase`: `wa_conversacion` (lectura de 24 h, cierre del turno con su traza) y `tomar_candado`.
// · `mensajeroWa`: «escribiendo…», texto, botones y lista por `wa-respond.ts` (que deja cada envío en `wa_envios` y en
//   `wa_conversacion`).
// · `puertoBandejaSupabase`: el directorio con el guardián de siempre (`fichasPorNombre`, `fichasPorLlave`,
//   `crearContactoConGuardian`), los viajes con `calcularNiveles`, el negocio nuevo como lo crea la bandeja hoy
//   (`crearNegocio`, con la empresa espejo) y la carga con la extracción del núcleo (`bandeja/extraccion.ts`: el modelo
//   clasifica, el código solo valida) y `cargarEnExistente`, que no pisa lo que una persona editó.
// · `cargarReglamento`, `cupoSupabase` (el aviso del cupo sale por correo desde el 2026-10-26).
// · `caidaSupabase`, `alertarCaidaWa`: el correo inmediato si se caen los modelos (`caida.ts`).
// ============================================================

import { sendButtons, sendList, sendTextoConId, sendTypingIndicator } from '../wa-respond.ts';
import { sendCtaUrl } from '../wa-respond.ts';
import { crearContactoConGuardian, fichasPorLlave, fichasPorNombre } from '../wa-cliente.ts';
import type { Llave } from '../wa-cliente-reglas.ts';
import {
  bloquesDatosDelNegocio, configDeLinea, crearNegocio, escribirBloque, leerConModelo,
} from '../wa-entendimiento.ts';
import type { CampoEntendible, SalidaEntendida, Sugerido } from '../wa-entendimiento-reglas.ts';
import { cargarEnExistente, trazaCarga } from '../wa-carga-reglas.ts';
import { textoParaModelo } from '../wa-guardianes.ts';
import { lineaCargada, mensajesDeTextos, planDeCarga, propuestoDe, registradoDe, traeArchivo } from './bandeja/carga.ts';
import type { AdjuntoCarga, PlanCarga } from './bandeja/carga.ts';
import { bajarMedia, subirSoporte } from '../wa-media.ts';
import type { PuertoAdjuntos } from './adjuntos.ts';
import { esquemaCarga, esquemaCargaCompacta, instruccionesCarga, omitidosCompacta } from './bandeja/extraccion.ts';
import { aplanarBloques, calcularNiveles } from '../niveles-solicitud.ts';
import { todayBogotaISO } from '../bogota.ts';
import { renombrarSegunPlantilla } from '../nombre-viaje.ts';
import { CORREO_MAURICIO, enviarCorreoInterno, htmlDeTexto } from '../correo-interno.ts';
import type { CorreoInterno } from '../correo-interno.ts';
import { aliasConversacionWa, alertarSiCaido, caidaDelTurno } from './caida.ts';
import type { PuertosCaida } from './caida.ts';
import type { SupabaseClient } from '../types.ts';
import { fichaValida, huellaDe } from './reglamento.ts';
import type { MiembroEquipo, PuertoBandeja, ViajeAgente } from './bandeja/dominio.ts';
import { equipoDesdeFilas, staffDePrueba } from './bandeja/equipo.ts';
import type { AutorizacionAgente } from './bandeja/autorizacion.ts';
import { planGuardado } from '../perfil-contacto.ts';
import type { EstadoPerfil } from '../perfil-contacto.ts';
import type { PuertosCupo } from './uso.ts';
import type { Almacen, FilaConversacion, MediaFila, Mensajero, Reglamento, Salida, Traza } from './tipos.ts';

type Fila = Record<string, unknown>;
const COLUMNAS = 'id, workspace_id, phone, direccion, clase, formato, texto, opciones, toque_id, contexto_wamid, wa_message_id, media, turno_id, traza, created_at';

// ── Almacén ──────────────────────────────────────────────────────────────────

export function almacenSupabase(supabase: SupabaseClient): Almacen {
  return {
    async leer(workspaceId, phone, desdeIso) {
      const { data, error } = await supabase.from('wa_conversacion').select(COLUMNAS)
        .eq('workspace_id', workspaceId).eq('phone', phone.replace(/\D/g, '')).gte('created_at', desdeIso)
        .order('created_at', { ascending: true }).limit(500);
      if (error) throw new Error(`no se pudo leer la conversación: ${error.message}`);
      return (data ?? []) as FilaConversacion[];
    },
    async cerrarTurno(p) {
      const r = await Promise.all([
        supabase.from('wa_conversacion').update({ turno_id: p.turnoId }).in('id', p.filas),
        supabase.from('wa_conversacion').update({ traza: p.traza }).eq('id', p.filaTraza),
        p.salientes.length ? supabase.from('wa_conversacion').update({ turno_id: p.turnoId }).in('wa_message_id', p.salientes) : Promise.resolve({ error: null }),
      ]);
      for (const x of r) if (x.error) console.error('[agente] no se pudo cerrar el turno:', x.error.message);
    },
    async tomarCandado(clave, segundos) {
      const { data, error } = await supabase.rpc('tomar_candado', { p_clave: clave, p_segundos: Math.round(segundos) });
      if (error) {
        console.error('[agente] no se pudo tomar el candado:', error.message);
        return false;
      }
      return data === true;
    },
    async soltarCandado(clave) {
      const { error } = await supabase.from('claves_idempotencia').delete().eq('clave', clave).eq('ambito', 'candado');
      if (error) console.error('[agente] no se pudo soltar el candado:', error.message);
    },
  };
}

// ── Mensajero ────────────────────────────────────────────────────────────────

export function mensajeroWa(): Mensajero {
  return {
    escribiendo: (wamid) => sendTypingIndicator(wamid),
    async enviar(phone: string, s: Salida, ctx) {
      const envio = { origen: 'bot' as const, workspaceId: ctx.workspaceId, intent: ctx.intent };
      if (s.tipo === 'texto') return await sendTextoConId(phone, s.texto, envio);
      // El botón con link (paso a una persona, §4.2): `interactive.type = "cta_url"`, cuerpo ≤ 1024 y botón ≤ 20.
      if (s.tipo === 'enlace') return await sendCtaUrl(phone, s.texto, s.boton, s.url, envio);
      if (s.tipo === 'botones') return await sendButtons(phone, s.texto, s.opciones.map((o) => ({ id: o.id, title: o.titulo })), envio);
      return await sendList(phone, s.texto, s.boton, s.opciones.map((o) => ({ id: o.id, title: o.titulo, ...(o.descripcion ? { description: o.descripcion } : {}) })), envio);
    },
  };
}

// ── Reglamento ───────────────────────────────────────────────────────────────

const cacheReglamento = new Map<string, { r: Reglamento; vence: number }>();

/** La versión del puntero o la última publicada. `null` si no hay ninguna (el agente no corre). Caché de 60 s. */
export async function cargarReglamento(supabase: SupabaseClient, workspaceId: string, bot: string, id: string | null): Promise<Reglamento | null> {
  const k = `${workspaceId}|${bot}|${id ?? ''}`;
  const c = cacheReglamento.get(k);
  if (c && c.vence > Date.now()) return c.r;
  let q = supabase.from('bot_reglamentos').select('id, version, huella, fichas').eq('workspace_id', workspaceId).eq('bot', bot);
  q = id ? q.eq('id', id) : q.order('version', { ascending: false }).limit(1);
  const { data, error } = await q.maybeSingle();
  if (error || !data) {
    if (error) console.error('[agente] no se pudo leer el reglamento:', error.message);
    return null;
  }
  const fichas = ((Array.isArray(data.fichas) ? data.fichas : []) as unknown[]).map(fichaValida).filter((f): f is NonNullable<ReturnType<typeof fichaValida>> => !!f);
  const r: Reglamento = { id: data.id as string, version: Number(data.version), huella: String(data.huella || await huellaDe(fichas)), fichas };
  cacheReglamento.set(k, { r, vence: Date.now() + 60_000 });
  return r;
}

// ── Cupo ─────────────────────────────────────────────────────────────────────

export function cupoSupabase(supabase: SupabaseClient, almacen: Almacen): PuertosCupo {
  return {
    async turnosDelMes(workspaceId, mes) {
      const { data, error } = await supabase.rpc('bot_uso_mes', { p_workspace_id: workspaceId, p_mes: `${mes}-01` });
      if (error) {
        console.error('[agente] no se pudo contar el uso del mes:', error.message);
        return null;
      }
      return Number((data as { turnos?: number } | null)?.turnos ?? 0);
    },
    tomarCandado: (k, s) => almacen.tomarCandado(k, s),
    async avisar(texto, variables) {
      // A MéTRIK por correo, nunca al cliente (spec 2026-10-26, §4.1 punto 5: por WhatsApp se perdían fuera de la
      // ventana de 24 h). Un correo por umbral y por mes: el candado ya lo asegura y la llave de Resend también.
      const r = await enviarCorreoInterno(correoAvisoCupo(texto, variables));
      if (!r.ok) console.error('[agente] no salió el aviso del cupo:', r.error);
    },
  };
}

/** El correo del aviso del cupo de uso justo. Pura. */
export function correoAvisoCupo(texto: string, v: Record<string, string>): CorreoInterno {
  const asunto = Number(v.umbral) >= 100 ? 'pasó su cupo' : `va en el ${v.umbral} % del cupo`;
  return {
    to: CORREO_MAURICIO,
    subject: `Cupo del asistente: ${v.workspace} ${asunto} de ${v.mes}`,
    text: texto,
    html: htmlDeTexto(texto),
    idempotencyKey: `agente-cupo/${v.workspace}/${v.mes}/${v.umbral}`,
  };
}

// ── Caída de los modelos (spec 2026-10-26, §4.1) ─────────────────────────────

/**
 * Los puertos del correo de caída en WhatsApp (ONE y la bandeja): los candados del almacén, la cuenta de
 * conversaciones sin respuesta del modelo en la última hora (`wa_conversacion`, índice parcial de las trazas del
 * modelo) y Resend.
 */
export function caidaSupabase(supabase: SupabaseClient, almacen: Pick<Almacen, 'tomarCandado' | 'soltarCandado'>, workspaceId: string): PuertosCaida {
  return {
    tomarCandado: (k, s) => almacen.tomarCandado(k, s),
    soltarCandado: (k) => almacen.soltarCandado(k),
    async sinRespuesta(desdeIso) {
      const { data, error } = await supabase.from('wa_conversacion').select('phone')
        .eq('workspace_id', workspaceId).gte('created_at', desdeIso).eq('traza->>tipo', 'modelo').like('traza->>error', 'modelo:%').limit(2000);
      if (error) return null;
      return new Set(((data ?? []) as Fila[]).map((x) => String(x.phone))).size;
    },
    enviarCorreo: (m) => enviarCorreoInterno(m),
  };
}

/** El correo si se cayeron los modelos en un turno de WhatsApp. Nunca lanza (ver `alertarSiCaido`). */
export async function alertarCaidaWa(
  supabase: SupabaseClient, almacen: Pick<Almacen, 'tomarCandado' | 'soltarCandado'>, traza: Traza,
  o: { workspaceId: string; workspaceNombre: string; canal: 'one' | 'bandeja'; phone: string; turnoId: string | null },
): Promise<void> {
  if (!caidaDelTurno(traza)) return;
  await alertarSiCaido(caidaSupabase(supabase, almacen, o.workspaceId), traza, {
    workspaceId: o.workspaceId, workspaceNombre: o.workspaceNombre, canal: o.canal,
    conversacion: await aliasConversacionWa(o.workspaceId, o.phone), turnoId: o.turnoId, ahoraMs: Date.now(),
  });
}

// ── La bandeja ───────────────────────────────────────────────────────────────


/** El CHECK de `activity_log.contenido` en producción. */
export const MAX_CONTENIDO_ACTIVIDAD = 280;

/** Corta en 280 con «…» (cuenta caracteres, no bytes). Pura. */
export function cortarContenido(s: string): string {
  const c = [...s];
  return c.length <= MAX_CONTENIDO_ACTIVIDAD ? s : `${c.slice(0, MAX_CONTENIDO_ACTIVIDAD - 1).join('')}…`;
}

/**
 * Los adjuntos de la conversación (foto o PDF, 2026-10-21), igual que el dominio ONE (`one/puerto-supabase.ts`): se bajan
 * de Meta, se suben al llegar a `gastos-soportes/<ws>/whatsapp/<fila>` (el bucket de los archivos que llegan por
 * WhatsApp; la app lo abre por `/api/archivos/abrir`, que valida el workspace de la ruta) y lo preparado se anota en
 * `wa_conversacion.media`.
 */
export function puertoAdjuntosSupabase(supabase: SupabaseClient, workspaceId: string): PuertoAdjuntos {
  return {
    async bajarAdjunto(mediaId) {
      const m = await bajarMedia(mediaId);
      return m ? { bytes: m.buffer, mime: m.mimeType } : null;
    },
    guardarAdjunto: (filaId, archivo) => subirSoporte(supabase, workspaceId, `whatsapp/${filaId}`, { buffer: archivo.bytes, mimeType: archivo.mime }),
    async anotarMedia(filaId: string, media: MediaFila) {
      try {
        const { error } = await supabase.from('wa_conversacion').update({ media }).eq('id', filaId).eq('workspace_id', workspaceId);
        if (error) console.error('[agente] no se pudo anotar el adjunto en la conversación:', error.message);
      } catch (err) {
        console.error('[agente] no se pudo anotar el adjunto en la conversación:', err);
      }
    },
  };
}

/** La línea de la actividad del viaje por un archivo que quedó de soporte (≤ 280: CHECK de `activity_log.contenido`). Pura. */
export function contenidoSoporte(a: Pick<AdjuntoCarga, 'tipo' | 'nombre'>): string {
  const que = a.tipo === 'documento' ? `PDF «${(a.nombre ?? 'sin nombre').slice(0, 120)}»` : 'foto';
  return `📎 Soporte que llegó por WhatsApp (${que}), cargado con el bot.`;
}

function relUno(v: unknown): Fila | null {
  return Array.isArray(v) ? (v[0] as Fila | undefined) ?? null : (v as Fila | null) ?? null;
}

export function puertoBandejaSupabase(
  supabase: SupabaseClient, workspaceId: string, staffId: string | null, o: { extraccionCompacta?: boolean; adjuntos?: boolean } = {},
): PuertoBandeja {
  const leerViaje = async (codigo: string): Promise<ViajeAgente | null | 'error'> => {
    const { data: neg, error } = await supabase.from('negocios').select('id, codigo, nombre, estado, contacto_id, contactos(nombre)')
      .eq('workspace_id', workspaceId).eq('codigo', codigo).maybeSingle();
    if (error) return 'error';
    if (!neg) return null;
    const bloques = await bloquesDatosDelNegocio(supabase, neg.id as string);
    if (typeof bloques === 'string') return 'error';
    const { fields, valores } = aplanarBloques(bloques.map((b) => ({ fields: b.fields, data: b.data })));
    const n = calcularNiveles(fields as CampoEntendible[], valores);
    return {
      id: neg.id as string,
      codigo: String(neg.codigo),
      nombre: String(neg.nombre ?? ''),
      cliente: (relUno(neg.contactos)?.nombre as string | undefined) ?? null,
      contactoId: (neg.contacto_id as string | null) ?? null,
      destino: typeof valores.destino === 'string' ? valores.destino : null,
      abierto: neg.estado === 'abierto',
      faltaCotizar: n.minimo.faltan.map((f) => f.label),
      faltaCompleto: [...n.minimo.faltan, ...n.deseable.faltan].map((f) => f.label),
      registrado: registradoDe(fields as CampoEntendible[], valores),
    };
  };

  const equipoComercial = async (): Promise<MiembroEquipo[] | 'error'> => {
    const [st, ws] = await Promise.all([
      supabase.from('staff').select('id, full_name, is_active, staff_areas(area)').eq('workspace_id', workspaceId).eq('is_active', true).limit(200),
      supabase.from('workspaces').select('config_extra').eq('id', workspaceId).maybeSingle(),
    ]);
    if (st.error || ws.error) {
      console.error('[agente] no se pudo leer el equipo comercial:', (st.error ?? ws.error)?.message);
      return 'error';
    }
    const filas = ((st.data ?? []) as Fila[]).map((f) => ({
      id: String(f.id), full_name: (f.full_name as string | null) ?? null, is_active: f.is_active === true,
      areas: (Array.isArray(f.staff_areas) ? f.staff_areas as Fila[] : []).map((a) => String(a.area)),
    }));
    return equipoDesdeFilas(filas, staffDePrueba(ws.data?.config_extra), staffId);
  };

  /** El `profiles.id` de quien escribe: es `assigned_by` (y con eso el trigger sabe si se asignó a sí misma). */
  const perfilDeQuienEscribe = async (): Promise<string | null> => {
    if (!staffId) return null;
    const { data } = await supabase.from('staff').select('profile_id').eq('id', staffId).eq('workspace_id', workspaceId).maybeSingle();
    return (data?.profile_id as string | null | undefined) ?? null;
  };

  return {
    equipoComercial,
    // Leer adjuntos (2026-10-21): con `adjuntos` (el interruptor `agente_config.leer_adjuntos`, por defecto sí).
    ...(o.adjuntos ? {
      adjuntos: puertoAdjuntosSupabase(supabase, workspaceId),
      async soportesEnViaje(viajeId: string, adjuntos: AdjuntoCarga[]) {
        // El viaje es de este workspace (la propuesta ya lo validó; se vuelve a mirar al escribir).
        const { data: neg, error: errN } = await supabase.from('negocios').select('id').eq('id', viajeId).eq('workspace_id', workspaceId).maybeSingle();
        if (errN) throw new Error(`no se pudo revisar el viaje: ${errN.message}`);
        if (!neg) throw new Error('el viaje no es de este workspace');
        // Solo referencias de ESTE workspace (`one://gastos-soportes/<ws>/…`): la fila de la conversación las dejó así.
        const propias = adjuntos.filter((a) => a.ref.startsWith(`one://gastos-soportes/${workspaceId}/`));
        if (!propias.length) throw new Error('ningún archivo es de este workspace');
        const { error } = await supabase.from('activity_log').insert(propias.map((a) => ({
          workspace_id: workspaceId, entidad_tipo: 'negocio', entidad_id: viajeId, tipo: 'comentario', autor_id: staffId,
          contenido: contenidoSoporte(a), link_url: a.ref,
        })));
        if (error) throw new Error(`no se pudo dejar el soporte en la actividad: ${error.message}`);
      },
    } : {}),
    async linea() {
      const cfg = await configDeLinea(supabase, workspaceId);
      if (typeof cfg === 'string') return 'la línea de la bandeja';
      const { data } = await supabase.from('lineas_negocio').select('nombre').eq('id', cfg.lineaId).maybeSingle();
      return String(data?.nombre ?? 'la línea de la bandeja');
    },
    porNombre: (t) => fichasPorNombre(supabase, workspaceId, t),
    porLlave: (l) => fichasPorLlave(supabase, workspaceId, l),
    viaje: leerViaje,
    async codigosExistentes(candidatos) {
      if (!candidatos.length) return [];
      const { data, error } = await supabase.from('negocios').select('codigo').eq('workspace_id', workspaceId).in('codigo', candidatos.slice(0, 20));
      if (error) return 'error';
      return ((data ?? []) as Fila[]).map((x) => String(x.codigo));
    },
    async crearViaje(p) {
      // Se vuelve a validar al escribir: entre la propuesta y el toque la persona pudo salir del equipo comercial.
      const [eq, cfg, asignadoPor] = await Promise.all([equipoComercial(), configDeLinea(supabase, workspaceId), perfilDeQuienEscribe()]);
      if (eq === 'error') throw new Error('no se pudo revisar el equipo comercial');
      if (!eq.some((m) => m.id === p.responsableId)) throw new Error('quien iba a llevar el viaje ya no es del equipo comercial activo');
      if (typeof cfg === 'string') throw new Error(cfg);
      const sugeridos: Record<string, Sugerido> = p.destino ? { destino: { valor: p.destino, frase: p.destino } } : {};
      const salida: SalidaEntendida = { historia: '', cliente: { nombre: null, telefono: null }, sugeridos, descartados: [] };
      const r = await crearNegocio(supabase, {
        workspaceId, cfg, contactoId: p.contactoId, entregaId: 'agente', staffId, salida, pistas: { mes: null, duracion: null },
        responsable: { staffId: p.responsableId, asignadoPor },
      });
      if (typeof r === 'string') throw new Error(r);
      const { data } = await supabase.from('negocios').select('codigo, nombre').eq('id', r.negocioId).maybeSingle();
      return { id: r.negocioId, codigo: String(data?.codigo ?? ''), nombre: String(data?.nombre ?? '') };
    },
    async prepararCarga(viajeId, textos, previo, oc) {
      const bloques = await bloquesDatosDelNegocio(supabase, viajeId);
      if (typeof bloques === 'string') throw new Error(bloques);
      const { fields, valores: yaTiene } = aplanarBloques(bloques.map((b) => ({ fields: b.fields, data: b.data })));
      const campos = fields as CampoEntendible[];
      const compacta = o.extraccionCompacta === true;
      const t0 = performance.now();
      const lectura = await leerConModelo(
        // `perfil`: lo de la persona sale aparte y va a su perfil como sugerido con el toque de la carga.
        // `documentos`: algún texto trae lo leído de una foto o un PDF (sin archivos, el prompt de siempre).
        // `preguntas`: lo ya preguntado del viaje no se vuelve a preguntar; `reenviados`: quién dijo cada texto.
        instruccionesCarga(campos, todayBogotaISO(), yaTiene, propuestoDe(previo), undefined, { compacta, perfil: true, documentos: textos.some(traeArchivo), preguntas: (oc?.preguntas ?? []).map((q) => q.texto) }),
        `Mensajes:\n${textoParaModelo(mensajesDeTextos(textos, oc?.reenviados))}`,
        compacta ? esquemaCargaCompacta(campos, { perfil: true }) : esquemaCarga(campos, { perfil: true }),
      );
      if (lectura.error || lectura.json === null) throw new Error(lectura.error ?? 'sin lectura');
      if (compacta) {
        // Para medir la compacta en vivo: cuánto tardó y si se saltó campos (ni en datos ni en sin_dato).
        const omitidos = omitidosCompacta(lectura.json, campos);
        console.log(`[agente] extracción compacta ${Math.round(performance.now() - t0)} ms${omitidos.length ? `; omitió ${omitidos.join(', ')}` : ''}`);
      }
      return planDeCarga({
        bloques: bloques.map((b) => ({ fields: b.fields as CampoEntendible[], data: b.data })), textos, raw: lectura.json,
        hoyISO: todayBogotaISO(), ahoraIso: new Date().toISOString(), previo, preguntas: oc?.preguntas,
      });
    },
    async cargar(viajeId, plan) {
      const { sugeridos, historia, quitar } = plan as PlanCarga;
      const bloques = await bloquesDatosDelNegocio(supabase, viajeId);
      if (typeof bloques === 'string') throw new Error(bloques);
      const meta = { entrega_id: 'agente', en: new Date().toISOString(), origenDe: () => 'mensaje' as const };
      const vistos = new Set<string>();
      const escritos: string[] = [];
      const quitados: string[] = [];
      const campos: CampoEntendible[] = [];
      const opts = { delModelo: true, ...(quitar ? { quitar } : {}) };
      for (const b of bloques) {
        const antes = new Set(vistos);
        for (const f of b.fields) { vistos.add(f.slug); campos.push(f); }
        let r = cargarEnExistente(b.data, b.fields, sugeridos, meta, new Set(antes), opts);
        const quedo = await escribirBloque(supabase, b, (d) => {
          r = cargarEnExistente(d, b.fields, sugeridos, meta, new Set(antes), opts);
          return r.escritos.length > 0 || r.conflictos.length > 0 || r.actualizados.length > 0 || r.quitados.length > 0 ? r.data : null;
        });
        if (quedo) {
          escritos.push(...r.escritos, ...r.actualizados.map((a) => a.slug));
          quitados.push(...r.quitados);
        }
      }
      // El nombre automático del viaje sigue a sus campos (destino, fechas), si nadie lo renombró a mano.
      if (escritos.length || quitados.length) await renombrarSegunPlantilla(supabase, viajeId, [...escritos, ...quitados]);
      const { data: neg } = await supabase.from('negocios').select('codigo').eq('id', viajeId).maybeSingle();
      const { error } = await supabase.from('activity_log').insert({
        workspace_id: workspaceId, entidad_tipo: 'negocio', entidad_id: viajeId, tipo: 'cambio_sistema', autor_id: staffId,
        // `activity_log.contenido` tiene CHECK de 280 caracteres en producción (medido el 2026-10-07): más largo, el
        // insert falla y la traza se pierde. Se corta aquí; la historia completa queda en la traza del turno.
        contenido: cortarContenido(trazaCarga({ quien: '', fechaISO: todayBogotaISO(), escritos, quitados, conflictos: [], fields: campos, historia })),
      });
      if (error) console.error('[agente] sin traza en la actividad del negocio:', error.message);
      const valoresEscritos = Object.fromEntries(Object.entries(sugeridos).map(([k, x]) => [k, x.valor]));
      return { lineas: [lineaCargada(String(neg?.codigo ?? 'el viaje'), escritos, campos, quitados)], escritos: registradoDe(campos, valoresEscritos, escritos) };
    },
    async autorizacion(contactoId: string): Promise<AutorizacionAgente | 'error'> {
      // La regla de vigencia es la de la app: la RPC `autorizacion_datos_estado` (migración 20261008230000).
      const { data: est, error } = await supabase.rpc('autorizacion_datos_estado', { p_workspace_id: workspaceId, p_contacto_id: contactoId });
      if (error || !est || est.existe !== true) {
        if (error) console.error('[agente] no se pudo leer la autorización:', error.message);
        return 'error';
      }
      if (est.vigente?.generales === true) {
        return { estado: 'autorizado', fecha: String(est.aceptacion?.aceptado_at ?? ''), menores: est.vigente?.menores === true };
      }
      if (!est.texto?.id) return { estado: 'sin_texto' };
      const [ws, txt] = await Promise.all([
        supabase.from('workspaces').select('slug, name, config_extra').eq('id', workspaceId).maybeSingle(),
        supabase.from('autorizacion_datos_textos').select('variables, mensajes').eq('id', est.texto.id).maybeSingle(),
      ]);
      const slug = ws.data?.slug as string | undefined;
      if (!slug) return 'error';
      const dias = Number(((ws.data?.config_extra as Fila | null)?.autorizacion_datos as Fila | undefined)?.dias_enlace);
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const { data: en, error: errEn } = await supabase.rpc('autorizacion_datos_enlace', {
        p_workspace_id: workspaceId, p_contacto_id: contactoId, p_token_nuevo: token, p_creado_por: staffId, p_negocio_id: null,
        p_dias: Number.isInteger(dias) && dias >= 2 && dias <= 365 ? dias : 60,
      });
      if (errEn || !en?.ok) {
        console.error('[agente] no se pudo crear el link de autorización:', errEn?.message ?? en?.error);
        return 'error';
      }
      const base = (Deno.env.get('APP_BASE_DOMAIN') || 'metrikone.co').trim();
      const variables = (txt.data?.variables ?? {}) as Record<string, unknown>;
      const mensajes = (txt.data?.mensajes ?? {}) as Record<string, unknown>;
      const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
      return {
        estado: 'pendiente',
        url: `https://${slug}.${base}/autorizacion/${en.token}?m=w`,
        agencia: texto(variables.agencia) ?? String(ws.data?.name ?? 'la agencia'),
        whatsapp: texto(mensajes.whatsapp),
        instruccion: texto(mensajes.instruccion_comercial),
      };
    },
    async autorizado(contactoId: string) {
      // Solo lee (no crea enlaces). La regla de vigencia es la de la app y del gate: la RPC.
      const { data: est, error } = await supabase.rpc('autorizacion_datos_estado', { p_workspace_id: workspaceId, p_contacto_id: contactoId });
      if (error || !est || est.existe !== true) {
        if (error) console.error('[agente] no se pudo leer la autorización:', error.message);
        return 'error' as const;
      }
      return est.vigente?.generales === true;
    },
    async perfilDe(contactoId: string) {
      const { data, error } = await supabase.from('contacto_perfil_hechos').select('id, texto, estado')
        .eq('workspace_id', workspaceId).eq('contacto_id', contactoId).limit(500);
      if (error) {
        console.error('[agente] no se pudo leer el perfil:', error.message);
        return 'error' as const;
      }
      return ((data ?? []) as Fila[]).map((x) => ({ id: String(x.id), texto: String(x.texto ?? ''), estado: x.estado as EstadoPerfil }));
    },
    async guardarPerfil(p) {
      // El contacto es de este workspace (el trigger de la tabla lo vuelve a exigir, con la autorización vigente).
      const { data: c, error: errC } = await supabase.from('contactos').select('id').eq('id', p.contactoId).eq('workspace_id', workspaceId).maybeSingle();
      if (errC) throw new Error(`no se pudo revisar el contacto: ${errC.message}`);
      if (!c) throw new Error('el contacto no es de este workspace');
      const { data: ex, error: errEx } = await supabase.from('contacto_perfil_hechos').select('id, texto, estado')
        .eq('workspace_id', workspaceId).eq('contacto_id', p.contactoId).limit(500);
      if (errEx) throw new Error(`no se pudo leer el perfil: ${errEx.message}`);
      const existentes = ((ex ?? []) as Fila[]).map((x) => ({ id: String(x.id), texto: String(x.texto ?? ''), estado: x.estado as EstadoPerfil }));
      const plan = planGuardado(p.hechos, existentes, p.estado);
      const ahora = new Date().toISOString();
      if (plan.insertar.length) {
        const { error } = await supabase.from('contacto_perfil_hechos').insert(plan.insertar.map((h) => ({
          workspace_id: workspaceId, contacto_id: p.contactoId, dimension: h.dimension, texto: h.texto, estado: p.estado,
          origen_tipo: p.origenTipo, origen_ref: h.origenRef, creado_por: staffId,
          ...(p.estado === 'confirmado' ? { confirmado_por: staffId, confirmado_at: ahora } : {}),
        })));
        if (error) throw new Error(`no se pudo guardar en el perfil: ${error.message}`);
      }
      for (const x of plan.confirmar) {
        const { error } = await supabase.from('contacto_perfil_hechos').update({ estado: 'confirmado', confirmado_por: staffId, confirmado_at: ahora })
          .eq('id', x.id).eq('workspace_id', workspaceId).eq('estado', 'sugerido');
        if (error) throw new Error(`no se pudo confirmar en el perfil: ${error.message}`);
      }
      return { guardados: [...plan.insertar, ...plan.confirmar.map((x) => x.hecho)], yaEstaban: plan.yaEstaban };
    },
    async crearCliente(nombre: string, llave: Llave) {
      const r = await crearContactoConGuardian(supabase, workspaceId, { nombre, llave });
      if (r.tipo === 'creado') return { ok: true as const, id: r.id, nombre: nombre.toUpperCase() };
      return { ok: false as const, motivo: r.tipo === 'error' ? r.motivo : `no se creó: ${r.resolucion.tipo}` };
    },
  };
}

export type { Traza };
