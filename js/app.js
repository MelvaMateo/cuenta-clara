/* Cuenta Clara — cajas, stock, fiados y resumen.
   Los datos viven en Supabase (ver datos.js); esta capa es solo la pantalla. */

/* ===== Sesión (ver sesion.js) ===== */
let sesion = null;

async function salir() {
  await Sesion.cerrar();
  location.replace('login.html');
}

/* ===== Formatos ===== */
const miles = (n, dec = 2) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmt = n => 'L ' + miles(n);                  // L 11,955.25
const fmt0 = n => 'L ' + miles(Math.round(n), 0);  // L 11,955 (para los indicadores)
const usd = n => '$' + miles(n);
const pct = n => Math.round(Number(n) * 100) + '%';
const pct1 = n => (Math.round(Number(n) * 1000) / 10) + '%';     // 0.025 → "2.5%"
const monto = (v, moneda) => (moneda === 'USD' ? usd(v) : fmt(v));
const entero = n => String(Math.round(n));

/* Lo que se escribe en un cuadro de diálogo llega como texto: "150", "150.50",
   "150,50", "L 1,200". Se lee siempre igual: con coma y punto, la coma separa
   miles; con solo coma, separa miles si le siguen grupos de tres cifras y, si
   no, es el decimal. Lo que no se entiende da NaN y la operación no sigue. */
function leerNumero(texto) {
  let s = String(texto ?? '').trim().replace(/^(L|\$)\s*/i, '').replace(/\s/g, '');
  if (s.includes('.') && s.includes(',')) s = s.replace(/,/g, '');
  else if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}
const leerMonto = texto => Math.round(leerNumero(texto) * 100) / 100;       // a centavos, como la base
const leerEntero = texto => { const n = leerNumero(texto); return Number.isInteger(n) ? n : NaN; };

/* Los nombres los escribe la usuaria: se escapan antes de meterlos en el HTML,
   o un "<" en el nombre de un producto rompería la tarjeta. */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const esEscritorio = () => window.matchMedia('(min-width: 960px)').matches;

/* Copia en memoria de lo último que devolvió la base. */
let cajas = [];
let productos = [];
let fiados = [];
let fotoPendiente = null;                       // ruta en Storage de la foto ya subida
let filtroStock = 'todos';
let filtroFiados = 'todos';

/* Traduce los errores de Supabase a algo que diga qué hacer. Un mensaje como
   "relation public.productos does not exist" no le sirve a nadie. */
function mensajeDe(error) {
  const codigo = error.code || '';
  /* Va primero: su mensaje también dice "schema cache" y se confundiría con
     que faltan las tablas, cuando lo que falta es correr la migración. */
  if (codigo === 'PGRST204' || /column .* does not exist/i.test(error.message)) {
    return 'La base tiene una estructura anterior: corré en orden los scripts de sql/, del 01 al 06.';
  }
  if (codigo === '42P01' || codigo === 'PGRST205' || /schema cache|does not exist/i.test(error.message)) {
    return 'Faltan las tablas en Supabase: corré en orden los scripts de sql/, del 01 al 06.';
  }
  if (codigo === '42883' || codigo === 'PGRST202') {
    return 'Falta una función de la base (o es de una versión anterior): corré sql/05_calculos.sql en el SQL Editor.';
  }
  if (codigo === '42501') return 'La base rechazó la operación por permisos (RLS).';
  if (/bucket not found/i.test(error.message)) {
    return 'Falta el bucket de fotos: corré sql/06_fotos.sql en el SQL Editor.';
  }
  if (/failed to fetch|networkerror/i.test(error.message)) return 'Sin conexión con Supabase.';
  return error.message;
}

/* Avisos: una tarjetita que aparece abajo y se va sola. Antes estaba arriba de
   todo y no se veía al guardar desde el final de un formulario largo. */
function avisar(msg, tipo = 'error') {
  const t = document.getElementById('aviso');
  t.replaceChildren();
  const ico = document.createElement('span');
  ico.className = 'toast-ico';
  ico.textContent = tipo === 'ok' ? '✓' : '!';
  const texto = document.createElement('span');
  texto.textContent = msg;
  t.append(ico, texto);
  t.className = `toast ${tipo} visible`;
  clearTimeout(avisar._t);
  avisar._t = setTimeout(() => t.classList.remove('visible'), tipo === 'ok' ? 2800 : 7000);
}

/* Los números corren hasta su valor en vez de aparecer de golpe. */
function contar(el, destino, formato) {
  const desde = el.dataset.valor === undefined ? 0 : Number(el.dataset.valor);
  el.dataset.valor = destino;
  cancelAnimationFrame(el._cuadro);
  if (quieto || desde === destino) { el.textContent = formato(destino); return; }
  const inicio = performance.now();
  const paso = ahora => {
    const t = Math.min((ahora - inicio) / 700, 1);
    const suave = 1 - Math.pow(1 - t, 3);
    el.textContent = formato(desde + (destino - desde) * suave);
    if (t < 1) el._cuadro = requestAnimationFrame(paso);
  };
  el._cuadro = requestAnimationFrame(paso);
}

