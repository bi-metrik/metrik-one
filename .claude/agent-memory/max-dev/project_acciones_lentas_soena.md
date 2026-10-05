---
name: acciones-lentas-soena
description: #1010 y #1011 MERGEADOS 2026-10-05, #1012 abierto, para el p95 de Conciliar, Crear negocio y Guardar en la ficha; cache() de React NO memoiza en server actions; after() lanza fuera de request
metadata:
  type: project
---

Encargo nocturno 2026-10-04 (pendiente «ONE core / velocidad sin fricciones»). #1010 y #1011 mergeados el 2026-10-05; #1012 abierto. Ninguno con migración:

- **#1010** Conciliar (19,7 s): abono/RC-3 de Siigo van por `after()` (`src/lib/siigo/segundo-plano.ts`); tope por intento en `siigoRequest` (20 s GET / 45 s escritura, `codes: ['timeout']`).
- **#1011** Crear negocio (7,5 s): 5 subcarpetas de Drive en paralelo; la carpeta se solapa con los bloques pero se espera antes de responder (NO `after()`: `carpeta_url` en la ficha y carrera buscar-y-crear con el cron).
- **#1012** Guardar en la ficha (6,4 s): segunda ola en `getNegocioDetalleCompleto`, 4 acciones de guardado dentro de `enPeticionDeRuta`, se quitó `router.refresh()` donde la acción ya revalida.

**Why:** dos hechos del runtime que no se ven en el código:
1. `cache()` de React (build react-server) sin request de Flight devuelve `new Map()` por llamada: en una **server action** no memoiza nada. `getWorkspace` se resolvía 3 veces en el camino del guard.
2. `after()` de `next/server` lanza síncrono fuera de un request (scripts, vitest): por eso `enSegundoPlano` cae a correr en línea.

**How to apply:** antes de mergear #1012, probar en preview que subir un documento refresca la ficha sin `router.refresh()`. Para memoizar más acciones, envolverlas en `enPeticionDeRuta` (opt-in); un memo genérico por `headers()` contaminaría el render posterior a una acción que cambia de workspace. Ver [[tableros-cache]] para otro caso de memo.
