---
name: project-dimpro-asistente-ventas-bold
description: Asistente de ventas de Dimpro (Chatwoot Messenger + link de Bold) — migración 20261029150000 y SQL de sql/dimpro SIN aplicar; webhook despacha por tabla; flete fuera de la venta
metadata:
  type: project
---

Dominio `ventas` del asistente público (29-oct, rama `feat/dimpro-asistente-ventas`). Estado al cerrar: migración
`20261029150000_ferreteria_links_bold.sql` SIN aplicar; `sql/dimpro/*reglamento*` y `*config*` SIN correr ; `chatwoot-agente` sin redesplegar; sandbox de Bold sin probar.

- Canal del ensayo: SOLO Messenger, cuenta Chatwoot 189134, inbox 151556 → canal `otro` del asistente (ventana 24 h).
- El webhook `/api/webhooks/bold/funciones/[ws]` despacha a Ferretería si el `LNK_…` está en `ferreteria_links_bold`;
  si no, sigue a `funcion_registrar_pago`. Con `deps.cliente` de prueba y sin `deps.ferreteria`, no despacha.
- `forma_pago = 'bold'` del brief NO se hizo: el CHECK solo admite anticipado/contra_entrega y la lógica de entrega lo
  lee. Bold queda en la fuente y la referencia `BOLD-<LNK>`. El flete no entra a `precio_final` ni a la ganancia.
- Confirmación del pago una sola vez por link: candado `ventas:pago:<ws>:<LNK>` compartido entre `verificar_pago` y el
  aviso del webhook (`chatwoot-agente?pago=`, Bearer service role). Si el aviso falla a mitad, no se reintenta.
- Revisión del 29-oct (coordinador): la venta se anota en el link APENAS se inserta (`alInsertar` de `registrarVenta`,
  FK `on delete set null`) y el reintento retoma/limpia; `procesando` > 2 min se reclama (`reclamado_at`, en la misma
  migración sin aplicar); `en_proceso` = 500; `verificar_pago` exige total del link y no-sandbox salvo espacio de
  pruebas; si no se pudo leer la tabla, el webhook sigue a funciones (Sabor). Hueco conocido: si `actualizarVenta`
  falla DESPUÉS de crear el negocio, la venta se borra y el negocio queda huérfano (el reintento crea otro).
- Términos publicados: https://dimpro.com.co/terminos/. pol.garantia y pol.cambios (retracto, 5 días HÁBILES) son texto
  legal revisado por Emilio: no los cambies sin él.
- Corrida real por CLI (Haiku): el modelo pasa a persona `fuera_de_zona` SIN intentar proponer; un caso que exija el
  candado falla con el modelo real. El guion del cliente tiene que decir lo que el caso prueba (cantidad 5).

**Why:** la sesión que aplique/encienda necesita el orden y lo que se apartó del brief.
**How to apply:** migración → semilla reglamento → config (con términos) → secretos y Agent Bot → llaves Bold + URL del
webhook → deploy de `chatwoot-agente` → `activo: true`. Ver [[project-asistente-chatwoot-sabor]].
