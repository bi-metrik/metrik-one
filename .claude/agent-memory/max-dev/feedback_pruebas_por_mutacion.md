---
name: pruebas-por-mutacion
description: Una prueba nueva no se cree hasta verla fallar — romper la regla a propósito y exigir que caiga; y el doble tiene que reproducir el defecto, no solo la tabla
metadata:
  type: feedback
---

Una prueba nueva **no vale hasta verla fallar**. Se rompe la regla a propósito y se
exige que la prueba caiga; si no cae, no está probando lo que dice.

**Why:** en este repo ya pasó varias veces que una prueba pasaba **por la razón
equivocada** (el `CLAUDE.md` lo documenta para el motor de Cardumen y para el ranking
de calidad). El caso más caro: un doble que devuelve lo mismo para cualquier tabla
hace pasar la prueba sin que el código filtre nada.

**Confirmado otra vez el 2026-09-02 (PR #491), y las dos mitades importan:**

1. **El doble tiene que reproducir el DEFECTO, no solo la forma de la tabla.** El
   doble del cliente de Supabase **recorta en 1.000 filas** igual que PostgREST y
   honra `.range()`. Sin esa parte, las 8 pruebas de la cola de facturación pasaban
   con el código viejo y no probaban nada. La primera versión del fixture dejaba
   pasar 3 de 8 contra `main`: hubo que reordenar las filas sembradas para que el
   recorte se llevara justo el RUT (una variante) y justo el servicio (otra).
2. **La mutación que NO tumba ninguna prueba delata un hueco de cobertura**, no una
   prueba de más. Se probaron 5 mutaciones del helper de paginación y las 5 cayeron;
   se dejó escrito cuál tumbó cuántas.

**How to apply:**
- Para código nuevo: mutar la implementación (script que sustituye una línea, corre
  vitest, restaura) y anotar en el docblock **qué mutación tumbó qué prueba**.
- Para un fix sobre código existente: correr las pruebas nuevas contra la versión
  vieja — `git show origin/main:<archivo> > <archivo>`, correr, restaurar. Si alguna
  pasa, el fixture no reproduce el defecto.
- Ambas listas van en el encabezado del archivo de pruebas, con fecha. Es lo que
  permite que quien lea dentro de seis meses sepa que el verde significa algo.

Relacionado: [[medir-antes-de-construir]], [[techo-postgrest-1000-filas]].