/* Fila de indicadores de cada pestaña. */
function pintarKpis(contId, items) {
  const cont = document.getElementById(contId);
  cont.innerHTML = items.map(k => `<div class="kpi ${k.tono || ''}">
      <span class="kpi-ico">${k.ico}</span>
      <b class="kpi-val">0</b>
      <span class="kpi-lbl">${k.lbl}</span>
      ${k.nota ? `<span class="kpi-nota">${k.nota}</span>` : ''}
    </div>`).join('');
  cont.querySelectorAll('.kpi-val').forEach((el, i) => contar(el, items[i].valor, items[i].formato || entero));
}

function vacio(ico, titulo, texto, panel, boton) {
  return `<div class="vacio">
    <span class="vacio-ico">${ico}</span>
    <b>${titulo}</b>
    <p>${texto}</p>
    ${panel ? `<button class="btn-nuevo" onclick="alternarPanel('${panel}', true)"><b>+</b><span>${boton}</span></button>` : ''}
  </div>`;
}

/* ===== Navegación ===== */
function showTab(id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tabbtn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === id);
    b.setAttribute('aria-current', b.dataset.tab === id ? 'page' : 'false');
  });
  document.getElementById(id).classList.add('active');
  if (id === 'resumen') renderResumen();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

/* Los formularios se pliegan detrás de su botón "+ Nuevo…". Cerrados quedan
   inert: no se puede llegar a sus campos con el teclado. */
function alternarPanel(id, abrir) {
  const panel = document.getElementById(id);
  const abierto = abrir ?? !panel.classList.contains('abierto');
  panel.classList.toggle('abierto', abierto);
  panel.inert = !abierto;
  panel.parentElement.classList.toggle('con-form', abierto);
  document.querySelectorAll(`[data-abre="${id}"]`).forEach(b => {
    b.classList.toggle('activo', abierto);
    b.querySelector('span').textContent = abierto ? 'Cerrar' : b.dataset.etiqueta;
  });
}

/* ============================ Cajas ============================ */

async function addCaja(e) {
  e.preventDefault();
  const f = e.target;
  const descripcion = f.descripcion.value.trim();
  const tipoCambio = parseFloat(f.tipoCambio.value);
  if (!descripcion || !(tipoCambio > 0)) {
    avisar('Falta el nombre de la caja o el tipo de cambio.');
    return;
  }
  const colchon = parseFloat(f.colchon.value) || 0;
  if (colchon < 0 || colchon > 50) {
    avisar('El colchón tiene que estar entre 0 y 50%.');
    return;
  }
  const boton = f.querySelector('button[type="submit"]');
  boton.disabled = true;
  try {
    const caja = {
      descripcion,
      fecha: f.fecha.value || null,
      lote: parseFloat(f.lote.value) || 0,
      loteMoneda: f.loteMoneda.value,
      flete: parseFloat(f.flete.value) || 0,
      fleteMoneda: f.fleteMoneda.value,
      aduana: parseFloat(f.aduana.value) || 0,
      aduanaMoneda: f.aduanaMoneda.value,
      otros: parseFloat(f.otros.value) || 0,
      otrosMoneda: f.otrosMoneda.value,
      tipoCambio,
      margen: (parseFloat(f.margen.value) || 0) / 100,
      colchon: colchon / 100,
    };
    await Claves.con(['caja', { ...caja, descripcion: Claves.texto(descripcion) }, cajas.length],
      clave => Datos.agregarCaja(clave, caja));
    f.reset();                                   // vuelve a 40% de ganancia y 3% de colchón
    if (!esEscritorio()) alternarPanel('panelCaja', false);
    avisar(`Caja "${descripcion}" guardada`, 'ok');
    await cargarCajas();
  } catch (error) {
    avisar('No se pudo guardar la caja: ' + mensajeDe(error));
  } finally {
    boton.disabled = false;
  }
}

async function cargarCajas() {
  try {
    cajas = await Datos.cajas();
  } catch (error) {
    avisar('No se pudieron leer las cajas: ' + mensajeDe(error));
    return;
  }
  renderCajas();
  llenarSelectCajas();
  if (document.getElementById('resumen').classList.contains('active')) renderResumen();
}

