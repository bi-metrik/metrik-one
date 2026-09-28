---
name: pglite-pruebas-sql
description: Probar migraciones y plpgsql contra Postgres real sin servidor ni base de prod (PGlite en node:test/vitest) — y los limites que dan falsos verdes o rojos
metadata:
  type: reference
---

Cuando la regla que importa vive en SQL (trigger, RPC, CHECK) y no hay base local ni branch de
Supabase, **`@electric-sql/pglite`** (Postgres compilado a wasm) corre dentro de la suite de pruebas
y en CI sin red. Usado el 2026-09-14 en metrik-valida (`lib/consumo/bolsa-sql.test.ts`, PR #43,
[[valida-bolsa-prepagada]]): 27 pruebas, y 31 mutaciones de la migracion vistas caer.

**Receta que funciono:**
- devDependency **exacta** (0.5.8). Al agregarla, `npm install --package-lock-only` reescribio
  entradas ajenas del lockfile; lo limpio fue editar el lockfile a mano con la entrada nueva y
  validarlo con `npm ci` en un arbol limpio.
- Esquema minimo de las tablas que la migracion toca, y luego `db.exec(readFileSync(migracion))`
  **tal cual esta en el repo**: probar una copia del SQL no prueba el archivo que se aplica.
- Replicar los privilegios por defecto de prod antes de aplicar
  (`alter default privileges ... grant execute on functions to anon, authenticated`), o una prueba de
  permisos pasa aunque falte el `revoke`.
- Medir el "antes" (p. ej. la RPC vieja) **antes** de aplicar la migracion nueva en el `before`, para
  poder afirmar que un cuerpo reemplazado devuelve lo mismo.

**Limites (cada uno ya dio un falso resultado):**
- **Una sola conexion**: no reproduce concurrencia. La guarda de carrera (UPDATE condicionado, candado
  de fila) solo se prueba en serie; declararlo en el PR.
- **Reloj con resolucion de milisegundos**: dos `clock_timestamp()` seguidos pueden empatar; una regla
  que compare instantes (ventanas `>=`/`<`) sale intermitente.
- `BEGIN`/`ROLLBACK` con `db.exec` si funciona aqui (a diferencia del pooler de prod).
- Para mutar el SQL: script que reemplaza un ancla unica, corre la prueba, restaura y verifica el sha;
  una mutacion que sobrevive es un hueco de cobertura (asi aparecio un CHECK sin prueba).
