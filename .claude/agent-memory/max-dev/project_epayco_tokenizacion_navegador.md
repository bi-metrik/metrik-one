---
name: epayco-tokenizacion-navegador
description: ePayco.js en /valida/empezar - sin captura alojada con token, bug de sesión en el primer intento, CSP de la ruta y forma de sus errores
metadata:
  type: project
---

Medido el 2026-10-14 (PR #1169, rama feat/valida-cobro-consulta-11):

- ePayco NO tiene captura alojada que devuelva token/customer reutilizable: Smart Checkout (onpage/standard) es pago único, su sesión no pide guardar tarjeta. Su propio plugin de suscripciones pinta `data-epayco` en la página del comercio. Mauricio lo veía "clandestino": se resolvió con recuadro de marca ePayco + CSP, no con migración.
- **Bug de ePayco.js**: en un navegador sin `localStorage.keyUserIndex`, pide la llave de cifrado con sesión vacía y tokeniza con la sesión nueva -> la API responde «No se encontro el token de sesion» o «card[exp_year] es requerido». El primer intento de TODO navegador nuevo fallaba («ePayco no aceptó la tarjeta» en el preview). Arreglo: `asegurarSesionEpayco` crea la sesión antes (`src/lib/valida-registro/error-epayco.ts`).
- Forma del error del callback `(error, token)`: string 103 «...vacío en: <campo>» (validación local), o `{status:false, message, data:{description}}` (400 de la API), o `(null, undefined)` en 200 sin token (el script compara con `=`).
- CSP solo en `/valida/empezar` vía `next.config.ts` headers (`src/lib/valida-registro/csp.ts`): script-src con `'unsafe-inline'` a propósito (layout raíz pinta scripts en línea sin nonce); externos solo los dos archivos exactos; connect-src `'self'`, `api.secure.payco.co`, origen de Supabase.

**Why:** el fallo del primer intento parece "tarjeta rechazada" y tapa todo lo demás; la API de encrypt no valida nada (cualquier llave da 200).
**How to apply:** si vuelve un rechazo de ePayco, leer primero la consola (`[ePayco] no tokenizó`) y la descripción que ya se muestra; para sondear la API sin tarjeta, número "123" -> «Bin credit card no valid» prueba que descifró bien.
