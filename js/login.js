/* Login contra Supabase Auth (ver sesion.js): correo y contraseña, y Google
   cuando el proveedor esté activo. Ya no hay credenciales en el cliente: la
   validación ocurre en Supabase. */

/* Supabase responde en inglés; acá se traduce lo que la usuaria puede ver. */
const MENSAJES = {
  'Invalid login credentials': 'Correo o contraseña incorrectos.',
  'Email not confirmed': 'Falta confirmar el correo. Revisá tu bandeja de entrada.',
  'Email logins are disabled': 'El acceso por correo está desactivado en Supabase.',
};

function avisar(msg) {
  const caja = document.getElementById('aviso');
  caja.textContent = msg;
  caja.classList.add('visible');
}

function limpiarAviso() {
  document.getElementById('aviso').classList.remove('visible');
}

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('formLogin');
  const boton = document.getElementById('btnEntrar');

  if (!CONFIG_LISTA) {
    boton.disabled = true;
    avisar('Falta completar js/config.js con la URL y la anon key del proyecto de Supabase.');
    return;
  }

  /* Si ya hay sesión (o se vuelve de Google), entra directo. */
  if (await Sesion.actual()) {
    location.replace('app.html');
    return;
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    limpiarAviso();

    const correo = document.getElementById('correo').value.trim();
    const clave = document.getElementById('clave').value;
    if (!correo || !clave) {
      avisar('Escribí tu correo y tu contraseña.');
      return;
    }

    boton.disabled = true;
    const { error } = await Sesion.entrarConCorreo(correo, clave);
    if (error) {
      boton.disabled = false;
      avisar(MENSAJES[error.message] || error.message);
      return;
    }
    location.href = 'app.html';
  });

  /* El botón de Google se muestra solo si el proveedor está activo. */
  const proveedores = await Sesion.proveedores();
  if (!proveedores.google) return;

  const bloque = document.getElementById('bloqueGoogle');
  const btnGoogle = document.getElementById('btnGoogle');
  bloque.classList.add('visible');

  btnGoogle.addEventListener('click', async () => {
    limpiarAviso();
    btnGoogle.disabled = true;
    const { error } = await Sesion.entrarConGoogle();
    if (error) {                                  // si sale bien, ya se fue a Google
      btnGoogle.disabled = false;
      avisar('No se pudo iniciar sesión con Google: ' + error.message);
    }
  });
});
