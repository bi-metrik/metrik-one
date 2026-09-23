---
name: project-seccion-suscripcion-cda
description: PR #851 /suscripcion de los CDA (pagos, usuarios con licencia adicional, Sustenta, comisión AFI) — migración 20260924060000 SIN aplicar al abrir el PR; orden y trampas
metadata:
  type: project
---

PR #851 (2026-09-23): `/suscripcion` para dueño/admin/designada del espacio que PAGA un contrato de Valida. Al abrirse, la migración `20260924060000_suscripcion_cda_licencias_usuarios_comision.sql` NO estaba aplicada (la aplica la sesión principal ANTES del merge: main despliega solo).

**Why:** el pago salió de `/valida`; la venta del usuario adicional (cláusula 2.3) y el retiro de usuarios dependen de tablas y dos funciones server-only (`registrar_compra_licencia`, `registrar_retiro_licencia`) que no existen sin la migración: sin ella la pestaña Usuarios da error al comprar/retirar.

**How to apply:**
- Orden: migración → merge → `sql/valida-cda/2026-09-23_comision-afi-y-usuario-adicional.sql` (ensayo primero). Sin `parametros.valor_usuario_adicional` el código NO vende licencias (no hay default, a propósito).
- Las funciones exigen `parametros.licencias` igual al que leyó el servidor (`licencias_cambiaron`): comprar sobre un contrato sin esa llave falla.
- El cobro va a la próxima cuota SIN cobro (el emisor no valida pagos: tocar una cuota con cobro le recobra al cliente). Cuotas de renovación creadas después del plan deben incluir los adicionales vigentes: nadie lo hace aún.
- Retirar = fila en `usuarios_espacio_retiros` + staff inactivo + ban en Auth; el JWT abierto vive ~1 h.
- Números sale de espacios solo-Valida por `vitrinasDelEspacio` (gate.ts); cambió 3 pruebas viejas que afirmaban lo contrario.
- El #850 (Bold) mergeó en medio: el medio de pago usa `etiquetaFuentePago` de `pasarela/dominios.ts`, no una regla propia.

Relacionado: [[project-valida-cda-gracia-facturas]], [[project-pago-en-linea-bold]].
