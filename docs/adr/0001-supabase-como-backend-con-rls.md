# ADR-1: Supabase como backend, con la seguridad de los datos en RLS

- **Estado:** Aceptada
- **Fecha:** 2026-09-07 (planteada en [PLAN.md](../../PLAN.md) el 2026-06-24)
- **Commits:** `da1780f` (Supabase Auth) y `a502f99` (datos a PostgreSQL)

## Contexto

Cuenta Clara la desarrolla una sola persona y la usa una emprendedora que trabaja desde el celular, con presupuesto cero para infraestructura.

La primera versión guardaba todo en `localStorage`. Los datos vivían en un solo navegador: cambiar de celular o borrar el historial los perdía. El login era de demostración, con una marca que el propio navegador escribía y que se falsificaba desde la consola.

La app necesita:

- inicio de sesión real, con correo y también con Google;
- datos relacionales: cajas, productos, ventas, clientas y abonos, con saldos y stock que tienen que cuadrar;
- fotos de los productos;
- respaldos;
- ningún servidor que mantener.

Opciones consideradas:

| Opción | Por qué no, o por qué sí |
|---|---|
| Seguir con `localStorage` | No resuelve ni el login ni la pérdida de datos |
| Backend propio (Node + PostgreSQL en un servidor) | Hay que programar, asegurar, actualizar y pagar un servidor; demasiado para una persona |
| Firebase (Firestore) | Resuelve el login, pero los datos son relacionales: sin claves foráneas ni SQL, cuadrar stock y saldos queda en la app |
| **Supabase** | PostgreSQL real, Auth con Google, Storage para fotos, API automática, respaldos y un plan gratis que alcanza |

## Decisión

Usamos **Supabase** como backend, sin servidor propio de la app:

1. La PWA habla directo con Supabase: Auth para la sesión, la API REST de PostgreSQL para los datos y Storage para las fotos. En el navegador viaja solo la clave pública del proyecto.
2. **Toda la autorización vive en la base**, no en la app:
   - RLS activado en las seis tablas, con la política "solo lo propio" (`owner_id = auth.uid()`);
   - vistas con `security_invoker` y funciones `security invoker`, que respetan el RLS de quien consulta;
   - referencias `(id, owner_id)`, para que ninguna fila apunte a datos de otra cuenta;
   - sin permisos para el rol sin sesión;
   - fotos en una carpeta por cuenta.
3. Los cálculos del negocio viven en la base: el costo real de cada producto sale de vistas (`cajas_calculo`, `productos_costeados`), así la fórmula está en un solo lugar.
4. El esquema se versiona en `sql/`, con scripts numerados e idempotentes que sirven igual para una base nueva que para actualizar una existente.

## Consecuencias

**Positivas**

- No hay servidor que mantener ni pagar; el plan gratis cubre el negocio.
- El login con Google y con correo viene resuelto, y Supabase emite, valida y renueva la sesión.
- Los datos tienen integridad de verdad: claves foráneas, restricciones y cálculos en SQL.
- La seguridad se puede verificar: `sql/08_verificacion.sql` la revisa en la base real, y las pruebas en PGlite comprueban que sin sesión no hay acceso y que se rechazan las referencias a otra cuenta.

**Negativas y cómo se mitigan**

- **Toda la seguridad depende del RLS.** La clave pública está en el navegador, así que una política mal escrita expondría datos. Se mitiga con la revisión 08, con las pruebas de permisos en el CI y con el principio de negar por defecto: sin política no hay acceso.
- **Dependencia de un proveedor.** Auth y Storage son de Supabase. La base es PostgreSQL estándar, así que los datos se pueden llevar a otro lado; el login y las fotos habría que rehacerlos.
- **La lógica queda repartida entre SQL y JavaScript.** La regla es: cálculos y escrituras de varias filas en la base, y pantalla en la app.
- **El portal no se puede bloquear en el servidor.** La sesión vive en el navegador, así que `app.html` es una página pública. No trae datos: sin sesión solo muestra "Verificando tu sesión" y manda al login, y la base no entrega nada sin sesión.
- **El plan gratis pausa los proyectos inactivos.** El healthcheck (`/api/health`) lo detecta: responde 503 si Supabase no contesta.
