// ============================================================
// Asistente de ventas — ¿la dirección del pedido la escribió el cliente después de autorizar? (Dimpro, 30-oct)
// ------------------------------------------------------------
// Mauricio (Messenger, 30-oct): «Revisa lo de la dirección. Se enredó». El cliente escribió «Cl 24 A bis # 100 71» y
// luego el barrio en otro mensaje; el modelo la pasó con «Bogotá» y «barrio» agregados y el candado (que la validaba como
// un NOMBRE: cada palabra tenía que estar en lo que escribió el cliente) la rechazó con «Pídelo». El bot le volvió a
// pedir la dirección tres veces.
//
// Ahora la dirección se valida como dirección:
//   · las palabras de relleno o de ubicación que el modelo agrega (Bogotá, barrio, cerca, la, de…) no cuentan;
//   · las abreviaturas valen como la palabra entera (Cl = Calle, Cra = Carrera, # = No.…);
//   · lo que lleva números (24A, 100, 71) se busca sin espacios en lo que escribió el cliente («24 A» = «24A»);
//   · todo lo demás (el barrio, la referencia, «sur», «bis») tiene que estar en lo que escribió el cliente.
// La intención del candado no cambia: lo dicho ANTES de la autorización no cuenta. Puro.
// ============================================================

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim();

/** Lo que el modelo suele agregar al armar la dirección y no cambia a dónde se entrega. */
const RELLENO = new Set([
  'barrio', 'bogota', 'colombia', 'cundinamarca', 'ciudad', 'localidad', 'urbana', 'dc', 'direccion', 'entrega', 'referencia',
  'cerca', 'frente', 'junto', 'al', 'la', 'el', 'los', 'las', 'de', 'del', 'en', 'y', 'con', 'por',
]);

/** Abreviaturas de dirección colombianas → la forma canónica. */
const ABREVIATURAS: Record<string, string> = {
  calle: 'calle', cl: 'calle', cll: 'calle', cal: 'calle', clle: 'calle',
  carrera: 'carrera', cra: 'carrera', cr: 'carrera', kr: 'carrera', kra: 'carrera', carr: 'carrera', crr: 'carrera',
  avenida: 'avenida', av: 'avenida', avda: 'avenida', ak: 'avenida carrera', ac: 'avenida calle',
  diagonal: 'diagonal', dg: 'diagonal', diag: 'diagonal',
  transversal: 'transversal', tv: 'transversal', tr: 'transversal', trans: 'transversal', transv: 'transversal',
  numero: 'numero', no: 'numero', nro: 'numero', n: 'numero',
  apartamento: 'apartamento', apto: 'apartamento', ap: 'apartamento', apt: 'apartamento',
  interior: 'interior', int: 'interior', torre: 'torre', to: 'torre', casa: 'casa', cs: 'casa',
  edificio: 'edificio', ed: 'edificio', edif: 'edificio', conjunto: 'conjunto', conj: 'conjunto', manzana: 'manzana', mz: 'manzana',
  bloque: 'bloque', bl: 'bloque', local: 'local', lc: 'local', piso: 'piso',
};
const canon = (w: string) => ABREVIATURAS[w] ?? w;

/**
 * Las piezas de una dirección: palabras (canónicas) y bloques con números («24 A» → «24a»: una letra suelta pegada a un
 * número va con él). Pura.
 */
export function piezasDireccion(texto: string): { palabras: string[]; numeros: string[] } {
  const ws = normal(texto).split(' ').filter(Boolean);
  const palabras: string[] = [];
  const numeros: string[] = [];
  for (const [i, w] of ws.entries()) {
    if (/\d/.test(w)) { numeros.push(w); continue; }
    // «24 A» → «24a» (la letra suelta justo después de un número es parte de él).
    if (w.length === 1 && i > 0 && /\d/.test(ws[i - 1]) && w !== 'n') { numeros[numeros.length - 1] += w; continue; }
    palabras.push(canon(w));
  }
  return { palabras, numeros };
}

/**
 * ¿La dirección que pasó el modelo sale de lo que escribió el cliente después de autorizar? Devuelve lo que el cliente no
 * escribió (vacío = sí sale). Una dirección sin ningún número no es dirección. Pura.
 */
export function direccionNoEscrita(valor: string, tras: string): string[] {
  const v = piezasDireccion(valor);
  if (!v.numeros.length) return ['(sin número de calle o carrera)'];
  const t = piezasDireccion(tras);
  const palabrasCliente = new Set(t.palabras.flatMap((p) => p.split(' ')));
  const compacto = normal(tras).replace(/ /g, '');
  const faltan: string[] = [];
  for (const n of v.numeros) if (!compacto.includes(n)) faltan.push(n);
  for (const p of v.palabras) {
    if (p.length < 2 || RELLENO.has(p)) continue;
    if (p.split(' ').every((x) => palabrasCliente.has(x))) continue;
    faltan.push(p);
  }
  return [...new Set(faltan)];
}
