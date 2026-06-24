# Cuenta Clara — Plan y diseño

Producto de software para que pequeños salones de belleza lleven su inventario y sus fiados sin cuaderno. Capstone de **Ingeniería de Software I**. Cliente real y piloto: **YCC Beauty Studio** (Choloma, Cortés).

---

## 1. Caso real, contexto y problema

**Cliente y cómo la conocí:** Yaleni Lineth Ventura Sosa, dueña de YCC Beauty Studio, un pequeño salón de belleza que, además de los servicios, importa cajas de productos de belleza y de hogar desde Estados Unidos para revenderlos en el local y por redes sociales. La conocí cuando realizaba mi práctica profesional del colegio.

**Ubicación:** Colonia Armando Gale #2 (entrada La San Miguel), frente a la Escuela Marcia Carolina Gale, Choloma, Cortés.

**Fecha de la entrevista:** sábado 6 de junio de 2026.

**Lo que me dijo (textual):** *"Imaginate que no es un negocio grande, y solo le fío a pocas personas."* Esa frase es justamente la que revela el problema: como lo ve pequeño y son pocas clientas, nunca ha sentido la necesidad de llevar un registro, y por eso hoy no tiene forma de saber con certeza cuánto le deben ni si cada caja que trae le deja ganancia.

**Usuarios primarios y secundarios:** La usuaria primaria es Yaleni, que trabaja sola: atiende el salón, vende y registra cada venta y cada fiado. Las usuarias secundarias son las clientas a las que les fía y las que le compran por redes, cuyo saldo y pedidos hoy solo viven en su cuaderno.

**Cómo resuelve hoy el problema y por qué falla:** Para las citas ya usa una app, pero para el inventario y los fiados no tiene nada: solo apunta en un cuaderno el nombre de la persona y la cantidad. Eso falla porque el cuaderno no se puede buscar, no suma totales, se moja o se pierde, y como no compara lo que le cuesta cada caja contra lo que vende, no sabe qué productos le dejan ganancia ni cuándo se le está acabando algo.

**Por qué un software ayudaría:** Una app sencilla en el celular, con búsqueda por nombre y total automático de fiados, registro de inventario con alerta de bajo stock y margen por producto o por caja, le diría en segundos quién le debe y cuánto, qué se está agotando y qué le deja ganancia real.

---

## 2. Backlog inicial (épicas + user stories)

### Épica 1 — Inventario (saber qué tengo y qué deja ganancia)

- **US1 [v1]** Como dueña, quiero registrar los productos de una caja con su costo y precio, para saber qué tengo y cuánto debería ganar.
  - Al guardar un producto con nombre, cantidad, costo y precio, se suma al inventario con su margen (precio − costo) calculado.
  - Si dejo vacío el nombre o el precio, muestra un error claro y no guarda.
- **US2 [v1]** Como dueña, quiero ver y buscar el stock de cada producto, para saber qué me queda sin contar a mano.
  - Al buscar por nombre, veo la cantidad disponible.
  - Cada venta registrada descuenta la cantidad del stock automáticamente.
- **US3 [v1]** Como dueña, quiero que me avise cuando un producto esté por agotarse, para volver a pedirlo en la próxima caja.
  - Cuando el stock baja del mínimo definido, el producto aparece resaltado como "bajo stock".
- **US4 [v2]** Como dueña, quiero registrar cada caja importada con su costo en dólares y el tipo de cambio, para conocer el costo real en lempiras de cada producto.

### Épica 2 — Ventas y fiados (saber quién debe y cuánto)

- **US5 [v1]** Como dueña, quiero registrar una venta en pocos segundos, para no perder el ritmo cuando estoy atendiendo.
  - Al confirmar la venta, se guarda con fecha automática y descuenta del stock.
- **US6 [v1]** Como dueña, quiero marcar una venta como fiada y a nombre de quién, para llevar el control de los créditos.
  - Al marcarla como fiada y elegir la clienta, queda como saldo pendiente con fecha.
- **US7 [v1]** Como dueña, quiero ver una lista de quién me debe y cuánto, para cobrar sin repasar el cuaderno.
  - Al buscar por nombre, veo el saldo de esa persona, y la lista muestra el total general por cobrar.
- **US8 [v1]** Como dueña, quiero registrar abonos a un fiado, para que el saldo se actualice solo.
  - Al registrar un abono, el saldo baja automáticamente; si cubre la deuda, el fiado se marca como "pagado".

### Épica 3 — Caja y reportes (saber cómo va el negocio)

- **US9 [v1]** Como dueña, quiero ver el total por cobrar y los productos por agotarse, para saber cómo va el negocio sin sumar a mano.
- **US10 [v2]** Como dueña, quiero ver cuánto gané por cada caja y qué producto deja más margen, para decidir qué volver a traer.
- **US11 [v2]** Como dueña, quiero que la app funcione sin internet y sincronice después, para registrar aunque se vaya la señal.

---

## 3. Arquitectura y diseño

**Capas (3 capas):**

```
Celular de Yaleni
   | HTTPS
   v
CLIENTE: PWA  (inventario, ventas, fiados, reportes)
   | API REST/Realtime + Auth
   v
SERVIDOR: Supabase (BaaS)  (Auth, API automática, seguridad RLS, backups)
   |
   v
BASE DE DATOS: PostgreSQL  (datos relacionales)
```

**Tecnologías y por qué:**

