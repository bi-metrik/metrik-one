---
name: medicion-cola-facturacion-con-vitest
description: Cómo medir una server action REAL contra producción desde un worktree aislado — vitest como arnés, sin reimplementar la lógica de negocio
metadata:
  type: reference
---

Para el antes/después de un cambio que toca una server action de ONE, el arnés es
**un archivo `*.test.ts` temporal dentro de `src/`**, corrido con
`npx vitest run <ruta>` y borrado después. Funcionó el 2026-09-02 (PR #491).

**Why:** reimplementar el criterio en SQL mide **otra cosa** — es el gotcha que este
repo documenta varias veces («un criterio viejo mide otra cosa»). El arnés llama la
función real, así que el único componente sustituido es el que se está cambiando.

**How to apply:**

1. `node_modules` y `.env.local` ya vienen enlazados en el worktree; el `.env.local`
   se carga a mano (vitest no lo lee): leer el archivo y volcarlo a `process.env`.
2. `vi.mock('@/lib/actions/get-workspace')` con el workspace y rol deseados —
   `getWorkspace` necesita el runtime de Next y no resuelve fuera de él.
3. `vi.mock('@/lib/siigo/client', () => ({ siigoRequest: async () => ({ results: [] }) }))`
   para **no tocar ninguna API externa**. Obligatorio cuando el encargo prohíbe
   escribir en Siigo: así queda demostrado que ni siquiera hubo lecturas.
4. `console.log('MEDICION::' + JSON.stringify(...))` y leer con `sed -n '1,40p'`.
5. `vitest.config.ts` ya aliasa `server-only`/`client-only` a `test/modulo-vacio.ts`,
   así que los módulos de servidor **sí** colectan.

**Para el «antes»:** correr el arnés ANTES de tocar el código. Para volver a ver el
comportamiento viejo con el fix ya puesto, un script que hace
`git show origin/main:<archivo> > <archivo>`, corre las pruebas y restaura. Es lo
que confirma que las pruebas nuevas fallan contra `main` — sin eso, «probé el bug»
es una afirmación.

**El mismo arnés sirve para preguntarle a un tercero (Siigo) SIN escribirle.** El
2026-09-02 se verificó con qué identificación salieron 12 facturas llamando
`siigoRequest` real (que resuelve las credenciales del workspace desde
`config_extra`) con **solo GET**: `/v1/invoices/{id}`, `/v1/customers?identification=`
y `/v1/invoices?customer_identification=`. Que el archivo no contenga un solo
`method: 'POST'` es lo que hace demostrable la prohibición de escribir. Se borra
igual que los demás arneses antes de commitear.

**Medir contra producción por SQL** (Management API, `.credentials.md`): sigue
disponible desde el subagente aislado, pero **hay que mandar `User-Agent`** o
Cloudflare responde `403 error 1010`. Ese detalle no estaba escrito y costó un
intento. Todo lo demás de [[sql-prod-one]] sigue vigente (solo la última sentencia
vuelve; nunca imprimir el token; scripts con Write + un comando plano).

Relacionado: [[techo-postgrest-1000-filas]], [[sql-prod-one]],
[[medir-antes-de-construir]].
