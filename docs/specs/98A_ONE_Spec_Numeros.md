---
doc_id: 98A
version: 2.1
updated: 2026-02-20
depends_on: [21], [98B], [98C], [99]
depended_by: [98F]
vigente: parcial
nota_vigencia: "Modulo /numeros sigue vivo como dashboard KPI principal. PERO consume datos de modulo /negocios (no de /pipeline ni /proyectos que son legacy). Filtro actual usa negocios.estado='abierto'. Ver metrik-one/CLAUDE.md para estado actual."
---

# Spec: Módulo Mis Números v2.1

Código: MOD-NUM. Punto final de consolidación del sistema. Consume datos de Pipeline, Costos y Proyectos. Es la pantalla que el usuario abre cada mañana.

Pregunta central: **"¿Estoy ganando plata?"**

**Contexto de desarrollo:** Este módulo se implementa DESPUÉS de Pipeline [98B] y Proyectos [98C]. Todas las tablas de datos transaccionales (contactos, oportunidades, proyectos, facturas, cobros, gastos, gastos_fijos, gastos_fijos_borradores) ya existen. Este módulo agrega: `config_metas`, `saldos_banco`, `streaks`, y las views/queries de consolidación.

---

## §1. Flujo de Datos

### Entradas

| Fuente | Datos que consume | Frecuencia |
|--------|------------------|------------|
| Pipeline [98B] | Valor oportunidades por etapa, probabilidad, forecast | Near real-time |
| Costos [98D] | Gastos fijos configurados, punto de equilibrio | Cuando cambian |
| Proyectos [98C] | Facturación, cobros, cartera, gastos directos, horas | Near real-time |
| Gastos [98E] | Gastos operativos registrados, categorías | Near real-time |
| Configuración [99] | Metas mensuales (ventas, recaudo), perfil fiscal, personal | Cuando cambian |
| WhatsApp [98F] | Registros vía bot (gastos, cobros, horas, saldo banco) | Near real-time |
| Saldos banco | Saldo real reportado por usuario (app/WhatsApp) | 2-3 veces/semana |

### Salida

No alimenta otros módulos. Es destino final y consumidor puro. Supabase Realtime garantiza que cualquier INSERT/UPDATE en las tablas fuente actualiza la pantalla sin refresh.

---

## §2. Layout Principal — Vista "Mis Números"

### Estructura visual definitiva

4 zonas verticales: Header -> Semáforo -> Franja Conciliación -> 5 Cards.

```
┌─────────────────────────────────────────────────────────────┐
│ HEADER │
│ Hola [nombre] ◀ Feb 2026 ▶ │
│ [FAB: +] │
├─────────────────────────────────────────────────────────────┤
│ SEMÁFORO — Capa 1: Completitud / Capa 2: Finanzas │
│ Datos completos. Tu negocio está sano. │
│ ▼ Ver checklist de datos │
├─────────────────────────────────────────────────────────────┤
│ FRANJA CONCILIACIÓN │
│ Caja: $4.200.000 Si Conciliado hoy 12 semanas │
├─────────────────────────────────────────────────────────────┤
│ ┌──────────────────────┐ ┌──────────────────────┐ │
│ │ P1 ¿Cuánta plata │ │ P2 ¿Estoy ganando? │ │
│ │ tengo? │ │ │ │
│ │ $4.200.000 ↑ │ │ +$5.200.000 ↑ │ │
│ │ Recaudo ████████░░░ │ │ Ingresos ███████████ │ │
│ │ $9.5M / $12M (79%) │ │ Gastos ████████░░░ │ │
│ └──────────────────────┘ └──────────────────────┘ │
│ ┌──────────────────────┐ ┌──────────────────────┐ │
│ │ P3 ¿Cuánto me deben? │ │ P4 ¿Cuánto necesito │ │
│ │ │ │ vender? │ │
│ │ $6.300.000 v │ │ $10.700.000 = │ │
│ │ Cobrado ██████░░░░ │ │ Ventas █████████░░ │ │
│ │ $9.5M / $15.8M (60%) │ │ $12.5M ▲PE $15M │ │
│ └──────────────────────┘ └──────────────────────┘ │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ P5 ¿Cuánto aguanto? │ │
│ │ 4.2 meses ↑ │ │
│ │ ░░░░░░░░░████░░░░░░░░░░ │ │
│ └──────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Principio fundamental: Cards = SOLO LECTURA (D116)

Las 5 cards son dashboard puro de visualización. Cero inputs, cero formularios, cero botones de acción para crear datos. Todo registro de información se hace vía:
- **FAB** (botón flotante de acciones rápidas)
- **Módulos correspondientes** (Pipeline, Proyectos, Configuración)
- **WhatsApp Bot** [98F]

Los drill-downs de las cards SÍ pueden tener **links de navegación** hacia otros módulos ("Ir a Pipeline", "Ver cartera completa"), pero NUNCA formularios de captura.

### Responsive: Móvil

En pantallas < 768px: cards en stack vertical (scroll), cada card ocupa ancho completo. P5 se mantiene ancha. Header con selector de mes sticky. Franja de conciliación siempre visible.

---

## §3. Header

### Saludo + Selector de Mes

| Elemento | Spec |
|---------|------|
| Nombre | `usuario.nombre` — "Hola Mauricio" |
| Selector de mes | `◀ [Mes Año] ▶` — navega entre meses |
| Mes actual | Datos en tiempo real, barras se actualizan live |
| Mes pasado | Datos cerrados, barras estáticas completas |
| Mes futuro | Solo metas configuradas, barras en outline sin fill |
| Default | Siempre abre en el mes actual |

### FAB — Botón Flotante de Acciones Rápidas (D118)

Botón "+" flotante en esquina inferior derecha. Al tocar, despliega:

| Acción | Destino | Icono |
|--------|---------|-------|
| Nueva oportunidad | Modal rápido -> Pipeline [98B] | |
| Registrar gasto | Modal rápido -> Gastos [98E] | |
| Registrar cobro | Modal rápido -> Proyectos [98C] | |
| Actualizar saldo | Modal input saldo bancario -> `saldos_banco` | |

Los modales son formularios mínimos que no sacan al usuario de Mis Números. Post-registro, la pantalla se actualiza en tiempo real vía Supabase Realtime.

---

## §4. Semáforo — Doble Capa (D103-v3 + D108)

### Concepto

Un solo semáforo con dos capas de evaluación en cascada. Capa 1 (completitud de datos) es un **gate**: si no pasa, Capa 2 (salud financiera) ni se evalúa.

### Capa 1: Completitud de Datos (Gate)

Evalúa si hay datos suficientes para confiar en los números.

**Indicadores de completitud:**

| Indicador | Peso | Verde | Amarillo | Rojo |
|-----------|------|---------|------------|--------|
| Gastos fijos configurados | Crítico | >= 3 gastos fijos | 1-2 gastos fijos | 0 gastos fijos |
| Meta ventas definida | Crítico | Mes actual configurado | Solo meta flat heredada | Sin meta |
| Datos fiscales clientes activos | Alto | 100% con datos fiscales | >= 70% | < 70% |
| Saldo bancario actualizado | Alto | Hace < 4 días | 4-7 días | > 7 días |
| Oportunidades actualizadas | Medio | Todas con actividad < 14 días | >= 70% | < 70% |
| Gastos fijos mes confirmados | Medio | Todos confirmados vs borradores | >= 50% | < 50% |
| Proyectos con horas al día | Bajo | Registro esta semana | Hace < 14 días | Sin registro > 14 días |
| Diferencia de conciliación | Medio | ±2% | 2-10% | > 10% |

**Score de completitud:**

```
score = (Σ indicadores_criticos_verdes × 3 + altos_verdes × 2 + medios_verdes × 1) / total_ponderado × 100
```

```sql
-- Ejemplo: evaluar completitud
-- Cada indicador retorna 'green', 'yellow', 'red'
-- Se pondera y calcula score

