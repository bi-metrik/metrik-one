// ============================================================
// WhatsApp Bot — Shared Types (MVP — 8 intents)
// ============================================================

// --- Gemini Parse Result ---

export type Intent =
  | 'GASTO'
  | 'CONTACTO_NUEVO'
  | 'ACTIVIDAD'
  | 'MIS_NUMEROS'
  | 'CARTERA'
  | 'ESTADO_NEGOCIOS'
  | 'AYUDA'
  | 'UNCLEAR';

export interface ParsedFields {
  amount?: number;
  concept?: string;
  entity_hint?: string;
  project_code?: string | number;  // Code: "KAE-2", "P-012", or numeric 12
  category_hint?: string;
  name?: string;
  phone?: string;
  role?: string;
  mensaje_original?: string;  // Full user message text (injected by webhook)
  activity_text?: string;      // Activity description for ACTIVIDAD
  suggested_actions?: string[]; // AI-suggested actions for smart UNCLEAR
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
  negocio_id?: string;
  destino_tipo?: 'negocio' | 'proyecto' | 'empresa';
  factura_id?: string;
  oportunidad_id?: string;
  contacto_id?: string;
  categoria?: string;
  amount?: number;
  // Multi-step flow state
  options?: Array<{ id: string; label: string; extra?: Record<string, unknown> }>;
  selected_option?: number;
  disambiguation?: 'proyecto' | 'empresa';
  gasto_id?: string;
  unclear_count?: number;
  // Session memory
  last_project_id?: string;
  last_project_name?: string;
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
  | 'cartera_list';      // result of CARTERA

export interface LastContext {
  type: LastContextType;
  items: LastContextItem[];
  shown: number;
  total: number;
  query_meta?: Record<string, unknown>;
  created_at: string;
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
  user_id?: string;
  phone: string;
  name: string;
  role: UserRole;
  collaborator_id?: string;
  subscription_status: string;
}

// --- WhatsApp Message ---

export interface IncomingMessage {
  phone: string;
  text: string;
  type: 'text' | 'image' | 'audio' | 'interactive' | 'button';
  image_id?: string;
  audio_id?: string;
  interactive_reply?: string;
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

// Supabase client type
// deno-lint-ignore no-explicit-any
export type SupabaseClient = any;

// --- Categories mapping ---

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

// --- Role-based intent permissions (MVP) ---

export const OPERATOR_ALLOWED_INTENTS: Intent[] = [
  'GASTO',
  'ACTIVIDAD',
  'AYUDA',
];

export const CONTADOR_ALLOWED_INTENTS: Intent[] = [
  'MIS_NUMEROS',
  'CARTERA',
  'ESTADO_NEGOCIOS',
  'AYUDA',
];

export const READ_ONLY_ALLOWED_INTENTS: Intent[] = [
  'MIS_NUMEROS',
  'CARTERA',
  'AYUDA',
];

// Legacy alias kept for backward-compat
export const COLLABORATOR_ALLOWED_INTENTS: Intent[] = OPERATOR_ALLOWED_INTENTS;

// --- Streak milestones (display only) ---

export const STREAK_MILESTONES: Record<number, string> = {
  4: '🥉',
  12: '🥈',
  26: '🥇',
  52: '🏆',
};
