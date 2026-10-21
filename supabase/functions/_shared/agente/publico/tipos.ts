// ============================================================
// Asistente público sobre Chatwoot — los tipos (Sabor & Experiencias, etapa 1)
// ------------------------------------------------------------
// Diseño: proyectos/sabor-experiencias/clarity/docs/entrada/diseno-asistente-etapa1.md.
//
// El asistente corre sobre el núcleo conversacional (`../nucleo.ts`: el turno del modelo, las propuestas con huella, el
// verificador, el reglamento versionado). Lo que cambia frente a la bandeja de Trappvel:
//   · la llave de la conversación es cuenta + id de conversación de Chatwoot, no un teléfono;
//   · lo que sale va por la API de Chatwoot (mensaje, nota privada, etiquetas, asignación, estado), no por Meta;
//   · quien escribe es un cliente final, no el equipo: aviso de bot, autorización de datos, ventanas por canal.
// Las filas se guardan en `chatwoot_conversacion` (migración 20261021090000). Para reusar el núcleo, una fila de
// Chatwoot se ve como `FilaConversacion` con `phone` = la llave de la conversación y `wa_message_id` = el id del mensaje
// en Chatwoot.
// ============================================================

import type { FilaConversacion, Salida, Traza } from '../tipos.ts';

export type Canal = 'instagram' | 'tiktok' | 'whatsapp' | 'otro';

/** La conversación de Chatwoot: la llave del candado, de la cola y de la fila (no hay teléfono en IG ni TikTok). */
export interface LlaveConversacion {
  workspaceId: string;
  cuentaId: number;
  conversacionId: number;
}

export const llaveTexto = (l: Pick<LlaveConversacion, 'cuentaId' | 'conversacionId'>): string => `${l.cuentaId}:${l.conversacionId}`;

/** Una fila de `chatwoot_conversacion`, con la forma que lee el núcleo. */
export interface FilaPublica extends FilaConversacion {
  canal: Canal;
  enmascarado?: boolean;
  /** El adjunto de audio como llegó (url y extensión). */
  adjunto?: { tipo: string; url: string | null; extension?: string | null; no_soportado?: boolean } | null;
  /** Solo salientes. */
  estado?: 'generado' | 'publicado' | 'fallido' | 'incierto' | null;
  ranura?: string | null;
  traza?: TrazaPublica | null;
  /** Lo que tardó el webhook en guardar esta fila (entrantes). */
  ms_webhook?: number | null;
}

/** Tiempos internos por tramo (§10.2). Todos en ms. */
export interface Tramos {
  /** Lo que tardó el webhook en guardar el último mensaje (de su fila). */
  recepcion_ms?: number | null;
  /** La espera de la ráfaga (se resta del tiempo interno). */
  rafaga_ms?: number;
  transcripcion_ms?: number;
  /** Cada intento del modelo (el 1 y, si llegó `corte_1`, el 2 en paralelo). */
  intentos?: Array<{ n: number; ms: number; ok: boolean; motivo?: string; ganador?: boolean }>;
  publicacion_ms?: number;
  /** Desde que llegó el último mensaje de la ráfaga hasta que Chatwoot aceptó la respuesta, menos la ráfaga. */
  interno_ms?: number;
}

export type MotivoPersona =
  | 'reserva_lista' | 'restriccion' | 'celebracion' | 'grupo' | 'pide_persona' | 'queja' | 'pago' | 'no_entiende'
  | 'menor' | 'crisis' | 'abuso' | 'duda_abierta' | 'datos' | 'falla';

export const MOTIVOS_PERSONA: MotivoPersona[] = [
  'reserva_lista', 'restriccion', 'celebracion', 'grupo', 'pide_persona', 'queja', 'pago', 'no_entiende',
  'menor', 'crisis', 'abuso', 'duda_abierta', 'datos', 'falla',
];

/** La etiqueta de Chatwoot de cada motivo (§6.1). */
export const ETIQUETA_MOTIVO: Record<MotivoPersona, string> = {
  reserva_lista: 'reserva', restriccion: 'restriccion', celebracion: 'celebracion', grupo: 'grupo', pide_persona: 'persona',
  queja: 'queja', pago: 'pago', no_entiende: 'no_entiende', menor: 'menor', crisis: 'crisis', abuso: 'abuso', duda_abierta: 'duda', datos: 'datos', falla: 'falla',
};

export type TipoAutorizacion = 'general' | 'sensible';

/** Un evento de autorización leído por el código (queda en la traza y, como prueba, en `chatwoot_consentimientos`). */
export interface EventoAutorizacion {
  tipo: TipoAutorizacion;
  respuesta: 'si' | 'no';
  /** Id en Chatwoot y texto del mensaje con que respondió. */
  mensaje_id: string | null;
  mensaje_texto: string;
  texto_clave: string;
  texto_version: string;
  texto_huella: string;
  at: string;
}

export interface PasoAPersona {
  motivo: MotivoPersona;
  etiqueta: string;
  equipo: number | null;
  nota: string;
}

export type TrazaPublica = Traza & {
  canal?: Canal;
  tramos?: Tramos;
  /** El aviso de bot y términos que salió en este turno (§5.1), con su versión y huella. */
  aviso?: { clave: string; version: string; huella: string; motivo: 'primero' | 'vuelve_de_persona' | 'pausa_larga' } | null;
  /** Lo que el código leyó como respuesta a una autorización en este turno. */
  autorizacion?: EventoAutorizacion | null;
  /** La autorización que este turno pidió (la respuesta fija con Sí / No). */
  pide_autorizacion?: TipoAutorizacion | null;
  /** El paso a persona que hizo este turno. */
  persona?: PasoAPersona | null;
  /** El aviso de demora salió en este turno (`rf.demora`). */
  demora?: boolean;
  /** Mensajes de este turno que se guardaron enmascarados (dato de salud). */
  enmascarados?: string[];
  /** Por qué no se publicó (ventana vencida, conversación ya de una persona, interruptor). */
  sin_publicar?: string | null;
  /** Links que no estaban en la lista blanca (la respuesta no salió). */
  enlaces_rechazados?: string[];
  /** Cuántas veces se descartó el borrador porque entró otro mensaje mientras generaba. */
  regenerado?: number;
  /** La mesa o zona que pidió el cliente: PREFERENCIA, nunca asignación (§8.4.2). */
  preferencia_mesa?: string | null;
  /** Topes que actuaron (presupuesto, turnos por conversación, anti-spam). */
  topes?: string[];
};

/** Lo que el turno publica: la salida y, si aplica, el paso a persona después. */
export interface Publicacion {
  ranura: string;
  salida: Salida;
}