-- Gastos fijos configurados (Crítico, peso 3)
SELECT COUNT(*) as n_gastos_fijos FROM gastos_fijos WHERE tenant_id = :tid;
-- >= 3 -> green, 1-2 -> yellow, 0 -> red

-- Meta ventas (Crítico, peso 3)
SELECT meta_ventas_mensual FROM config_metas 
WHERE tenant_id = :tid AND mes = date_trunc('month', :fecha_ref);
-- Existe y > 0 -> green, hereda de otro mes -> yellow, null -> red

-- Datos fiscales clientes activos (Alto, peso 2)
SELECT 
 COUNT(*) FILTER (WHERE nit IS NOT NULL AND regimen IS NOT NULL) as completos,
 COUNT(*) as total
FROM contactos 
WHERE tenant_id = :tid 
 AND id IN (SELECT contacto_id FROM oportunidades WHERE estado = 'ganada')
 OR id IN (SELECT cliente_id FROM proyectos WHERE estado IN ('activo', 'en_progreso'));
-- completos/total >= 1.0 -> green, >= 0.7 -> yellow, < 0.7 -> red

-- Saldo bancario (Alto, peso 2)
SELECT fecha FROM saldos_banco 
WHERE tenant_id = :tid ORDER BY fecha DESC LIMIT 1;
-- < 4 días -> green, 4-7 -> yellow, > 7 o null -> red
```

**Umbrales de completitud:**

| Score | Estado | Acción sobre cards |
|-------|--------|-------------------|
| >= 80% | Si Datos confiables | -> Evalúa Capa 2 (finanzas) |
| 50-79% | [ATENCION] Datos parciales | -> Semáforo amarillo de datos. Cards visibles con badge [ATENCION] |
| < 50% | No Datos insuficientes | -> Semáforo rojo de datos. Cards OCULTAS |

### Capa 2: Salud Financiera (solo si Capa 1 >= 80%)

Cuando los datos son confiables, evalúa la salud del negocio. Muestra el **peor estado** de tres indicadores:

| Indicador | Verde | Amarillo | Rojo |
|-----------|---------|------------|--------|
| Runway | > 6 meses | 3–6 meses | < 3 meses |
| Facturación vs PE | > 120% PE | 100–120% PE | < 100% PE |
| Cartera vencida | < 20% del total | 20–40% | > 40% |

```sql
-- Runway
SELECT 
 (SELECT saldo_real FROM saldos_banco WHERE tenant_id = :tid ORDER BY fecha DESC LIMIT 1)
 / 
 NULLIF((SELECT AVG(gasto_mensual) FROM (
 SELECT SUM(monto) as gasto_mensual 
 FROM gastos WHERE tenant_id = :tid 
 AND fecha >= CURRENT_DATE - interval '3 months'
 GROUP BY date_trunc('month', fecha)
 ) sub), 0)
AS runway_meses;

-- Facturación vs PE
SELECT 
 COALESCE(SUM(monto_total), 0) as facturacion_mes,
 (SELECT punto_equilibrio FROM config_financiera WHERE tenant_id = :tid) as pe
FROM facturas 
WHERE tenant_id = :tid 
 AND date_trunc('month', fecha_emision) = date_trunc('month', :fecha_ref);

-- Cartera vencida
SELECT 
 COALESCE(SUM(CASE WHEN CURRENT_DATE - fecha_emision > 30 
 THEN monto_total - monto_cobrado ELSE 0 END), 0) as cartera_vencida,
 COALESCE(SUM(monto_total - monto_cobrado), 0) as cartera_total