function renderCajas() {
  const invertido = cajas.reduce((a, c) => a + Number(c.invertido), 0);
  const vendido = cajas.reduce((a, c) => a + Number(c.vendido), 0);
  const ganancia = cajas.reduce((a, c) => a + Number(c.ganancia_proyectada), 0);
  pintarKpis('kpisCajas', [
    { ico: '📦', lbl: 'Cajas', valor: cajas.length },
    { ico: '💸', lbl: 'Invertiste', valor: invertido, formato: fmt0 },
    { ico: '💰', lbl: 'Recuperado', valor: vendido, formato: fmt0,
      nota: invertido > 0 ? pct(Math.min(vendido / invertido, 1)) : '' },
    { ico: '📈', lbl: 'Ganás si vendés todo', valor: ganancia, formato: fmt0,
      tono: ganancia < 0 ? 'malo' : 'bueno' },
  ]);

  const cont = document.getElementById('listaCajas');
  cont.classList.add('animar');
  if (cajas.length === 0) {
    cont.innerHTML = vacio('📦', 'Todavía no registraste ninguna caja',
      'Empezá cargando lo que pagaste por la última caja que trajiste.', 'panelCaja', 'Registrar caja');
    return;
  }
  cont.innerHTML = cajas.map((c, i) => {
    const invertidoC = Number(c.invertido);
    const vendidoC = Number(c.vendido);
    const recuperado = invertidoC > 0 ? Math.min(vendidoC / invertidoC, 1) : 0;
    const gananciaC = Number(c.ganancia_proyectada);
    const listo = invertidoC > 0 && vendidoC >= invertidoC;
    const encarece = Math.round((Number(c.factor) - 1) * 100);
    const fecha = new Date(c.fecha + 'T12:00:00')
      .toLocaleDateString('es-HN', { day: 'numeric', month: 'short', year: 'numeric' });
    const costos = [
      ['Lote', monto(c.lote, c.lote_moneda)],
      ['Tiendas', usd(c.tienda_usd)],
      ...[['Flete', c.flete, c.flete_moneda], ['Aduana', c.aduana, c.aduana_moneda], ['Otros', c.otros, c.otros_moneda]]
        .filter(([, valor]) => Number(valor) > 0)
        .map(([nombre, valor, moneda]) => [nombre, monto(valor, moneda)]),
    ];

    return `<article class="tarjeta caja-card ${listo ? 'recuperada' : ''}" style="--i:${i}">
      <div class="caja-cab">
        <div class="caja-ico">📦</div>
        <div class="caja-tit">
          <strong>${esc(c.descripcion)}</strong>
          <span>${fecha} · dólar a ${Number(c.tipo_cambio).toFixed(2)}, guardado con esta caja</span>
        </div>
        <span class="estado ${listo ? 'ok' : 'curso'}">${listo ? 'Recuperada' : 'En curso'}</span>
      </div>

      <div class="caja-progreso">
        <div class="anillo" style="--p:${Math.round(recuperado * 100)}"><span>${pct(recuperado)}</span></div>
        <div class="caja-prog-txt">
          <span class="muted">Recuperado</span><br>
          <b>${fmt(vendidoC)}</b> <span class="muted">de ${fmt(invertidoC)}</span>
          ${listo
            ? '<p class="ok-msg">Ya recuperaste esta caja: lo que vendas ahora es ganancia.</p>'
            : `<p class="pendiente">Te faltan <b>${fmt(c.falta_recuperar)}</b> para recuperar lo que invertiste.</p>`}
        </div>
      </div>

      <div class="chips-costos">
        ${costos.map(([n, v]) => `<span class="chip-costo"><i>${n}</i>${v}</span>`).join('')}
        <span class="chip-costo total"><i>Invertiste</i>${fmt(invertidoC)}</span>
      </div>

      <p class="factor">Traerla te encarece la mercadería un <b>${encarece}%</b>
         — cada $1 de producto te llega costando ${usd(c.factor)}</p>

      <div class="proyeccion ${gananciaC >= 0 ? '' : 'mala'}">
        Si vendés todo a los precios que pusiste:
        <b>${gananciaC >= 0 ? 'ganás ' : 'perdés '}${fmt(Math.abs(gananciaC))}</b>
        ${invertidoC > 0 ? `(${Math.round(gananciaC / invertidoC * 100)}%)` : ''}
      </div>

      <div class="caja-pie">
        <div class="colchon">
          <span>🛡️ Colchón por el dólar: <b>${pct1(c.colchon)}</b></span>
          <button class="mini secundario" onclick="cambiarColchon('${c.id}')">Cambiar</button>
        </div>
        <span class="muted">${c.productos} productos · quedan ${c.en_stock} de ${c.unidades}</span>
      </div>
    </article>`;
  }).join('');
}

/* El colchón sube los precios sugeridos de lo pagado en dólares, por si el
   dólar está más caro cuando toque reponer. No toca el costo ni los precios
   que ya puso: esos los cambia ella, producto por producto. */
