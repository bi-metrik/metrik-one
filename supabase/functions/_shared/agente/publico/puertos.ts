// ============================================================
// Asistente público — los puertos de Chatwoot (§2, §3.3, §6.2, §9)
// ------------------------------------------------------------
// Los mismos papeles que los puertos del núcleo (`../tipos.ts`), con la llave de Chatwoot:
//   · `AlmacenPublico`     la conversación (`chatwoot_conversacion`), los candados, la prueba de consentimientos.
//                          Lo que sale nace `generado` en una ranura única por turno y pasa a `publicado`: el mismo turno
//                          no publica dos veces la misma cosa (la API de Chatwoot no tiene clave de idempotencia).
//   · `MensajeroChatwoot`  mensaje, nota privada, etiquetas, asignación y `toggle_status`, y el estado de la conversación.
//   · `Transcriptor`       la nota de voz desde la URL de Chatwoot (Gemini, `transcribir.ts`).
// Producción: `produccion.ts`. Pruebas y arnés: `memoria.ts`.
// ============================================================

import type { Salida } from '../tipos.ts';
import type { Canal, FilaPublica, LlaveConversacion, TipoAutorizacion, TrazaPublica } from './tipos.ts';

export interface Consentimiento {
  llave: LlaveConversacion;
  canal: Canal;
  tipo: 'aviso' | TipoAutorizacion;
  respuesta: 'informado' | 'si' | 'no';
  textoClave: string;
  textoVersion: string;
  textoHuella: string;
  mensajeTexto: string | null;
  chatwootMessageId: number | null;
}

export interface AlmacenPublico {
  /** La conversación desde `desdeIso`, en orden. */
  leer(l: LlaveConversacion, desdeIso: string): Promise<FilaPublica[]>;
  /** Marca las entrantes como atendidas por el turno y deja la traza en `filaTraza`. */
  cerrarTurno(p: { turnoId: string; filas: string[]; filaTraza: string; traza: TrazaPublica }): Promise<void>;
  /** El texto de una nota de voz ya transcrita. */
  completarTexto(id: string, texto: string): Promise<void>;
  /** Deja sin el detalle los mensajes con un dato de salud o de tarjeta (§5.3). */
  enmascarar(ids: string[]): Promise<void>;
  /**
   * Guarda lo que va a salir como `generado` en (turno, ranura). Devuelve el id de la fila, o `null` si esa ranura del
   * turno ya existe (otro intento ya la tomó: no se publica dos veces).
   */
  reservarSalida(p: { llave: LlaveConversacion; canal: Canal; turnoId: string; ranura: string; salida: Salida; nota?: boolean }): Promise<string | null>;
  marcarSalida(id: string, r: { estado: 'publicado' | 'fallido' | 'incierto'; chatwootMessageId?: number | null }): Promise<void>;
  registrarConsentimiento(c: Consentimiento): Promise<void>;
  /** Las trazas de turnos del modelo del workspace desde `desdeIso` (el gasto del día). `null` = no se pudo leer. */
  trazasDelModelo(workspaceId: string, desdeIso: string): Promise<TrazaPublica[] | null>;
  tomarCandado(clave: string, segundos: number): Promise<boolean>;
  soltarCandado(clave: string): Promise<void>;
}

export type ResultadoPublicar = { ok: true; id: number | null } | { ok: false; incierto: boolean; motivo: string };

export interface MensajeroChatwoot {
  /** `pending`, `open`, `resolved`, `snoozed`, o `null` si no se pudo leer. */
  estado(l: LlaveConversacion): Promise<string | null>;
  publicar(l: LlaveConversacion, s: Salida): Promise<ResultadoPublicar>;
  nota(l: LlaveConversacion, texto: string): Promise<ResultadoPublicar>;
  /** Agrega etiquetas sin quitar las que ya tiene. */
  etiquetar(l: LlaveConversacion, etiquetas: string[]): Promise<boolean>;
  asignarEquipo(l: LlaveConversacion, equipo: number): Promise<boolean>;
  /** `toggle_status` a `open`: la conversación queda para las personas. */
  abrir(l: LlaveConversacion): Promise<boolean>;
}

export interface Transcriptor {
  transcribir(a: { url: string; extension?: string | null }): Promise<{ texto: string | null; error?: string }>;
}

export interface AvisosInternos {
  /** A MéTRIK, nunca al cliente (alertas de presupuesto). */
  avisar(texto: string): Promise<void>;
}
