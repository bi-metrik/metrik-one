---
name: project-spec-asistentes-roles
description: Spec «asistentes: roles y funciones» (26-oct, rev 2, PR #1278) — Sabor sale el 29-oct YA sobre roles; respaldo de Sabor = persona en Chatwoot; #966 se mergea completo
metadata:
  type: project
---

Spec `docs/specs/2026-10-26_asistentes-roles-y-funciones.md` (PR #1278, rama `docs/spec-asistentes-roles`). El merge lo hace la sesión principal.

Decisiones de Mauricio del 26-oct (rev 2, §6.1):
- **Los tres asistentes salen sobre el modelo de roles, Sabor incluido desde el 29-oct.** Ya no existe la fase «Sabor sobre `publico/` y a roles después del 13-nov». Fechas de Sabor iguales: 29-oct, 9-nov, 13-nov. O sea: migración de roles + componedor + funciones `clientes.*` de etapa 1 entran ANTES del 29-oct, y el arnés de Sabor tiene que dar lo mismo sobre el rol compuesto que sobre `dominioPublico`.
- Sabor no tiene modelo de respaldo en otro proveedor: su respaldo es un agente humano de Sabor en Chatwoot (caída del modelo o cualquier señal de escalamiento pasa directo, sin ofrecer). El correo inmediato si cae el modelo se mantiene.
- Imperviun: apertura diaria por plantilla construida y apagada; #1235 se reutiliza partido en funciones antes de su merge.
- Laura se adelanta ya: plantillas a Meta y migración del módulo de citas sin esperar la firma.
- #966 (recordatorios apagados + arreglo `type:"button"`) se mergea completo; se puso al día con main el 26-oct (08aa9aec). El prefijo `ag|t|` va en un PR aparte después.

Lo que no se ve leyendo main:
- El permiso por rol ya lo hace cumplir el núcleo (`nucleo.ts:338`, `:421`); lo que falla es que `dominioOne` declara todo a todos y frena al ejecutar.
- Laura: ONE no tiene dónde guardar citas, portafolio ni cuotas por clienta (`catalogo_servicios` es el de MeTRIK).
- En #966 la confirmación de recordatorio sale del webhook ANTES de la deduplicación por `wa_message_id` de main; es idempotente por la condición `confirmado_at is null` en el update.

**Why:** la próxima sesión que construya cualquiera de estas fases parte de esta spec y del orden nuevo.
**How to apply:** lo que bloquea el 29-oct es el núcleo de roles (§5.1 filas 1-6), no solo insumos de Paula; no proponer volver a sacar Sabor sobre `publico/` como plan.