async function cambiarColchon(id) {
  const c = cajas.find(x => x.id === id);
  if (!c) return;
  const texto = prompt(
    `${c.descripcion}\n\nColchón por el dólar, en %.\n` +
    `Sube los precios sugeridos por si el dólar está más caro cuando vuelvas a comprar.\n` +
    `No cambia lo que te costó la caja ni los precios que ya pusiste.`,
    String(Math.round(Number(c.colchon) * 1000) / 10));
  if (texto === null) return;
  const valor = leerNumero(texto);
  if (!(valor >= 0 && valor <= 50)) { avisar('El colchón tiene que estar entre 0 y 50%.'); return; }
  try {
    await Datos.cambiarColchon(id, valor / 100);
    avisar(`Colchón de "${c.descripcion}" en ${valor}%`, 'ok');
    await Promise.all([cargarCajas(), cargarProductos()]);
  } catch (error) {
    avisar('No se pudo cambiar el colchón: ' + mensajeDe(error));
  }
}

function llenarSelectCajas() {
  const sel = document.getElementById('selCaja');
  const elegida = sel.value;
  sel.innerHTML = cajas.length
    ? cajas.map(c => `<option value="${c.id}">${esc(c.descripcion)}</option>`).join('')
    : '<option value="">Registrá una caja primero</option>';
  if (elegida) sel.value = elegida;
  calcularSugerido();
}

/* ============================ Stock ============================ */

/* Precio sugerido en vivo, mientras carga el producto: es el momento en que
   decide cuánto cobrar, y hoy lo hace sin saber lo que le costó traerlo.
   Para lo del lote es aproximado y se reacomoda al cargar más productos;
   para lo de tienda es exacto. */
function calcularSugerido() {
  const caja = cajas.find(c => c.id === document.getElementById('selCaja').value);
  const origen = document.getElementById('selOrigen').value;
  const valor = parseFloat(document.getElementById('inpValor').value);
  const precio = parseFloat(document.getElementById('inpPrecio').value);
  const cont = document.getElementById('sugerencia');

  if (!caja || !(valor > 0)) { cont.className = 'sugerencia'; cont.textContent = ''; return; }

  /* El mismo cálculo que la vista productos_costeados (sql/05_calculos.sql):
     k ya viene en lempiras por dólar estimado; lo de tienda se convierte con
     el dólar de la caja. El colchón solo pesa sobre la parte pagada en dólares. */
  const base = origen === 'lote' ? valor * Number(caja.k) : valor * Number(caja.tipo_cambio);
  const costo = base * Number(caja.factor);
  const sugerido = costo * (1 + Number(caja.colchon) * Number(caja.parte_usd))
                         * (1 + Number(caja.margen_deseado));

  if (origen === 'lote' && !(Number(caja.k) > 0)) {
    cont.className = 'sugerencia';
    cont.innerHTML = `Guardá este producto y la app repartirá el costo del lote.`;
    return;
  }

  const conColchon = Number(caja.colchon) > 0 ? ` con ${pct1(caja.colchon)} de colchón` : '';
  let clase = 'sugerencia visible', msg =
    `Te cuesta <b>${fmt(costo)}</b> · para ganar ${pct(caja.margen_deseado)}${conColchon} vendelo a <b>${fmt(sugerido)}</b>`;

  if (precio > 0 && precio < costo) {
    clase += ' perdida';
    msg += `<br>⚠ A ${fmt(precio)} estarías <b>perdiendo ${fmt(costo - precio)}</b> por unidad.`;
  } else if (precio > 0 && precio < sugerido) {
    clase += ' bajo';
    msg += `<br>A ${fmt(precio)} ganás, pero menos de lo que te propusiste.`;
  }
  cont.className = clase;
  cont.innerHTML = msg;
}

/* La etiqueta del valor cambia según el origen: no es lo mismo un costo real
   que una estimación, y confundirlos arruinaría el cálculo. */
function ajustarOrigen() {
  const esLote = document.getElementById('selOrigen').value === 'lote';
  document.getElementById('lblValor').firstChild.textContent =
    esLote ? 'Valor estimado en US$ ' : 'Lo que pagaste en US$ ';
  document.getElementById('notaOrigen').textContent = esLote
    ? 'Si no sabés cuánto costó, poné lo que creés que vale. Solo importa que esté bien en proporción a los demás: el total siempre queda anclado a lo que pagaste por el lote.'
    : 'Poné el costo exacto del recibo, sin flete ni aduana: eso lo suma la app.';
  calcularSugerido();
}

async function elegirFoto(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  /* Se vacía para que elegir la misma foto otra vez, por ejemplo después de un
     corte, vuelva a disparar el cambio: si no, el navegador no avisa nada. */
  e.target.value = '';
  const vista = document.getElementById('vistaFoto');
  const etiqueta = document.querySelector('.foto-boton');
  etiqueta.textContent = '⏳ Subiendo foto...';
  try {
    fotoPendiente = await Datos.subirFoto(file, sesion.user.id);
    vista.src = Datos.urlFoto(fotoPendiente);
    vista.classList.add('visible');
    etiqueta.textContent = '📷 Cambiar la foto';
  } catch (error) {
    fotoPendiente = null;
    etiqueta.textContent = '📷 Tomar o elegir una foto';
    avisar('No se pudo subir la foto: ' + mensajeDe(error));
  }
}

