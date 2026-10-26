// Las dos funciones del directorio (`buscar_contacto_duplicado` y `buscar_clientes_por_nombre`) para los dobles
// de base en memoria de las pruebas. Siguen el SQL de las migraciones `20260908000001` y `20261005190000`: la
// llave por los últimos 10 dígitos, el correo en minúsculas y el usuario sin arroba; el nombre por todas sus
// palabras o por trigramas (como `similarity` de pg_trgm). Datos sintéticos: los ponen las pruebas.

type Fila = Record<string, unknown>;

/** Para probar «error al comprobar ≠ permiso para crear»: con `true`, las dos funciones responden error. */
export const directorioCaido = { valor: false };

function digitos(t: unknown): string {
  return String(t ?? '').replace(/\D/g, '');
}

function norm(t: unknown): string {
  return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function trigramas(t: string): Set<string> {
  const out = new Set<string>();
  for (const w of t.split(' ').filter(Boolean)) {
    const p = `  ${w} `;
    for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  }
  return out;
}

function similitud(a: string, b: string): number {
  const ta = trigramas(a);
  const tb = trigramas(b);
  const comunes = [...ta].filter(x => tb.has(x)).length;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : comunes / union;
}

const VACIAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'cliente', 'clienta', 'senor', 'senora', 'sr', 'sra', 'don', 'dona']);

/** Responde las dos funciones del directorio, o `undefined` si `nombre` es otra. */
export function rpcDelDirectorio(t: Record<string, Fila[]>, nombre: string, a: Fila): { data: unknown; error: { message: string } | null } | undefined {
  if (nombre !== 'buscar_contacto_duplicado' && nombre !== 'buscar_clientes_por_nombre') return undefined;
  if (directorioCaido.valor) return { data: null, error: { message: 'directorio caído (doble)' } };
  const contactos = (t.contactos ?? []).filter(c => c.workspace_id === a.p_workspace_id || c.workspace_id === undefined);
  const orden = (x: Fila, y: Fila) => String(x.created_at ?? '').localeCompare(String(y.created_at ?? '')) || String(x.id).localeCompare(String(y.id));
  if (nombre === 'buscar_contacto_duplicado') {
    const d = digitos(a.p_telefono);
    const tel = d.length >= 10 ? d.slice(-10) : d || null;
    const mail = String(a.p_email ?? '').trim().toLowerCase() || null;
    const wa = String(a.p_usuario_whatsapp ?? '').trim().replace(/^@/, '').toLowerCase() || null;
    const filas = contactos.filter(c => (tel && digitos(c.telefono) && digitos(c.telefono).slice(-10) === tel)
      || (mail && String(c.email ?? '').trim().toLowerCase() === mail)
      || (wa && String(c.usuario_whatsapp ?? '').trim().replace(/^@/, '').toLowerCase() === wa))
      .sort(orden).slice(0, 10)
      .map(c => ({ id: c.id, nombre: c.nombre, telefono: c.telefono ?? null, email: c.email ?? null, usuario_whatsapp: c.usuario_whatsapp ?? null, motivo: 'telefono' }));
    return { data: filas, error: null };
  }
  const txt = norm(a.p_texto);
  const ws = txt.split(' ').filter(w => w.length >= 2 && !VACIAS.has(w));
  if (!txt || ws.length === 0) return { data: [], error: null };
  const negocios = t.negocios ?? [];
  const filas = contactos.map(c => {
    const nom = norm(c.nombre);
    return { c, exacto: nom === txt, todas: ws.every(w => ` ${nom} `.includes(` ${w} `)), sim: similitud(nom, txt) };
  }).filter(x => x.exacto || x.todas || x.sim >= 0.45)
    .sort((x, y) => Number(y.exacto) - Number(x.exacto) || Number(y.todas) - Number(x.todas) || y.sim - x.sim || orden(x.c, y.c))
    .slice(0, 5)
    .map(({ c, exacto }) => {
      const suyos = negocios.filter(n => n.contacto_id === c.id);
      const cerrado = suyos.filter(n => n.estado !== 'abierto').sort((x, y) => String(y.created_at ?? '').localeCompare(String(x.created_at ?? '')))[0];
      const d = digitos(c.telefono);
      return {
        id: c.id, nombre: c.nombre, cel4: d.length >= 4 ? d.slice(-4) : null,
        tiene_correo: !!String(c.email ?? '').trim(), tiene_usuario: !!String(c.usuario_whatsapp ?? '').trim(),
        abiertos: suyos.filter(n => n.estado === 'abierto').map(n => ({ codigo: n.codigo ?? null, nombre: n.nombre ?? null })),
        cerrado: cerrado ? { codigo: cerrado.codigo ?? null, nombre: cerrado.nombre ?? null } : null,
        exacto,
      };
    });
  return { data: filas, error: null };
}
