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
// · `cargarReglamento`, `cupoSupabase`.
// ============================================================

import { sendButtons, sendList, sendTextoConId, sendTypingIndicator } from '../wa-respond.ts';
import { crearContactoConGuardian, fichasPorLlave, fichasPorNombre } from '../wa-cliente.ts';
import type { Llave } from '../wa-cliente-reglas.ts';
import {
  bloquesDatosDelNegocio, configDeLinea, crearNegocio, escribirBloque, leerConModelo,
} from '../wa-entendimiento.ts';
import type { CampoEntendible, SalidaEntendida, Sugerido } from '../wa-entendimiento-reglas.ts';
import { cargarEnExistente, trazaCarga } from '../wa-carga-reglas.ts';
import { textoParaModelo } from '../wa-guardianes.ts';
import { lineaCargada, mensajesDeTextos, planDeCarga, registradoDe } from './bandeja/carga.ts';
import { esquemaCarga, instruccionesCarga } from './bandeja/extraccion.ts';
import { aplanarBloques, calcularNiveles } from '../niveles-solicitud.ts';
import { todayBogotaISO } from '../bogota.ts';
import { enviarAvisoInterno } from '../wa-alerta.ts';
import type { SupabaseClient } from '../types.ts';
import { fichaValida, huellaDe } from './reglamento.ts';
import type { PuertoBandeja, ViajeAgente } from './bandeja/dominio.ts';
import type { PuertosCupo } from './uso.ts';
import type { Almacen, FilaConversacion, Mensajero, Reglamento, Salida, Traza } from './tipos.ts';

type Fila = Record<string, unknown>;
const COLUMNAS = 'id, workspace_id, phone, direccion, clase, formato, texto, opciones, toque_id, contexto_wamid, wa_message_id, turno_id, traza, created_at';

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
      // El canal de avisos internos de siempre (el mismo del número desconocido): a MéTRIK, nunca al cliente.
      const admin = (Deno.env.get('WA_ADMIN_NOTIFY_PHONE') || '').replace(/\D/g, '');
      if (!admin) {
        console.warn('[agente] cupo de uso justo sin avisar: falta WA_ADMIN_NOTIFY_PHONE');
        return;
      }
      await enviarAvisoInterno(admin, 'agente_cupo', texto, variables);
    },
  };
}

// ── La bandeja ───────────────────────────────────────────────────────────────

/** El CHECK de `activity_log.contenido` en producción. */
export const MAX_CONTENIDO_ACTIVIDAD = 280;

/** Corta en 280 con «…» (cuenta caracteres, no bytes). Pura. */
export function cortarContenido(s: string): string {
  const c = [...s];
  return c.length <= MAX_CONTENIDO_ACTIVIDAD ? s : `${c.slice(0, MAX_CONTENIDO_ACTIVIDAD - 1).join('')}…`;
}

function relUno(v: unknown): Fila | null {
  return Array.isArray(v) ? (v[0] as Fila | undefined) ?? null : (v as Fila | null) ?? null;
}