async function addProducto(e) {
  e.preventDefault();
  const f = e.target;
  const nombre = f.nombre.value.trim();
  const valorUsd = parseFloat(f.valorUsd.value);
  const cantidad = parseInt(f.cantidad.value);
  if (!f.cajaId.value) { avisar('Elegí de qué caja salió el producto.'); return; }
  if (!nombre || !(valorUsd >= 0) || !(cantidad > 0)) {
    avisar('Falta el nombre, el valor o la cantidad.');
    return;
  }
  const boton = f.querySelector('button[type="submit"]');
  boton.disabled = true;
  try {
    const producto = {
      cajaId: f.cajaId.value,
      nombre,
      origen: f.origen.value,
      valorUsd,
      cantidad,
      stockMinimo: parseInt(f.stockMinimo.value) || 0,
      precio: parseFloat(f.precio.value) || 0,
      fotoPath: fotoPendiente,
    };
    await Claves.con(['producto', { ...producto, nombre: Claves.texto(nombre) }, productos.length],
      clave => Datos.agregarProducto(clave, producto));
    const caja = f.cajaId.value;
    f.reset();
    f.cajaId.value = caja;                       // suele cargar varios de la misma caja seguidos
    fotoPendiente = null;
    document.getElementById('vistaFoto').classList.remove('visible');
    document.querySelector('.foto-boton').textContent = '📷 Tomar o elegir una foto';
    document.getElementById('sugerencia').className = 'sugerencia';
    avisar(`"${nombre}" agregado al stock`, 'ok');
    await Promise.all([cargarProductos(), cargarCajas()]);   // la caja cambia al sumar producto
  } catch (error) {
    avisar('No se pudo guardar el producto: ' + mensajeDe(error));
  } finally {
    boton.disabled = false;
  }
}

async function venderProducto(id) {
  const p = productos.find(x => x.id === id);
  if (!p) return;
  const texto = prompt(`¿Cuántas unidades de "${p.nombre}" vendiste?`, '1');
  if (texto === null) return;
  const cant = leerEntero(texto);
  if (!(cant > 0)) { avisar('La cantidad tiene que ser un número entero mayor que cero.'); return; }
  try {
    await Claves.con(['vender', id, cant, p.stock],
      clave => Datos.venderProducto(clave, id, cant));
    avisar(`Vendiste ${cant} × ${p.nombre}`, 'ok');
    await Promise.all([cargarProductos(), cargarCajas()]);
  } catch (error) {
    avisar(mensajeDe(error));                   // "No hay suficiente stock"
  }
}

async function cambiarPrecio(id) {
  const p = productos.find(x => x.id === id);
  if (!p) return;
  const texto = prompt(
    `${p.nombre}\nTe cuesta ${fmt(p.costo_unitario)}\nSugerido: ${fmt(p.precio_sugerido)}\n\nNuevo precio:`,
    p.precio);
  if (texto === null) return;
  const nuevo = leerMonto(texto);
  if (!(nuevo >= 0)) { avisar('Escribí el precio como un número, por ejemplo 150.50.'); return; }
  try {
    await Datos.cambiarPrecio(id, nuevo);
    avisar(`Precio de "${p.nombre}": ${fmt(nuevo)}`, 'ok');
    await Promise.all([cargarProductos(), cargarCajas()]);
  } catch (error) {
    avisar('No se pudo cambiar el precio: ' + mensajeDe(error));
  }
}

async function cargarProductos() {
  try {
    productos = await Datos.productos();
  } catch (error) {
    avisar('No se pudo leer el inventario: ' + mensajeDe(error));
    return;
  }
  const bajos = productos.filter(esBajo).length;
  const perdiendo = productos.filter(conPerdida).length;
  pintarKpis('kpisStock', [
    { ico: '🏷️', lbl: 'Productos', valor: productos.length },
    { ico: '📦', lbl: 'Unidades en stock', valor: productos.reduce((a, p) => a + Number(p.stock), 0) },
    { ico: '🔔', lbl: 'Bajo stock', valor: bajos, tono: bajos ? 'aviso' : '' },
    { ico: '⚠️', lbl: 'Con pérdida', valor: perdiendo, tono: perdiendo ? 'malo' : '' },
  ]);
  renderProductos(true);
  if (document.getElementById('resumen').classList.contains('active')) renderResumen();
}

