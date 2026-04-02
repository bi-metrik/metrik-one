// ============================================================
// evaluar-reglas — Motor de Reglas Condicionales [98H] §4
// Evalúa tenant_rules para una entidad/evento y ejecuta acciones.
// Llamado como función de librería desde Server Actions (no HTTP directo).
// ============================================================

import { getServiceClient } from '../_shared/supabase-client.ts';
import { corsHeaders } from '../_shared/cors.ts';

// ── Tipos ──────────────────────────────────────────────────

export type OperadorCondicion =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'contains'
  | 'is_empty'
  | 'is_not_empty';

export interface Condicion {
  campo: string;           // Path anidado soportado: "custom_data.tipo_obra", "estado_nuevo"
  operador: OperadorCondicion;
  valor?: unknown;         // Requerido para todos excepto is_empty / is_not_empty
}

export interface AccionBlockTransition {
  tipo: 'block_transition';
  mensaje_error: string;
}

export interface AccionSetField {
  tipo: 'set_field';
  campo: string;
  valor: unknown;
}

export interface AccionSetLabel {
  tipo: 'set_label';
  label_slug: string;
}

export interface AccionNotify {
  tipo: 'notify';
  titulo: string;
  mensaje: string;
  deep_link?: string;
}

export type Accion =
  | AccionBlockTransition
  | AccionSetField
  | AccionSetLabel
  | AccionNotify;

export interface TenantRule {
  id: string;
  tenant_id: string;
  nombre: string;
  entidad: string;
  evento: string;
  condiciones: Condicion[];
  acciones: Accion[];
  prioridad: number;
  activo: boolean;
}

// Error especial para bloqueo de transición — el caller debe capturarlo
export class BlockTransitionError extends Error {
  constructor(
    message: string,
    public readonly ruleId: string,
    public readonly ruleName: string,
  ) {
    super(message);
    this.name = 'BlockTransitionError';
  }
}

// ── Helper: getValue anidado ───────────────────────────────
// Soporta paths como "custom_data.tipo_obra" o "estado_nuevo"

export function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

// ── Evaluador de condición individual ─────────────────────

function evaluarCondicion(
  condicion: Condicion,
  registro: Record<string, unknown>,
): boolean {
  const valor = getNestedValue(registro, condicion.campo);

  switch (condicion.operador) {
    case 'eq':
      return valor === condicion.valor;

    case 'neq':
      return valor !== condicion.valor;

    case 'gt':
      return typeof valor === 'number' && typeof condicion.valor === 'number'
        ? valor > condicion.valor
        : false;

    case 'gte':
      return typeof valor === 'number' && typeof condicion.valor === 'number'
        ? valor >= condicion.valor
        : false;

    case 'lt':
      return typeof valor === 'number' && typeof condicion.valor === 'number'
        ? valor < condicion.valor
        : false;

    case 'lte':
      return typeof valor === 'number' && typeof condicion.valor === 'number'
        ? valor <= condicion.valor
        : false;

    case 'in':
      return Array.isArray(condicion.valor)
        ? (condicion.valor as unknown[]).includes(valor)
        : false;

    case 'contains':
      return typeof valor === 'string' && typeof condicion.valor === 'string'
        ? valor.toLowerCase().includes((condicion.valor as string).toLowerCase())
        : false;

    case 'is_empty':
      return valor === null || valor === undefined || valor === '';

    case 'is_not_empty':
      return valor !== null && valor !== undefined && valor !== '';

    default:
      return false;
  }
}

// ── Evaluador de una regla (todas las condiciones en AND) ─

function reglaSeCumple(
  regla: TenantRule,
  registro: Record<string, unknown>,
): boolean {
  if (!Array.isArray(regla.condiciones) || regla.condiciones.length === 0) {
    // Sin condiciones = siempre se cumple (regla universal)
    return true;
  }

  return regla.condiciones.every((c) => evaluarCondicion(c, registro));
}

// ── Ejecutor de acciones ───────────────────────────────────