FROM facturas 
WHERE tenant_id = :tid AND monto_total - monto_cobrado > 0;
```

### Comportamiento visual del semáforo (D108)

**Estado: Datos insuficientes (score < 50%)**

```
┌─────────────────────────────────────────────────────────────┐
│ Tus números no son confiables aún │
│ │
│ Para ver tus números, completa: │
│ ⬜ Configura al menos 3 gastos fijos mensuales │
│ ⬜ Define tu meta de ventas de este mes │
│ ⬜ Actualiza tu saldo bancario │
│ │
│ [Completar datos ->] │
└─────────────────────────────────────────────────────────────┘

[5 CARDS OCULTAS — en su lugar:]
┌─────────────────────────────────────────────────────────────┐
│ Completa los pendientes de arriba para ver tus 5 números │
└─────────────────────────────────────────────────────────────┘
```

**Estado: Datos parciales (score 50-79%)**

```
┌─────────────────────────────────────────────────────────────┐
│ Casi listo — 2 pendientes para lectura completa │
│ ▼ Ver pendientes │
└─────────────────────────────────────────────────────────────┘

[Expandido:]
│ ⬜ Datos fiscales de 2 clientes activos │
│ ⬜ Confirmar arriendo y seguros de febrero │
│ Si Gastos fijos configurados │
│ Si Meta de ventas definida │
│ Si Saldo bancario actualizado │

[5 CARDS VISIBLES con badge [ATENCION] en cada una]
[Disclaimer sutil debajo del semáforo: "Información parcial — puede variar"]
```

**Estado: Datos completos (score >= 80%) + finanzas evaluadas**

```
┌─────────────────────────────────────────────────────────────┐
│ Datos completos. Tu negocio está sano. │
│ ▼ Ver checklist │
└─────────────────────────────────────────────────────────────┘

