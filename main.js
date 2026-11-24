/* The Riemann Hypothesis, visualized — D3 v7 */

// ---------- shared helpers ----------
const fmt = d3.format(",");
const fmt1 = d3.format(",.1f");
const SUP = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻" };
const pow10 = k => "10" + String(k).split("").map(c => SUP[c]).join("");
const fmtTick = v => (v >= 1e6 ? +(v / 1e6).toFixed(1) + "M" : v >= 1e3 ? +(v / 1e3).toFixed(1) + "k" : String(v));
const fmtBig = v => {
  const k = Math.log10(v);
  if (Math.abs(k - Math.round(k)) < 1e-9 && Math.abs(k) >= 4) return pow10(Math.round(k));
  return fmt(Math.round(v));
};

const tooltip = d3.select("#tooltip");
function showTip(event, html) {
  tooltip.html(html).style("opacity", 1);
  const node = tooltip.node();
  const { innerWidth: W, innerHeight: H } = window;
  let x = event.clientX + 14, y = event.clientY + 14;
  if (x + node.offsetWidth > W - 8) x = event.clientX - node.offsetWidth - 14;
  if (y + node.offsetHeight > H - 8) y = event.clientY - node.offsetHeight - 14;
  tooltip.style("left", x + "px").style("top", y + "px");
}
const hideTip = () => tooltip.style("opacity", 0);
const row = (cls, label, value) =>
  `<div class="tt-row"><span class="tt-sw" style="background:var(--${cls})"></span>${label}<b>${value}</b></div>`;

function frame(sel, height, m = { top: 12, right: 64, bottom: 40, left: 56 }) {
  const el = d3.select(sel);
  el.selectAll("*").remove();
  const width = el.node().clientWidth;
  const svg = el.append("svg").attr("width", width).attr("height", height);
  const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);
  return { svg, g, w: width - m.left - m.right, h: height - m.top - m.bottom, m };
}

function axisTitle(g, text, x, y, anchor = "middle", rotate = false) {
  g.append("text").attr("class", "axis-title")
    .attr("text-anchor", anchor)
    .attr("transform", rotate ? `translate(${y},${-x}) rotate(-90)` : `translate(${x},${y})`)
    .text(text);
}

// ---------- number theory ----------
const MAXN = 1e7;
const composite = new Uint8Array(MAXN + 1);
composite[0] = composite[1] = 1;
for (let i = 2; i * i <= MAXN; i++) if (!composite[i]) for (let j = i * i; j <= MAXN; j += i) composite[j] = 1;
const isPrime = n => n >= 2 && !composite[n];

// π at each x of an ascending list of integers, in one pass
function piAt(xs) {
  const out = new Array(xs.length);
  let c = 0, n = 1;
  for (let k = 0; k < xs.length; k++) {
    const x = Math.floor(xs[k]);
    while (n < x) { n++; if (!composite[n]) c++; }
    out[k] = c;
  }
  return out;
}

// logarithmic integral li(x) via Ramanujan's series
function li(x) {
  const L = Math.log(x);
  let s = 0, f = 1, inner = 0;
  for (let n = 1; n < 120; n++) {
    f *= n;
    if (n % 2 === 1) inner += 1 / n;
    s += ((n - 1) % 2 ? -1 : 1) * Math.pow(L, n) / (f * Math.pow(2, n - 1)) * inner;
  }
  return 0.5772156649015329 + Math.log(L) + Math.sqrt(x) * s;
}

function factorize(n) {
  const f = [];
  for (let p = 2; p * p <= n; p++) while (n % p === 0) { f.push(p); n /= p; }
  if (n > 1) f.push(n);
  return f;
}