export function puertoBandejaSupabase(supabase: SupabaseClient, workspaceId: string, staffId: string | null): PuertoBandeja {
  const leerViaje = async (codigo: string): Promise<ViajeAgente | null | 'error'> => {
    const { data: neg, error } = await supabase.from('negocios').select('id, codigo, nombre, estado, contactos(nombre)')
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
      destino: typeof valores.destino === 'string' ? valores.destino : null,
      abierto: neg.estado === 'abierto',
      faltaCotizar: n.minimo.faltan.map((f) => f.label),
      faltaCompleto: [...n.minimo.faltan, ...n.deseable.faltan].map((f) => f.label),
      registrado: registradoDe(fields as CampoEntendible[], valores),
    };
  };

  return {
    async linea() {
      const cfg = await configDeLinea(supabase, workspaceId);
      if (typeof cfg === 'string') return 'la línea de la bandeja';
      const { data } = await supabase.from('lineas_negocio').select('nombre').eq('id', cfg.lineaId).maybeSingle();
      return String(data?.nombre ?? 'la línea de la bandeja');
    },
    porNombre: (t) => fichasPorNombre(supabase, workspaceId, t),
    porLlave: (l) => fichasPorLlave(supabase, workspaceId, l),
    viaje: leerViaje,
    async crearViaje(p) {
      const cfg = await configDeLinea(supabase, workspaceId);
      if (typeof cfg === 'string') throw new Error(cfg);
      const sugeridos: Record<string, Sugerido> = p.destino ? { destino: { valor: p.destino, frase: p.destino } } : {};
      const salida: SalidaEntendida = { historia: '', cliente: { nombre: null, telefono: null }, sugeridos, descartados: [] };
      const r = await crearNegocio(supabase, { workspaceId, cfg, contactoId: p.contactoId, entregaId: 'agente', staffId, salida, pistas: { mes: null, duracion: null } });
      if (typeof r === 'string') throw new Error(r);
      const { data } = await supabase.from('negocios').select('codigo, nombre').eq('id', r.negocioId).maybeSingle();
      return { id: r.negocioId, codigo: String(data?.codigo ?? ''), nombre: String(data?.nombre ?? '') };
    },
    async prepararCarga(viajeId, textos, previo) {
      const bloques = await bloquesDatosDelNegocio(supabase, viajeId);
      if (typeof bloques === 'string') throw new Error(bloques);
      const { fields, valores: yaTiene } = aplanarBloques(bloques.map((b) => ({ fields: b.fields, data: b.data })));
      const campos = fields as CampoEntendible[];
      const lectura = await leerConModelo(instruccionesCarga(campos, todayBogotaISO(), yaTiene), `Mensajes:\n${textoParaModelo(mensajesDeTextos(textos))}`, esquemaCarga(campos));
      if (lectura.error || lectura.json === null) throw new Error(lectura.error ?? 'sin lectura');
      return planDeCarga({
        bloques: bloques.map((b) => ({ fields: b.fields as CampoEntendible[], data: b.data })), textos, raw: lectura.json,
        hoyISO: todayBogotaISO(), ahoraIso: new Date().toISOString(), previo,
      });
    },
    async cargar(viajeId, plan) {
      const { sugeridos, historia } = plan as { sugeridos: Record<string, Sugerido>; historia: string };
      const bloques = await bloquesDatosDelNegocio(supabase, viajeId);
      if (typeof bloques === 'string') throw new Error(bloques);
      const meta = { entrega_id: 'agente', en: new Date().toISOString(), origenDe: () => 'mensaje' as const };
      const vistos = new Set<string>();
      const escritos: string[] = [];
      const campos: CampoEntendible[] = [];
      for (const b of bloques) {
        const antes = new Set(vistos);
        for (const f of b.fields) { vistos.add(f.slug); campos.push(f); }
        let r = cargarEnExistente(b.data, b.fields, sugeridos, meta, new Set(antes), { delModelo: true });
        const quedo = await escribirBloque(supabase, b, (d) => {
          r = cargarEnExistente(d, b.fields, sugeridos, meta, new Set(antes), { delModelo: true });
          return r.escritos.length > 0 || r.conflictos.length > 0 || r.actualizados.length > 0 ? r.data : null;
        });
        if (quedo) escritos.push(...r.escritos, ...r.actualizados.map((a) => a.slug));
      }
      const { data: neg } = await supabase.from('negocios').select('codigo').eq('id', viajeId).maybeSingle();
      const { error } = await supabase.from('activity_log').insert({
        workspace_id: workspaceId, entidad_tipo: 'negocio', entidad_id: viajeId, tipo: 'cambio_sistema', autor_id: staffId,
        // `activity_log.contenido` tiene CHECK de 280 caracteres en producción (medido el 2026-10-07): más largo, el
        // insert falla y la traza se pierde. Se corta aquí; la historia completa queda en la traza del turno.
        contenido: cortarContenido(trazaCarga({ quien: '', fechaISO: todayBogotaISO(), escritos, conflictos: [], fields: campos, historia })),
      });
      if (error) console.error('[agente] sin traza en la actividad del negocio:', error.message);
      const valoresEscritos = Object.fromEntries(Object.entries(sugeridos).map(([k, x]) => [k, x.valor]));
      return { lineas: [lineaCargada(String(neg?.codigo ?? 'el viaje'), escritos, campos)], escritos: registradoDe(campos, valoresEscritos, escritos) };
    },
    async crearCliente(nombre: string, llave: Llave) {
      const r = await crearContactoConGuardian(supabase, workspaceId, { nombre, llave });
      if (r.tipo === 'creado') return { ok: true as const, id: r.id, nombre: nombre.toUpperCase() };
      return { ok: false as const, motivo: r.tipo === 'error' ? r.motivo : `no se creó: ${r.resolucion.tipo}` };
    },
  };
}

export type { Traza };