async function ejecutarAccion(
  accion: Accion,
  tenantId: string,
  entidad: string,
  registroId: string | undefined,
  regla: TenantRule,
): Promise<void> {
  const supabase = getServiceClient();

  switch (accion.tipo) {
    case 'block_transition':
      // Lanzar error especial — el caller (Server Action) captura esto
      // y cancela el UPDATE de estado ANTES de persistirlo.
      throw new BlockTransitionError(accion.mensaje_error, regla.id, regla.nombre);

    case 'set_field': {
      if (!registroId) break;
      const tabla = entidad === 'oportunidad'
        ? 'oportunidades'
        : entidad === 'proyecto'
        ? 'proyectos'
        : entidad === 'contacto'
        ? 'contactos'
        : 'empresas';

      await supabase
        .from(tabla)
        .update({ [accion.campo]: accion.valor })
        .eq('id', registroId)
        .eq('workspace_id', tenantId);
      break;
    }

    case 'set_label': {
      if (!registroId) break;
      // Buscar label por slug en el workspace
      const { data: label } = await supabase
        .from('labels')
        .select('id')
        .eq('workspace_id', tenantId)
        .eq('slug', accion.label_slug)
        .single();

      if (label) {
        // Insertar en entity_labels (ignorar duplicados)
        await supabase
          .from('entity_labels')
          .upsert({
            workspace_id: tenantId,
            entidad,
            entidad_id: registroId,
            label_id: label.id,
          }, { onConflict: 'workspace_id,entidad,entidad_id,label_id', ignoreDuplicates: true });
      }
      break;
    }

    case 'notify': {
      // Notificar a todos los profiles owner/admin del workspace
      const { data: destinatarios } = await supabase
        .from('profiles')
        .select('id')
        .eq('workspace_id', tenantId)
        .in('role', ['owner', 'admin']);

      if (destinatarios && destinatarios.length > 0) {
        const notifs = destinatarios.map((p) => ({
          workspace_id: tenantId,
          destinatario_id: p.id,
          tipo: 'asignacion_responsable' as const, // tipo genérico disponible
          estado: 'pendiente' as const,
          contenido: accion.mensaje,
          entidad_tipo: entidad as 'oportunidad' | 'proyecto' | 'cotizacion' | null,
          entidad_id: registroId ?? null,
          deep_link: accion.deep_link ?? null,
          metadata: { titulo: accion.titulo, origin: 'tenant_rule', rule_id: regla.id },
        }));

        await supabase.from('notificaciones').insert(notifs);
      }
      break;
    }
  }
}

// ── Función principal exportable ───────────────────────────
// Diseñada para ser llamada desde Server Actions de Next.js
// via fetch interno a la Edge Function, o directamente importada.

export async function evaluarReglas(
  tenantId: string,
  entidad: string,
  evento: string,
  registro: Record<string, unknown>,
  registroAnterior?: Record<string, unknown>,
): Promise<void> {
  const supabase = getServiceClient();

  // Cargar reglas activas para este tenant/entidad/evento, ordenadas por prioridad DESC
  const { data: reglas, error } = await supabase
    .from('tenant_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('entidad', entidad)
    .eq('evento', evento)
    .eq('activo', true)
    .order('prioridad', { ascending: false });

  if (error || !reglas || reglas.length === 0) return;

  const registroId =
    typeof registro['id'] === 'string' ? registro['id'] : undefined;

  for (const regla of reglas as TenantRule[]) {
    // El contexto de evaluación incluye el registro actual Y el anterior (si aplica)
    const contexto: Record<string, unknown> = {
      ...registro,
      ...(registroAnterior ? { _anterior: registroAnterior } : {}),
    };

    if (!reglaSeCumple(regla, contexto)) continue;

    // Ejecutar todas las acciones de la regla en orden
    for (const accion of regla.acciones as Accion[]) {
      // block_transition lanza BlockTransitionError — se propaga al caller
      await ejecutarAccion(accion, tenantId, entidad, registroId, regla);
    }
  }
}

// ── HTTP Handler (para llamadas directas via fetch interno) ──
// Útil para pruebas manuales o invocación desde Edge Functions externas.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json() as {
      tenantId: string;
      entidad: string;
      evento: string;
      registro: Record<string, unknown>;
      registroAnterior?: Record<string, unknown>;
    };

    const { tenantId, entidad, evento, registro, registroAnterior } = body;

    if (!tenantId || !entidad || !evento || !registro) {
      return new Response(
        JSON.stringify({ error: 'Faltan campos requeridos: tenantId, entidad, evento, registro' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    await evaluarReglas(tenantId, entidad, evento, registro, registroAnterior);

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    if (err instanceof BlockTransitionError) {
      return new Response(
        JSON.stringify({
          blocked: true,
          mensaje_error: err.message,
          rule_id: err.ruleId,
          rule_name: err.ruleName,
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const message = err instanceof Error ? err.message : 'Error interno';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
