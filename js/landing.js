/* Landing (index.html): el simulador de precio y las animaciones.

   Todo es mejora progresiva. Sin este archivo la página se ve completa: la
   caja ya abierta, el teléfono con la caja armada y el simulador mostrando su
   ejemplo inicial. Con "reducir movimiento" activado en el sistema, el
   simulador funciona pero nada se mueve. */

const lempiras = n => 'L ' + Math.round(n).toLocaleString('en-US');

/* ============================ Simulador ============================
   "Hacé la cuenta": el mismo cálculo que hace la app con una caja real,
   reducido a un solo producto para que se entienda de un vistazo. */
(() => {
  const $ = id => document.getElementById(id);
  const form = $('sim');
  if (!form) return;

  const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const enPantalla = new Map();                  // último valor mostrado de cada número

  /* Los números corren hasta el valor nuevo en vez de saltar. */
  function mostrar(el, destino) {
    const desde = enPantalla.has(el) ? enPantalla.get(el) : destino;
    enPantalla.set(el, destino);
    cancelAnimationFrame(el._cuadro);
    if (quieto || desde === destino) { el.textContent = lempiras(destino); return; }

    const inicio = performance.now();
    const paso = ahora => {
      const t = Math.min((ahora - inicio) / 380, 1);
      const suave = 1 - Math.pow(1 - t, 3);
      el.textContent = lempiras(desde + (destino - desde) * suave);
      if (t < 1) el._cuadro = requestAnimationFrame(paso);
    };
    el._cuadro = requestAnimationFrame(paso);
  }

  /* Pinta la parte recorrida de cada control deslizable. */
  function pintar(rango) {
    const p = (rango.value - rango.min) / (rango.max - rango.min) * 100;
    rango.style.setProperty('--p', p + '%');
  }

  function calcular() {
    const usd = Number($('sUsd').value);
    const gastos = Number($('sGastos').value) / 100;
    const margen = Number($('sMargen').value) / 100;
    const tc = parseFloat($('sTc').value) > 0 ? parseFloat($('sTc').value) : 24.65;
    const aOjo = parseFloat($('sOjo').value);

    const producto = usd * tc;                   // lo que costó en USA, en lempiras
    const traer = producto * gastos;             // su parte del flete y la aduana
    const costo = producto + traer;
    const ganancia = costo * margen;
    const precio = costo + ganancia;

    $('oUsd').textContent = '$' + usd;
    $('oGastos').textContent = Math.round(gastos * 100) + '%';
    $('oMargen').textContent = Math.round(margen * 100) + '%';
    form.querySelectorAll('input[type="range"]').forEach(pintar);

    mostrar($('rPrecio'), precio);
    mostrar($('rCosto'), costo);
    mostrar($('lUsa'), producto);
    mostrar($('lTraer'), traer);
    mostrar($('lGan'), ganancia);

    $('bUsa').style.width = (producto / precio * 100) + '%';
    $('bTraer').style.width = (traer / precio * 100) + '%';
    $('bGan').style.width = (ganancia / precio * 100) + '%';

    /* Lo que le pasa al precio que pondría "a ojo". */
    const veredicto = $('rVeredicto');
    // NaN (el campo vacío) también cuenta como "sin precio a ojo".
    if (!Number.isFinite(aOjo) || aOjo <= 0) {
      veredicto.className = 'sim-veredicto';
      return;
    }
    if (aOjo < costo) {
      veredicto.className = 'sim-veredicto visible mala';
      veredicto.innerHTML = `A ${lempiras(aOjo)} estarías <b>perdiendo ${lempiras(costo - aOjo)}</b> en cada uno.`;
    } else if (aOjo < precio) {
      veredicto.className = 'sim-veredicto visible regular';
      veredicto.innerHTML = `A ${lempiras(aOjo)} ganás ${lempiras(aOjo - costo)}, pero menos del ${Math.round(margen * 100)}% que querés.`;
    } else {
      veredicto.className = 'sim-veredicto visible buena';
      veredicto.innerHTML = `A ${lempiras(aOjo)} ganás <b>${lempiras(aOjo - costo)}</b> en cada uno.`;
    }
  }

  form.addEventListener('input', calcular);
  form.addEventListener('submit', e => e.preventDefault());
  calcular();
})();

/* ============================ Animaciones ============================
   Las clases que esconden cosas (.revelado-activo, .anima) y la que cierra la
   caja las pone este bloque, y solo cuando va a poder mostrarlas. */
(() => {
  const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (quieto || !('IntersectionObserver' in window)) return;

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

  /* ===== La caja 3D: llega cerrada, se abre y salen los productos ===== */
  const caja = document.getElementById('cajaEscena');
  if (caja) {
    const cubo = caja.querySelector('.caja3d');
    let espera = null;

    const abrir = demora => {
      clearTimeout(espera);
      caja.classList.remove('abierta');
      espera = setTimeout(() => caja.classList.add('abierta'), demora);
    };
    abrir(700);

    /* Tocarla la vuelve a abrir. Es un botón solo cuando hay animación. */
    caja.setAttribute('role', 'button');
    caja.setAttribute('aria-label', 'Volver a abrir la caja');
    caja.removeAttribute('aria-hidden');
    caja.tabIndex = 0;
    caja.addEventListener('click', () => abrir(750));
    caja.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(750); }
    });

    /* Con mouse, la caja gira un poco siguiendo el puntero. */
    if (window.matchMedia('(pointer: fine)').matches) {
      const zona = document.querySelector('.portada');
      let cuadro = 0;
      zona.addEventListener('pointermove', e => {
        cancelAnimationFrame(cuadro);
        cuadro = requestAnimationFrame(() => {
          const r = zona.getBoundingClientRect();
          const dx = (e.clientX - r.left) / r.width * 2 - 1;     // -1 izquierda … 1 derecha
          const dy = (e.clientY - r.top) / r.height * 2 - 1;     // -1 arriba … 1 abajo
          cubo.style.setProperty('--ry', (-38 + dx * 16) + 'deg');
          cubo.style.setProperty('--rx', (-22 - dy * 8) + 'deg');
        });
      });
      zona.addEventListener('pointerleave', () => {
        cubo.style.removeProperty('--ry');
        cubo.style.removeProperty('--rx');
      });
    }
  }

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

/* PWA: la landing también registra el service worker, así la app se puede
   instalar desde la primera página y abre sin internet. Solo por http(s). */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
