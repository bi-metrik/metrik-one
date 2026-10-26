// ============================================================
// Dominio ONE — el puerto de producción (Supabase y Meta), 2026-10-21
// ------------------------------------------------------------
// Escribe EXACTAMENTE como el bot de siempre, para que un gasto del modo agente sea igual a uno de antes en la app:
//   · el gasto: las columnas de `executeW01` (`handlers/registro/execute.ts`): canal whatsapp, `soporte_pendiente`,
//     `created_by_wa_name`, `mensaje_original`, tipo `directo`/`empresa` y el centro de costos de `proponerCentroCostosWA`;
//   · el soporte: `downloadAndStoreImage` (referencia `one://gastos-soportes/…`) y `soporte_pendiente = false`;
//   · la actividad: `activity_log` tipo comentario como `persistActividad` (autor = staff del remitente; sin staff, el
//     nombre entre corchetes) y el `updated_at` del negocio;
//   · el contacto: el insert de `executeW06`, después de `buscar_contacto_duplicado`.
// Los negocios salen de `wa_find_negocios` (20261021093000): código normalizado, nombre, empresa o contacto.
// ============================================================

import type { SupabaseClient, WaUser } from '../../types.ts';
import { proponerCentroCostosWA } from '../../centro-costos.ts';
import { bajarMedia, downloadAndStoreImage, subirSoporte } from '../../wa-media.ts';
import type { MediaFila } from '../tipos.ts';
import { descripcionParaGuardar } from '../../wa-gasto-descripcion.ts';
import { tieneServiciosPorPagar } from '../../handlers/registro/servicio-viaje.ts';
import { EMOJI_ACTIVIDAD } from './dominio.ts';
import { comentariosDeActividad, filasDeComentarios } from '../../comentario-actividad.ts';
import type { CobroPendiente, GastoOne, NegocioOne, PuertoOne } from './dominio.ts';
import { confirmarPagoCobroProgramado } from '../../confirmar-cobro-programado.ts';

type Fila = Record<string, unknown>;
const uno = (v: unknown): Fila | null => (Array.isArray(v) ? (v[0] as Fila | undefined) ?? null : (v as Fila | null) ?? null);

function negocioDeRpc(f: Fila): NegocioOne {
  const valor = Number(f.precio_aprobado ?? f.precio_estimado);
  return {
    id: String(f.id), codigo: String(f.codigo ?? ''), nombre: String(f.nombre ?? ''),
    empresa: (f.empresa_nombre as string | null) ?? null, contacto: (f.contacto_nombre as string | null) ?? null,
    etapa: (f.stage_actual as string | null) ?? null, valor: Number.isFinite(valor) && valor > 0 ? valor : null,
    coincidencia: f.coincidencia as NegocioOne['coincidencia'],
  };
}

function negocioDeTabla(f: Fila): NegocioOne {
  const valor = Number(f.precio_aprobado ?? f.precio_estimado);
  return {
    id: String(f.id), codigo: String(f.codigo ?? ''), nombre: String(f.nombre ?? ''),
    empresa: (uno(f.empresas)?.nombre as string | undefined) ?? null, contacto: (uno(f.contactos)?.nombre as string | undefined) ?? null,
    etapa: (f.stage_actual as string | null) ?? null, valor: Number.isFinite(valor) && valor > 0 ? valor : null,
  };
}

function gastoDeTabla(f: Fila): GastoOne {
  return {
    id: String(f.id), fecha: String(f.fecha ?? '').slice(0, 10), monto: Number(f.monto) || 0, categoria: String(f.categoria ?? 'otros'),
    descripcion: String(f.descripcion ?? ''), negocio: (uno(f.negocios)?.codigo as string | undefined) ?? null,
    soporte: f.soporte_pendiente === false || !!f.soporte_url,
    ...(f.revisado === true ? { revisado: true } : {}),
  };
}