- **PWA (HTML/CSS/JS):** Yaleni trabaja desde su celular Android. Una PWA se abre con un link y se "agrega a inicio" sin pasar por la tienda, pesa poco y permite registrar sin internet. Evita el costo de una app nativa.
- **Supabase (BaaS):** ella trabaja sola y el desarrollo es de una persona; no conviene mantener un servidor propio. Trae autenticación, API automática, respaldos y seguridad por fila, con un plan gratis que cubre el negocio.
- **PostgreSQL:** los datos son relacionales (clientas, productos, cajas, ventas, abonos).
- **Vercel:** despliega la PWA automáticamente desde GitHub con HTTPS gratis.

**Modelo de datos (entidades + campos clave):**

- **Clienta** (id, nombre, telefono, creada_en)
- **Caja** (id, descripcion, fecha, costo_total_usd, tipo_cambio)
- **Producto** (id, caja_id, nombre, costo, precio, stock, stock_minimo)
- **Venta** (id, fecha, canal, es_fiada, clienta_id, total)
- **DetalleVenta** (id, venta_id, producto_id, cantidad, precio_unit)
- **Abono** (id, venta_id, monto, fecha)

**Relaciones clave:**

- Caja 1—N Producto (habilita el margen por caja).
- Venta 1—N DetalleVenta, y Producto 1—N DetalleVenta (una venta lleva varios productos; cada detalle descuenta stock).
- Clienta 1—N Venta fiada (saldo = ventas fiadas − abonos).
- Venta fiada 1—N Abono.

**Integraciones externas:** Supabase Auth (login), Vercel (hosting/CDN) y, en v2, compartir por WhatsApp (Web Share API) para recordatorios de cobro.

---

## 4. Plan de calidad y testing

**Tipos de prueba:**

- **Unitarias:** lógica de cálculo — total de la venta, saldo del fiado (total − abonos), margen y descuento de stock.
- **Integración:** que guarde/lea bien en Supabase (registrar venta descuenta stock; un abono baja el saldo).
- **E2E:** flujo completo — registrar venta fiada → verla en "quién debe" → abonar → ver saldo actualizado.
- **Manual:** prueba real con Yaleni en su celular (registrar una venta en menos de 10 s).

**Definition of Done:** pasa el 100% de sus pruebas unitarias; tiene ≥1 escenario E2E del camino feliz; pasó 1 prueba manual con usuario real; valida entradas y muestra error claro; está desplegada en staging.

**Casos de prueba (US6 fiado / US8 abono):**

1. Clienta + producto + monto válido, marcado fiado → se guarda como saldo pendiente con fecha automática.
2. Monto = 0 o vacío → error claro, no guarda.
3. Clienta que no existe → se crea y queda asociada al fiado.
4. Abono menor al saldo → el saldo baja y queda en el historial.
5. Abono que cubre la deuda exacta → el fiado se marca como "pagado".
6. Registrar sin internet → guarda local y sincroniza al volver la señal.

**Riesgos de bugs y mitigación:** saldos mal calculados → pruebas unitarias del cálculo + redondeo a 2 decimales; doble registro → deshabilitar el botón al enviar; pérdida de datos sin señal → guardado local + sincronización; errores de tipeo → validación y selección de clienta existente.

---

## 5. Plan de despliegue y operación

- **Entornos:** dev (local), staging (Vercel preview por cada Pull Request) y prod (dominio fijo en Vercel con el Supabase real).
- **CI/CD:** GitHub Actions corre pruebas y lint en cada PR; merge a `main` = deploy automático; migraciones de BD versionadas.
- **Releases:** cambios chicos y frecuentes (un cambio por PR), versionado simple; como hay una sola usuaria, se publica en horario de poco movimiento.
- **Monitoreo:** Sentry (o logs de Vercel) para errores de JS; UptimeRobot con healthcheck cada 5 min.
- **Backup:** respaldos automáticos diarios de Supabase + export manual a CSV; el código vive en GitHub.

---

## 6. Plan de validación 10 / 15 / 30 días

**Hipótesis:**

- **H1 (la más riesgosa — adopción):** Yaleni registrará la mayoría de sus ventas y fiados en la app si el flujo toma menos de 10 segundos. Es la clave, porque ella misma siente que no lo necesita.
- **H2 (fiados):** sabrá al instante quién le debe y cuánto, y dejará de perder fiados por olvido.
- **H3 (margen):** sabrá qué producto deja más ganancia y cuándo reponer.

**Métricas:** % de ventas/fiados registrados en la app vs. cuaderno; tiempo por registro; veces que consulta "quién me debe"; total por cobrar real vs. lo que calculaba de memoria.

**Lo que se probó (piloto de 10 días, del domingo 14 al miércoles 24 de junio de 2026):** piloto real con Yaleni; cargamos juntas el inventario inicial y ella registró sus ventas y fiados a diario. **Resultado observado:** la mayor dificultad fue que empezó a usar la app con la caja ya abierta y producto ya vendido; al no cargar el inventario y los costos desde que llegó la caja, no pudo saber con certeza si le dejó ganancia. **Lección:** para medir bien el margen, la app debe usarse desde que se recibe la caja. Aun así, el piloto confirmó el problema real: hoy no tiene cómo conocer su ganancia.

**Continuación planificada:** a los 15 días, arrancar con una caja nueva desde cero y dejarla sola; a los 30 días, revisar si bajaron las pérdidas en fiados y si usó el reporte de margen.

**Criterios:** seguir si registra >70% en la app y dice que le ahorra tiempo; pivotar (simplificar) si la usa pero la siente lenta; abandonar si sigue prefiriendo el cuaderno.
