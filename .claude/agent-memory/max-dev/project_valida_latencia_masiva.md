---
name: valida-latencia-masiva
description: Medición 2026-10-15 de dónde se van los segundos del cargue masivo de Valida; el lote corre en serie porque Next encola las server actions; ONE pesa más que Valida desde la 0036
metadata:
  type: project
---

Medido el 2026-10-15, solo lectura, sin cambiar nada:

- **El cargue masivo de ONE corre en serie.** `CONCURRENCIA_LOTE = 3` no sirve: el router de Next encola las server actions del cliente y las corre de a una (`actionQueue.pending` en `next/dist/client/components/app-router-instance.js`). En 2.707 filas de lotes (5 y 15 de octubre) no hay ningún hueco < 150 ms entre filas; el hueco es la duración de una fila (1,25–3,4 s).
- **Desde la 0036 de Valida (03-oct, índices parciales `buscable`), ONE pesa más que Valida.** `/api/v1/validate` pasó de p50 1,3 s / p95 12 s a p50 0,39 s / p95 0,96 s. Mientras tanto, el POST `/valida` de ONE tiene p50 1,4–3,3 s. La puerta CDA (`entradaValidaCda`/`moraValidaCda`) se resuelve ~3 veces por acción porque `cache()` no memoiza en actions (ver [[acciones-lentas-soena]]).
- **La cola larga de Valida es por IO en frío**, no por concurrencia: `entradas_lista` pesa 2,6 GB de heap con solo 109 k de 1,6 M filas buscables, shared_buffers 256 MB, cache hit 91 %. Los nombres con «S.A.S.» (normalizado «s a s») sacan 7–12 k candidatos de trigram, contra ~200 de un nombre distintivo.
- Vercel (los dos proyectos) corre en iad1 con Fluid, y las dos bases están en us-east-1: la región no es el problema.

**Why:** Mauricio quiere acelerar las consultas masivas. La palanca grande no es Supabase.

**How to apply:** antes de tocar el compute o los índices de Valida, sacar el lote de la cola de server actions (route handler o lote del lado del servidor) y memoizar la puerta por lote. Medir con `vercel metrics ... -f "route eq '/valida'" -f "request_method eq 'POST'"` contra `/api/v1/validate` de metrik-valida.