export function puertoOneSupabase(supabase: SupabaseClient, user: WaUser): PuertoOne {
  const ws = user.workspace_id;

  const rpcNegocios = async (hint: string, limite: number): Promise<Fila[] | 'error'> => {
    const { data, error } = await supabase.rpc('wa_find_negocios', { p_workspace_id: ws, p_hint: hint, p_limit: limite });
    if (error) {
      console.error('[agente-one] wa_find_negocios:', error.message);
      return 'error';
    }
    return (data ?? []) as Fila[];
  };

  // El soporte: la referencia del archivo ya subido al llegar (`ref`, foto o PDF) o, si no se alcanzó, se baja de Meta
  // como siempre. Mismo bucket (`gastos-soportes`), misma columna (`gastos.soporte_url`) y `soporte_pendiente = false`.
  const guardarSoporte = async (gastoId: string, mediaId: string, ref?: string | null): Promise<boolean> => {
    const referencia = ref || await downloadAndStoreImage(supabase, mediaId, ws, gastoId);
    if (!referencia) return false;
    const { error } = await supabase.from('gastos').update({ soporte_url: referencia, soporte_pendiente: false }).eq('id', gastoId).eq('workspace_id', ws);
    if (error) {
      console.error('[agente-one] no se pudo marcar el soporte:', error.message);
      return false;
    }
    return true;
  };

  return {
    async buscarNegocios(texto, limite) {
      const r = await rpcNegocios(texto, limite);
      return r === 'error' ? r : r.map(negocioDeRpc);
    },
    async negociosAbiertos(etapa, limite) {
      const { data, error } = await supabase.from('negocios')
        .select('id, codigo, nombre, stage_actual, precio_estimado, precio_aprobado, updated_at, empresas(nombre), contactos(nombre)')
        .eq('workspace_id', ws).eq('estado', 'abierto').order('updated_at', { ascending: false }).limit(500);
      if (error) {
        console.error('[agente-one] negocios abiertos:', error.message);
        return 'error';
      }
      const todos = ((data ?? []) as Fila[]).map(negocioDeTabla);
      const porEtapa: Record<string, number> = {};
      for (const n of todos) porEtapa[n.etapa ?? 'venta'] = (porEtapa[n.etapa ?? 'venta'] ?? 0) + 1;
      const filtrados = etapa ? todos.filter((n) => n.etapa === etapa) : todos;
      return { total: filtrados.length, porEtapa, negocios: filtrados.slice(0, limite) };
    },
    async negocioPorCodigo(codigo) {
      // La RPC normaliza el código («i1-26-5» = «I1 26 5») y, si casa, devuelve solo ese con `coincidencia = 'codigo'`.
      const r = await rpcNegocios(codigo, 1);
      if (r === 'error') return r;
      const f = r.find((x) => x.coincidencia === 'codigo');
      return f ? negocioDeRpc(f) : null;
    },
    async serviciosPorPagar(negocioId) {
      try {
        return await tieneServiciosPorPagar(supabase, ws, negocioId);
      } catch (e) {
        console.error('[agente-one] servicios del viaje:', e);
        return 'error';
      }
    },
    async centroCostos({ negocioId, descripcion }) {
      // Igual que `resolverCentroCostos` del bot de siempre: atado a un negocio es directo; si no, el motor si está seguro.
      if (negocioId) return { centro: 'directa_negocio', origen: 'sugerido' };
      try {
        const p = await proponerCentroCostosWA({ supabase, workspaceId: ws, descripcion, userId: user.user_id ?? null });
        return p.centro && p.confianza >= 0.7 ? { centro: p.centro, origen: p.origen } : { centro: null, origen: null };
      } catch (e) {
        console.error('[agente-one] centro de costos:', e);
        return { centro: null, origen: null };
      }
    },
    async gastosRecientes({ desdeIso, negocioId, limite }) {
      const desde = desdeIso.slice(0, 10);
      let lista = supabase.from('gastos').select('id, fecha, monto, categoria, descripcion, soporte_pendiente, soporte_url, negocios(codigo)')
        .eq('workspace_id', ws).gte('fecha', desde).order('fecha', { ascending: false }).order('created_at', { ascending: false }).limit(limite);
      let montos = supabase.from('gastos').select('monto').eq('workspace_id', ws).gte('fecha', desde).limit(5000);
      if (negocioId) {
        lista = lista.eq('negocio_id', negocioId);
        montos = montos.eq('negocio_id', negocioId);
      }
      const [l, m] = await Promise.all([lista, montos]);
      if (l.error || m.error) {
        console.error('[agente-one] gastos recientes:', (l.error ?? m.error)?.message);
        return 'error';
      }
      const todos = (m.data ?? []) as Fila[];
      return { total: todos.reduce((s, x) => s + (Number(x.monto) || 0), 0), cantidad: todos.length, gastos: ((l.data ?? []) as Fila[]).map(gastoDeTabla) };
    },
    async gasto(id) {
      const { data, error } = await supabase.from('gastos').select('id, fecha, monto, categoria, descripcion, soporte_pendiente, soporte_url, revisado, negocios(codigo)')
        .eq('workspace_id', ws).eq('id', id).maybeSingle();
      if (error) return 'error';
      return data ? gastoDeTabla(data as Fila) : null;
    },
    async gastosPorId(ids) {
      if (!ids.length) return [];
      const { data, error } = await supabase.from('gastos').select('id, fecha, monto, categoria, descripcion, soporte_pendiente, soporte_url, revisado, negocios(codigo)')
        .eq('workspace_id', ws).in('id', ids.slice(0, 50));
      if (error) {
        console.error('[agente-one] gastos de la conversación:', error.message);
        return 'error';
      }
      return ((data ?? []) as Fila[]).map(gastoDeTabla);
    },
    async contactoDuplicado(telefono) {
      const { data, error } = await supabase.rpc('buscar_contacto_duplicado', { p_workspace_id: ws, p_telefono: telefono, p_email: null, p_excluir_id: null });
      if (error) {
        console.error('[agente-one] buscar_contacto_duplicado:', error.message);
        return 'error';
      }
      return ((data ?? []) as Array<{ nombre: string }>)[0]?.nombre ?? null;
    },
    async registrarGasto(p) {
      const insert: Record<string, unknown> = {
        workspace_id: ws,
        monto: p.monto,
        fecha: p.fecha,
        categoria: p.categoria,
        // Como el bot de siempre: el detalle completo, o «Categoría — $monto» si no hubo concepto.
        descripcion: descripcionParaGuardar({ descripcion: p.descripcion ?? undefined }, p.categoria, p.monto),
        mensaje_original: p.mensajeOriginal,
        tipo: p.negocioId ? 'directo' : 'empresa',
        canal_registro: 'whatsapp',
        created_by_wa_name: user.name,
        soporte_pendiente: true,
        created_by: user.user_id ?? null,
        ...(p.negocioId ? { negocio_id: p.negocioId } : {}),
        ...(p.centro ? { centro_costos: p.centro } : {}),
        ...(p.origen ? { origen_asignacion: p.origen } : {}),
      };
      const { data, error } = await supabase.from('gastos').insert(insert).select('id').single();
      if (error || !data) throw new Error(`no se pudo registrar el gasto: ${error?.message ?? 'sin fila'}`);
      const id = String((data as Fila).id);
      if (!p.mediaId && !p.ref) return { id, soporte: 'sin' };
      // El gasto ya quedó: si el soporte falla, se dice y se sube después desde la app (como el bot de siempre).
      return { id, soporte: (await guardarSoporte(id, p.mediaId ?? '', p.ref)) ? 'guardado' : 'fallo' };
    },
    adjuntarSoporte: (gastoId, mediaId, ref) => guardarSoporte(gastoId, mediaId, ref),
    async corregirGasto({ gastoId, monto, mediaId, ref }) {
      // Solo un gasto sin revisar: uno revisado (o causado) se corrige en la app.
      const { data, error } = await supabase.from('gastos').update({ monto }).eq('id', gastoId).eq('workspace_id', ws).eq('revisado', false).select('id');
      if (error) throw new Error(`no se pudo corregir el gasto: ${error.message}`);
      if (!((data ?? []) as Fila[]).length) throw new Error('el gasto no existe o ya se revisó');
      if (!mediaId && !ref) return { soporte: 'sin' };
      return { soporte: (await guardarSoporte(gastoId, mediaId ?? '', ref)) ? 'guardado' : 'fallo' };
    },
    async bajarAdjunto(mediaId) {
      const m = await bajarMedia(mediaId);
      return m ? { bytes: m.buffer, mime: m.mimeType } : null;
    },
    // Al llegar, sin gasto todavía: `gastos-soportes/<ws>/whatsapp/<fila>.<ext>` (cuelga del workspace, así lo abre la app).
    guardarAdjunto: (filaId, archivo) => subirSoporte(supabase, ws, `whatsapp/${filaId}`, { buffer: archivo.bytes, mimeType: archivo.mime }),
    async anotarMedia(filaId: string, media: MediaFila) {
      try {
        const { error } = await supabase.from('wa_conversacion').update({ media }).eq('id', filaId).eq('workspace_id', ws);
        if (error) console.error('[agente-one] no se pudo anotar el soporte en la conversación:', error.message);
      } catch (err) {
        console.error('[agente-one] no se pudo anotar el soporte en la conversación:', err);
      }
    },
    async cobrosPendientes(negocioId) {
      const { data, error } = await supabase.from('cobros').select('id, numero_cuota, monto, fecha_esperada, notas')
        .eq('workspace_id', ws).eq('negocio_id', negocioId).eq('tipo_cobro', 'programado').is('fecha', null).is('anulado_at', null)
        .order('fecha_esperada', { ascending: true, nullsFirst: false }).order('numero_cuota', { ascending: true }).limit(24);
      if (error) {
        console.error('[agente-one] cobros pendientes:', error.message);
        return 'error';
      }
      return ((data ?? []) as Fila[]).map((c): CobroPendiente => ({
        id: String(c.id), numeroCuota: c.numero_cuota == null ? null : Number(c.numero_cuota), monto: Number(c.monto) || 0,
        fechaEsperada: c.fecha_esperada ? String(c.fecha_esperada).slice(0, 10) : null, notas: (c.notas as string | null) ?? null,
      }));
    },
    async confirmarCobro(p) {
      // El mismo camino que el botón «Confirmar pago manual» de la app (`confirmarCobroProgramado` →
      // `confirmarPagoCobroProgramado`). Sin `fuente`: la manual no la pone (la `fuente` la leen las reglas de anulación).
      const r = await confirmarPagoCobroProgramado(supabase, { cobroId: p.cobroId, workspaceId: ws, fecha: p.fecha, monto: p.monto, notas: p.notas });
      if (!r.ok) return { ok: false, motivo: r.motivo === 'ya_confirmado' ? 'ya_confirmado' : 'error', error: r.error };
      if (!p.ref && !p.mediaId) return { ok: true, soporte: 'sin' };
      // El soporte del pago va en `cobros.soporte` (la forma que abre `hrefArchivoDeCobro`: `{ url, file_name, mime_type }`),
      // solo si la cuota no tenía. Si no se subió al llegar, se baja y se sube ahora.
      let ref = p.ref;
      if (!ref && p.mediaId) {
        const m = await bajarMedia(p.mediaId);
        ref = m ? await subirSoporte(supabase, ws, `cobros/${p.cobroId}`, { buffer: m.buffer, mimeType: m.mimeType }) : null;
      }
      if (!ref) return { ok: true, soporte: 'fallo' };
      const { error } = await supabase.from('cobros').update({ soporte: { url: ref, file_name: p.nombre ?? 'soporte-whatsapp', mime_type: p.mime } })
        .eq('id', p.cobroId).eq('workspace_id', ws).is('soporte', null);
      if (error) console.error('[agente-one] soporte del cobro:', error.message);
      return { ok: true, soporte: error ? 'fallo' : 'guardado' };
    },
    async registrarActividad({ negocioId, tipo, texto }) {
      let autorId: string | null = null;
      if (user.user_id) {
        const { data } = await supabase.from('staff').select('id').eq('workspace_id', ws).eq('profile_id', user.user_id).maybeSingle();
        autorId = (data?.id as string | undefined) ?? null;
      }
      const emoji = EMOJI_ACTIVIDAD[tipo] ?? '📝';
      // `activity_log.contenido` tiene CHECK de 280 caracteres: lo largo va completo en varios comentarios, no cortado.
      const contenidos = comentariosDeActividad(autorId ? `${emoji} ` : `${emoji} [${user.name}] `, texto);
      const filas = filasDeComentarios({ workspace_id: ws, entidad_tipo: 'negocio', entidad_id: negocioId, tipo: 'comentario', autor_id: autorId }, contenidos);
      const { error } = await supabase.from('activity_log').insert(filas);
      if (error) throw new Error(`no se pudo registrar la actividad: ${error.message}`);
      await supabase.from('negocios').update({ updated_at: new Date().toISOString() }).eq('id', negocioId).eq('workspace_id', ws);
      return { comentarios: contenidos.length };
    },
    async crearContacto({ nombre, telefono, decisor }) {
      // El duplicado se revisó al proponer; se vuelve a revisar al escribir (entre la propuesta y el toque pudo crearse).
      if (telefono) {
        const { data: dup, error: dupErr } = await supabase.rpc('buscar_contacto_duplicado', { p_workspace_id: ws, p_telefono: telefono, p_email: null, p_excluir_id: null });
        if (dupErr) throw new Error(`no se pudo revisar el duplicado: ${dupErr.message}`);
        const d = ((dup ?? []) as Array<{ nombre: string }>)[0];
        if (d) throw new Error(`ese teléfono ya es de ${d.nombre}`);
      }
      const { data, error } = await supabase.from('contactos').insert({ workspace_id: ws, nombre, telefono, rol: decisor ? 'decisor' : 'operativo' }).select('id').single();
      if (error || !data) throw new Error(`no se pudo crear el contacto: ${error?.message ?? 'sin fila'}`);
      return { id: String((data as Fila).id) };
    },
  };
}