// ---------- 1. prime grid ----------
// Drawn on a <canvas>: thousands of cells as SVG elements made every slider step rebuild
// up to 10,000 DOM nodes (~600 ms per step). A canvas handles 100,000 cells easily.
const gridInput = document.querySelector("#gridn");
const gridCanvas = d3.select("#grid").append("canvas").style("display", "block").node();
const gctx = gridCanvas.getContext("2d");
const baseCanvas = document.createElement("canvas");
const bctx = baseCanvas.getContext("2d");
const grid = { N: 0, cols: 0, cell: 0, hover: null };
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function layoutGrid() {
  const width = document.querySelector("#grid").clientWidth;
  const N = gridN();
  // Columns are always a multiple of 10 and grow with the range, so cells shrink instead of the grid getting very tall.
  const base = width < 520 ? 10 : 30;
  const cols = Math.max(base, Math.round((base * Math.sqrt(N / 300)) / 10) * 10);
  const cell = width / cols;
  const height = Math.ceil(N / cols) * cell;
  const dpr = window.devicePixelRatio || 1;
  for (const cv of [gridCanvas, baseCanvas]) {
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(height * dpr);
  }
  gridCanvas.style.width = width + "px";
  gridCanvas.style.height = height + "px";
  Object.assign(grid, { N, cols, cell, width, height, dpr });

  let primeCount = 0;
  for (let n = 2; n <= N; n++) if (isPrime(n)) primeCount++;
  d3.select("#gridn-out").text(fmt(N));
  d3.select("#grid-readout").html(
    `<b>${fmt(primeCount)}</b> of the numbers from 1 to ${fmt(N)} are prime (<b>${d3.format(".1%")(primeCount / N)}</b>).`);
}

// Slider is logarithmic (100 to 100,000); round to two significant figures so the numbers read cleanly.
function gridN() {
  const raw = Math.pow(10, +gridInput.value);
  const p = Math.pow(10, Math.floor(Math.log10(raw)) - 1);
  return Math.round(raw / p) * p;
}

const cellXY = n => [((n - 1) % grid.cols) * grid.cell, Math.floor((n - 1) / grid.cols) * grid.cell];

// Draw every cell once into an offscreen canvas; hovering only copies it and adds an outline.
function renderGridBase() {
  const { N, cols, cell, width, height, dpr } = grid;
  const c = { prime: cssVar("--series-1"), composite: cssVar("--neutral-fill"), axis: cssVar("--axis"), muted: cssVar("--text-muted") };
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  bctx.clearRect(0, 0, width, height);

  if (cell < 4) {
    // Tiny cells: no gaps or rounding. Paint the composite background in two blocks, then only the primes on top.
    const fullRows = Math.floor(N / cols), rem = N % cols;
    bctx.fillStyle = c.composite;
    bctx.fillRect(0, 0, width, fullRows * cell);
    if (rem) bctx.fillRect(0, fullRows * cell, rem * cell, cell);
    bctx.fillStyle = c.prime;
    for (let n = 2; n <= N; n++) if (isPrime(n)) { const [x, y] = cellXY(n); bctx.fillRect(x, y, cell, cell); }
    return;
  }

  const gap = cell < 10 ? 0.5 : 1;          // half of the 2px (or 1px) surface gap on each side
  const r = Math.min(4, cell * 0.2);
  const s = cell - 2 * gap;
  const labels = cell >= 10 + String(N).length * 5;
  const family = getComputedStyle(document.body).fontFamily;
  bctx.textAlign = "center";
  bctx.textBaseline = "middle";
  for (let n = 1; n <= N; n++) {
    let [x, y] = cellXY(n); x += gap; y += gap;
    const prime = isPrime(n);
    bctx.beginPath();
    bctx.roundRect(x, y, s, s, r);
    if (n === 1) { bctx.strokeStyle = c.axis; bctx.lineWidth = 1; bctx.stroke(); }
    else { bctx.fillStyle = prime ? c.prime : c.composite; bctx.fill(); }
    if (labels) {
      bctx.fillStyle = prime ? "#fff" : c.muted;
      bctx.font = `${prime ? 600 : 400} 10px ${family}`;
      bctx.fillText(n, x + s / 2, y + s / 2 + 0.5);
    }
  }
}

function paintGrid() {
  const { cell, dpr, hover } = grid;
  gctx.setTransform(1, 0, 0, 1, 0, 0);
  gctx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
  gctx.drawImage(baseCanvas, 0, 0);
  if (!hover) return;
  gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Outline the hovered cell; on tiny cells draw a ring at least 8px wide so it stays visible.
  const [x, y] = cellXY(hover);
  const size = Math.max(cell, 8), off = (size - cell) / 2;
  gctx.beginPath();
  gctx.roundRect(x - off + 1, y - off + 1, size - 2, size - 2, Math.min(4, size * 0.2));
  gctx.strokeStyle = cssVar("--text-primary"); gctx.lineWidth = 2; gctx.stroke();
}

function drawGrid() { layoutGrid(); renderGridBase(); paintGrid(); }

