// ============================================================
// WhatsApp Bot — Shared Types (Spec 98F)
// ============================================================

// --- Gemini Parse Result ---

export type Intent =
  | 'GASTO_DIRECTO'
  | 'GASTO_OPERATIVO'
  | 'EDITAR_GASTO'
  | 'HORAS'
  | 'TIMER_INICIAR'
  | 'TIMER_PARAR'
  | 'TIMER_ESTADO'
  | 'COBRO'
  | 'CONTACTO_NUEVO'
  | 'SALDO_BANCARIO'
  | 'NOTA_NEGOCIO'
  | 'ESTADO_PROYECTO'
  | 'ESTADO_NEGOCIOS'
  | 'MIS_NUMEROS'
  | 'CARTERA'
  | 'INFO_CONTACTO'
  | 'OPP_GANADA'
  | 'OPP_PERDIDA'
  | 'OPP_NUEVA'
  | 'OPP_AVANZAR'
  | 'ACTIVIDAD'
  | 'AYUDA'
  | 'FOLLOWUP'
  | 'UNCLEAR';

export interface ParsedFields {
  amount?: number;
  concept?: string;
  entity_hint?: string;
  project_code?: string | number;  // Code: "KAE-2", "P-012", or numeric 12
  category_hint?: string;
  hours?: number;
  date_hint?: string;
  name?: string;
  phone?: string;
  role?: string;
  note?: string;
  mensaje_original?: string;  // Full user message text (injected by webhook)
  stage_hint?: string;         // Target pipeline stage for OPP_AVANZAR
  activity_text?: string;      // Activity description for ACTIVIDAD
  suggested_actions?: string[]; // AI-suggested actions for smart UNCLEAR
  saldo_teorico?: number;      // Theoretical balance (injected by handler)
  stage_filter?: 'venta' | 'ejecucion' | 'cobro' | 'cierre' | 'all'; // For ESTADO_NEGOCIOS queries
}

export interface ParseResult {
  intent: Intent;
  confidence: number;
  fields: ParsedFields;
}

// --- Bot Session ---

export type SessionState =
  | 'started'
  | 'collecting'
  | 'confirming'
  | 'awaiting_selection'
  | 'awaiting_reason'
  | 'awaiting_payment_status'
  | 'awaiting_image'
  | 'awaiting_timeout_confirm'
  | 'completed'
  | 'expired';

export interface SessionContext {
  intent?: Intent;
  parsed_fields?: ParsedFields;
  pending_action?: string;
  // Resolved data from lookups
  proyecto_id?: string;
  proyecto_nombre?: string;
  factura_id?: string;
  oportunidad_id?: string;
  contacto_id?: string;
  categoria?: string;
  amount?: number;
  // Multi-step flow state
  options?: Array<{ id: string; label: string; extra?: Record<string, unknown> }>;
  selected_option?: number;
  disambiguation?: 'proyecto' | 'empresa';
  borrador_id?: string;
  gasto_id?: string;
  unclear_count?: number;
  // Session memory (persists across interactions)
  last_project_id?: string;
  last_project_name?: string;
  // OPP_AVANZAR
  target_stage?: string;
  // ACTIVIDAD
  activity_text?: string;
  // Timeout tracking: ISO timestamp when awaiting_selection started
  awaiting_since?: string;
  // Conversational memory (loaded from last completed session of same phone)
  last_context?: LastContext;
}

// --- Conversational Last Context (follow-up memory) ---

export interface LastContextItem {
  id?: string;
  nombre: string;
  codigo?: string | null;
  precio?: number;
  stage?: string;
  extra?: Record<string, unknown>;
}

export type LastContextType =
  | 'negocios_list'      // result of ESTADO_NEGOCIOS
  | 'contactos_list'     // result of INFO_CONTACTO multi-match
  | 'cartera_list';      // result of CARTERA

export interface LastContext {
  type: LastContextType;
  items: LastContextItem[];
  shown: number;           // how many items were displayed to user
  total: number;           // total items in the query result
  query_meta?: Record<string, unknown>; // stage_filter, etc.
  created_at: string;      // ISO timestamp — used for TTL
}

export interface BotSession {
  id: string;
  workspace_id: string;
  user_phone: string;
  intent: string | null;
  state: SessionState;
  context: SessionContext;
  started_at: string;
  expires_at: string;
}

// --- User Identity ---

export type UserRole = 'owner' | 'admin' | 'operator' | 'supervisor' | 'contador' | 'read_only';

