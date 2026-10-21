// ============================================================
// Núcleo conversacional — preparar los adjuntos (foto o PDF) antes del turno, para cualquier dominio (2026-10-21)
// ------------------------------------------------------------
// Nació en el dominio ONE (#1228: el PDF del recibo es el soporte del gasto) y desde el mismo día lo usa también la
// bandeja de Trappvel (lo que el cliente manda en foto o PDF se lee y entra a la carga del viaje). Lo común:
//   · baja el archivo de Meta, lo SUBE al llegar (no se pierde aunque nadie confirme) y lo LEE a la vez;
//   · deja `media.ref` y `media.lectura` en la fila de la conversación (memoria y base): los turnos siguientes lo ven
//     como texto sin volver a bajarlo, y lo leído respalda las cifras que diga el bot (verificador);
//   · un archivo se prepara una vez por proceso aunque lo pidan a la vez la espera de la ventana y el turno;
//   · nunca escribe en el negocio: eso pasa solo con el toque, en el `ejecutar` de cada dominio.
// Qué leer (un recibo, un itinerario) lo decide el `Lector` que pasa cada dominio.
// ============================================================

import type { ArchivoAdjunto, Lector } from './one/lectura-adjunto.ts';
import type { ContextoDominio, FilaConversacion, LecturaAdjunto, MediaFila } from './tipos.ts';

/** Lo que el preparador necesita de la base y de Meta (cada dominio lo implementa en su puerto). */
export interface PuertoAdjuntos {
  /** Baja un archivo de Meta (foto o documento). null = no se pudo. */
  bajarAdjunto(mediaId: string): Promise<ArchivoAdjunto | null>;
  /** Sube el archivo al llegar y devuelve su referencia `one://`. null = no se pudo. */
  guardarAdjunto(filaId: string, archivo: ArchivoAdjunto): Promise<string | null>;
  /** Deja en la fila de la conversación lo preparado (`ref`, `lectura`). Nunca lanza. */
  anotarMedia(filaId: string, media: MediaFila): Promise<void>;
}

/** ¿La fila es un adjunto que llegó (foto o documento, escrito o reenviado), con su id de Meta? Pura. */
export function esAdjuntoEntrante(f: FilaConversacion | undefined): f is FilaConversacion & { media: MediaFila } {
  return !!f && f.direccion === 'entrante' && (f.media?.tipo === 'imagen' || f.media?.tipo === 'documento') && !!f.media.id;
}

/** Una lectura vacía con el motivo (no se pudo bajar, el lector no respondió). Pura. */
export const sinLectura = (motivo: string): LecturaAdjunto => ({ legible: false, monto: null, fecha: null, comercio: null, nit: null, descripcion: null, motivo });

export interface OpcionesPreparador {
  lector: Lector | null;
  ahora: () => number;
  /** Solo los adjuntos que llegaron desde hace este tiempo. */
  desdeMs: number;
  /** Máximo de adjuntos por turno (los más recientes). */
  max: number;
  /** Filas que no se preparan (en ONE, las que ya son soporte de un gasto). */
  omitir?: (ctx: ContextoDominio) => Set<string>;
  /** La lectura vacía del dominio (la bandeja marca `clase`, así la conversación dice «no se pudo leer el archivo»). */
  vacia?: (motivo: string) => LecturaAdjunto;
}

/**
 * El `prepararTurno` de un dominio: baja, sube y lee los adjuntos recientes que todavía no se prepararon, y lo deja en la
 * fila. Devuelve un resumen por archivo para la traza. Nunca lanza por un archivo (si falla, queda con su motivo).
 */
export function preparadorDeAdjuntos(puerto: PuertoAdjuntos, o: OpcionesPreparador): (ctx: ContextoDominio) => Promise<Array<Record<string, unknown>>> {
  const enCurso = new Map<string, Promise<MediaFila>>();
  const vacia = o.vacia ?? sinLectura;

  async function prepararUno(f: FilaConversacion & { media: MediaFila }): Promise<MediaFila> {
    const archivo = await puerto.bajarAdjunto(f.media.id).catch(() => null);
    if (!archivo) {
      const m: MediaFila = { ...f.media, lectura: vacia('no se pudo bajar el archivo') };
      await puerto.anotarMedia(f.id, m);
      return m;
    }
    const conNombre: ArchivoAdjunto = { ...archivo, nombre: f.media.nombre ?? archivo.nombre ?? null };
    // Se sube al llegar (no se pierde aunque nadie confirme) y se lee a la vez.
    const [ref, lectura] = await Promise.all([
      f.media.ref ? Promise.resolve(f.media.ref) : puerto.guardarAdjunto(f.id, conNombre).catch(() => null),
      o.lector ? o.lector(conNombre).catch(() => null) : Promise.resolve(null),
    ]);
    const m: MediaFila = {
      ...f.media, mime: f.media.mime ?? archivo.mime, ref: ref ?? null,
      lectura: lectura ?? vacia(o.lector ? 'el lector no respondió' : 'sin lector'),
    };
    await puerto.anotarMedia(f.id, m);
    return m;
  }

  return async (ctx) => {
    const omitidas = o.omitir?.(ctx) ?? new Set<string>();
    const desde = o.ahora() - o.desdeMs;
    const faltan = ctx.conversacion
      .filter((f): f is FilaConversacion & { media: MediaFila } => esAdjuntoEntrante(f) && f.media.lectura === undefined && !omitidas.has(f.id) && Date.parse(f.created_at) >= desde)
      .slice(-o.max);
    const t0 = o.ahora();
    return await Promise.all(faltan.map(async (f) => {
      let p = enCurso.get(f.id);
      if (!p) {
        p = prepararUno(f);
        enCurso.set(f.id, p);
      }
      const m = await p;
      f.media = m;
      return { fila: f.id, tipo: m.tipo, guardado: !!m.ref, leido: !!m.lectura?.legible, monto: m.lectura?.monto ?? null, ...(m.lectura?.clase ? { clase: m.lectura.clase } : {}), ms: Math.round(o.ahora() - t0) };
    }));
  };
}