// Coalesce slider input to one redraw per animation frame
let gridRaf = 0;
gridInput.addEventListener("input", () => {
  cancelAnimationFrame(gridRaf);
  gridRaf = requestAnimationFrame(drawGrid);
});

gridCanvas.addEventListener("mousemove", event => {
  const { cols, cell, N } = grid;
  const col = Math.floor(event.offsetX / cell), rowI = Math.floor(event.offsetY / cell);
  const n = rowI * cols + col + 1;
  if (col < 0 || col >= cols || n < 1 || n > N) { grid.hover = null; paintGrid(); hideTip(); return; }
  if (n !== grid.hover) { grid.hover = n; paintGrid(); }
  let body;
  if (n === 1) body = "1 is neither prime nor composite. It is the building block of nothing.";
  else if (isPrime(n)) body = `<b>${n} is prime.</b> Only 1 × ${n}.`;
  else body = `${n} = ${factorize(n).join(" × ")}`;
  showTip(event, `<div class="tt-title">${n}</div>${body}`);
});
gridCanvas.addEventListener("mouseleave", () => { grid.hover = null; paintGrid(); hideTip(); });
// Canvas colors don't follow CSS automatically, so repaint when the OS theme flips
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { renderGridBase(); paintGrid(); });

// ---------- 2. counting staircase ----------
const xmaxInput = document.querySelector("#xmax");
function drawCount() {
  const xmax = Math.round(Math.pow(10, +xmaxInput.value));
  d3.select("#xmax-out").text(fmt(xmax));

  const { g, w, h } = frame("#count", 380, { top: 12, right: 92, bottom: 40, left: 64 });
  const S = Math.min(1200, xmax - 1);
  const xs = Array.from(new Set(d3.range(S + 1).map(i => Math.floor(2 + (xmax - 2) * i / S))));
  const pis = piAt(xs);
  const data = xs.map((x, i) => ({ x, pi: pis[i], est: x / Math.log(x), li: li(x) }));

  const x = d3.scaleLinear().domain([0, xmax]).range([0, w]);
  const y = d3.scaleLinear().domain([0, d3.max(data, d => Math.max(d.pi, d.li, d.est)) * 1.05]).range([h, 0]).nice();

  g.append("g").attr("class", "axis grid").call(d3.axisLeft(y).ticks(5).tickSize(-w).tickFormat(""));
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(6).tickFormat(fmtTick));
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5).tickFormat(fmtTick));
  axisTitle(g, "x (count primes up to here)", w / 2, h + 34);
  axisTitle(g, "how many primes", -h / 2, -48, "middle", true);

  const line = key => d3.line().x(d => x(d.x)).y(d => y(d[key]));
  g.append("path").datum(data).attr("class", "l-s2").attr("d", line("est"));
  g.append("path").datum(data).attr("class", "l-s3").attr("d", line("li"));
  g.append("path").datum(data).attr("class", "l-s1").attr("d", line("pi").curve(d3.curveStepAfter));

  // direct labels at the right edge, nudged apart
  const last = data[data.length - 1];
  const labels = [
    { t: "Li(x)", v: last.li }, { t: "π(x)", v: last.pi }, { t: "x / ln x", v: last.est },
  ].map(d => ({ ...d, y: y(d.v) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
  g.selectAll(".direct-label").data(labels).join("text").attr("class", "direct-label")
    .attr("x", w + 8).attr("y", d => d.y).attr("dy", "0.35em").text(d => d.t);

  // crosshair
  const cross = g.append("line").attr("class", "cross-v").attr("y1", 0).attr("y2", h).style("opacity", 0);
  const dots = g.selectAll(".hover-dot").data(["series-1", "series-3", "series-2"]).join("circle")
    .attr("class", "hover-dot").attr("r", 4.5).style("fill", c => `var(--${c})`).style("opacity", 0);
  const bis = d3.bisector(d => d.x).center;
  g.append("rect").attr("width", w).attr("height", h).attr("fill", "transparent")
    .on("mousemove", event => {
      const d = data[bis(data, x.invert(d3.pointer(event)[0]))];
      cross.attr("x1", x(d.x)).attr("x2", x(d.x)).style("opacity", 1);
      dots.attr("cx", x(d.x)).attr("cy", (c, i) => y([d.pi, d.li, d.est][i])).style("opacity", 1);
      showTip(event, `<div class="tt-title">Up to ${fmt(d.x)}</div>` +
        row("series-1", "Actual primes", fmt(d.pi)) +
        row("series-3", "Li(x)", fmt(Math.round(d.li))) +
        row("series-2", "x ÷ ln x", fmt(Math.round(d.est))));
    })
    .on("mouseleave", () => { cross.style("opacity", 0); dots.style("opacity", 0); hideTip(); });
}
xmaxInput.addEventListener("input", drawCount);

function buildTable() {
  const xs = d3.range(1, 8).map(k => Math.pow(10, k));
  const pis = piAt(xs);
  const pct = (a, b) => (a > b ? "+" : "") + d3.format(".2f")((a - b) / b * 100) + "%";
  const t = d3.select("#count-table");
  t.append("thead").append("tr").selectAll("th")
    .data(["x", "Actual π(x)", "x ÷ ln x", "off by", "Li(x)", "off by"]).join("th").text(d => d);
  t.append("tbody").selectAll("tr").data(xs).join("tr").selectAll("td")
    .data((x, i) => {
      const e = x / Math.log(x), l = li(x), p = pis[i];
      return [fmt(x), fmt(p), fmt(Math.round(e)), pct(e, p), fmt(Math.round(l)), pct(l, p)];
    }).join("td").text(d => d);
}

// ---------- 3. error band ----------
let errorData;
function drawError() {
  if (!errorData) {
    const xs = Array.from(new Set(d3.range(900).map(i => Math.floor(Math.pow(10, 2 + 5 * i / 899)))));
    const pis = piAt(xs);
    errorData = xs.map((x, i) => ({
      x, err: pis[i] - li(x),
      bound: x >= 2657 ? Math.sqrt(x) * Math.log(x) / (8 * Math.PI) : null,
    }));
  }
  const data = errorData;
  const { g, w, h } = frame("#error", 340, { top: 12, right: 92, bottom: 40, left: 64 });
  const x = d3.scaleLog().domain([100, MAXN]).range([0, w]);
  const ymax = d3.max(data, d => d.bound || Math.abs(d.err)) * 1.08;
  const y = d3.scaleLinear().domain([-ymax, ymax]).range([h, 0]).nice();

  g.append("g").attr("class", "axis grid").call(d3.axisLeft(y).ticks(6).tickSize(-w).tickFormat(""));
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(v => (Number.isInteger(Math.log10(v)) ? fmtBig(v) : "")));
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat(v => (v < 0 ? "−" : "") + fmtTick(Math.abs(v))));
  g.append("line").attr("class", "zero-line").attr("x1", 0).attr("x2", w).attr("y1", y(0)).attr("y2", y(0));
  axisTitle(g, "x (log scale: each tick is 10× bigger)", w / 2, h + 34);
  axisTitle(g, "actual − estimate", -h / 2, -48, "middle", true);

  const bd = data.filter(d => d.bound);
  g.append("path").datum(bd).attr("class", "band-area")
    .attr("d", d3.area().x(d => x(d.x)).y0(d => y(-d.bound)).y1(d => y(d.bound)));
  ["bound", "neg"].forEach(k => g.append("path").datum(bd).attr("class", "band-edge")
    .attr("d", d3.line().x(d => x(d.x)).y(d => y(k === "bound" ? d.bound : -d.bound))));
  g.append("path").datum(data).attr("class", "l-s1").attr("d", d3.line().x(d => x(d.x)).y(d => y(d.err)));

  const last = bd[bd.length - 1];
  g.append("text").attr("class", "direct-label").attr("x", w + 8).attr("y", y(last.bound)).attr("dy", "0.35em").text("safe zone");
  g.append("text").attr("class", "direct-label").attr("x", w + 8).attr("y", y(data[data.length - 1].err)).attr("dy", "0.35em").text("error");

  const cross = g.append("line").attr("class", "cross-v").attr("y1", 0).attr("y2", h).style("opacity", 0);
  const dot = g.append("circle").attr("class", "hover-dot").attr("r", 4.5).style("fill", "var(--series-1)").style("opacity", 0);
  const bis = d3.bisector(d => d.x).center;
  g.append("rect").attr("width", w).attr("height", h).attr("fill", "transparent")
    .on("mousemove", event => {
      const d = data[bis(data, x.invert(d3.pointer(event)[0]))];
      cross.attr("x1", x(d.x)).attr("x2", x(d.x)).style("opacity", 1);
      dot.attr("cx", x(d.x)).attr("cy", y(d.err)).style("opacity", 1);
      showTip(event, `<div class="tt-title">Up to ${fmt(d.x)}</div>` +
        row("series-1", "Error", fmt1(d.err)) +
        (d.bound ? row("text-muted", "Safe zone ±", fmt1(d.bound)) : "") +
        `<div class="tt-row">Error is ${d3.format(".3f")(Math.abs(d.err) / d.x * 100)}% of x</div>`);
    })
    .on("mouseleave", () => { cross.style("opacity", 0); dot.style("opacity", 0); hideTip(); });
}

