/* Login del prototipo: valida contra una cuenta de demostración y abre la
   sesión (ver sesion.js). En producción esto se reemplaza por Supabase Auth;
   nunca se compara una contraseña en el cliente. */

const DEMO = { usuario: 'yaleni', clave: 'ycc2026', nombre: 'Yaleni' };

function mostrarError(msg) {
  const caja = document.getElementById('error');
  caja.textContent = msg;
  caja.classList.add('visible');
}

document.getElementById('formLogin').addEventListener('submit', e => {
  e.preventDefault();
  document.getElementById('error').classList.remove('visible');

  const usuario = document.getElementById('usuario').value.trim().toLowerCase();
  const clave = document.getElementById('clave').value;

  if (!usuario || !clave) {
    mostrarError('Escribí tu usuario y tu contraseña.');
    return;
  }
  if (usuario !== DEMO.usuario || clave !== DEMO.clave) {
    mostrarError('Usuario o contraseña incorrectos.');
    return;
  }

  Sesion.abrir({ usuario: DEMO.usuario, nombre: DEMO.nombre });
  location.href = 'app.html';
});

/* Si ya hay sesión abierta, no tiene sentido pedir el login otra vez. */
if (Sesion.actual()) location.replace('app.html');