export interface WaUser {
  workspace_id: string;
  user_id?: string;        // auth.users.id (only for owners/staff)
  phone: string;
  name: string;
  role: UserRole;
  collaborator_id?: string; // wa_collaborators.id
  subscription_status: string;
}

// --- WhatsApp Message ---

export interface IncomingMessage {
  phone: string;
  text: string;
  type: 'text' | 'image' | 'audio' | 'interactive' | 'button';
  image_id?: string;
  audio_id?: string;
  interactive_reply?: string; // button/list reply ID
  timestamp: string;
}

// --- Handler Context ---

export interface HandlerContext {
  user: WaUser;
  message: IncomingMessage;
  session: BotSession;
  parsed: ParseResult;
  supabase: SupabaseClient;
  sendMessage: (text: string) => Promise<void>;
  sendOptions: (body: string, options: string[]) => Promise<void>;
  sendButtons: (body: string, buttons: Array<{ id: string; title: string }>) => Promise<void>;
  updateSession: (state: SessionState, context?: Partial<SessionContext>) => Promise<void>;
}

// Supabase client type (avoid importing full lib in type file)
// deno-lint-ignore no-explicit-any
export type SupabaseClient = any;

// --- Categories mapping (spec §4 — 9 categorías) ---

export const GASTO_CATEGORIAS = [
  'materiales',
  'transporte',
  'alimentacion',
  'servicios_profesionales',
  'software',
  'arriendo',
  'marketing',
  'capacitacion',
  'otros',
] as const;

export const CATEGORIA_LABELS: Record<string, string> = {
  materiales: 'Materiales e insumos',
  transporte: 'Transporte y movilidad',
  alimentacion: 'Alimentación trabajo',
  servicios_profesionales: 'Servicios profesionales',
  software: 'Software y tecnología',
  arriendo: 'Arriendo y servicios',
  marketing: 'Marketing y publicidad',
  capacitacion: 'Capacitación',
  otros: 'Otros gastos operativos',
};

// Categories 1-5 are ambiguous (could be project or company) — D104
export const AMBIGUOUS_CATEGORIES = [
  'materiales',
  'transporte',
  'alimentacion',
  'software',
  'servicios_profesionales',
];

// --- Role-based intent permissions (D99) ---
// owner + admin: all intents (no restriction needed)
// operator + supervisor: same as previous "collaborator" — can register + consult their projects
// contador: only read/consult intents — cannot register gastos
// read_only: only basic consult, no modifications

export const OPERATOR_ALLOWED_INTENTS: Intent[] = [
  'GASTO_DIRECTO',
  'EDITAR_GASTO',
  'TIMER_INICIAR',
  'TIMER_PARAR',
  'TIMER_ESTADO',
  'NOTA_NEGOCIO',
  'ESTADO_PROYECTO',
  'ACTIVIDAD',
  'AYUDA',
  'FOLLOWUP',
];

export const CONTADOR_ALLOWED_INTENTS: Intent[] = [
  'MIS_NUMEROS',
  'CARTERA',
  'INFO_CONTACTO',
  'ESTADO_PROYECTO',
  'ESTADO_NEGOCIOS',
  'AYUDA',
  'FOLLOWUP',
];

export const READ_ONLY_ALLOWED_INTENTS: Intent[] = [
  'MIS_NUMEROS',
  'CARTERA',
  'ESTADO_PROYECTO',
  'AYUDA',
  'FOLLOWUP',
];

// Legacy alias kept for backward-compat with existing imports
export const COLLABORATOR_ALLOWED_INTENTS: Intent[] = OPERATOR_ALLOWED_INTENTS;

// --- Pipeline stages ---

export const PIPELINE_STAGES = [
  'lead_nuevo',
  'contacto_inicial',
  'discovery_hecha',
  'propuesta_enviada',
  'negociacion',
  'ganada',
  'perdida',
] as const;

export const PIPELINE_STAGE_LABELS: Record<string, string> = {
  lead_nuevo: 'Lead nuevo',
  contacto_inicial: 'Contacto inicial',
  discovery_hecha: 'Discovery',
  propuesta_enviada: 'Propuesta enviada',
  negociacion: 'Negociación',
  ganada: 'Ganada',
  perdida: 'Perdida',
};

// --- Streak milestones (D117) ---

export const STREAK_MILESTONES: Record<number, string> = {
  4: '🥉',
  12: '🥈',
  26: '🥇',
  52: '🏆',
};
