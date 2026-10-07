// ============================================================
// Núcleo conversacional de ONE — los tipos (2026-10-06)
// ------------------------------------------------------------
// Diseño: proyectos/trappvel/clarity/docs/diseno/2026-10-06_investigacion-agentes-conversacionales.md, §3.
//
// El núcleo no sabe de Gemini, de Supabase ni de Meta: habla con cuatro puertos.
//   · `Modelo`        — un proveedor (Gemini hoy; otro proveedor es otro adaptador).
//   · `Almacen`       — la conversación (`wa_conversacion`) y los candados.
//   · `Mensajero`     — lo que sale por WhatsApp (texto, botones, lista, «escribiendo…»).
//   · `Dominio`       — las herramientas del bot (`buscar`, `ver_viaje`) y los ejecutores de `proponer`.
// En producción los implementa `wa-agente.ts`; en las pruebas y en el arnés, `memoria.ts`.
// ============================================================

// ── La conversación ──────────────────────────────────────────────────────────

export type ClaseFila = 'escrito' | 'reenvio' | 'toque' | 'audio' | 'imagen' | 'ubicacion' | 'otro' | 'bot';

/** Una fila de `wa_conversacion` (las columnas que usa el núcleo). */
export interface FilaConversacion {
  id: string;
  workspace_id: string;
  phone: string;
  direccion: 'entrante' | 'saliente';
  clase: ClaseFila;
  formato?: string | null;
  texto: string | null;
  opciones?: Array<{ id: string; titulo: string; descripcion?: string }> | null;
  toque_id?: string | null;
  contexto_wamid?: string | null;
  wa_message_id?: string | null;
  turno_id?: string | null;
  traza?: Traza | null;
  created_at: string;
}

// ── El modelo ────────────────────────────────────────────────────────────────

/** Una parte de un mensaje del modelo o hacia él (forma de Gemini; otro proveedor la traduce en su adaptador). */
export interface Parte {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: unknown; id?: string };
}

export interface Mensaje {
  role: 'user' | 'model';
  parts: Parte[];
  /** Qué modelo produjo este mensaje (solo `model`): el adaptador decide si sus firmas valen para el siguiente. */
  modelo?: string;
}

export interface DeclaracionHerramienta {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface PedidoModelo {
  sistema: string;
  mensajes: Mensaje[];
  herramientas: DeclaracionHerramienta[];
  /** Las que puede llamar en este llamado (modo ANY): en el último llamado, solo las que cierran el turno. */
  permitidas: string[];
  /** Tope duro de este llamado (lo que queda del turno). */
  timeoutMs: number;
}

export interface UsoLlamado {
  modelo: string;
  entrada: number;
  salida: number;
  razonamiento: number;
  cache: number;
  ms: number;
  ok: boolean;
  /** Por qué falló o por qué se usó el respaldo («corte», «http 429»…). */
  motivo?: string;
}

export type RespuestaModelo =
  | { ok: true; mensaje: Mensaje; usos: UsoLlamado[] }
  | { ok: false; motivo: string; usos: UsoLlamado[] };

export interface Modelo {
  llamar(p: PedidoModelo): Promise<RespuestaModelo>;
}

// ── Lo que sale ──────────────────────────────────────────────────────────────

export interface Opcion { id: string; titulo: string; descripcion?: string }

export type Salida =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'botones'; texto: string; opciones: Opcion[] }
  | { tipo: 'lista'; texto: string; boton: string; opciones: Opcion[] };

export interface Mensajero {
  /** Marca leído y enciende «escribiendo…» (una sola llamada a Meta). Nunca lanza. */
  escribiendo(waMessageId: string): Promise<void>;
  /** Envía y devuelve el wamid (o null si Meta lo rechazó). */
  enviar(phone: string, salida: Salida, ctx: { workspaceId: string; intent: string }): Promise<string | null>;
}

// ── El almacén ───────────────────────────────────────────────────────────────

export interface Almacen {
  /** La conversación de un remitente desde `desdeIso`, en orden. */
  leer(workspaceId: string, phone: string, desdeIso: string): Promise<FilaConversacion[]>;
  /** Marca filas como atendidas por un turno; la traza va en `filaTraza`. */
  cerrarTurno(p: { turnoId: string; filas: string[]; filaTraza: string; traza: Traza; salientes: string[] }): Promise<void>;
  /** Candado con vencimiento (`tomar_candado`). true = es tuyo. */
  tomarCandado(clave: string, segundos: number): Promise<boolean>;
  soltarCandado(clave: string): Promise<void>;
}

// ── El reglamento ────────────────────────────────────────────────────────────

export type TipoFicha = 'perfil' | 'alcance' | 'invariante' | 'glosario' | 'guia' | 'procedimiento' | 'respuesta_fija' | 'estilo';
export type CargaFicha = 'siempre' | 'indice' | 'con_herramienta';

export interface Ficha {
  clave: string;
  tipo: TipoFicha;
  carga: CargaFicha;
  cuando?: string | null;
  hacer: string;
  herramientas?: string[] | null;
  prioridad?: number | null;
  fuente?: string | null;
  /** Datos estructurados: `temas` en `alc.temas`, el perfil en `perfil`. */
  valores?: Record<string, unknown> | null;
}

export interface Reglamento {
  id: string;
  version: number;
  huella: string;
  fichas: Ficha[];
}

// ── El dominio (por bot) ─────────────────────────────────────────────────────