[5 CARDS VISIBLES sin restricción — verdad financiera]
```

**Estado: Datos + Finanzas**

```
│ Datos completos. Hay temas que atender. │
│ Cartera vencida: 25% — revisa cobros pendientes │
```

**Estado: Datos + Finanzas**

```
│ Datos completos. Tu negocio necesita acción inmediata. │
│ Runway: 2.1 meses — acelera cobros o reduce gastos │
```

### Checklist siempre expandible

En TODOS los estados (incluso ) el checklist es expandible tocando "▼ Ver checklist". En verde muestra "Si Todo al día" o sugerencias opcionales de mejora.

---

## §5. Franja de Conciliación Bancaria (D109, D112-rev)

### Concepto

Franja compacta (máximo 2 líneas) entre semáforo y cards. Solo visualización — nunca input. Muestra el saldo real del banco, estado de conciliación y streak.

### Modelo de datos

**Tabla: `saldos_banco`**

```sql
CREATE TABLE saldos_banco (
 id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 saldo_real NUMERIC(15,2) NOT NULL,
 saldo_teorico NUMERIC(15,2) NOT NULL, -- calculado al momento del registro
 diferencia NUMERIC(15,2) NOT NULL, -- saldo_real - saldo_teorico
 fecha TIMESTAMPTZ DEFAULT NOW(),
 registrado_via VARCHAR(20) NOT NULL, -- 'app' | 'whatsapp' | 'push'
 nota TEXT, -- opcional: contexto de la diferencia
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE saldos_banco ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON saldos_banco
 USING (tenant_id = auth.jwt() ->> 'tenant_id');

-- Índice para queries frecuentes
CREATE INDEX idx_saldos_banco_tenant_fecha ON saldos_banco(tenant_id, fecha DESC);
```

**Tabla: `streaks`**

```sql
CREATE TABLE streaks (
 id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 tipo VARCHAR(30) NOT NULL DEFAULT 'conciliacion',
 semanas_actuales INTEGER DEFAULT 0,
 semanas_record INTEGER DEFAULT 0,
 ultima_actualizacion TIMESTAMPTZ,
 streak_inicio DATE,
 created_at TIMESTAMPTZ DEFAULT NOW(),
 updated_at TIMESTAMPTZ DEFAULT NOW(),
 UNIQUE(tenant_id, tipo)
);

-- RLS
ALTER TABLE streaks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON streaks
 USING (tenant_id = auth.jwt() ->> 'tenant_id');
```

### Cálculo del saldo teórico (D110)

El saldo teórico se calcula DESDE el último saldo real reportado (no desde el inicio). Cada conciliación "resetea" el punto de partida.

```sql
-- Saldo teórico = último saldo real + cobros desde entonces - gastos desde entonces
SELECT 
 sb.saldo_real 
 + COALESCE(
 (SELECT SUM(monto) FROM cobros 
 WHERE tenant_id = :tid AND fecha > sb.fecha), 0)
 - COALESCE(
 (SELECT SUM(monto) FROM gastos 
 WHERE tenant_id = :tid AND fecha > sb.fecha), 0)
AS saldo_teorico
FROM saldos_banco sb
WHERE sb.tenant_id = :tid
ORDER BY sb.fecha DESC
LIMIT 1;
```

### Tolerancia de diferencia (D111)

| Diferencia | Estado | Visual |
|-----------|--------|--------|
| ±$50.000 o ±2% (lo que sea mayor) | Si Cuadra | No muestra comparación |
| $50K-$500K o 2-10% | [ATENCION] Diferencia menor | Muestra banco vs calculado |
| > $500K o > 10% | Diferencia importante | Muestra banco vs calculado + alerta |

Tolerancia configurable en setup. Estos son defaults.

### Streak de conciliación — Gamificación (D117)

| Regla | Valor |
|-------|-------|
| Qué cuenta | Actualizar saldo bancario al menos 1 vez por semana calendario |
| Cuándo se rompe | Si pasan > 7 días sin actualización |
| Cómo se muestra | X semanas consecutivas |
| Milestones | 4 sem · 12 sem · 26 sem · 52 sem |
| Recuperación | No. Si se rompe, arranca desde 0. |
| Record | Se guarda `semanas_record` — "Tu mejor racha: X semanas" |

**Cron job semanal** (domingo 23:59):

```sql
-- Evaluar streak
UPDATE streaks 
SET 
 semanas_actuales = CASE 
 WHEN EXISTS (
 SELECT 1 FROM saldos_banco 
 WHERE tenant_id = streaks.tenant_id 
 AND fecha > NOW() - interval '7 days'
 ) THEN semanas_actuales + 1
 ELSE 0
 END,
 semanas_record = GREATEST(semanas_record, 
 CASE 
 WHEN EXISTS (
 SELECT 1 FROM saldos_banco 
 WHERE tenant_id = streaks.tenant_id 
 AND fecha > NOW() - interval '7 days'
 ) THEN semanas_actuales + 1
 ELSE semanas_record
 END
 ),
 ultima_actualizacion = NOW(),
 updated_at = NOW()
WHERE tipo = 'conciliacion';
```

### 4 estados visuales de la franja

**Estado 1: Conciliado y reciente** (último saldo < 4 días, diferencia <= tolerancia)

```
│ Caja: $4.200.000 Si Conciliado hoy 12 semanas │
```

1 línea. Compacto. Sin ruido.

**Estado 2: Conciliado pero envejeciendo** (último saldo 4-7 días)

```
│ Caja: $4.200.000 [ATENCION] Hace 4 días 12 sem — ¡no pierdas tu racha! │
```

1 línea. Urgencia suave.

**Estado 3: Diferencia detectada** (último saldo < 7 días, diferencia > tolerancia)

```
│ Banco: $4.200.000 vs Calculado: $4.350.000 │
│ [ATENCION] Diferencia: -$150.000 12 semanas │
```

2 líneas. Muestra la comparación.

**Estado 4: Streak roto** (último saldo > 7 días)

```
│ Caja: $3.800.000 [ATENCION] Hace 9 días │
│ Perdiste tu racha de 12 semanas — actualiza para empezar otra │
```

2 líneas. Dolor + CTA implícito.

### Impacto en P1 y P5 (D115)

**P1 y P5 siempre usan el saldo real del banco**, no el teórico. El banco es la verdad.

```sql
-- Saldo para P1 y P5
SELECT saldo_real FROM saldos_banco 
WHERE tenant_id = :tid ORDER BY fecha DESC LIMIT 1;
```

Si no hay saldo registrado aún, P1 usa saldo teórico (cobros - gastos) con label "Calculado — actualiza tu saldo real para mayor precisión".

---

## §6. Las 5 Preguntas MéTRIK — Versión ONE (D101)

### P1: ¿Cuánta plata tengo?

**Número grande:** Saldo real del banco (último reportado). Si no hay saldo real -> calculado.

**Flecha tendencia:** Compara con mismo día del mes anterior. ↑ mejoró, v empeoró, = ±5%.

**Barra de progreso:** Recaudo del mes vs meta de recaudo mensual.

```
Recaudo: ████████░░░ $9.500.000 / $12.000.000 (79%)
```

**Color dinámico de barra (D105):**

```
ritmo_esperado = meta_recaudo × (día_actual / días_del_mes)

Si progreso >= ritmo_esperado -> Verde (#10B981)
Si progreso >= ritmo × 0.8 -> Amarillo (#F59E0B)
Si progreso < ritmo × 0.8 -> Rojo (#EF4444)
```

**Fuente de datos:**

```sql
-- Saldo caja (prioriza saldo real)
SELECT COALESCE(
 (SELECT saldo_real FROM saldos_banco WHERE tenant_id = :tid ORDER BY fecha DESC LIMIT 1),
 (SELECT COALESCE(SUM(monto), 0) FROM cobros WHERE tenant_id = :tid AND fecha <= CURRENT_DATE)
 - (SELECT COALESCE(SUM(monto), 0) FROM gastos WHERE tenant_id = :tid AND fecha <= CURRENT_DATE)
) AS saldo_caja;

-- Recaudo del mes
SELECT COALESCE(SUM(monto), 0) as recaudo_mes
FROM cobros
WHERE tenant_id = :tid
 AND date_trunc('month', fecha) = date_trunc('month', :fecha_ref);

-- Meta recaudo
SELECT meta_recaudo_mensual FROM config_metas 
WHERE tenant_id = :tid AND mes = date_trunc('month', :fecha_ref);
```

**Drill-down (click en card):**

| Sección | Contenido |
|---------|-----------|
| Movimientos del mes | Lista cronológica: cobros (+) y gastos (-) con fecha, concepto, proyecto |
| Proyección 30 días | Cobros esperados (facturas no cobradas) - gastos fijos programados |
| Saldo proyectado | Gráfica línea: saldo actual -> saldo en 30 días |

**Links de navegación (D106):** "Ver cartera completa" -> P3 drill-down. "Ir a Pipeline" -> Pipeline.

---

### P2: ¿Estoy ganando?

**Número grande:** Utilidad del periodo (ingresos cobrados - gastos totales).

**Flecha tendencia:** vs mes anterior completo.

**Barra de progreso:** Dual bar — Ingresos vs Gastos.

```
Ingresos ███████████████████ $12.500.000
Gastos █████████████░░░░░░ $7.300.000
```

**Lógica visual:**
- Ingresos: barra superior, 100% = total ingresos cobrados del mes.
- Gastos: barra inferior, proporcional. Si gastos > ingresos -> se desborda en rojo.
- Color gastos: verde < 70% ingresos, amarillo 70-90%, rojo > 90%.

**Fuente de datos:**

```sql
-- Ingresos cobrados del mes
SELECT COALESCE(SUM(monto), 0) as ingresos_mes
FROM cobros WHERE tenant_id = :tid
 AND date_trunc('month', fecha) = date_trunc('month', :fecha_ref);

-- Gastos totales del mes
SELECT COALESCE(SUM(monto), 0) as gastos_mes
FROM gastos WHERE tenant_id = :tid
 AND date_trunc('month', fecha) = date_trunc('month', :fecha_ref);
```

**Drill-down -> P&L Simplificado:**

```
ESTADO DE RESULTADOS — Febrero 2026
─────────────────────────────────────
Ingresos cobrados $12.500.000
─────────────────────────────────────
(-) Gastos directos proyectos
 Materiales $1.800.000
 Transporte $450.000
 Servicios profesionales $800.000
 Subtotal directos -$3.050.000
(-) Gastos operativos
 Arriendo $2.000.000
 Software $350.000
 Marketing $200.000
 Subtotal operativos -$2.550.000
(-) Gastos fijos personal
 Salario propio $1.500.000
 Asistente $200.000
 Subtotal personal -$1.700.000
─────────────────────────────────────
= UTILIDAD BRUTA $5.200.000
─────────────────────────────────────
(-) Provisión impuestos (~20%) -$1.040.000
─────────────────────────────────────
= DISPONIBLE PARA TI $4.160.000
─────────────────────────────────────
```

Provisión de impuestos: % configurable en perfil fiscal (fuente: Felipe [55A]).
Disclaimer siempre visible: "Valores estimados. Consulte su contador para declaraciones oficiales."

**Links de navegación:** "Ver gastos del mes" -> módulo Gastos. "Exportar a CSV" -> descarga.

---

### P3: ¿Cuánto me deben? (D101 — reemplaza P3 original)

**Número grande:** Total cartera pendiente (facturas emitidas - cobros recibidos).

**Flecha tendencia:** vs mes anterior. **Invertida:** v es verde (cartera bajó = bueno), ↑ es rojo.

**Barra de progreso:** Cobrado vs Facturado total.

```
Cobrado ██████████░░░░ $9.500.000 / $15.800.000 (60%)
```

**Color dinámico:**
- Verde: cobrado >= 70% del facturado
- Amarillo: 50-70%
- Rojo: < 50%

**Fuente de datos:**

```sql
SELECT 
 COALESCE(SUM(monto_total), 0) as total_facturado,
 COALESCE(SUM(monto_cobrado), 0) as total_cobrado,
 COALESCE(SUM(monto_total - monto_cobrado), 0) as cartera_pendiente
FROM facturas WHERE tenant_id = :tid AND monto_total - monto_cobrado > 0;
```

**Drill-down -> Cartera por Proyecto:**

| Proyecto | Factura | Saldo | Días | Estado |
|----------|---------|-------|------|--------|
| *Edificio Torres* | #0025 | $2.500.000 | 3 | |
| *Casa María* | #0018 | $2.000.000 | 22 | |
| *Pérez* | #0019 | $1.800.000 | 35 | Vencida |

Con cartera por antigüedad (0-30, 31-60, 61-90, >90 días).

**Links de navegación:** Cada fila -> " Llamar" (teléfono contacto) + " WhatsApp". "Ver todas las facturas" -> módulo Proyectos.

---

### P4: ¿Cuánto necesito vender? (incluye "Cuánto debo" — D102-A)

**Número grande:** Punto de equilibrio mensual.

**Flecha tendencia:** = si estable, ↑ si subió (costos aumentaron), v si bajó.

**Barra de progreso:** Ventas del mes vs meta, con marcador PE.

```
Ventas: █████████████░░░░ $12.500.000 / $15.000.000 (83%)
 ▲ PE $10.7M
```

**Lógica visual:**
- Barra va de 0 a Meta de ventas.
- Marcador PE (línea vertical o triángulo ▲) dentro de la barra.
- Color dinámico (D105):

| Zona | Color |
|------|-------|
| Fill < PE y día > 50% del mes | No has cubierto costos fijos |
| Fill < PE y día <= 50% del mes | Vas en camino |
| Fill >= PE | Ya cubriste costos fijos |
| Fill >= Meta | intenso — superaste la meta |

**Fuente de datos:**

```sql
-- Ventas del mes (facturación emitida)
SELECT COALESCE(SUM(monto_total), 0) as ventas_mes
FROM facturas WHERE tenant_id = :tid
 AND date_trunc('month', fecha_emision) = date_trunc('month', :fecha_ref);

-- Costos fijos
SELECT COALESCE(SUM(monto_esperado), 0) as costos_fijos_mes
FROM gastos_fijos WHERE tenant_id = :tid;

-- Margen de contribución promedio (últimos 6 meses)
SELECT AVG(1 - (costo_real / NULLIF(valor_facturado, 0))) as margen
FROM proyectos WHERE tenant_id = :tid 
 AND estado = 'cerrado' AND fecha_cierre > CURRENT_DATE - interval '6 months';

-- PE = costos_fijos / margen

-- Meta ventas
SELECT meta_ventas_mensual FROM config_metas 
WHERE tenant_id = :tid AND mes = date_trunc('month', :fecha_ref);
```

**Drill-down -> Gastos Fijos Corridos + PE:**

**Sección 1: Lo que debo pagar (próximos 30 días)**

```
GASTOS FIJOS — Vista corrida desde hoy
─────────────────────────────────────────
Si Arriendo oficina $2.000.000 (pagado 5 feb)
Si Internet $180.000 (pagado 8 feb)
⬜ Contador $500.000 (vence 25 feb)
⬜ Seguros $320.000 (vence 28 feb)
⬜ Arriendo oficina $2.000.000 (vence 5 mar)
─────────────────────────────────────────
Total próximos 30 días: $5.000.000
Ya pagado este mes: $2.180.000
Pendiente este mes: $820.000
```

Si = confirmado/pagado (reconciliado con borrador — D84)
⬜ = pendiente

**Sección 2: Cálculo PE**

```
PUNTO DE EQUILIBRIO
─────────────────────────────────────────
Costos fijos mensuales: $7.600.000
Margen de contribución: 88.6%
PE = $7.600.000 ÷ 0.886 = $10.700.000

Ventas este mes: $12.500.000
Sobre PE: +$1.800.000 Si
```

**Links de navegación:** "Configurar gastos fijos" -> Config. "Ir a Pipeline" -> Pipeline (si ventas < PE).

---

### P5: ¿Cuánto aguanto?

**Número grande:** Runway en meses (1 decimal).

**Flecha tendencia:** vs mes anterior.

**Barra de progreso:** Gauge horizontal con zonas.

```
░░░░░░░░░████░░░░░░░░░░
 0 3 6 12+
 ▲ 4.2 meses
```

**Lógica visual:**
- Zona roja: 0-3 meses
- Zona amarilla: 3-6 meses
- Zona verde: 6-12+
- Marcador posicional. Si > 12, se posiciona al final con "+12"

**Fuente de datos:**

```sql
-- Runway = Saldo real banco / Gasto promedio mensual (últimos 3 meses)
SELECT 
 (SELECT saldo_real FROM saldos_banco WHERE tenant_id = :tid ORDER BY fecha DESC LIMIT 1)
 /
 NULLIF((SELECT COALESCE(SUM(monto), 0) / 3 FROM gastos 
 WHERE tenant_id = :tid AND fecha >= CURRENT_DATE - interval '3 months'), 0)
AS runway_meses;
```

**Drill-down -> Escenarios:**

```
ESCENARIOS DE RUNWAY
─────────────────────────────────────────
Caja actual: $4.200.000
Gasto mensual promedio: $1.000.000

Base: 4.2 meses (gasto se mantiene)
Optimista: 5.8 meses (cobras cartera: +$6.3M)
Pesimista: 2.8 meses (sin nuevos cobros)
```

**Links de navegación:** "Ver cartera para cobrar" -> P3. "Revisar gastos fijos" -> P4. "Ir a Pipeline" -> Pipeline.

---

## §7. Estado Vacío — Onboarding (D107)

### Primera vez (0 datos)

Pantalla NO muestra cards vacías. Muestra onboarding paso a paso:

```
┌─────────────────────────────────────────────────┐
│ ¡Bienvenido a Mis Números! │
│ │
│ Para que tus números cobren vida: │
│ │
│ 1⃣ Configura tus gastos fijos mensuales │
│ [Configurar ->] ⬜ Pendiente │
│ │
│ 2⃣ Define tu meta de ventas del mes │
│ [Definir ->] ⬜ Pendiente │
│ │
│ 3⃣ Registra tu saldo bancario actual │
│ [Registrar ->] ⬜ Pendiente │
│ │
│ 4⃣ Crea tu primera oportunidad o proyecto │
│ [Crear ->] ⬜ Pendiente │
│ │
│ Cuando completes 1, 2 y 3, tus números │
│ se activan automáticamente. │
└─────────────────────────────────────────────────┘
```

### Parcialmente configurado

Gastos fijos y metas configurados pero sin transacciones: cards con $0, barras outline sin fill, semáforo gris "Registra tu primera venta para activar el semáforo", CTA: "Registrar primera oportunidad".

### Transición

Con 1 cobro registrado -> layout completo con datos reales. Barras empiezan a llenarse.

---

## §8. Selector de Mes — Lógica Temporal

| Periodo | Datos | Barras | Color dinámico | Semáforo |
|---------|-------|--------|---------------|----------|
| Mes actual | Real-time (Supabase Realtime) | Animadas, fill crece | Sí (ritmo vs día) | Activo live |
| Mes pasado | Cerrados, estáticos | Completas (resultado final) | No (verde si superó, rojo si no) | Estado al cierre |
| Mes futuro | Solo metas + forecast | Outline sin fill | No | Gris: "Configura metas" |

Todas las queries usan `:fecha_ref` parametrizado. El selector cambia el parámetro y todas las cards se recalculan.

---

## §9. Componente QuestionCard — Spec Técnica

### Props React

```typescript
interface QuestionCardProps {
 questionNumber: 1 | 2 | 3 | 4 | 5;
 title: string;
 value: number;
 valueFormat: 'currency' | 'months' | 'percent';
 trend: 'up' | 'down' | 'stable';
 trendIsPositive: boolean; // false para P3 (cartera ↑ = malo)
 barType: 'progress' | 'dual' | 'gauge' | 'dual_marker';
 barData: ProgressBarData | DualBarData | GaugeBarData | DualMarkerBarData;
 barColorDynamic: boolean; // true = color según ritmo D105
 onDrillDown: () => void;
 isEmpty: boolean;
 monthType: 'current' | 'past' | 'future';
 hasWarningBadge: boolean; // true cuando semáforo amarillo D108
}

interface ProgressBarData {
 current: number;
 target: number;
 label: string;
 sublabel: string;
}

interface DualBarData {
 bar1: { value: number; label: string; }
 bar2: { value: number; label: string; }
}

interface GaugeBarData {
 value: number;
 zones: { start: number; end: number; color: string; }[]
}

interface DualMarkerBarData {
 current: number;
 target: number;
 marker: number;
 markerLabel: string;
}
```

### Comportamiento del Click

Click -> slide-in panel desde derecha (desktop) o bottom sheet (móvil). Panel tiene botón cerrar + links de navegación (D106). NUNCA formularios dentro del drill-down.

---

## §10. Integración WhatsApp [98F]

### W16 — "¿Cómo estoy este mes?"

```
 Tus números — Febrero 2026:

 Tu negocio está sano

├ Caja: $4.200.000 (conciliado hoy Si)
├ Utilidad: +$5.200.000
├ Te deben: $6.300.000
├ Ventas: $12.5M / $15M (83%)
└ Aguantas: 4.2 meses

[ATENCION] 1 factura vencida de Pérez ($1.8M, 35 días)

 12 semanas de racha — ¡sigue así!
```

### W29 — Resumen Semanal (Lunes 7AM)

```
 Resumen semanal — 17-23 Feb 2026

 Tu negocio está sano

Esta semana:
├ Cobraste: $3.000.000
├ Gastaste: $1.250.000
├ ⏱ Trabajaste: 28h

Mes al día 23:
├ Ventas: 83% ████████░░
├ Recaudo: 79% ███████░░░
├ Utilidad: +$5.200.000
└ Runway: 4.2 meses

 Racha: 12 semanas

[ATENCION] *Pérez* te debe $1.8M (35 días)
```

### W32 — Actualizar saldo bancario (NUEVA — D114)

Intención nueva para el catálogo WhatsApp.

**Ejemplo:** "Mi saldo es 4.2 millones" / "Tengo 4200000 en el banco"

**Parse (Gemini):**
```json
{
 "intent": "SALDO_BANCO",
 "confidence": 0.95,
 "fields": { "amount": 4200000 }
}
```

**Lookup:** Calcular saldo teórico actual.

**Present:**
```
Diferencia <= tolerancia:
 Si Saldo actualizado: $4.200.000
 Mi cálculo: $4.195.000
 Si Cuadra perfecto
 ¡Semana 13 de racha!

Diferencia > tolerancia:
 Si Saldo actualizado: $4.200.000
 Mi cálculo: $4.350.000
 [ATENCION] Diferencia: -$150.000
 ¿Hubo un gasto que no registraste? Escríbemelo.
 Semana 13

Streak roto (>7 días):
 Si Saldo actualizado: $4.200.000
 Nueva racha iniciada — ¡a por las 4 semanas! 
```

**Save:** INSERT en `saldos_banco` + UPDATE streak.

---

## §11. Metas Mensuales — Configuración

### Dónde se configuran

En **Configuración** (tab ⚙), sección "Mis Metas".

### Tabla: `config_metas`

```sql
CREATE TABLE config_metas (
 id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 mes DATE NOT NULL, -- primer día del mes
 meta_ventas_mensual NUMERIC(15,2),
 meta_recaudo_mensual NUMERIC(15,2),
 created_at TIMESTAMPTZ DEFAULT NOW(),
 updated_at TIMESTAMPTZ DEFAULT NOW(),
 UNIQUE(tenant_id, mes)
);

ALTER TABLE config_metas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON config_metas
 USING (tenant_id = auth.jwt() ->> 'tenant_id');
```

### Campos

| Meta | Default | Nota |
|------|---------|------|
| Meta ventas mensual | Sin default (obligatorio) | "¿Cuánto quieres facturar este mes?" |
| Meta recaudo mensual | = Meta ventas × 0.8 | "¿Cuánto esperas cobrar?" |

### Recurrencia

- **Por mes:** "En marzo quiero vender $18M"
- **Flat:** "Siempre $15M" -> se replica mes a mes

Si no hay meta para un mes futuro, hereda el último configurado.

### PE automático

PE = gastos fijos / margen promedio. No configurable directamente. Cambia con gastos fijos o cierres de proyecto.

---

## §12. Alertas desde Números

| Condición | Alerta | Canal |
|-----------|--------|-------|
| Semáforo -> | "Tu negocio pasó a precaución: [razón]" | Push + WhatsApp |
| Semáforo -> | "Alerta: acción necesaria. [razón]" | Push + WhatsApp |
| Ventas < PE al día 20 | "Vas al X% del PE. Faltan $Y." | WhatsApp |
| Factura vence > 30 días | Cubierto en W25 [98F] | WhatsApp |
| Runway < 3 meses | "Runway: X meses. Acelera cobros." | Push + WhatsApp |
| Saldo no actualizado > 5 días | "Llevas 5 días sin actualizar — no pierdas tu racha" | Push |
| Streak roto | "Perdiste tu racha de X semanas " | Push |

---

## §13. Registro de Decisiones

| # | Decisión | Quién decidió |
|---|---------|---------------|
| D101 | 5 Preguntas ONE: P3 = "¿Cuánto me deben?" Retiro disponible se absorbe en P&L de P2 | Carmen + Felipe -> Mauricio Si |
| D102 | "Cuánto debo" integrado en drill-down P4 (gastos fijos corridos + PE). Opción A | Mik -> Mauricio Si |
| D103-v3 | Semáforo doble capa: Capa 1 completitud (gate) -> Capa 2 finanzas. Un solo semáforo visual | Mesa completa -> Mauricio Si |
| D104 | Pulso del Mes fusionado dentro de 5 cards. Cada card tiene barra de progreso | Consenso -> Mauricio Si |
| D105 | Barras con color dinámico: progreso vs ritmo esperado para el día del mes | Sofía -> Mauricio Si |
| D106 | Drill-downs con links de navegación (no formularios). Terminan en acción | Sofía -> Mauricio Si |
| D107 | Estado vacío: onboarding 4 pasos. No cards vacías | Sofía -> Mauricio Si |
| D108 | Rojo: cards ocultas. Amarillo: cards con badge [ATENCION]. Verde: sin restricción. Checklist siempre expandible | Mauricio directo Si |
| D109 | Conciliación bancaria: usuario reporta saldo real, sistema compara con teórico | Carmen + equipo -> Mauricio Si |
| D110 | Una cuenta MVP. Recálculo continuo desde último saldo real. Diferencia solo alerta | Max + Carmen -> Mauricio Si |
| D111 | Tolerancia: ±$50K o ±2% = cuadra. $50K-500K = menor. >$500K = importante | Carmen -> Mauricio Si |
| D112-rev | Conciliación = franja compacta entre semáforo y cards. Solo visualización, nunca input | Sofía + Mauricio directo Si |
| D113 | Saldo no actualizado > 7 días baja score completitud del semáforo | Hana + Sofía -> Mauricio Si |
| D114 | 3 canales actualización saldo: app (FAB), WhatsApp (W32), push (martes/viernes) | Hana -> Mauricio Si |
| D115 | P1 y P5 usan saldo real banco, no teórico. Banco siempre gana | Carmen -> Mauricio Si |
| D116 | Cards = SOLO LECTURA. Cero inputs. Todo registro vía FAB, módulos o WhatsApp | Mauricio directo Si |
| D117 | Streak conciliación tipo Duolingo. Semanal. 4/12/26/52. Irrecuperable | Santiago -> Mauricio Si |
| D118 | FAB: 4 acciones (oportunidad, gasto, cobro, actualizar saldo) | Max -> Mauricio Si |

---

## §14. Tablas Nuevas Requeridas (resumen para Max)

| Tabla | Campos clave | Creada por este módulo |
|-------|-------------|----------------------|
| `config_metas` | tenant_id, mes, meta_ventas, meta_recaudo | Si Sí |
| `saldos_banco` | tenant_id, saldo_real, saldo_teorico, diferencia, fecha, registrado_via | Si Sí |
| `streaks` | tenant_id, tipo, semanas_actuales, semanas_record | Si Sí |

**Tablas existentes que consume (ya creadas por módulos anteriores):**

| Tabla | Spec fuente | Datos que usa |
|-------|-------------|---------------|
| `contactos` | [99] | Datos fiscales para score completitud |
| `oportunidades` | [98B] | Actividad, etapa, valor para pipeline/forecast |
| `proyectos` | [98C] | Estado, valor_facturado, costo_real, horas |
| `facturas` | [98C] | monto_total, monto_cobrado, fecha_emision |
| `cobros` | [98C] | monto, fecha, proyecto_id |
| `gastos` | [98E] | monto, fecha, categoria, proyecto_id |
| `gastos_fijos` | [98E] | concepto, monto_esperado, categoria |
| `gastos_fijos_borradores` | [98C] D84 | estado (borrador/confirmado) |
| `config_financiera` | [99] | punto_equilibrio, perfil fiscal |

---

## §15. Plan de Sprints (secuencial con Pipeline y Proyectos)

**Prerrequisito:** Pipeline [98B] y Proyectos [98C] completamente implementados y funcionales.

### Sprint NUM-1: Infraestructura + Cards sin drill-down

| Entregable | Descripción |
|-----------|-------------|
| Tablas | `config_metas`, `saldos_banco`, `streaks` + RLS + índices |
| Componente `QuestionCard` | 4 tipos de barra, responsive, estados vacío/parcial/completo |
| 5 cards con datos reales | Queries Supabase con Realtime subscriptions |
| Semáforo Capa 1 | Score completitud con 8 indicadores |
| Semáforo Capa 2 | Evaluación financiera (runway, PE, cartera) |
| Comportamiento D108 | Ocultar/badge/libre según score |
| Selector de mes | Navegación temporal + diferenciación visual 3 estados |
| Estado vacío D107 | Onboarding 4 pasos |
| Config metas | UI básica en Configuración |

### Sprint NUM-2: Conciliación + FAB + Streak

| Entregable | Descripción |
|-----------|-------------|
| Franja conciliación | 4 estados visuales, compacta entre semáforo y cards |
| FAB | 4 acciones: oportunidad, gasto, cobro, saldo |
| Modal "Actualizar saldo" | Input numérico + cálculo diferencia instantáneo |
| Streak engine | Cron semanal + milestones + UI en franja |
| Saldo inicial onboarding | Flujo onboarding ajustado: paso 3 = saldo |

### Sprint NUM-3: Drill-downs

| Entregable | Descripción |
|-----------|-------------|
| P1 drill-down | Movimientos + proyección 30d |
| P2 drill-down | P&L simplificado + retiro disponible |
| P3 drill-down | Cartera por proyecto + antigüedad + links llamar/WA |
| P4 drill-down | Gastos fijos corridos + cálculo PE |
| P5 drill-down | Escenarios optimista/base/pesimista |

### Sprint NUM-4: Alertas + WhatsApp + Polish

| Entregable | Descripción |
|-----------|-------------|
| Alertas push | Cambio semáforo, runway bajo, streak |
| W16 | Consulta "mis números" por WhatsApp |
| W29 | Resumen semanal con datos de Números |
| W32 | Actualizar saldo bancario por WhatsApp |
| Color dinámico barras D105 | Fórmula ritmo vs día |
| Responsive móvil | Cards stack, bottom sheet drill-downs |

---

## §16. Actualización requerida a WhatsApp [98F]

La spec de WhatsApp Flows [98F] necesita incorporar:

| Intención | Acción | Sprint |
|-----------|--------|--------|
| W32 (NUEVA) | Actualizar saldo bancario | WA sprint 5 o NUM-4 |
| W16 (AJUSTE) | Incluir saldo conciliado + streak en respuesta | NUM-4 |
| W29 (AJUSTE) | Incluir streak + estado conciliación en resumen semanal | NUM-4 |

W32 se agrega al prompt maestro Gemini como intención nueva en grupo REGISTRO.

**Catálogo WhatsApp actualizado: 16 intenciones MVP** (15 originales + W32).
