---
doc_id: MVP-PLAN
version: 1.0
updated: 2026-03-09
---

# Plan Consolidado — MVP MeTRIK ONE

Criterio: Equilibrio funcional + estetico. Solo lo que impacta retencion en semana 1.

Resultado de auditoria integral con Santiago (CCO), Vera (COO), Carmen (CFO), Mateo (CMO), Ren (Art Director) y Sofia (Customer Success). 10 rondas de iteracion hasta consenso.

## Items MVP

| # | Item | Tipo | Esfuerzo | Estado |
|---|------|------|----------|--------|
| 1 | Eliminar codigo muerto v1 (action files + routes legacy) | Funcional | 2-3h | DONE |
| 2 | /numeros como homepage post-login (redirect / a /numeros) | Funcional | 30min | PENDIENTE |
| 3 | Estado vacio inteligente en /numeros: si no hay datos, onboarding guiado con CTAs | Funcional + UX | 2-3h | PENDIENTE |
| 4 | Tokens de color: Verde Metrica como --brand/--success, tokens semanticos (warning, error, info) en globals.css | Estetico | 1-2h | PENDIENTE |
| 5 | Componente Button unificado con variantes (primary, secondary, destructive, ghost, outline) | Estetico | 2-3h | PENDIENTE |
| 6 | Empty states con personalidad en Pipeline, Proyectos, Movimientos, Directorio | UX | 2-3h | PENDIENTE |
| 7 | Micro-transiciones: hover en cards/buttons, fade-in en datos, transition-all duration-200 | Estetico | 1-2h | PENDIENTE |
| 8 | Consolidar getWorkspace() — eliminar 6+ copias inline, usar helper compartido | Tecnico | 1h | PENDIENTE |
| 9 | Migrar pdf-actions.ts de calculos.ts (deprecated) a calculos-fiscales.ts | Tecnico | 1h | PENDIENTE |
| 10 | Deduplicar SECTORES_EMPRESA — single source en pipeline/constants.ts | Tecnico | 30min | PENDIENTE |

Esfuerzo total estimado: 14-19 horas (~2-3 dias)

## Detalle por item

### #1 Eliminar codigo muerto v1 — DONE

24 archivos eliminados (-9,449 lineas). Incluye:
- 15 archivos huerfanos v1 (actions, boards, modals, clients)
- Rutas /dashboard (5 archivos) y /semaforo (4 archivos) eliminadas
- Referencias actualizadas: /dashboard a /numeros en story-mode, accept-invite, middleware
- revalidatePath('/dashboard') removido de gastos/actions

### #2 /numeros como homepage post-login

El cliente aterriza en /numeros donde estan las 5 Preguntas Financieras (motor v2). Actualmente no hay redirect desde /. Implementar redirect en middleware o layout.

### #3 Estado vacio inteligente en /numeros

Cuando el usuario no tiene datos, /numeros muestra KPIs en cero. En su lugar, mostrar un estado de bienvenida:
- Mensaje: "Registra tu primer cobro para ver cuanto estas ganando realmente"
- CTA directo al FAB (boton flotante de acciones rapidas)
- Condicional: datos > 0 muestra KPIs, datos = 0 muestra onboarding guiado

### #4 Tokens de color

Actualmente --primary es negro (acromatico). El Verde Metrica (#10B981) aparece como green-600, emerald-600, green-100 hardcoded sin estandarizar. Implementar:
- --brand / --success: Verde Metrica
- --warning: Amarillo
- --error / --destructive: Rojo (ya existe)
- --info: Azul
- Reemplazar todos los hardcoded green-600, red-500, etc. por tokens semanticos

### #5 Componente Button unificado

No existe componente Button de shadcn. Cada pagina reinventa botones con clases ad-hoc (bg-black, bg-green-600, bg-blue-600). Crear componente con variantes:
- primary (verde, accion principal)
- secondary (gris, accion secundaria)
- destructive (rojo, eliminar)
- ghost (transparente, navegacion)
- outline (borde, alternativa)

### #6 Empty states con personalidad

Cuando las listas estan vacias, se muestra texto plano gris. Cada empty state debe ser un CTA de onboarding:
- Pipeline vacio: "Tu primera oportunidad empieza aqui" + boton crear
- Proyectos vacio: "Gana una oportunidad para ver tu primer proyecto"
- Movimientos vacio: "Registra tu primer cobro o gasto" + boton FAB
- Directorio vacio: "Agrega tu primer cliente" + boton crear

### #7 Micro-transiciones

Cero animaciones actualmente. La app se siente estatica. Agregar:
- transition-all duration-200 en cards y botones (hover)
- Hover states en todos los elementos interactivos
- Fade-in al cargar datos
- Transformacion sutil en cards al pasar el mouse (scale o shadow)

### #8 Consolidar getWorkspace()

Hay 6+ copias inline de la misma funcion getWorkspace() en diferentes action files. Crear un helper compartido en lib/ y reemplazar todas las copias.

### #9 Migrar pdf-actions de calculos.ts

El archivo calculos.ts esta deprecado pero pdf-actions.ts todavia lo importa. Migrar a usar calculos-fiscales.ts que es el motor fiscal vigente.

### #10 Deduplicar SECTORES_EMPRESA

La constante SECTORES_EMPRESA esta duplicada con valores diferentes en al menos 2 archivos. Unificar en pipeline/constants.ts como single source of truth.

## Post-MVP (backlog)

| # | Item | Razon para despues |
|---|------|--------------------|
| 1 | Busqueda global por codigo (FAB-1) | Nice-to-have, no bloquea onboarding |
| 2 | Dark mode completo | El 80% usa la app de dia |
| 3 | Split numeros/actions-v2.ts (997 lineas) | Deuda tecnica, no afecta al usuario |
| 4 | Batch bulkUpsertMonthlyTargets | Performance, no critico con <12 targets |
| 5 | UVT configurable (no hardcoded $52,374) | Solo cambia 1 vez al anio |
| 6 | Bottom bar mobile con mas rutas | Requiere rediseno de navegacion |
| 7 | Animaciones con proposito (principio Ren #5) | Refinamiento post-lanzamiento |
| 8 | Migrar /contactos, /promotores, /gastos actions a v2 | Rutas activas que aun usan tablas v1 |
| 9 | Migrar config/bank-accounts-actions a v2 | Usa bank_accounts/bank_balances v1 |
| 10 | Reescribir /facturacion actions en v2 | Page ya redirige a /proyectos pero actions siguen en v1 |

## Votos del equipo

| Agente | Rol | Voto |
|--------|-----|------|
| Santiago | CCO | PROCEDER — "Con estos 10 items, el producto se puede vender" |
| Vera | COO | PROCEDER — "Orden correcto: limpiar, funcional, estetico" |
| Carmen | CFO | VIABLE — "14-19h es invertible. ROI inmediato en retencion" |
| Mateo | CMO | PUBLICAR — "Los tokens + Button + empty states le dan identidad" |
| Ren | Art Director | REFINAR — "Es el minimo. Post-MVP necesitamos el pass completo" |
| Sofia | Customer Success | PROCEDER — "Si /numeros es home + empty states guian, el onboarding funciona" |

Resultado: 5 a favor, 1 condicional (Ren acepta como minimo viable)
