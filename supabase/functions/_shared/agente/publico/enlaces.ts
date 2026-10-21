// ============================================================
// Asistente público — links solo de la lista blanca (§8.1, verificador de `responder`)
// ------------------------------------------------------------
// El verificador del núcleo revisa cifras, fechas, celulares y correos; los links no. Aquí: todo link que escriba el
// modelo tiene que empezar por uno de la lista (términos, sitio de Sabor, mapa). Si no, la respuesta no sale (sale la
// respuesta fija de «no pude») y queda el candado en la traza. Se reconocen `https://…`, `http://…` y `www.…`. Pura.
// ============================================================

const RE_ENLACE = /\b(?:https?:\/\/|www\.)[^\s<>()"'«»]+/giu;

const normal = (u: string) => u.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[.,;:!?)\]]+$/u, '').replace(/\/+$/, '');

export function enlacesDe(texto: string): string[] {
  return [...texto.matchAll(RE_ENLACE)].map((m) => m[0].replace(/[.,;:!?)\]]+$/u, ''));
}

/** Los links del texto que no empiezan por ninguno permitido. Vacío = pasa. Pura. */
export function enlacesFueraDeLista(texto: string, permitidos: string[]): string[] {
  const ok = permitidos.map(normal).filter(Boolean);
  return enlacesDe(texto).filter((e) => {
    const n = normal(e);
    return !ok.some((p) => n === p || n.startsWith(`${p}/`) || n.startsWith(`${p}?`) || n.startsWith(`${p}#`));
  });
}
