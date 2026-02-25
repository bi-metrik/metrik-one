// ============================================================
// WhatsApp Bot — Shared Types (Spec 98F)
// ============================================================

// --- Gemini Parse Result ---

export type Intent =
  | 'GASTO_DIRECTO'
  | 'GASTO_OPERATIVO'
  | 'HORAS'
  | 'TIMER_INICIAR'
  | 'TIMER_PARAR'
  | 'TIMER_ESTADO'
  | 'COBRO'
  | 'CONTACTO_NUEVO'
  | 'SALDO_BANCARIO'
  | 'NOTA_OPORTUNIDAD'
  | 'NOTA_PROYECTO'
  | 'ESTADO_PROYECTO'
  | 'ESTADO_PIPELINE'
  | 'MIS_NUMEROS'
  | 'CARTERA'
  | 'INFO_CONTACTO'
  | 'OPP_GANADA'
  | 'OPP_PERDIDA'
  | 'AYUDA'
  | 'UNCLEAR';

export interface ParsedFields {
  amount?: number;
  concept?: string;
  entity_hint?: string;
  category_hint?: string;
  hours?: number;
  date_hint?: string;
  name?: string;
  phone?: string;
  role?: string;
  note?: string;
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
  | 'awaiting_image'
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

export type UserRole = 'owner' | 'collaborator';

export interface WaUser {
  workspace_id: string;
  user_id?: string;        // auth.users.id (only for owners)
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

// --- Collaborator allowed intents (D99) ---

export const COLLABORATOR_ALLOWED_INTENTS: Intent[] = [
  'GASTO_DIRECTO',
  'TIMER_INICIAR',
  'TIMER_PARAR',
  'TIMER_ESTADO',
  'NOTA_PROYECTO',
  'ESTADO_PROYECTO',
  'AYUDA',
];

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
