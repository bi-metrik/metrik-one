import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Prueba de contrato de la razón social de MéTRIK en lo que ONE publica.
 *
 * La sociedad es METRIK IA S.A.S., NIT 902.079.601-9. El nombre sin «IA» pertenece a OTRA
 * sociedad, homónima, del mismo sector (decisión de constitución del 2026-06-14). Hasta el
 * 2026-09-16 el aviso de la Política de Datos que acepta cada usuario del módulo Valida API
 * («Al continuar, autoriza a …») y el autor de tres PDF de compliance nombraban a esa otra
 * sociedad. En metrik-valida el mismo defecto estaba en la Política publicada, el ANS y las
 * portadas; allá lo vigila `lib/docs/razon-social-publicada.test.ts`.
 *
 * La marca comercial sigue siendo MéTRIK, sin sufijo. Lo prohibido es la marca CON sufijo
 * societario y sin «IA», y el NIT declarado «en proceso».
 *
 * Barre por contenido lo que se despliega y lo que migra la base, como `retencion.test.ts`: una
 * lista de rutas no ve el archivo nuevo. Las pruebas quedan fuera porque tienen que poder escribir
 * la forma prohibida para vigilarla.
 *
 * VERIFICADO POR MUTACIÓN (2026-09-16): la forma prohibida inyectada en el aviso de
 * `valida-api/politica.ts`, en el autor de un PDF, partida en dos líneas y con la «é» escrita como
 * escape de JSX tumba el barrido y nombra el archivo; revertida, vuelve a verde.
 */

const RAIZ = resolve(process.cwd());

/** Lo que se despliega (app y edge functions), lo que migra la base y lo que se sirve estático. */
const ARBOLES = ['src', 'supabase', 'scripts', 'public'];
const EXTENSIONES = /\.(tsx?|sql|mjs|js|json|md|html|txt|svg)$/;
const ES_PRUEBA = /\.test\.(tsx?|mjs)$/;
const DIRS_IGNORADOS = new Set(['node_modules', '.next', '.claude', '.temp', '.branches', '__fixtures__']);

/**
 * Archivos que conservan la forma prohibida a propósito, con su razón. La prueba de abajo exige
 * que cada uno la siga conteniendo: una excepción que ya no hace falta no puede quedar tapando el
 * archivo.
 */
const EXCEPCIONES: Record<string, string> = {
  'supabase/migrations/20260825000001_compliance_tier_fuentes.sql':
    'Migración aplicada el 2026-08-25. El nombre aparece en un comentario interno que no se publica ' +
    'ni se inserta en la base; reescribirla cambiaría un archivo que el ledger ya da por aplicado.',
};

/** La «é» de la marca en cualquiera de las formas en que el código la escribe. */
const E = String.raw`(?:e|é|É|\\u00e9|\\u00c9|&eacute;|&Eacute;|&#233;|&#201;)`;
const MARCA_CON_SUFIJO = new RegExp(String.raw`m${E}trik[\s,.]*s\.?\s*a\.?\s*s(?![\p{L}\p{N}])`, 'giu');
const SUFIJO_SUELTO = />\s*S\.?\s*A\.?\s*S\.?\s*</g;
const NIT_EN_PROCESO = /\bNIT\s*(?:·\s*)?en proceso|en proceso de registro ante (?:la )?DIAN/gi;

function normalizar(texto: string): string {
  return texto
    .replace(/\{\s*['"](?:\\u00[eE]9|\\u00[cC]9|é|É)['"]\s*\}/g, 'é')
    .replace(/\{\s*['"]\s*['"]\s*\}/g, ' ')
    .replace(/\s+/g, ' ');
}

function hallazgos(texto: string): string[] {
  const normal = normalizar(texto);
  return [
    ...[...normal.matchAll(MARCA_CON_SUFIJO)].map((m) => m[0]),
    ...[...texto.matchAll(SUFIJO_SUELTO)].map((m) => m[0]),
    ...[...normal.matchAll(NIT_EN_PROCESO)].map((m) => m[0]),
  ];
}

function archivosBarridos(): string[] {
  const salida: string[] = [];
  const caminar = (dir: string) => {
    for (const entrada of readdirSync(dir)) {
      if (DIRS_IGNORADOS.has(entrada)) continue;
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) caminar(ruta);
      else if (EXTENSIONES.test(entrada) && !ES_PRUEBA.test(entrada)) salida.push(ruta);
    }
  };
  for (const base of ARBOLES) {
    const dir = join(RAIZ, base);
    if (existsSync(dir)) caminar(dir);
  }
  return salida.map((absoluta) => relative(RAIZ, absoluta).split('\\').join('/'));
}

describe('razón social publicada', () => {
  const archivos = archivosBarridos();

  it('el barrido alcanza las superficies que nombraban a la sociedad homónima', () => {
    for (const ruta of [
      'src/lib/valida-api/politica.ts',
      'src/lib/valida/pdf-metodologia.tsx',
      'src/lib/compliance/pdf-soporte-dual.tsx',
      'src/lib/compliance/pdf-autorizacion-contratacion.tsx',
    ]) {
      expect(archivos, `el barrido no lee ${ruta}`).toContain(ruta);
    }
  });

  it('ningún archivo nombra a la sociedad homónima ni declara el NIT en proceso', () => {
    const fallos = archivos
      .filter((ruta) => !(ruta in EXCEPCIONES))
      .flatMap((ruta) =>
        hallazgos(readFileSync(join(RAIZ, ruta), 'utf-8')).map((literal) => `${ruta}: «${literal.trim()}»`),
      );
    expect(fallos, 'La sociedad es METRIK IA S.A.S., NIT 902.079.601-9; sin «IA» es otra sociedad.').toEqual([]);
  });

  it('cada excepción sigue conteniendo la forma que la justifica', () => {
    for (const [ruta, razon] of Object.entries(EXCEPCIONES)) {
      expect(razon.trim().length, `${ruta}: excepción sin razón`).toBeGreaterThan(0);
      expect(existsSync(join(RAIZ, ruta)), `${ruta}: la excepción apunta a un archivo que no existe`).toBe(true);
      expect(hallazgos(readFileSync(join(RAIZ, ruta), 'utf-8')).length, `${ruta}: sobra la excepción`).toBeGreaterThan(0);
    }
  });

  it('detecta las formas del defecto y deja pasar la razón social correcta y la marca', () => {
    const marca = ['Me', 'TRIK'].join('');
    const sufijo = ['S', 'AS'].join('');
    for (const muestra of [
      `autoriza a ${marca} ${sufijo} a tratar`,
      `author="Mé${'TRIK'} S.A.S. · Valida"`,
      `<Text>M{'\\u00e9'}TRIK ${sufijo}</Text>`,
      `de ${marca}\n      ${sufijo} para`,
      `<Text style={s.coverProduct}>${sufijo}</Text>`,
      `${marca} · NIT en proceso`,
    ]) {
      expect(hallazgos(muestra), `no detecta: ${muestra}`).not.toEqual([]);
    }
    for (const muestra of [
      'METRIK IA S.A.S., NIT 902.079.601-9',
      'MéTRIK IA SAS',
      'MéTRIK one',
      'Powered by MéTRIK',
      "'FERRETERIA DEL NORTE SAS'",
      'Metrik Sastreria',
    ]) {
      expect(hallazgos(muestra), `falso positivo: ${muestra}`).toEqual([]);
    }
  });
});
