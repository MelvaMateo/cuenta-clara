/* Sesión con Supabase Auth, compartida por el login y la app.

   Antes la sesión era una llave en localStorage que el propio navegador se
   escribía: se falsificaba desde la consola. Ahora la emite y la valida
   Supabase, y el token se renueva solo. */

/* `sb` es nuestro cliente; `window.supabase` es la librería del CDN. */
const sb = CONFIG_LISTA
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

/* Marca de sesión: una cookie que avisa que en este navegador hay sesión.
   Vercel la mira para servir app.html (ver "redirects" en vercel.json): sin
   ella, manda al login sin entregar la página. No es la sesión ni la valida
   nadie; la sesión de verdad la valida Supabase, y los datos los protege el
   RLS de la base. */
const MARCA_SESION = 'cc_sesion';
function marcarSesion() {
  const segura = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${MARCA_SESION}=1; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax${segura}`;
}
function borrarMarca() {
  document.cookie = `${MARCA_SESION}=; Path=/; Max-Age=0; SameSite=Lax`;
}

const Sesion = {
  async actual() {
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session;
  },

  async entrarConCorreo(correo, clave) {
    return sb.auth.signInWithPassword({ email: correo, password: clave });
  },

  /* Manda a Google y vuelve a app.html con la sesión ya abierta. */
  async entrarConGoogle() {
    return sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: new URL('app.html', location.href).href },
    });
  },

  async cerrar() {
    borrarMarca();
    if (sb) await sb.auth.signOut();
  },

  /* Google manda el nombre en user_metadata; con correo no viene, y queda
     la parte del correo antes de la arroba. */
  nombreDe(sesion) {
    const usuario = sesion?.user || {};
    const meta = usuario.user_metadata || {};
    if (meta.full_name || meta.name) return meta.full_name || meta.name;
    return usuario.email ? usuario.email.split('@')[0] : 'Usuaria';
  },

  /* Qué proveedores tiene activos el proyecto. Sirve para no mostrar el botón
     de Google mientras el proveedor esté apagado: cuando se active en el panel
     de Supabase, aparece solo, sin tocar este código. */
  async proveedores() {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
        headers: { apikey: SUPABASE_ANON_KEY },
      });
      return (await r.json()).external || {};
    } catch {
      // Sin red, o Supabase no respondió: se muestra solo el acceso por correo,
      // que funciona igual. No es un error que la usuaria tenga que ver.
      return {};
    }
  },
};

/* Solo se entra con sesión abierta; si no, se vuelve a la pantalla de acceso. */
async function exigirSesion() {
  const sesion = await Sesion.actual();
  if (sesion) {
    marcarSesion();                               // renueva la marca mientras se use
  } else {
    borrarMarca();                                // la sesión venció: la marca también
    location.replace('login.html');
  }
  return sesion;
}
