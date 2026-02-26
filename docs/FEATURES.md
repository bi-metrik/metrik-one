# MeTRIK ONE — Features Implementados

> Documento generado: 2026-02-26 | Version: MVP v1.0

---

## Leyenda de Estado

- ✅ **Implementado** — Funcional en produccion
- 🔧 **Schema listo** — Tablas/columnas creadas, UI o logica pendiente
- 🔲 **Planeado** — En roadmap, sin implementacion

---

## 1. Pipeline CRM

| # | Feature | Estado | Descripcion |
|---|---------|--------|-------------|
| D25 | Creacion rapida de oportunidad | ✅ | <45 seg, 4 campos obligatorios |
| D29 | Crear cliente inline (modal) | ✅ | Sin salir del formulario de oportunidad |
| D48 | Auto-crear proyecto al ganar oportunidad | ✅ | Oportunidad won → proyecto activo automatico |
| D173 | Reactivar oportunidad perdida | ✅ | Regresar a Lead/Prospecto |
| D174 | Razon de perdida | ✅ | 6 opciones predefinidas |
| D176 | Proyecto activo al ganar (sin borrador) | ✅ | Skip estado draft |
| — | Kanban drag-and-drop | ✅ | @dnd-kit para cambio de etapa visual |
| — | Notas en oportunidad | ✅ | Sistema de notas generico |

### Etapas del Pipeline
`lead` → `prospecto` → `propuesta` → `negociacion` → `ganado` / `perdido`

---

## 2. Cotizaciones

| # | Feature | Estado | Descripcion |
|---|---------|--------|-------------|
| D32 | Cotizacion Flash (3 bloques) | ✅ | Calculo en vivo: Cliente paga / Retienen / Consignan |
| D50 | Flash en creacion de cotizacion | ✅ | Widget durante edicion |
| D85 | 6 tipos de rubro | ✅ | materiales, mano_de_obra, transporte, software, servicios_profesionales, otros |
| D86 | Layout 3 bloques fiscales | ✅ | IVA, ReteFuente, ReteICA, ReteIVA |
| D93 | Disclaimer fiscal obligatorio | ✅ | "Consulta con tu contador" |
| D131 | Link cotizacion → proyecto | ✅ | Proyecto hereda rubros de cotizacion aprobada |
| — | PDF cotizacion | ✅ | @react-pdf/renderer con branding |
| — | Email cotizacion | ✅ | Envio via Resend |
| — | Descuento en cotizacion | ✅ | Porcentaje de descuento global |

---

## 3. Proyectos

| # | Feature | Estado | Descripcion |
|---|---------|--------|-------------|
| D175 | 6 estados de proyecto | ✅ | en_ejecucion, pausado, completado, rework, cancelado, cerrado |
| D141 | Margen de contribucion | ✅ | % margen por proyecto |
| — | Rubros presupuestados vs ejecutados | ✅ | Vista comparativa |
| — | Gastos directos por proyecto | ✅ | Asignacion gasto → proyecto |
| — | Codigo auto-incremental | ✅ | P-001, P-002... por workspace |
| — | Proyectos internos | ✅ | Flag `tipo: 'interno'` para gastos operativos |
| — | Notas en proyecto | ✅ | Sistema generico |
| — | Horas por proyecto | ✅ | Registro de horas con tarifa |

---

## 4. Numeros (KPIs)

| # | Feature | Estado | Descripcion |
|---|---------|--------|-------------|
| — | P1: Facturacion del mes | ✅ | Total cobros vs meta |
| — | P2: Recaudo del mes | ✅ | Cobros efectivos vs meta |
| — | P3: Gastos del mes | ✅ | Total egresos con desglose |
| — | P4: Margen operativo | ✅ | Ingresos - egresos = neto |
| — | P5: Pipeline activo | ✅ | Valor ponderado oportunidades |
| — | Metas mensuales | ✅ | Configurables por workspace |
| — | Grafico de tendencia | ✅ | Recharts barras/lineas |

---

## 5. Movimientos (Registro Transaccional)

| # | Feature | Estado | Descripcion |
|---|---------|--------|-------------|
| D142 | Tags deducibilidad | ✅ | "Deducible" / "Falta soporte" por categoria |
| D142 | Tooltips educativos (primera vez) | ✅ | Explicacion deducibilidad + falta soporte |
| D119 | Estado de pago (pagado/pendiente) | ✅ | Badge naranja "Pend. pago" + boton "Pagado" |
| D246 | Estado contable (causacion) | ✅ | Badges: Pendiente/Aprobado/Rechazado/Causado |
| D246 | Aprobar/Rechazar inline | ✅ | Botones en tarjeta (owner/admin + PENDIENTE) |
| D246 | Dialog de rechazo con motivo | ✅ | Motivo obligatorio |
| — | Filtros avanzados | ✅ | Categoria, proyecto, tipo proyecto, estado pago, estado contable |
| — | Canal de registro (WhatsApp/App) | ✅ | Icono telefono verde = WhatsApp |
| — | Usuario que registro | ✅ | Linea separada con icono User + nombre |
| — | Soporte fotografico (lightbox) | ✅ | Click para ver imagen de factura |
| — | Selector de mes con navegacion | ✅ | Flechas izq/der |

---

## 6. Causacion Contable (D246)

