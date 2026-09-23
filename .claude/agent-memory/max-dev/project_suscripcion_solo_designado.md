---
name: project-suscripcion-solo-designado
description: PR #857 (mergeado 2026-09-23) — /suscripcion y toda la plata del CDA solo para la persona designada; «Ver como» compara la persona EFECTIVA; un CDA no abre ninguna vitrina
metadata:
  type: project
---

PR #857 (mergeado `f4db56e0`, 2026-09-23, sin migración): reemplaza la regla del #851 («dueño, admins y designada»). Ahora `/suscripcion`, la franja, los avisos de plazo de términos y de mora <30 días en `/valida`, la pestaña Pagos y las descargas de recibos/facturas son SOLO de la persona designada (`puedeVerSuscripcion`, en `seccion-suscripcion/estado.ts`; `puedeVerPagosCda` delega en ella). Los demás ven solo la pausa por mora >30 días, sin montos.

**Why:** Mauricio: «la sección de suscripción solo la ve el admin encargado». En el mismo PR: un espacio solo-Valida (CDA) ya no abre ninguna vitrina (`vitrinasDelEspacio` devuelve `[]`), ni Tableros ni Números.

**How to apply:**
- La comparación usa la persona EFECTIVA (`entrada.usuarioEfectivoId`, que sale de `getWorkspace().userId`). Un platform admin en «Ver como» la designada la VE en solo lectura (`ctx.soloLectura`, `ctxEscritura()` en acciones.ts); en «Ver como» un operador, NO la ve. Aceptar Términos sigue comparando contra la persona REAL.
- ⚠️ En cda-pruebas el perfil propio de Mauricio (owner, platform admin) NO es el designado: le da 404 fuera de «Ver como». No es un bug; si pregunta, se explica así.
- `/suscripcion` es ruta común: el middleware la deja pasar y el 404 lo da la página. No meter la regla en el middleware, porque necesita la designación (que es una lectura de base).
- Pruebas: `suscripcion/quien-ve-suscripcion.test.ts` recorre la cadena real, y se validó por mutación.

Reemplaza la regla de quién ve en [[project-seccion-suscripcion-cda]]. Relacionado: [[project-sustenta-tarjeta-marca]].
