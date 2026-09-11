---
name: soporte-listas-operator
description: PR #631 mergeado — el operador ya baja el PDF de soporte de listas; la pantalla /compliance/listas NO tiene ningún gate por rol (la ruta era el único candado) y `contador` sigue fuera a propósito
metadata:
  type: project
---

**PR #631 mergeado el 2026-09-11** (`b379342`, squash). `GET /api/compliance/listas/soporte/[consulta_id]`
admite `operator`; `?descargar=1` entrega `attachment`; el nombre del archivo pasa a
`soporte-listas-<sujeto>-<documento>-<AAAA-MM-DD>.pdf`. Sin migración, sin escrituras a producción.

**Why:** ALMA (`alma-afi`, compliance dual Informa+Valida) reportó que sus operarios no podían ver
el soporte. No era confidencialidad: era **inconsistencia entre el menú y la ruta**. El menú ya deja
entrar a `operator` a `/compliance/listas` y `listarHistorialDual()` **no filtra por rol**, así que
ya veía el histórico completo del workspace —nombre consultado, documento, severidad, coincidencias—
y lo único que no podía abrir era el PDF, que no dice nada que la pantalla no le muestre.

**How to apply — tres hechos que ahorran el diagnóstico la próxima vez:**

1. ⚠️ **`src/app/(app)/compliance/listas/` no menciona `role` NI UNA VEZ** (medido: `grep -rn "role"`
   sobre toda la carpeta devuelve vacío). O sea que en esa pantalla **el gate es siempre la ruta de
   la API, nunca el render**. Si algo "no se ve" ahí, buscar el 403, no un condicional en el `.tsx`.
2. **`contador` sigue con 403 y eso es deliberado.** La lista quedó
   `['owner','admin','supervisor','operator','read_only']`. Es el mismo criterio del menú.
3. **El convenio de descarga en esta ruta es `?descargar=1` (o `true`), y el default es `inline`.**
   El botón "Ver soporte" del resultado puntual se quedó en `inline` a propósito (abre en pestaña);
   el enlace de la columna del histórico es el que lleva `?descargar=1`. Si aparece una tercera
   superficie, decidir cuál de las dos es antes de copiar el enlace.

⚠️ **El nombre del archivo se sanea con LISTA BLANCA (`a-z0-9`), no con lista negra, y la razón no
es estética:** `nombre_consultado` es texto que escribió una persona y termina **dentro de la
cabecera `Content-Disposition`**. Una comilla o un `\r\n` ahí no rompen el nombre, rompen la
cabecera. Vive en `src/lib/compliance/nombre-soporte.ts` (puro) porque **un `route.ts` de Next no
puede exportar helpers** — ver [[probar-route-handler-vitest]].

⚠️ **La fecha del nombre es el día en Bogotá, no en UTC** (`todayBogotaISO(new Date(created_at))`):
leerla en UTC correría el día para toda consulta hecha después de las 7 p.m.

**Lo que NO se tocó:** el gate de `modules.compliance`, el filtro por `workspace_id` (una consulta
de otro workspace sigue dando 404) y el PDF en sí. Hay una prueba por cada uno.

Relacionado: [[valida-fto-state-dept]], [[r4-liberaciones]], [[pruebas-por-mutacion]].
