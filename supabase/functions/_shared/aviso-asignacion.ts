// ============================================================
// El texto del aviso de asignación (correo de `avisar-asignacion`)
// ------------------------------------------------------------
// La campanita la escribe el trigger `avisar_asignacion_responsable` con el MISMO título y mensaje (migración
// 20261016193000): si cambia uno, cambia el otro. Puro.
// ============================================================

/** De dónde salió la asignación (`negocio_responsables.asignado_origen`). `null` = fila anterior al 2026-10-26. */
export type OrigenAsignacion = 'persona' | 'bot_whatsapp' | 'regla_etapa';

export function textoAvisoAsignacion(p: {
  codigo: string | null;
  nombre: string | null;
  rol: string | null;
  quienAsigna: string | null;
  origen?: OrigenAsignacion | null;
  /** Nombre de la etapa a la que entró el negocio, con origen `regla_etapa`. */
  etapa?: string | null;
}): {
  titulo: string;
  mensaje: string;
  etiqueta: string;
} {
  const nombre = (p.nombre ?? '').trim() || 'un negocio';
  const etiqueta = p.codigo ? `${p.codigo} — ${nombre}` : nombre;
  const titulo = `Te asignaron ${p.codigo ? `${p.codigo} · ${nombre}` : nombre}`;
  const como = p.rol ? ` (${p.rol})` : '';
  const etapa = (p.etapa ?? '').trim();
  // Con persona manda la persona; sin ella, el origen. El trigger arma el mismo texto en SQL.
  const inicio = p.quienAsigna
    ? `${p.quienAsigna} te dejó como responsable`
    : p.origen === 'bot_whatsapp'
      ? 'El bot de WhatsApp te dejó como responsable'
      : 'Quedaste como responsable';
  const cola = !p.quienAsigna && p.origen === 'regla_etapa' && etapa ? ` al entrar a la etapa ${etapa}` : '';
  const mensaje = `${inicio}${como} de este negocio${cola}.`;
  return { titulo, mensaje, etiqueta };
}
