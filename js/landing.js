/* Animaciones de la landing (index.html).

   Todo es mejora progresiva: si este archivo no carga, si el navegador es
   viejo o si la persona activó "reducir movimiento" en su sistema, la página
   se ve completa y quieta. Por eso las clases que esconden cosas (.anima,
   .revelado-activo) las pone este script, y solo cuando va a poder mostrarlas. */

(() => {
  const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hayObservador = 'IntersectionObserver' in window;
  if (quieto || !hayObservador) return;

  /* ===== Aparición al hacer scroll ===== */
  document.documentElement.classList.add('revelado-activo');

  const alAparecer = new IntersectionObserver(entradas => {
    entradas.forEach(entrada => {
      if (!entrada.isIntersecting) return;
      entrada.target.classList.add('visible');
      alAparecer.unobserve(entrada.target);          // aparece una vez y queda
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.revelar').forEach(el => alAparecer.observe(el));

  /* ===== El teléfono: la caja se arma, se recupera y avisa la pérdida ===== */
  const escena = document.querySelector('.escena');
  if (!escena) return;

  const MOSTRAR = 8500;     // lo que dura la caja armada antes de reiniciar
  const PAUSA = 700;        // el hueco en blanco entre una vuelta y la otra
  let temporizador = null;

  escena.classList.add('anima');

  function vuelta() {
    escena.classList.remove('play');
    temporizador = setTimeout(() => {
      escena.classList.add('play');
      temporizador = setTimeout(vuelta, MOSTRAR);
    }, PAUSA);
  }

  /* Solo gira mientras al menos un 30% del teléfono está en pantalla: fuera
     de vista no gasta batería, y al volver arranca desde el principio.
     isIntersecting no alcanza: sigue en true al bajar del 30%, y reiniciaría
     la animación en vez de pausarla. */
  new IntersectionObserver(([entrada]) => {
    clearTimeout(temporizador);
    if (entrada.intersectionRatio >= 0.3) vuelta();
  }, { threshold: [0, 0.3] }).observe(escena);
})();
