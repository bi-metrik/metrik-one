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
  /** El archivo que llegó con el mensaje (`{ tipo: 'imagen', id }` = el id de Meta para bajarlo). Solo entrantes. */
  media?: MediaFila | null;
  turno_id?: string | null;
  traza?: Traza | null;
  created_at: string;
}

/**
 * Lo que se leyó de un soporte (foto o PDF) con el modelo (`one/lectura-adjunto.ts`). Son datos del DOCUMENTO: mandan en
 * monto, fecha, comercio y NIT; el destino y a qué gasto corresponde los dice la persona.
 */
export interface LecturaAdjunto {
  /** false = no es un soporte de pago o no se alcanzó a leer el total. */
  legible: boolean;
  monto: number | null;
  /** AAAA-MM-DD. */
  fecha: string | null;
  comercio: string | null;
  nit: string | null;
  descripcion: string | null;
  /** Por qué no hay lectura (no se pudo bajar, el modelo no respondió). */
  motivo?: string;
  /**
   * Solo la lectura de la bandeja (documentos que manda el cliente de una agencia, `bandeja/lectura-adjunto.ts`): qué es
   * el documento. `viaje` = pide o describe un viaje; `identidad` = pasaporte, cédula; `pago` = comprobante de pago.
   */
  clase?: ClaseDocumento;
  /** Solo la bandeja: lo que el documento dice que sirve para el viaje, con sus palabras (entra a la carga como dato). */
  texto?: string | null;
}

export type ClaseDocumento = 'viaje' | 'identidad' | 'pago' | 'otro';

/**
 * `wa_conversacion.media` (jsonb). El webhook escribe `tipo` e `id` (y, en un documento, `mime` y `nombre`); el dominio
 * ONE completa `ref` (el archivo ya subido a `gastos-soportes`, todavía sin gasto) y `lectura` al preparar el turno.
 */
export interface MediaFila {
  tipo: string;
  id: string;
  /** Cuántas veces se intentó leer (una lectura que falló por tiempo o por la descarga se reintenta hasta 3). */
  intentos?: number;
  mime?: string;
  nombre?: string;
  ref?: string | null;
  lectura?: LecturaAdjunto | null;
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
  /** Las declaraciones para el modelo de respaldo, si son otras (más estrictas). Sin esto, las mismas. */
  herramientasRespaldo?: DeclaracionHerramienta[];
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
  /**
   * La cosa concreta que se consultó (en la bandeja, el código del viaje de `ver_viaje`). Una propuesta pendiente sobre
   * otra cosa queda atrás cuando la conversación consulta esta (`propuestaVigente`).
   */
  sobre?: string;
}