// ---------- 4. zeta: complex plane + Z(t) ----------
function drawZeta() {
  const H = 520, TMAX = 80;
  const zeros = ZETA_ZEROS.filter(t => t <= TMAX);
  const m = { top: 10, right: 16, bottom: 40, left: 44 };

  // left: complex plane
  const P = frame("#plane", H, m);
  const x = d3.scaleLinear().domain([-9, 2.5]).range([0, P.w]);
  const y = d3.scaleLinear().domain([-4, TMAX]).range([P.h, 0]);
  P.g.append("rect").attr("class", "strip-rect").attr("x", x(0)).attr("width", x(1) - x(0)).attr("y", 0).attr("height", P.h);
  P.g.append("g").attr("class", "axis grid").call(d3.axisLeft(y).ticks(8).tickSize(-P.w).tickFormat(""));
  P.g.append("g").attr("class", "axis").attr("transform", `translate(0,${P.h})`).call(d3.axisBottom(x).ticks(8));
  P.g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(8));
  P.g.append("line").attr("class", "zero-line").attr("x1", 0).attr("x2", P.w).attr("y1", y(0)).attr("y2", y(0));
  P.g.append("line").attr("class", "zero-line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", P.h);
  P.g.append("line").attr("class", "crit-line").attr("x1", x(0.5)).attr("x2", x(0.5)).attr("y1", 0).attr("y2", P.h);
  axisTitle(P.g, "real part", P.w / 2, P.h + 34);
  axisTitle(P.g, "height (imaginary part)", -P.h / 2, -34, "middle", true);
  P.g.append("text").attr("class", "direct-label").attr("x", x(0.5)).attr("y", 12).attr("text-anchor", "end").attr("dx", -8).text("line at ½");

  // pole at s = 1
  const px = x(1), py = y(0);
  P.g.append("path").attr("class", "pole").attr("d", `M${px - 5},${py - 5}L${px + 5},${py + 5}M${px - 5},${py + 5}L${px + 5},${py - 5}`);
  P.g.append("text").attr("class", "axis-title").attr("x", px + 8).attr("y", py - 6).text("ζ → ∞");

  P.g.selectAll(".trivial-dot").data([-2, -4, -6, -8]).join("circle").attr("class", "trivial-dot")
    .attr("cx", d => x(d)).attr("cy", y(0)).attr("r", 5)
    .on("mousemove", (e, d) => showTip(e, `<div class="tt-title">Trivial zero at ${d}</div>These come from a simple formula and are well understood. Nobody worries about them.`))
    .on("mouseleave", hideTip);

  const zdots = P.g.selectAll(".zero-dot").data(zeros).join("circle").attr("class", "zero-dot")
    .attr("cx", x(0.5)).attr("cy", d => y(d)).attr("r", 5);

  // right: Z(t) along the critical line
  const Q = frame("#zline", H, m);
  const zx = d3.scaleLinear().domain(d3.extent(Z_CURVE, d => d[1])).nice().range([0, Q.w]);
  Q.g.append("g").attr("class", "axis grid").call(d3.axisLeft(y).ticks(8).tickSize(-Q.w).tickFormat(""));
  Q.g.append("g").attr("class", "axis").attr("transform", `translate(0,${Q.h})`).call(d3.axisBottom(zx).ticks(6));
  Q.g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(8));
  Q.g.append("line").attr("class", "crit-line").attr("x1", zx(0)).attr("x2", zx(0)).attr("y1", 0).attr("y2", Q.h);
  axisTitle(Q.g, "value of ζ (rotated to be a real number)", Q.w / 2, Q.h + 34);
  Q.g.append("path").datum(Z_CURVE).attr("class", "l-s1")
    .attr("d", d3.line().x(d => zx(d[1])).y(d => y(d[0])));
  const qdots = Q.g.selectAll(".zero-dot").data(zeros).join("circle").attr("class", "zero-dot")
    .attr("cx", zx(0)).attr("cy", d => y(d)).attr("r", 4);

  // linked hover
  const hP = P.g.append("line").attr("class", "cross-h").attr("x1", 0).attr("x2", P.w).style("opacity", 0);
  const hQ = Q.g.append("line").attr("class", "cross-h").attr("x1", 0).attr("x2", Q.w).style("opacity", 0);
  const nearest = t => zeros.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
  const bis = d3.bisector(d => d[0]).center;
  function move(event, g) {
    const t = Math.max(0, Math.min(TMAX, y.invert(d3.pointer(event, g.node())[1])));
    const z = nearest(t);
    const snap = Math.abs(y(z) - y(t)) < 8;
    const tt = snap ? z : t;
    hP.attr("y1", y(tt)).attr("y2", y(tt)).style("opacity", 1);
    hQ.attr("y1", y(tt)).attr("y2", y(tt)).style("opacity", 1);
    zdots.attr("r", d => (snap && d === z ? 8 : 5));
    qdots.attr("r", d => (snap && d === z ? 7 : 4));
    const Zv = Z_CURVE[bis(Z_CURVE, tt)][1];
    const idx = ZETA_ZEROS.indexOf(z) + 1;
    showTip(event, snap
      ? `<div class="tt-title">Zero #${idx}</div>s = ½ + ${d3.format(".4f")(z)}<i>i</i><br>ζ(s) = 0, exactly on the line.`
      : `<div class="tt-title">Height ${d3.format(".2f")(t)}</div>ζ along the line ≈ ${d3.format(".3f")(Zv)}<br>Nearest zero: #${idx} at ${d3.format(".2f")(z)}`);
  }
  function leave() { hP.style("opacity", 0); hQ.style("opacity", 0); zdots.attr("r", 5); qdots.attr("r", 4); hideTip(); }
  [P, Q].forEach(F => F.g.insert("rect", ".zero-dot").attr("width", F.w).attr("height", F.h).attr("fill", "transparent")
    .on("mousemove", e => move(e, F.g)).on("mouseleave", leave));
  [zdots, qdots].forEach(s => s.on("mousemove", e => move(e, s === zdots ? P.g : Q.g)).on("mouseleave", leave));
}