const esBajo = p => p.stock <= p.stock_minimo;
const conPerdida = p => Number(p.precio) > 0 && Number(p.precio) < Number(p.costo_unitario);
const FILTROS_STOCK = { todos: () => true, bajo: esBajo, perdida: conPerdida };

function renderProductos(animar = false) {
  const q = (document.getElementById('buscarProd').value || '').toLowerCase();
  document.querySelectorAll('#filtrosStock .chip').forEach(ch => {
    ch.classList.toggle('activo', ch.dataset.filtro === filtroStock);
    ch.querySelector('span').textContent = productos.filter(FILTROS_STOCK[ch.dataset.filtro]).length;
  });
  const lista = productos
    .filter(FILTROS_STOCK[filtroStock])
    .filter(p => p.nombre.toLowerCase().includes(q));

  const cont = document.getElementById('listaProductos');
  cont.classList.toggle('animar', animar);
  if (productos.length === 0) {
    cont.innerHTML = cajas.length
      ? vacio('🏷️', 'Todavía no cargaste productos', 'Agregá lo que vino en tu caja: la app te dice a cuánto venderlo.', 'panelProducto', 'Agregar producto')
      : vacio('📦', 'Primero registrá una caja', 'Los productos se cargan dentro de la caja en la que llegaron.', null);
    return;
  }
  if (lista.length === 0) {
    cont.innerHTML = vacio('🔍', 'Nada coincide', 'Probá con otra búsqueda u otro filtro.', null);
    return;
  }
  cont.innerHTML = lista.map((p, i) => {
    const bajo = esBajo(p);
    const perdida = conPerdida(p);
    const costo = Number(p.costo_unitario);
    const precio = Number(p.precio);
    const margen = precio > 0 && costo > 0 ? (precio - costo) / costo : null;
    const foto = Datos.urlFoto(p.foto_path);
    const quedan = Number(p.cantidad) > 0 ? Math.min(p.stock / p.cantidad, 1) * 100 : 0;
    return `<article class="tarjeta prod-card ${perdida ? 'perdida' : bajo ? 'bajo' : ''}" style="--i:${i}">
      <div class="prod-foto">${foto ? `<img src="${foto}" alt="">` : '📦'}</div>
      <div class="prod-info">
        <div class="prod-cab">
          <strong>${esc(p.nombre)}</strong>
          ${margen === null
            ? '<span class="margen sin">sin precio</span>'
            : `<span class="margen ${margen >= 0 ? 'pos' : 'neg'}">${margen >= 0 ? '+' : ''}${Math.round(margen * 100)}%</span>`}
        </div>
        <div class="prod-sub">${esc(p.caja)} · <span class="origen">${p.origen === 'lote' ? 'del lote' : 'de tienda'}</span></div>

        <div class="prod-precios">
          <div><span>Costo</span><b>${fmt(costo)}</b></div>
          <div><span>Precio</span><b>${fmt(precio)}</b></div>
          <div><span>Sugerido</span><b>${fmt(p.precio_sugerido)}</b></div>
        </div>

        <div class="stock-linea">
          <div class="barrita ${bajo ? 'roja' : ''}"><i style="width:${quedan.toFixed(0)}%"></i></div>
          <span class="${bajo ? 'rojo' : ''}">Quedan ${p.stock} de ${p.cantidad}${bajo ? ' · reponer' : ''}</span>
        </div>

        ${perdida ? `<div class="marca-perdida">⚠ Perdés ${fmt(costo - precio)} en cada uno. Sugerido: ${fmt(p.precio_sugerido)}</div>` : ''}

        <div class="acciones-card">
          <button class="mini" onclick="venderProducto('${p.id}')">Vender</button>
          <button class="mini secundario" onclick="cambiarPrecio('${p.id}')">Cambiar precio</button>
        </div>
      </div>
    </article>`;
  }).join('');
}

/* ============================ Fiados ============================ */

async function addFiado(e) {
  e.preventDefault();
  const f = e.target;
  const clienta = f.clienta.value.trim();
  const monto = parseFloat(f.monto.value);
  if (!clienta || isNaN(monto) || monto <= 0) {
    avisar('Falta el nombre o un monto válido.');
    return;
  }
  const boton = f.querySelector('button[type="submit"]');
  boton.disabled = true;
  try {
    const descripcion = f.descripcion.value.trim();
    await Claves.con(['fiado', Claves.texto(clienta), Claves.texto(descripcion), monto, fiados.length],
      clave => Datos.agregarFiado(clave, { clienta, descripcion, monto }));
    f.reset();
    if (!esEscritorio()) alternarPanel('panelFiado', false);
    avisar(`Fiado de ${clienta} por ${fmt(monto)} anotado`, 'ok');
    await cargarFiados();
  } catch (error) {
    avisar('No se pudo guardar el fiado: ' + mensajeDe(error));
  } finally {
    boton.disabled = false;
  }
}

