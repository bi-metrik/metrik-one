---
name: bandeja-retroceso-alejandra
description: Caso Alejandra N1 26 1 (2026-10-05) — la bandeja de Trappvel falló por envíos que NUNCA llegaron a Vercel; no fue #1023/#1026. Reintento + idempotencia + registro; prueba fija con lecturas grabadas de Gemini
metadata:
  type: project
---

Rama `fix/trappvel-bandeja-retroceso-alejandra` (2026-10-05), SIN migración, NO mergeada por encargo.

**Causa medida, no supuesta:** en COT-2026-0023 los 4 envíos fallidos (detectar y «Aceptar» de
Cabañas, leer de los dos pegados juntos) no aparecen en `vercel metrics vercel.request.count` (el
borde, antes del firewall) ni como error; el firewall dejó pasar todo. El brief contó 3 «aceptar 200»
porque metió una ventana con OTRA cotización del mismo negocio (cde0a67e, 16:35:43). Con las lecturas
reales de Gemini el servidor acepta los 8. La transporte sin reintento ni registro viene de #907
(2026-09-24); #1023/#1026 no tocaron ese camino. RUM de su pestaña: bajada estimada 10 → 1,35 Mbps
justo en la ventana del fallo.

**Why:** Mauricio: «diseñar para dificultad alta». La red de los clientes (Claro/Telmex hacia Vercel,
ver memoria de la torre `red-mac-a-vercel-vs-cloudflare`) se cae a medias y la bandeja manda ~0,5 MB
por envío, tres veces por pantallazo (detectar, leer, aceptar).

**How to apply:**
- Para saber si un `fetch` llegó: `vercel.request.count` por `request_path`, no `vercel logs` (que
  repite filas y solo ve lo que entró). `fot_in_bytes` da el tamaño del cuerpo.
- `aceptar-captura` ahora es idempotente por `idAceptacion` (= id de la captura); la lectura escrita
  lleva `aceptacion`. Cambiar el id de la captura rompe la idempotencia.
- Prueba fija `caso-alejandra-e2e.test.ts`: `CASO_ALEJANDRA=gemini CASO_ALEJANDRA_DIR=<carpeta>` contra
  Gemini real (~6 min); desde un worktree la carpeta por defecto NO resuelve, hay que pasarla.
- Gemini varía la ciudad del nombre de la opción («Providencia Island» vs «… / Providencia Island»):
  comparar por proveedor, no por nombre entero.

Relacionado: [[bandeja-borrador-firmado]], [[habitaciones-hotel-r8]], [[limpieza-presentar-trappvel]].