// ---------- 5. music of the primes ----------
const XM = [2, 60];
const musicXs = d3.range(0, 1001).map(i => XM[0] + (XM[1] - XM[0]) * i / 1000);
// Chebyshev ψ(x): add ln p at every prime power p^k ≤ x
const psiSteps = (() => {
  const steps = [];
  for (let n = 2; n <= XM[1]; n++) {
    const f = factorize(n);
    if (f.every(p => p === f[0])) steps.push({ x: n, jump: Math.log(f[0]), prime: f.length === 1 });
  }
  let s = 0;
  const pts = [{ x: XM[0] - 1e-9, y: 0 }];
  steps.forEach(st => { s += st.jump; pts.push({ x: st.x, y: s, n: st.x, prime: st.prime }); });
  pts.push({ x: XM[1], y: s });
  return pts;
})();
const wave = (gamma, xv) => {
  const L = Math.log(xv);
  return -2 * Math.sqrt(xv) * (0.5 * Math.cos(gamma * L) + gamma * Math.sin(gamma * L)) / (0.25 + gamma * gamma);
};
const smooth = xv => xv - Math.log(2 * Math.PI) - 0.5 * Math.log(1 - 1 / (xv * xv));

const nInput = document.querySelector("#nzeros");
let musicScales;
function drawMusicFrame() {
  const { g, w, h } = frame("#music", 360, { top: 12, right: 24, bottom: 40, left: 48 });
  const x = d3.scaleLinear().domain(XM).range([0, w]);
  const y = d3.scaleLinear().domain([-2, 66]).range([h, 0]);
  musicScales = { g, x, y, w, h };
  g.append("g").attr("class", "axis grid").call(d3.axisLeft(y).ticks(6).tickSize(-w).tickFormat(""));
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(12));
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6));
  axisTitle(g, "x", w / 2, h + 34);
  axisTitle(g, "weighted prime count", -h / 2, -36, "middle", true);
  g.append("path").datum(psiSteps).attr("class", "l-ink")
    .attr("d", d3.line().x(d => x(d.x)).y(d => y(d.y)).curve(d3.curveStepAfter));
  g.append("path").attr("class", "l-s1 approx");

  const cross = g.append("line").attr("class", "cross-v").attr("y1", 0).attr("y2", h).style("opacity", 0);
  g.append("rect").attr("width", w).attr("height", h).attr("fill", "transparent")
    .on("mousemove", event => {
      const xv = Math.max(XM[0], Math.min(XM[1], x.invert(d3.pointer(event)[0])));
      const N = +nInput.value;
      let a = smooth(xv);
      for (let k = 0; k < N; k++) a += wave(ZETA_ZEROS[k], xv);
      const actual = psiSteps.filter(p => p.x <= xv).pop().y;
      const n = Math.round(xv);
      cross.attr("x1", x(xv)).attr("x2", x(xv)).style("opacity", 1);
      showTip(event, `<div class="tt-title">x = ${d3.format(".1f")(xv)}</div>` +
        row("text-primary", "True staircase", d3.format(".2f")(actual)) +
        row("series-1", `Rebuilt from ${N} zeros`, d3.format(".2f")(a)) +
        (isPrime(n) && Math.abs(xv - n) < 0.6 ? `<div class="tt-row">${n} is prime: the staircase steps up here.</div>` : ""));
    })
    .on("mouseleave", () => { cross.style("opacity", 0); hideTip(); });
  updateMusic();
}
function updateMusic() {
  const N = +nInput.value;
  d3.select("#nzeros-out").text(N);
  const { g, x, y } = musicScales;
  const pts = musicXs.map(xv => {
    let a = smooth(xv);
    for (let k = 0; k < N; k++) a += wave(ZETA_ZEROS[k], xv);
    return [xv, a];
  });
  g.select(".approx").datum(pts).attr("d", d3.line().x(d => x(d[0])).y(d => y(Math.max(-4, Math.min(70, d[1])))));
}
nInput.addEventListener("input", updateMusic);

