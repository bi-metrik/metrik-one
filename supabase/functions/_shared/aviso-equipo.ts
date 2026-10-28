// ============================================================
// avisos_equipo — la traza de los correos INTERNOS al equipo
// ------------------------------------------------------------
// Hasta el 2026-10-26 los avisos internos (notificar-etapa, avisar-asignacion, alertas-plazo)
// no dejaban rastro: si uno rebotaba o Resend lo suprimía, nadie se enteraba. Ahora cada envío
// deja una fila con su `proveedor_id`, y `resend-webhook` la actualiza (entregado, rebotado,
// suprimido, fallido, queja) con las MISMAS reglas que aplica a `avisos_cliente`.
//
// Tabla aparte a propósito: `avisos_cliente` deduplica por `huella` y exige `negocio_id`; un
// aviso interno no es «al cliente le avisamos» y no puede entrar en esa cuenta.
//
// Sin Deno ni red: recibe el cliente de Supabase. Nunca lanza — la traza no puede tumbar un
// envío que ya salió.
// ============================================================

export type OrigenAvisoEquipo =
  | 'notificar-etapa'
  | 'avisar-asignacion'
  | 'alertas-plazo'
  | 'recordatorios'
  | 'resend-volumen';

export interface FilaAvisoEquipo {
  origen: OrigenAvisoEquipo;
  workspaceId: string | null;
  negocioId?: string | null;
  estado: 'enviado' | 'fallido';
  destino: string | string[] | null;
  titulo: string | null;
  motivo?: string | null;
  proveedorId?: string | null;
}

/** La fila tal como entra a la tabla. Pura. */
export function filaAvisoEquipo(f: FilaAvisoEquipo): Record<string, unknown> {
  const destino = Array.isArray(f.destino) ? f.destino.filter(Boolean).join(', ') : f.destino;
  return {
    origen: f.origen,
    workspace_id: f.workspaceId,
    negocio_id: f.negocioId ?? null,
    canal: 'email',
    estado: f.estado,
    destino: destino || null,
    titulo: f.titulo ? f.titulo.slice(0, 300) : null,
    motivo: f.motivo ? f.motivo.slice(0, 300) : null,
    proveedor_id: f.proveedorId ?? null,
  };
}

// deno-lint-ignore no-explicit-any
type ClienteConFrom = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Inserta la traza. Nunca lanza: un error queda en el log. */
export async function registrarAvisoEquipo(supabase: ClienteConFrom, f: FilaAvisoEquipo): Promise<void> {
  try {
    const { error } = await supabase.from('avisos_equipo').insert(filaAvisoEquipo(f));
    if (error) console.error(`[aviso-equipo] no se pudo dejar traza (${f.origen}):`, error.message);
  } catch (e) {
    console.error(`[aviso-equipo] no se pudo dejar traza (${f.origen}):`, e instanceof Error ? e.message : String(e));
  }
}

/** El `id` de la respuesta de Resend a un POST /emails exitoso, o null. No consume un cuerpo ya leído. */
export async function idDeRespuestaResend(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { id?: unknown };
    return typeof body?.id === 'string' ? body.id : null;
  } catch {
    return null;
  }
}
