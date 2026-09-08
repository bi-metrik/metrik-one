---
name: vistas-server-only
description: v_venta_mes_comercial está revocada a `authenticated` — leerla con el cliente de la sesión devuelve vacío sin error; cómo comprobar el grant antes de escribir la consulta, y por qué un `grant` viejo no sobrevive a la siguiente reescritura de la vista
metadata:
  type: project
---

`v_venta_mes_comercial` —la **definición canónica de venta** del producto— está
declarada **server-only**: su migración (`20260812230000`) termina con
`revoke all on v_venta_mes_comercial from anon, authenticated`, y el comentario de
la vista lo dice con todas las letras. La leen funciones `SECURITY DEFINER` con
guard por workspace, no el cliente de la sesión.

**Why:** un brief puede pedir `supabase.from('v_venta_mes_comercial')…` con toda
naturalidad —la vista existe, el nombre está en media docena de archivos— y el
resultado es **vacío SIN error visible**: `data` llega `null`, el `error` se
descarta en el destructuring habitual, y la pantalla se comporta igual que si el
negocio no tuviera cobros. Es el fallo mudo que este repo ya pagó varias veces.

**How to apply — antes de escribir una consulta a una vista, comprobar el grant:**

```sql
select has_table_privilege('authenticated','public.<vista>','select');
-- y la prueba empírica, que es la que convence:
begin; set local role authenticated; select count(*) from <vista>; rollback;
--   -> ERROR 42501: permission denied for view <vista>
```

Medido el 2026-09-03: `v_venta_mes_comercial` **false** para `authenticated`;
`v_cartera_negocio` y `v_cobro_valor` **true**. O sea que **no se puede
generalizar desde una vista hermana**: conviven las dos políticas en el mismo
esquema.

Si la vista está revocada hay tres caminos y solo uno no toca la base:
`createServiceClient()` con `.eq('workspace_id', …)` explícito (el service client
**no pasa por RLS**, así que el filtro es la única barrera); una RPC
`SECURITY DEFINER` con guard, que es como lo resuelven `/tableros` y `/equipo`;
o un `grant`, que deshace una decisión deliberada y necesita migración.

## El caso que lo destapó: `/numeros` — YA ARREGLADO, no volver a reportarlo

`numeros/actions-v2.ts` consultaba la vista con el cliente **autenticado** y hacía
`ventasMesRes.data ?? []`, así que `ventasMes` era 0 en todos los workspaces: la
tarjeta P4 y el factor `ventasMes / puntoEquilibrio` del semáforo llevaban semanas
mintiendo. Se reportó en el PR #517 y **se corrigió después**: verificado el
2026-09-07, la consulta ya usa `createServiceClient()` con `.eq('workspace_id', …)`
explícito y el archivo lleva el porqué escrito al lado.

⚠️ **El `grant` suelto no sobrevive.** La migración `20260822000004` le concedió
`select` a `authenticated`, y las dos que reescriben la vista después
(`20260823000001`, `20260824000001`) vuelven a revocarla: **gana la última sentencia
del ledger**, no la que uno recuerda. Por eso el grant se comprueba contra la base,
nunca leyendo la migración que lo otorgó.

⚠️ **No generalizar a la vista hermana:** `v_cartera_negocio` **sí** está concedida a
`authenticated` y se sigue leyendo con el cliente de la sesión, que es lo correcto —
ahí la RLS es el control.

Relacionado: [[sql-prod-one]], [[cifras-del-brief-caducan]].