let playTimer = null;
const playBtn = document.querySelector("#play");
playBtn.addEventListener("click", () => {
  if (playTimer) { playTimer.stop(); playTimer = null; playBtn.textContent = "▶ Play"; return; }
  if (+nInput.value >= 300) nInput.value = 0;
  playBtn.textContent = "❚❚ Pause";
  const start = +nInput.value, t0 = performance.now();
  playTimer = d3.timer(() => {
    // ease: slow at first (each early wave is dramatic), faster later
    const el = (performance.now() - t0) / 1000;
    const n = Math.min(300, Math.round(start + Math.pow(el * 4.2, 1.6)));
    nInput.value = n;
    updateMusic();
    if (n >= 300) { playTimer.stop(); playTimer = null; playBtn.textContent = "▶ Play"; }
  });
});

function drawWaves() {
  const { g, w, h } = frame("#waves", 200, { top: 10, right: 24, bottom: 36, left: 48 });
  const x = d3.scaleLinear().domain(XM).range([0, w]);
  const series = [0, 1, 2].map(k => musicXs.map(xv => [xv, wave(ZETA_ZEROS[k], xv)]));
  const ext = d3.max(series.flat(), d => Math.abs(d[1]));
  const y = d3.scaleLinear().domain([-ext, ext]).range([h, 0]).nice();
  g.append("g").attr("class", "axis grid").call(d3.axisLeft(y).ticks(4).tickSize(-w).tickFormat(""));
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(12));
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4));
  g.append("line").attr("class", "zero-line").attr("x1", 0).attr("x2", w).attr("y1", y(0)).attr("y2", y(0));
  axisTitle(g, "x", w / 2, h + 30);
  series.forEach((s, k) => g.append("path").datum(s).attr("class", `l-s${k + 1}`)
    .attr("d", d3.line().x(d => x(d[0])).y(d => y(d[1]))));

  const cross = g.append("line").attr("class", "cross-v").attr("y1", 0).attr("y2", h).style("opacity", 0);
  g.append("rect").attr("width", w).attr("height", h).attr("fill", "transparent")
    .on("mousemove", event => {
      const xv = Math.max(XM[0], x.invert(d3.pointer(event)[0]));
      cross.attr("x1", x(xv)).attr("x2", x(xv)).style("opacity", 1);
      showTip(event, `<div class="tt-title">x = ${d3.format(".1f")(xv)}</div>` +
        [0, 1, 2].map(k => row(`series-${k + 1}`, `Wave #${k + 1}`, d3.format("+.3f")(wave(ZETA_ZEROS[k], xv)))).join(""));
    })
    .on("mouseleave", () => { cross.style("opacity", 0); hideTip(); });
}

