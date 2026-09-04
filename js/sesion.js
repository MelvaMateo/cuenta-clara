/* Sesión del prototipo, compartida por el login y la app.
   Se guarda en el localStorage del dispositivo; en producción esto se
   reemplaza por Supabase Auth (ver PLAN.md). */

const SESION_KEY = 'sesion';

const Sesion = {
  actual() {
    try {
      return JSON.parse(localStorage.getItem(SESION_KEY) || 'null');
    } catch (e) {
      return null;                                  // dato corrupto: como si no hubiera sesión
    }
  },
  abrir(usuario) {
    localStorage.setItem(SESION_KEY, JSON.stringify({
      ...usuario,
      desde: new Date().toISOString(),
    }));
  },
  cerrar() {
    localStorage.removeItem(SESION_KEY);
  },
};

/* Solo se entra con sesión abierta; si no, se vuelve a la pantalla de acceso. */
function exigirSesion() {
  const sesion = Sesion.actual();
  if (!sesion) location.replace('login.html');
  return sesion;
}