async function abonar(id) {
  const fi = fiados.find(x => x.id === id);
  if (!fi) return;
  const texto = prompt(`Saldo de ${fi.clienta}: ${fmt(fi.saldo)}\n¿Cuánto abona?`, '');
  if (texto === null) return;
  const m = leerMonto(texto);
  if (!(m > 0)) { avisar('Escribí el abono como un número mayor que cero, por ejemplo 150.50.'); return; }
  if (m > Number(fi.saldo)) { avisar('El abono no puede ser mayor al saldo.'); return; }
  try {
    const saldo = await Claves.con(['abono', id, m, fi.saldo],
      clave => Datos.abonar(clave, id, m));
    avisar(saldo <= 0 ? `${fi.clienta} terminó de pagar 🎉` : `Abono de ${fmt(m)} registrado`, 'ok');
    await cargarFiados();
  } catch (error) {
    avisar('No se pudo registrar el abono: ' + mensajeDe(error));
  }
}

async function cargarFiados() {
  try {
    fiados = await Datos.fiados();
  } catch (error) {
    avisar('No se pudieron leer los fiados: ' + mensajeDe(error));
    return;
  }
  const pendientes = fiados.filter(f => Number(f.saldo) > 0);
  pintarKpis('kpisFiados', [
    { ico: '🧾', lbl: 'Por cobrar', valor: fiados.reduce((a, f) => a + Number(f.saldo), 0), formato: fmt0, tono: 'destacado' },
    { ico: '👥', lbl: 'Te deben', valor: pendientes.length },
    { ico: '✅', lbl: 'Pagados', valor: fiados.length - pendientes.length },
    { ico: '💵', lbl: 'Ya cobrado', valor: fiados.reduce((a, f) => a + Number(f.abonado), 0), formato: fmt0 },
  ]);
  renderFiados(true);
  if (document.getElementById('resumen').classList.contains('active')) renderResumen();
}

const FILTROS_FIADOS = {
  todos: () => true,
  pendientes: f => Number(f.saldo) > 0,
  pagados: f => Number(f.saldo) <= 0,
};

/* Un color estable por persona, para que su círculo sea siempre el mismo. */
const tonoDe = nombre => [...String(nombre)].reduce((a, c) => a + c.charCodeAt(0), 0) * 37 % 360;
const inicialesDe = nombre => String(nombre).trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();

function renderFiados(animar = false) {
  const q = (document.getElementById('buscarFiado').value || '').toLowerCase();
  document.querySelectorAll('#filtrosFiados .chip').forEach(ch => {
    ch.classList.toggle('activo', ch.dataset.filtro === filtroFiados);
    ch.querySelector('span').textContent = fiados.filter(FILTROS_FIADOS[ch.dataset.filtro]).length;
  });
  const lista = fiados
    .filter(FILTROS_FIADOS[filtroFiados])
    .filter(f => (f.clienta || '').toLowerCase().includes(q));

  const cont = document.getElementById('listaFiados');
  cont.classList.toggle('animar', animar);
  if (fiados.length === 0) {
    cont.innerHTML = vacio('🤝', 'Nadie te debe nada', 'Cuando fíes algo, anotalo acá y llevá la cuenta de los abonos.', 'panelFiado', 'Anotar fiado');
    return;
  }
  if (lista.length === 0) {
    cont.innerHTML = filtroFiados === 'pendientes'
      ? vacio('🎉', 'Nadie te debe nada', 'Todos los fiados están pagados.', null)
      : vacio('🔍', 'Nada coincide', 'Probá con otro nombre u otro filtro.', null);
    return;
  }
  cont.innerHTML = lista.map((f, i) => {
    const pagado = Number(f.saldo) <= 0;
    const avance = Number(f.total) > 0 ? Math.min(Number(f.abonado) / Number(f.total), 1) * 100 : 0;
    const fecha = new Date(f.fecha).toLocaleDateString('es-HN', { day: 'numeric', month: 'short' });
    return `<article class="tarjeta fiado-card ${pagado ? 'pagado' : ''}" style="--i:${i}">
      <span class="avatar-cli" style="--h:${tonoDe(f.clienta)}">${esc(inicialesDe(f.clienta))}</span>
      <div class="fiado-info">
        <div class="fiado-cab">
          <strong>${esc(f.clienta)}</strong>
          <span class="pill ${pagado ? 'pill-verde' : 'pill-rojo'}">${pagado ? 'PAGADO' : fmt(f.saldo)}</span>
        </div>
        <div class="fiado-sub">${esc(f.descripcion) || '—'} · ${fecha}</div>
        <div class="barrita ${pagado ? 'verde' : ''}"><i style="width:${avance.toFixed(0)}%"></i></div>
        <div class="muted">Abonó ${fmt(f.abonado)} de ${fmt(f.total)}</div>
        ${pagado ? '' : `<div class="acciones-card"><button class="mini" onclick="abonar('${f.id}')">Registrar abono</button></div>`}
      </div>
    </article>`;
  }).join('');
}