| # | Feature | Estado | Descripcion |
|---|---------|--------|-------------|
| D246 | Bandeja de aprobados | ✅ | Lista de gastos/cobros estado APROBADO |
| D246 | Formulario de causacion inline | ✅ | Cuenta PUC, centro costo, retencion, notas |
| D246 | Accion "Causar" | ✅ | APROBADO → CAUSADO con datos contables |
| D246 | Tab causados por mes | ✅ | Vista read-only con badges PUC/CC |
| D246 | Log de auditoria | ✅ | causaciones_log con cada accion |
| D246 | Seccion separada en sidebar | ✅ | "Contabilidad" debajo del nav principal |
| — | Alegra sync | 🔧 | Columnas listas (alegra_id, enviado_alegra), sin API |

---

## 7. Gastos

| # | Feature | Estado | Descripcion |
|---|---------|--------|-------------|
| D44 | Registro rapido de gasto | ✅ | Formulario con 9 categorias |
| D241 | Gastos empresariales (sin proyecto) | ✅ | tipo: 'empresa' |
| D239 | Gastos fijos recurrentes | ✅ | Configuracion + borradores mensuales |
| D95 | 9 categorias de gasto | ✅ | materiales, transporte, etc. |
| — | Soporte fotografico | ✅ | Upload a Supabase Storage |
| — | Estado pago (D119) | ✅ | pagado / pendiente con fecha_pago |
| — | Causacion contable (D246) | ✅ | PENDIENTE → APROBADO → CAUSADO |
| — | Trazabilidad created_by | ✅ | Usuario que registro cada gasto |

---

## 8. Facturacion y Cobros

| # | Feature | Estado | Descripcion |
|---|---------|--------|-------------|
| D182 | Tracking de facturas | ✅ | Numero, monto, estado, fecha |
| D183 | Registro de pagos | ✅ | Pagos parciales/totales |
| D412 | Estado de pago cobros | ✅ | Tracking cobros pendientes |
| — | Cobro rapido | ✅ | Formulario FAB |

---

## 9. Fiscal

| # | Feature | Estado | Descripcion |
|---|---------|--------|-------------|
| D2 | Perfil fiscal por workspace | ✅ | NIT, regimen, declarante |
| D34 | Warning perfil fiscal incompleto | ✅ | Alerta en numeros |
| D51 | Defaults conservadores (UVT) | ✅ | Topes automaticos |
| D94 | Parametros fiscales desde tabla | ✅ | UVT $49,799, tasas configurables |
| D234-D236 | Wizard fiscal (Felipe) | 🔧 | Schema listo, UI por implementar |

---

## 10. Directorio

| # | Feature | Estado | Descripcion |
|---|---------|--------|-------------|
| — | Empresas CRUD | ✅ | NIT, sector, direccion fiscal |
| — | Contactos CRUD | ✅ | Nombre, email, telefono, empresa |
| — | Promotores/Referidos | ✅ | Comision configurable |
| — | Detalle empresa con contactos | ✅ | Vista empresa → contactos asociados |

---

## 11. Configuracion

| # | Feature | Estado | Descripcion |
|---|---------|--------|-------------|
| — | Perfil fiscal | ✅ | Regimen, NIT, declarante |
| — | Equipo (invitar, roles) | ✅ | Magic link invite + roles |
| — | Cuentas bancarias | ✅ | Registro multiple |
| — | Catalogo de servicios | ✅ | Nombre + precio estandar |
| — | Staff (equipo interno) | ✅ | Salario + horas disponibles |
| — | Metas mensuales | ✅ | Ventas + recaudo por mes |

---

## 12. UX / Onboarding

| # | Feature | Estado | Descripcion |
|---|---------|--------|-------------|
| D181 | Story Mode (7 pantallas) | ✅ | Tutorial interactivo pre-onboarding |
| D43 | FAB flotante | ✅ | Boton "+" con acciones rapidas |
| — | Onboarding 3 pasos | ✅ | Nombre → Negocio + slug → Profesion |
| — | Sidebar colapsable | ✅ | Expand/collapse en desktop |
| — | Mobile bottom tab bar | ✅ | Navegacion inferior adaptativa |
| — | Branding por workspace | ✅ | Color primario, secundario, logo |
| — | Dark mode | 🔧 | next-themes instalado, parcialmente integrado |

---

## 13. Integraciones

| Servicio | Estado | Descripcion |
|----------|--------|-------------|
| WhatsApp Business | 🔧 20% | Webhook + handlers + sesiones, logica conversacional parcial |
| Alegra (Contabilidad) | 🔧 5% | Schema listo, API no conectada |
| Resend (Email) | ✅ | Envio cotizaciones, invitaciones |
| Supabase Storage | ✅ | Logos, soportes de gastos |

---

## 14. Features NO implementados (Roadmap)

| Feature | Prioridad | Notas |
|---------|-----------|-------|
| Multiusuario completo (98G) | Alta | 5 niveles de rol, permisos granulares |
| Rol contador | Alta | Acceso solo a causacion |
| Wizard fiscal Felipe (D234-D236) | Media | UI de configuracion fiscal guiada |
| Nomina/Payroll (D129) | Media | Schema listo, UI pendiente |
| Health Score calculo (D105) | Media | Schema listo, formula pendiente |
| WhatsApp bot completo | Media | Handlers parciales, flujos conversacionales |
| Alegra sync | Baja | Depende de causacion estable |
| Subscriptions/Billing | Baja | Stripe no conectado |
| Reconciliacion bancaria | Baja | Schema listo |
| Notificaciones in-app | Baja | Tabla existe, sin triggers |
