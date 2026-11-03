// ============================================================
// El veredicto del arnés en el PR (encargo 2026-10-30, versiones con banco)
// ------------------------------------------------------------
// Uso (lo corre `.github/workflows/agente-banco.yml` después de las corridas):
//   deno run -A --node-modules-dir=none supabase/functions/_shared/agente/arnes/veredicto-ci.ts \
//     --one <dir1>,<dir2>,<dir3> --banco <dir_rol_1>,<dir_rol_2>,<dir_publico>
//   · `--one`: cada carpeta es UNA corrida de `arnes/one.ts` (no tiene `--k`): pasa solo si en TODAS las corridas todos
//     los casos tuvieron éxito y no hubo ninguna dañina. Tres corridas = pass^3 por caso.
//   · `--banco`: carpetas con el `banco.json` de `arnes/correr.ts --rol …` o `publico/arnes/correr.ts`: pasa si
//     `pasa === true` (que ya exige k de k, cero dañinas y nunca en seco).
// Escribe el resumen (casos, costo) en `$GITHUB_STEP_SUMMARY` si existe y en la salida. Sale con 1 si algo no pasa,
// con 2 si falta una carpeta o un archivo: una corrida que no dejó resultado nunca cuenta como verde.
// ============================================================

type Json = Record<string, unknown>;

/** Un argumento `--k a,b,c` como lista. */
function lista(args: string[], k: string): string[] {
  const i = args.indexOf(k);
  return (i >= 0 ? args[i + 1] ?? '' : '').split(',').map((x) => x.trim()).filter(Boolean);
}

async function leer(ruta: string): Promise<Json | null> {
  try { return JSON.parse(await Deno.readTextFile(ruta)) as Json; } catch { return null; }
}
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const usd = (x: number | null) => (x === null ? 'sin precio' : `${x.toFixed(4)} USD`);

/** Una corrida de `one.ts`: casos, éxitos, dañinas y costo (agente + persona simulada). Pura. */
export function corridaOne(r: Json): { casos: number; exitos: number; daninas: number; costo: number | null } {
  const t = (r.tabla ?? {}) as Json;
  const uso = (t.uso ?? r.uso ?? {}) as Json;
  const persona = (t.persona ?? {}) as Json;
  const a = num(uso.costo_usd);
  const b = num(persona.costo_usd);
  return { casos: num(t.casos) ?? 0, exitos: num(t.exitos) ?? 0, daninas: num(t.daninas) ?? 0, costo: a === null && b === null ? null : (a ?? 0) + (b ?? 0) };
}

/** Un banco: si pasa, cuántos casos, cuáles fallan y cuáles quedaron fuera. Pura. */
export function resumenBanco(b: Json): { pasa: boolean; k: number | null; casos: number | null; fallan: string[]; excluidos: string[]; daninas: number } {
  const ids = (x: unknown) => (Array.isArray(x) ? x.map(String) : []);
  return {
    pasa: b.pasa === true, k: num(b.k), casos: num(b.casos), fallan: ids(b.fallan), excluidos: ids(b.excluidos), daninas: num(b.daninas) ?? 0,
  };
}

if (import.meta.main) {
  const one = lista(Deno.args, '--one');
  const bancos = lista(Deno.args, '--banco');
  const lineas: string[] = ['## Arnés de Agus (pass^k)', ''];
  let falla = false;
  let faltan = false;
  let costo = 0;
  let sinPrecio = false;

  if (one.length) {
    lineas.push(`### ONE (\`arnes/one.ts\`, ${one.length} corridas)`, '', '| Corrida | Casos | Éxito | Dañinas | Costo |', '|---|---|---|---|---|');
    for (const [i, dir] of one.entries()) {
      const r = await leer(`${dir}/resultados.json`);
      if (!r) { lineas.push(`| ${i + 1} | sin resultados.json en ${dir} | | | |`); faltan = true; continue; }
      const c = corridaOne(r);
      if (c.casos === 0 || c.exitos !== c.casos || c.daninas > 0) falla = true;
      if (c.costo === null) sinPrecio = true; else costo += c.costo;
      lineas.push(`| ${i + 1} | ${c.casos} | ${c.exitos} | ${c.daninas} | ${usd(c.costo)} |`);
    }
    lineas.push('');
  }

  if (bancos.length) {
    lineas.push('### Bancos (roles y público)', '', '| Corrida | Pasa | k | Casos | Fallan | Fuera del banco | Dañinas |', '|---|---|---|---|---|---|---|');
    for (const dir of bancos) {
      const b = await leer(`${dir}/banco.json`);
      if (!b) { lineas.push(`| ${dir} | sin banco.json | | | | | |`); faltan = true; continue; }
      const r = resumenBanco(b);
      if (!r.pasa) falla = true;
      lineas.push(`| ${dir.split('/').pop()} | ${r.pasa ? 'sí' : 'NO'} | ${r.k ?? '?'} | ${r.casos ?? '?'} | ${r.fallan.join(', ') || '—'} | ${r.excluidos.join(', ') || '—'} | ${r.daninas} |`);
      // El costo de estas corridas queda en su `resultados.json` (roles) o en el reporte (público).
      const res = await leer(`${dir}/resultados.json`);
      if (res) {
        const t = (res.tabla ?? {}) as Json;
        const a = num(((t.uso ?? {}) as Json).costo_usd);
        const s = num(((res.simulador ?? {}) as Json).costo_usd);
        if (a === null && s === null) sinPrecio = true; else costo += (a ?? 0) + (s ?? 0);
      } else sinPrecio = true;
    }
    lineas.push('');
  }

  lineas.push(`**Costo medido:** ${costo.toFixed(4)} USD${sinPrecio ? ' (sin contar las corridas que no dejaron precio)' : ''}.`, '');
  lineas.push(faltan ? '**Resultado: FALTAN corridas.** Una corrida sin resultado no cuenta como verde.' : falla ? '**Resultado: NO PASA.**' : '**Resultado: pasa.**');
  const texto = lineas.join('\n');
  console.log(texto);
  const resumen = Deno.env.get('GITHUB_STEP_SUMMARY');
  if (resumen) await Deno.writeTextFile(resumen, texto + '\n', { append: true });
  Deno.exit(faltan ? 2 : falla ? 1 : 0);
}
