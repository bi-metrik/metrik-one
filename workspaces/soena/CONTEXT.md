# SOENA — Workspace ONE

## Workspace
- **Nombre:** SOENA S.A.S.
- **Slug:** soena
- **Dominio:** soena.metrikone.co
- **Modulos activos:** business
- **Proceso principal:** VE (Vehiculos Electricos)

## Configuracion actual

### Etapas VE (11 total)
| Orden | Slug | Nombre | Tipo |
|-------|------|--------|------|
| A1 | contacto_inicial | Contacto inicial | oportunidad |
| A2 | documentacion | Documentacion | oportunidad |
| B1 | en_revision | En revision | oportunidad (terminal: ganado/perdido) |
| C1 | radicacion | Radicacion | proyecto |
| C2 | evaluacion_tecnica | Evaluacion tecnica | proyecto |
| D1 | aprobado | Aprobado | proyecto |
| D2 | por_cobrar | Por cobrar | proyecto |
| E1 | en_ejecucion | En ejecucion | proyecto |
| E2 | entregado | Entregado | proyecto |
| F1 | cerrado | Cerrado | proyecto (terminal) |
| F2 | cancelado | Cancelado | proyecto (terminal) |

### Custom fields (9)
- referencia_anticipo_epayco, valor_anticipo, numero_radicado
- fecha_radicacion, resultado_evaluacion, observaciones_evaluacion
- referencia_epayco_saldo, valor_pago, numero_factura

### Gates activos
- `comentario_requerido` en etapa A1 (contacto_inicial) — debe haber comentario antes de avanzar

### Cobros automaticos
- **Anticipo (etapa A2):** `autoCrearCobros` — crea cobro tipo 'anticipo' si existe referencia_anticipo_epayco + valor_anticipo. Idempotente por negocio_id+tipo_cobro
- **Multi-pago (etapa D2):** `autoCrearCobrosMulti` — filas dinamicas referencia_epayco + valor_pago, cada referencia crea cobro independiente tipo 'pago'. Idempotente por external_ref

### Modulos financieros
- `proyecto_modules`: todos activos (flujo_caja, costos_ejecutados, detalle_ejecucion, cotizacion_readonly)

### Bloques por etapa
- 13 componentes de bloque: BloqueChecklist, BloqueDatos, BloqueDocumentos, BloqueCobros, BloqueCotizacion, BloqueHistorial, BloqueEjecucion, etc.
- BloqueDocumentos usa upload real (bucket ve-documentos, path workspace/negocios/negocioId/bloqueId/slug.ext)
- BloqueDatos con require_confirm=true para anticipo (no auto-save)
- BloqueCobros visible read-only durante todo el ciclo (etapas A2-F1)
- BloqueHistorial con tabs gastos/horas/cobros en etapas de ejecucion

## Ultimo avance
**Sesion:** 2026-04-09 (sesion H)

Que se hizo:
- BloqueHistorial implementado (visualizacion gastos/horas/cobros con tabs)
- KPI numeros: filtro estado 'abierto' corregido + renombrar Pipeline a "En venta"
- Limpieza completa workspace metrik para demo
- ID negocio formato `S1 26 3` con triggers auto-generados

## Pendientes

### Criticos
- [ ] **Persona natural → empresa automatica:** En `crearNegocio`, cuando `es_persona_natural=true`, insertar empresa con nombre del contacto y asignar empresa_id. Migration 004 es fallback incorrecto
- [ ] **Verificar gate comentario_requerido:** Probar en produccion que bloquea avance A1→A2
- [ ] **Verificar logs cambio de etapa:** Confirmar que aparecen en ActivityLog del negocio (migration 005 arreglo constraint)
- [ ] **Recorrer VE punta a punta:** Todas las 11 etapas con un negocio real
- [ ] **Auto-cotizacion al abrir negocio:** Debe crearse automaticamente (feature no implementado)

### Normales
- [ ] Sesion con radicadora — mapear 9 errores recurrentes con frecuencia y causa raiz
- [ ] Decidir migracion de datos: casos activos Sheets/HubSpot → ONE, o arrancar limpio

## Decisiones clave
Ver `decisions.md` para historial completo.

## Contexto critico
- Bizzagi (sistema actual de SOENA) no tiene API — trazabilidad se hace en ONE
- SOENA es el primer cliente Clarity sobre ONE. Todo lo que se construya aqui debe ser patron reutilizable
- Sesion E (Sonnet 4.6) tuvo resultados degradados. Usar Opus 4.6 para desarrollo complejo
- HubSpot en convivencia durante fase inicial del pipeline
