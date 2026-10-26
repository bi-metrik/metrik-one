---
name: project-spec-asistentes-roles
description: Spec «asistentes: roles y funciones» (26-oct, PR sin mergear hasta que Mauricio apruebe) — qué piezas ya existen en PR abiertos y las preguntas abiertas
metadata:
  type: project
---

Spec `docs/specs/2026-10-26_asistentes-roles-y-funciones.md` (ADN del asistente aprobado por Mauricio el 26-oct). Solo spec; NO se mergea aunque los checks den verde: Mauricio la aprueba antes.

Lo que no se ve leyendo main y costó encontrar:
- El arreglo del toque de plantilla (`type:"button"`) YA está escrito en el PR #966 (rama `worktree-agente-24aead2e4686`, `wa-webhook-payload.ts`), mezclado con 2 migraciones de recordatorios. La spec propone sacarlo a un PR propio sin migración, con el prefijo `ag|t|` en `leerToque`.
- Imperviun ya está construido en #1235 (asistente) y #1237 (web), migración 20261021183000 sin aplicar, encendido con `bot_conversacional.obras = true`. La spec recomienda reutilizarlo partido en funciones y enrutado por `asistente_asignaciones`, no reescribirlo.
- Sabor etapa 2 (#1234) ya trae campañas con `codigo`, `funcion_campana_anuncios` y el saldo (`funcion_saldo`): la base de `clientes.origen` y `clientes.cobro_saldo`. Nota de voz del 23-oct: experiencia genérica (cine, cata, sushi), sin código por tipo.
- El permiso por rol ya lo hace cumplir el núcleo (`nucleo.ts:338`, `:421`); lo que falla es que `dominioOne` declara todo a todos y frena al ejecutar.
- Laura: ONE no tiene dónde guardar citas, portafolio ni cuotas por clienta (`catalogo_servicios` es el de MeTRIK).

**Why:** la próxima sesión que construya cualquiera de estas fases va a partir de esta spec y de esos PR abiertos.
**How to apply:** antes de construir, revisar si Mauricio respondió las 4 preguntas de §6.1 (respaldo de Sabor, plantilla diaria de Imperviun vs D9, reutilizar #1235, Laura antes de la firma).
