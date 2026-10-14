---
name: project-f7-configurar-linea-trappvel
description: F7/F8 post-cotización Trappvel — SQL de cliente 11→9 etapas, clon, interruptores, reversa y semilla (2026-10-12); qué NO aísla el código todavía
metadata:
  type: project
---

Los SQL viven en `proyectos/trappvel/clarity/migrations/2026-10-12_f7-*.sql` y `2026-10-12_f8-semilla.sql`, con prueba
reproducible en `migrations/pruebas/f7-prueba-local.mjs` (PGlite del repo principal; corre la carga original
20260902000001). NINGUNO corrido contra producción al 2026-10-12. Orden: clon → snapshot → dry-run → configurar →
interruptores → semilla; la real igual (sin semilla) solo con OK de Mauricio (F7-7).

**Why:** Vera F7-1…F7-7 y F8-1; el mismo cuerpo (hash entre marcas `F7-CUERPO`) tiene que correr en clon y real.

**How to apply / gotchas que no salen del código a simple vista:**
- Los gates `cotizacion_enviada` y los de Confirmación NO miran interruptor: configurar sin interruptores frena
  negocios en 3-4. Configurar e interruptores van juntos.
- El motor de recordatorios con `area:<x>` sin responsable de ese rol avisa a TODA el área del workspace (staff real).
  La semilla pone comercial y operaciones; `negocio_responsables.rol` solo admite esos dos.
- La cola de facturación lee TODAS las líneas del workspace (incluido el clon) y no filtra `es_prueba`: con F5 encendido
  en el clon, el negocio B aparece en /conciliacion del equipo real. Solo la lista /negocios quedó filtrada (PR de F8).
- Pasos del guion que no salen de SQL: cotización de 3 tarifas (UI), staff de prueba (script de la raíz), bot de WA del
  paso 16 (necesita un teléfono de staff de prueba que no sea de otro workspace).
- `node_modules` del repo principal está viejo (sin happy-dom ni unpdf): tsc/vitest en worktree dan esos errores ajenos.

Relacionado: [[project-bandeja-varios-viajes]], [[feedback-pruebas-por-mutacion]].