/* ============================ Resumen ============================ */

function renderResumen() {
  const porCobrar = fiados.reduce((a, f) => a + Number(f.saldo), 0);
  const bajos = productos.filter(esBajo);
  /* Lo que queda por vender, a precio de venta: es lo que le importa cobrar,
     no un valor al costo. */
  const porVender = productos.reduce((a, p) => a + p.stock * Number(p.precio), 0);
  contar(document.getElementById('rPorCobrar'), porCobrar, fmt0);
  contar(document.getElementById('rPorVender'), porVender, fmt0);
  contar(document.getElementById('rBajoStock'), bajos.length, entero);
  contar(document.getElementById('rProductos'), productos.length, entero);

  const perdiendo = productos.filter(conPerdida);
  const alerta = document.getElementById('alertaPerdida');
  alerta.className = perdiendo.length ? 'alerta-perdida visible' : 'alerta-perdida';
  alerta.innerHTML = perdiendo.length
    ? `<span class="alerta-ico">⚠️</span><div><b>${perdiendo.length} producto${perdiendo.length > 1 ? 's se están' : ' se está'}
         vendiendo por debajo del costo:</b><br>${perdiendo.map(p => esc(p.nombre)).join(', ')}</div>`
    : '';

  document.getElementById('rCajas').innerHTML = cajas.length
    ? cajas.map(c => {
        const inv = Number(c.invertido);
        const r = inv > 0 ? Math.min(Number(c.vendido) / inv, 1) : 0;
        return `<div class="rec">
          <div class="rec-cab"><span>${esc(c.descripcion)}</span><b>${pct(r)}</b></div>
          <div class="barrita ${r >= 1 ? 'verde' : ''}"><i style="width:${(r * 100).toFixed(0)}%"></i></div>
        </div>`;
      }).join('')
    : '<p class="muted">Todavía no hay cajas.</p>';

  document.getElementById('rReponer').innerHTML = bajos.length
    ? bajos.map(p => `<div class="reponer">
        <span>${esc(p.nombre)}</span>
        <span class="pill pill-rojo">quedan ${p.stock}</span>
      </div>`).join('')
    : '<p class="todo-bien">✓ Todo tu stock está por encima del mínimo.</p>';
}

/* ============================ Inicio ============================ */

document.addEventListener('DOMContentLoaded', async () => {
  sesion = await exigirSesion();
  if (!sesion) return;

  const nombre = Sesion.nombreDe(sesion);
  document.getElementById('saludo').textContent = `Hola, ${nombre.split(/\s+/)[0]} 👋`;
  document.getElementById('avatar').textContent = nombre.trim().charAt(0).toUpperCase();
  document.getElementById('fechaHoy').textContent =
    new Date().toLocaleDateString('es-HN', { weekday: 'long', day: 'numeric', month: 'long' });

  document.getElementById('formCaja').addEventListener('submit', addCaja);
  document.getElementById('formProducto').addEventListener('submit', addProducto);
  document.getElementById('formFiado').addEventListener('submit', addFiado);
  document.getElementById('buscarProd').addEventListener('input', () => renderProductos());
  document.getElementById('buscarFiado').addEventListener('input', () => renderFiados());
  document.getElementById('selOrigen').addEventListener('change', ajustarOrigen);
  document.getElementById('selCaja').addEventListener('change', calcularSugerido);
  document.getElementById('inpValor').addEventListener('input', calcularSugerido);
  document.getElementById('inpPrecio').addEventListener('input', calcularSugerido);
  document.getElementById('inpFoto').addEventListener('change', elegirFoto);

  document.querySelectorAll('[data-abre]').forEach(b =>
    b.addEventListener('click', () => alternarPanel(b.dataset.abre)));
  document.getElementById('filtrosStock').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (chip) { filtroStock = chip.dataset.filtro; renderProductos(true); }
  });
  document.getElementById('filtrosFiados').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (chip) { filtroFiados = chip.dataset.filtro; renderFiados(true); }
  });

  /* En computadora los formularios arrancan abiertos, al lado de la lista.
     En el celular, cerrados, salvo que no haya nada cargado todavía. */
  const escritorio = esEscritorio();
  ['panelCaja', 'panelProducto', 'panelFiado'].forEach(id => alternarPanel(id, escritorio));

  await cargarCajas();
  await Promise.all([cargarProductos(), cargarFiados()]);

  if (!escritorio) {
    if (cajas.length === 0) alternarPanel('panelCaja', true);
    if (cajas.length > 0 && productos.length === 0) alternarPanel('panelProducto', true);
  }
});

/* PWA: registra el service worker solo cuando se sirve por http(s) */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