// ---------- 6. why the line matters ----------
const sigInput = document.querySelector("#sigma");
function drawLine() {
  const s = +sigInput.value;
  d3.select("#sigma-out").text(d3.format(".2f")(s));
  const { g, w, h } = frame("#line", 320, { top: 12, right: 92, bottom: 40, left: 80 });
  const x = d3.scaleLog().domain([10, 1e12]).range([0, w]);
  const y = d3.scaleLog().domain([1e-6, 1]).range([h, 0]);
  const xs = d3.range(0, 201).map(i => Math.pow(10, 1 + 11 * i / 200));
  const on = xs.map(v => [v, Math.pow(v, -0.5)]);
  const off = xs.map(v => [v, Math.pow(v, s - 1)]);
  const pct = v => (v >= 0.01 ? d3.format(".0%")(v) : v >= 1e-4 ? d3.format(".2%")(v) : d3.format(".4%")(v));

  g.append("g").attr("class", "axis grid").call(d3.axisLeft(y).ticks(6).tickSize(-w).tickFormat(""));
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(12).tickFormat(v => {
      const k = Math.log10(v); return Number.isInteger(k) && k % 2 === 1 ? pow10(k) : "";
    }));
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat(v => {
    const k = Math.log10(v); return Number.isInteger(k) ? (100 * Math.pow(10, k)).toFixed(Math.max(0, -k - 2)) + "%" : "";
  }));
  axisTitle(g, "x (log scale)", w / 2, h + 34);
  axisTitle(g, "error as a share of x (roughly)", -h / 2, -68, "middle", true);

  const line = d3.line().x(d => x(d[0])).y(d => y(d[1]));
  g.append("path").datum(on).attr("class", "l-s1").attr("d", line);
  g.append("path").datum(off).attr("class", "l-s2").attr("d", line);
  const lab = [{ t: "on line", v: on[200][1] }, { t: "off line", v: off[200][1] }]
    .map(d => ({ ...d, y: y(d.v) })).sort((a, b) => a.y - b.y);
  if (lab[1].y - lab[0].y < 14) lab[1].y = lab[0].y + 14;
  g.selectAll(".direct-label").data(lab).join("text").attr("class", "direct-label")
    .attr("x", w + 8).attr("y", d => d.y).attr("dy", "0.35em").text(d => d.t);

  const cross = g.append("line").attr("class", "cross-v").attr("y1", 0).attr("y2", h).style("opacity", 0);
  g.append("rect").attr("width", w).attr("height", h).attr("fill", "transparent")
    .on("mousemove", event => {
      const xv = x.invert(d3.pointer(event)[0]);
      cross.attr("x1", x(xv)).attr("x2", x(xv)).style("opacity", 1);
      showTip(event, `<div class="tt-title">x ≈ ${fmtBig(Math.pow(10, Math.round(Math.log10(xv) * 10) / 10))}</div>` +
        row("series-1", "Zero at ½", pct(Math.pow(xv, -0.5))) +
        row("series-2", `Zero at ${s.toFixed(2)}`, pct(Math.pow(xv, s - 1))));
    })
    .on("mouseleave", () => { cross.style("opacity", 0); hideTip(); });

  const big = 1e12;
  d3.select("#line-readout").html(
    `Counting primes up to a trillion (10¹²): with every zero on the line, the error is about <b>${pct(Math.pow(big, -0.5))}</b> of x. ` +
    (s > 0.5
      ? `If a single zero sat at ${s.toFixed(2)}, the error could be around <b>${pct(Math.pow(big, s - 1))}</b>, which is ${fmt(Math.round(Math.pow(big, s - 0.5)))}× worse.`
      : `That is the Riemann Hypothesis.`));
}
sigInput.addEventListener("input", drawLine);

// ---------- boot & resize ----------
function drawAll() {
  drawGrid(); drawCount(); drawError(); drawZeta(); drawMusicFrame(); drawWaves(); drawLine();
}
buildTable();
drawAll();
let rT;
window.addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(drawAll, 150); });
