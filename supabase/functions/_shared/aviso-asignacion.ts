// ============================================================
// El texto del aviso de asignación (correo de `avisar-asignacion`)
// ------------------------------------------------------------
// La campanita la escribe el trigger `avisar_asignacion_responsable` con el MISMO título y mensaje (migración
// 20261016193000): si cambia uno, cambia el otro. Puro.
// ============================================================

export function textoAvisoAsignacion(p: { codigo: string | null; nombre: string | null; rol: string | null; quienAsigna: string | null }): {
  titulo: string;
  mensaje: string;
  etiqueta: string;
} {
  const nombre = (p.nombre ?? '').trim() || 'un negocio';
  const etiqueta = p.codigo ? `${p.codigo} — ${nombre}` : nombre;
  const titulo = `Te asignaron ${p.codigo ? `${p.codigo} · ${nombre}` : nombre}`;
  const como = p.rol ? ` (${p.rol})` : '';
  const mensaje = p.quienAsigna
    ? `${p.quienAsigna} te dejó como responsable${como} de este negocio.`
    : `Quedaste como responsable${como} de este negocio.`;
  return { titulo, mensaje, etiqueta };
}