export interface ResultadoHerramienta {
  ok: boolean;
  /** Lo que ve el modelo (se recorta a 400 tokens aprox.). */
  datos: unknown;
  /** Error que dice qué corregir (nunca un código opaco). */
  error?: string;
  /** Lo que el código necesita después (ids reales) y el modelo no ve. Queda en la traza. */
  privado?: unknown;
}

/** Lo que un ejecutor de `proponer` arma: el resumen y lo que se ejecutaría con el toque. */
export interface Propuesta {
  accion: string;
  /** Los datos resueltos por el código (ids reales), que son los que se ejecutan. */
  datos: Record<string, unknown>;
  /** El texto que ve el comercial, armado por el código con datos reales. */
  resumen: string;
  /** Los botones: el primero ejecuta, el último dice que no. Títulos ≤ 20. */
  si: string;
  no: string;
}

export interface Hechos {
  /** Las líneas de hechos (`rf.hecho`): las escribe el código, tal cual. */
  lineas: string[];
  /** Viajes que la escritura deja nombrados (el que se acaba de abrir). */
  nombrados?: string[];
  /** Ids de filas de la conversación que la acción consumió (la tanda cargada o descartada). */
  consumidos?: string[];
  /** Cambios que el arnés lee como estado final (para las pruebas). */
  escrituras?: Array<Record<string, unknown>>;
}

export interface ContextoDominio {
  workspaceId: string;
  phone: string;
  /** Quién escribe, para el estado. */
  remitente: { nombre: string; rol: string };
  /** Toda la conversación de 24 h (para los candados: lo escrito, lo mostrado, lo tocado). */
  conversacion: FilaConversacion[];
  /** Los resultados de herramientas de turnos anteriores (de las trazas). */
  resultadosPrevios: Array<{ herramienta: string; args: unknown; datos: unknown; privado?: unknown }>;
}

export interface Dominio {
  /** Nombre del bot (`bandeja-solicitudes`). */
  bot: string;
  /** Las herramientas de lectura del dominio (además de `consultar_reglas`). */
  lecturas: DeclaracionHerramienta[];
  /** Las acciones de `proponer`. */
  acciones: string[];
  /** Descripción de los `datos` de `proponer` por acción (va en la declaración). */
  datosProponer: Record<string, unknown>;
  leer(nombre: string, args: Record<string, unknown>, ctx: ContextoDominio): Promise<ResultadoHerramienta>;
  /** Arma la propuesta con datos reales o devuelve el error para el modelo (el candado). */
  proponer(accion: string, datos: Record<string, unknown>, ctx: ContextoDominio): Promise<{ ok: true; propuesta: Propuesta } | { ok: false; error: string; candado: string }>;
  /** Ejecuta una propuesta tocada. Idempotencia por huella: la asegura el núcleo. Lanza si no pudo. */
  ejecutar(propuesta: Propuesta, ctx: ContextoDominio): Promise<Hechos>;
  /**
   * Después de ejecutar una propuesta tocada: la siguiente propuesta que ya se puede armar con lo dicho (abrir un viaje
   * → anotar lo que el comercial ya contó de él). `lineas` reemplaza las del hecho. `null` = nada más. Puede lanzar: el
   * núcleo deja el hecho como estaba.
   */
  trasEjecutar?(propuesta: Propuesta, hechos: Hechos, huella: string, ctx: ContextoDominio): Promise<{ lineas: string[]; propuesta?: Propuesta } | null>;
  /** ¿La propuesta sigue sirviendo? (la tanda no cambió desde que se armó). Ausente = sí. */
  sigueVigente?(propuesta: Propuesta, ctx: ContextoDominio): boolean;
  /** Una línea del estado que solo el dominio sabe (la tanda abierta). */
  estado?(ctx: ContextoDominio): string[];
}

// ── La traza ─────────────────────────────────────────────────────────────────

export interface Traza {
  tipo: 'modelo' | 'toque_propuesta' | 'si_escrito' | 'reenvio' | 'sin_turno';
  bot: string;
  reglamento?: { id: string; version: number; huella: string } | null;
  /** Desde que llegó el webhook del último mensaje del turno hasta que salió la respuesta. */
  ms_turno?: number;
  ms_modelo?: number;
  ms_herramientas?: number;
  ms_base?: number;
  llamados?: number;
  uso?: UsoLlamado[];
  herramientas?: Array<{ nombre: string; args: unknown; ok: boolean; datos?: unknown; privado?: unknown; error?: string; ms: number }>;
  reglas_usadas?: string[];
  tema?: string | null;
  /** Lo que cada candado atajó: el arnés las cuenta como dañinas evitadas. */
  candados?: Array<{ candado: string; detalle: string }>;
  verificador?: Array<{ motivo: string; texto: string }>;
  propuesta?: (Propuesta & { huella: string; args_modelo: Record<string, unknown> }) | null;
  ejecucion?: {
    huella: string;
    accion?: string;
    resultado: 'ejecutada' | 'rechazada' | 'vieja' | 'repetida' | 'error';
    lineas?: string[];
    escrituras?: Array<Record<string, unknown>>;
    nombrados?: string[];
    /** Lo que la acción consumió (los reenvíos cargados o descartados): cortan la tanda. */
    consumidos?: string[];
  } | null;
  respuesta_fija?: string | null;
  salida?: Salida | null;
  error?: string | null;
}
