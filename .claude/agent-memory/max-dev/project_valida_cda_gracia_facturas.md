---
name: valida-cda-gracia-facturas
description: PR #849 (2026-09-23) — plazo para aceptar términos, mora de 30 días, pestañas Pagos/Términos y facturas por cuota en /valida de los CDA; migración 20260924010000 SIN aplicar y lo que no es obvio del diseño
metadata:
  type: project
---

PR #849 (`feat/valida-cda-gracia-y-facturas`) continúa el #845. **Migración
`20260924010000_valida_cda_plazo_terminos_y_facturas_cuota.sql` SIN aplicar al abrirlo**; la
aplica la sesión principal y después mergea.

**Why:** decisiones de Mauricio del 2026-09-23 para los 4 CDA que pasan de AFI a contrato directo.

**How to apply (lo que no se ve leyendo el código):**
- ⚠️ `mis_servicios()` y `mis_cuotas_de_servicio(uuid)` se recrearon con DROP + CREATE (cambió
  el `returns table`): la ACL se repone en el archivo. Si alguien vuelve a tocarlas, lo mismo.
- ⚠️ El SQL de carga de los CDA fija `terminos_plazo_hasta = 2026-09-30`. **Cargar un bloque
  después del 30-sep cierra Valida de ese CDA en el acto**: hay que correr el plazo antes.
- La mora NO cierra ante una lectura caída de cuotas (a propósito, al revés que los términos), y
  un beneficiario que no paga no tiene mora (las RPC de cuotas solo responden al pagador).
- Facturas: 2 MB por archivo porque PDF+XML viajan en UNA server action y Vercel corta en 4,5 MB.
- El texto del aviso dice «a más tardar el 30-sep», no «antes del 30-sep» como pidió el brief
  (el 30 todavía se opera). Si Mauricio lo objeta, vive en `plazos.ts` (`textoAvisoPlazo`).
- Al abrir el PR nada bloqueaba por pago: suspensión por suscripción existe pero los CDA están
  `active` y `suspenderAutomaticamente: false`.

Relacionado: [[razon-social-metrik-ia]], [[suscripciones-cobro-automatico]].