/** Lo que un ejecutor de `proponer` arma: el resumen y lo que se ejecutaría con el toque. */
export interface Propuesta {
  accion: string;
  /** Los datos resueltos por el código (ids reales), que son los que se ejecutan. */
  datos: Record<string, unknown>;
  /** El texto que ve el comercial, armado por el código con datos reales. */
  resumen: string;
  /** La cosa concreta donde escribe (el código del viaje); sin `sobre`, todavía no existe (un viaje nuevo, un cliente). */
  sobre?: string;
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
  /**
   * Qué es un reenvío del equipo. `tanda` (por defecto, la bandeja): dato del cliente que se junta sin modelo hasta que el
   * comercial pide el resumen. `mensaje` (ONE): entra al turno del modelo como cualquier otro mensaje (marcado como reenvío).
   */
  reenvios?: 'tanda' | 'mensaje';
  /**
   * `true` (ONE): una propuesta vence en cuanto el bot manda otro mensaje del modelo que no es ella misma (una pregunta,
   * otra propuesta, una respuesta). Su botón deja de escribir. Medido en el arnés del 2026-10-21: el bot propuso «gasto de
   * empresa», la persona contestó «1», el bot volvió a preguntar y el «Registrar» viejo, todavía vivo, registró a empresa.
   * Sin la bandera (la bandeja) la propuesta sigue viva mientras la conversación no consulte otra cosa (`sobre`).
   */
  propuestaVenceConRespuesta?: boolean;
  /** Las herramientas de lectura del dominio. */
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
   * `seguir`: el modelo tiene un turno después del hecho (crear un cliente → ¿quedó una solicitud suya sin atender?). Él
   * decide si propone lo que sigue, pregunta lo que falta o termina; el código no lee el texto. El hecho sale igual.
   */
  trasEjecutar?(propuesta: Propuesta, hechos: Hechos, huella: string, ctx: ContextoDominio): Promise<{ lineas: string[]; propuesta?: Propuesta; seguir?: boolean } | null>;
  /** ¿La propuesta sigue sirviendo? (la tanda no cambió desde que se armó). Ausente = sí. */
  sigueVigente?(propuesta: Propuesta, ctx: ContextoDominio): boolean;
  /**
   * Antes del turno del modelo (2026-10-21, soportes del dominio ONE): baja, guarda y lee los archivos que llegaron
   * (fotos y PDF) y deja lo leído en la fila (`media.ref`, `media.lectura`), para que la conversación lo muestre como
   * texto. Devuelve un resumen para la traza. Nunca escribe en el negocio. El núcleo le pone un tope de tiempo.
   */
  prepararTurno?(ctx: ContextoDominio): Promise<Array<Record<string, unknown>>>;
  /**
   * Ventana de los adjuntos (ms, 2026-10-21): un adjunto y el texto que lo acompaña en mensajes separados se atienden
   * en el MISMO turno si llegan dentro de esta ventana (la cola espera tras un adjunto y repite el turno si un adjunto
   * llegó mientras el modelo pensaba). Sin ella, cada mensaje es su turno.
   */
  ventanaAdjuntosMs?: number;
  /** Una línea del estado que solo el dominio sabe (la tanda abierta). */
  estado?(ctx: ContextoDominio): string[] | Promise<string[]>;
  /**
   * Los registros que la conversación dice que se hicieron, revisados en la base en este turno (`registros.ts`). El
   * núcleo los pone en el Estado, anota los mensajes viejos, ataja con el verificador «ya está registrado» de uno
   * borrado y no deja proponer sobre él. `'error'`: no se pudo revisar. Una consulta por turno.
   */
  registros?(ctx: ContextoDominio): Promise<RegistroConversacion[] | 'error'>;
  /**
   * Herramientas del dominio que CIERRAN el turno con una salida que escribe el código, no el modelo (`link_autorizacion`:
   * el link real y el mensaje para reenviar tal cual). Pueden ser varios mensajes: el primero va como respuesta y los
   * demás salen después, en orden. El modelo solo decide llamarla y con qué ficha.
   */
  cierres?: DeclaracionHerramienta[];
  /**
   * Revisa una respuesta del modelo antes de que salga (2026-10-21). Devuelve el error para el modelo, o null. En ONE: la
   * lista para elegir a qué negocio va un gasto (con «Gasto de empresa») solo la arma el código (`preguntar_destino`).
   */
  revisarRespuesta?(salida: Salida, ctx: ContextoDominio): string | null;
  cerrar?(nombre: string, args: Record<string, unknown>, ctx: ContextoDominio): Promise<
    | { ok: true; salidas: Salida[]; datos?: unknown; privado?: unknown }
    | { ok: false; error: string; candado: string }
  >;
}

/**
 * Un registro que la conversación dice que se hizo (un gasto G1, un viaje abierto), con su estado en la base AHORA
 * (`Dominio.registros`, 2026-10-21: «la conversación da la intención; la verdad la da la base»).
 */
export interface RegistroConversacion {
  /** El id en la base (el de la escritura de la traza). */
  id: string;
  /** Cómo lo nombra la conversación (G1, «M1 26 9»). */
  alias: string;
  /** Una línea con lo que es, con los datos de la base si sigue (o los de la traza si ya no existe). */
  que: string;
  estado: 'vigente' | 'borrado';
  /** Sus cifras (para que el verificador no deje afirmar la de uno borrado). */
  montos?: number[];
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
  herramientas?: Array<{ nombre: string; args: unknown; ok: boolean; datos?: unknown; privado?: unknown; sobre?: string; error?: string; ms: number }>;
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
  /**
   * El turno del modelo que siguió a un toque (`trasEjecutar` con `seguir`): de qué toque vino y cómo terminó. La traza
   * es de tipo `modelo` (así cuenta en el uso del mes) y trae la `ejecucion` del toque.
   */
  tras_toque?: { origen: 'toque_propuesta' | 'si_escrito'; resultado: 'propuesta' | 'respuesta' | 'terminar' | 'solo_hecho' } | null;
  salida?: Salida | null;
  /** Los registros de la conversación como estaban en la base en este turno (alias y estado). */
  registros?: Array<{ alias: string; estado: string }> | 'error' | null;
  /** Los adjuntos que el dominio preparó antes del turno (bajados, guardados, leídos) y cuánto tardó. */
  adjuntos?: Array<Record<string, unknown>> | null;
  /** Los mensajes que salieron después de `salida` en el mismo turno (un cierre del dominio con varios mensajes). */
  salidas_extra?: Salida[] | null;
  error?: string | null;
}
