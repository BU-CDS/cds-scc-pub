// test_page.mjs — assert the built public page's STRUCTURE, JS-execution safety, and
// de-id/blocklist policy for the portal-lift design (design revision of 2026-08-31): twin pool
// panels (GPU left, CPU right) and an "Over time" section of server-rendered charts. The
// Totals section (period selector + per-pool KPI cards) and the page's embedded copy of
// cluster_data.json were removed on 2026-11-15; section 5 pins both gone. The inline script
// is checked present, self-contained (no external requests / storage / theme machinery /
// data object) and functionally correct (slide auto-advance and tab clicks).
//
// Run: module load nodejs/20.12.2 && node scripts/test_page.mjs [index.html]
// Exit 0 = pass, 1 = wrong, 2 = usage.
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const SDIR = dirname(fileURLToPath(import.meta.url));
const path = process.argv[2] || join(SDIR, '..', 'index.html');
let html;
try { html = readFileSync(path, 'utf8'); } catch { console.error('test_page: cannot read ' + path); process.exit(2); }

const dataPath = join(SDIR, '..', 'output', 'cluster_data.json');
let data;
try { data = JSON.parse(readFileSync(dataPath, 'utf8')); }
catch (e) { console.error('test_page: cannot read/parse ' + dataPath + ': ' + e.message); process.exit(2); }

let FAILS = 0;
const ok  = m => console.log('PASS: ' + m);
const bad = m => { console.log('FAIL: ' + m); FAILS++; };
const has = (s, needle, m) => (s.includes(needle) ? ok(m) : bad(m + ' -- missing: ' + JSON.stringify(needle).slice(0, 90)));
const not = (s, needle, m) => (s.includes(needle) ? bad(m + ' -- present: ' + JSON.stringify(needle).slice(0, 90)) : ok(m));

// mirrors the page's own monthLabel()/rangeText() (build_cluster_page.R JS block)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLbl = (m, withYear) => MON[+m.slice(5, 7) - 1] + (withYear ? ' ' + m.slice(0, 4) : '');
const rangeTextJS = (months) => {
  if (!months.length) return '';
  const a = months[0], b = months[months.length - 1];
  if (a === b) return monthLbl(a, true);
  const sameYear = a.slice(0, 4) === b.slice(0, 4);
  return monthLbl(a, !sameYear) + ' – ' + monthLbl(b, true);
};

// ---- 0. scripts: the app's one inline <script>, plus the Google Analytics tag (its external loader and
// inline bootstrap) and nothing else. The page's own code stays self-contained: no fetch/XHR, no browser
// storage, no OS-theme detection. (The zero-JS rule died with the 2026-08-31 design revision; the 2026-09-02
// analytics decision admits exactly the one external script below.)
{
  const scriptCount = (html.match(/<script\b/g) || []).length;
  scriptCount === 3 ? ok('page carries exactly three <script> tags: Google loader, its bootstrap, the app') : bad('found ' + scriptCount + ' <script> tags, want exactly 3');
  const ext = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]*)"/g)].map(m => m[1]);
  (ext.length === 1 && ext[0] === 'https://www.googletagmanager.com/gtag/js?id=G-0B07K1F1MX') ? ok("the only external script is the Google tag loader with this page's measurement id") : bad('external scripts: ' + JSON.stringify(ext));
  const cfg = (html.match(/gtag\("config","G-0B07K1F1MX"\)/g) || []).length;
  cfg === 1 ? ok('one gtag config call with the same id') : bad('gtag config calls: ' + cfg);
  const ids = new Set(html.match(/\bG-[A-Z0-9]{8,12}\b/g) || []);
  (ids.size === 1 && ids.has('G-0B07K1F1MX')) ? ok("this page's measurement id is the only one on the page") : bad('measurement ids on the page: ' + JSON.stringify([...ids]));
  const gaAt = html.indexOf('googletagmanager.com/gtag/js');
  (gaAt > html.indexOf('<meta charset="utf-8">') && gaAt < html.indexOf('</head>')) ? ok('Google tag sits in the head after the charset meta') : bad('Google tag is outside the head or ahead of the charset meta');
}
has(html, 'function gtag(){window.dataLayer.push(arguments);}', "gtag() pushes through window.dataLayer (a bare dataLayer is undefined under validate.mjs's shim)");
not(html, '{dataLayer.push(arguments);}', 'no bare dataLayer reference');
for (const needle of ['fetch(', 'XMLHttpRequest', 'localStorage', 'document.cookie', 'prefers-color-scheme'])
  not(html, needle, 'no "' + needle + '" anywhere (no external requests / storage / theme machinery in the page\'s own code)');

// ---- 1. containment, not just order: a stray </div> can close a section early while
// every string check still passes. Tiny stack parser over the static markup (copied
// verbatim from cpu-cds-scc/scripts/test_page.mjs's own containment parser).
const parentOf = (() => {
  const body = html.slice(html.indexOf('<body')).replace(/<script[\s\S]*?<\/script>/g, '');
  const stack = [], parent = {}; const voids = new Set(['br', 'img', 'input', 'meta', 'link', 'hr']);
  for (const m of body.matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g)) {
    const [, close, tag, attrs] = m;
    if (close) { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { stack.length = i; break; } continue; }
    const id = (attrs.match(/\bid="([^"]+)"/) || [])[1], cls = (attrs.match(/\bclass="([^"]+)"/) || [])[1];
    const lab = tag + (id ? '#' + id : '') + (cls ? '.' + cls.replace(/\s+/g, '.') : '');
    parent[lab] = stack.length ? stack[stack.length - 1].lab : '(root)';
    if (!voids.has(tag)) stack.push({ tag, lab });
  }
  return parent;
})();
// note: the parser's label key is "tag#id.class1.class2..." when an element carries
// both -- these wrapper divs carry an id (for the JS/test hooks) AND a class (for
// per-pool CSS), so the lookup key must include both, in source attribute order.
const P = sel => parentOf[sel] || '(absent)';
P('div.deckrow') === 'main' ? ok('a deckrow is a direct child of main') : bad('deckrow parent is ' + P('div.deckrow'));
P('div#gpupanel.deck.pool.pool-gpu') === 'div.deckrow' ? ok('GPU panel sits inside a deckrow') : bad('GPU panel parent is ' + P('div#gpupanel.deck.pool.pool-gpu'));
P('div#cpupanel.deck.pool.pool-cpu') === 'div.deckrow' ? ok('CPU panel sits inside a deckrow') : bad('CPU panel parent is ' + P('div#cpupanel.deck.pool.pool-cpu'));

(html.indexOf('id="gpupanel"') >= 0 && html.indexOf('id="gpupanel"') < html.indexOf('id="cpupanel"'))
  ? ok('GPU panel renders before the CPU panel (GPU left, CPU right)')
  : bad('GPU panel does not precede the CPU panel in source order');

{
  const main = html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
  const opens = (main.match(/<div\b/g) || []).length, closes = (main.match(/<\/div>/g) || []).length;
  opens === closes ? ok('div tags balance inside main (' + opens + ')') : bad('div tags unbalanced inside main: ' + opens + ' open vs ' + closes + ' close');
}

// ---- 2. header lockup (unchanged) ----
const head1 = (html.match(/<h1>([\s\S]*?)<\/h1>/) || ['', ''])[1];
has(head1, 'class="buplate"', 'h1 carries the University plate image');
has(head1, 'Faculty of Computing &amp; Data Sciences', 'h1 carries the school name');

// ---- 3. every PANEL block renders fully saturated: capacity, not occupancy.
// Scoped to the two pool panels: the Over time charts further down also draw
// <i> marks (bars, capacity tracks, gridlines, legend swatches) that are not
// panel blocks. ----
{
  const panels = html.slice(html.indexOf('id="gpupanel"'), html.indexOf('id="ovhead"'));
  const totalBlocks = (panels.match(/<i\b[^>]*><\/i>/g) || []).length;
  const onBlocks = (panels.match(/<i class="on"><\/i>/g) || []).length;
  totalBlocks > 0 && totalBlocks === onBlocks
    ? ok('every panel block is saturated (' + onBlocks + '/' + totalBlocks + ')')
    : bad('panel blocks not fully saturated: ' + onBlocks + ' of ' + totalBlocks + ' carry class="on"');
}

// ---- 4. no LIVE/STALE machinery (this is capacity, not a live occupancy feed) ----
for (const needle of ['livebadge', 'stalebadge', 'livedot', 'LIVE</span>', '>STALE<'])
  not(html, needle, 'no "' + needle + '" (capacity panels carry no live/stale badge)');
// the footer's stamp wording moves monthly -> quarterly per the 2026-08-31 design revision
// (cadence: quarterly); deploy.sh's stamp grep is updated to match -- must
// still be present, not forbidden.
has(html, 'updated quarterly', 'footer keeps the "updated quarterly" stamp deploy.sh checks for');

// ---- 5. the Totals section and the embedded data are gone (2026-11-15: too much to
// share publicly). No period selector, no KPI cards, no coverage notes, and no copy of
// cluster_data.json in the page source -- its monthly rows carried failed, wall-killed,
// walltime-accuracy and reserved-idle hours by node class and card. ----
for (const needle of ['id="sechead"', 'id="gpucard"', 'id="cpucard"', 'id="prange"', 'id="pmonth"', 'id="seg-p3"',
  'id="kpi-gpu"', 'id="kpi-cpu"', 'id="gpu-cov"', 'id="cpu-cov"', 'id="ovsel"', 'class="kpi"', 'Totals', 'Past 3 months', 'Past 6 months', 'All months', ' highlighted'])
  not(html, needle, 'Totals section removed: "' + needle + '" appears nowhere');
for (const lbl of ['Reserved core-h<', 'Utilized core-h', 'Avg efficiency', 'Core-h per job', 'Reserved GPU-h<', 'Utilized GPU-h',
  'Avg utilization', 'Jobs run', 'Energy used', 'Mean VRAM', 'Researchers served', 'Capacity reserved'])
  not(html, lbl, 'removed KPI tile "' + lbl + '" appears nowhere');
for (const needle of ['const DATA', 'DATA.', '"monthly"', 'cpu_monthly', 'gpu_monthly', 'capacity_monthly', 'headline', 'window3',
  'fail_h', 'wkill', 'wa_used', 'wa_req', 'residle', 'vram_h', 'njobs', 'kwh', 'data-m='])
  not(html, needle, 'no embedded data: "' + needle + '" appears nowhere in the page source');
{
  // the node-class vocabulary, from the CPU clone's host config (contract v5 no longer carries it)
  const hostsCsv = readFileSync(join(process.env.PUB_CPU_CLONE || '/usr3/bustaff/mhorn/repos/cpu-cds-scc', 'config', 'cds_cpu_hosts.csv'), 'utf8').trim().split('\n');
  const nci = hostsCsv[0].split(',').indexOf('node_class');
  const nodeClasses = [...new Set(hostsCsv.slice(1).map(l => l.split(',')[nci]).filter(Boolean))];
  const leaked = nodeClasses.filter(c => new RegExp('\\b' + c + '\\b').test(html));
  leaked.length === 0 ? ok('no CPU node-class key (' + nodeClasses.join(', ') + ') appears in the page') : bad('node-class keys in the page: ' + leaked.join(', '));
}
// none of the earlier-removed tile labels or banned tooltip phrases may appear anywhere
for (const lbl of ['Under-Utilized', 'Under-utilized', 'Non-Utilized', 'on hard-failed jobs', 'on wall-killed jobs', 'Walltime Accuracy'])
  not(html, lbl, 'removed tile label "' + lbl + '" no longer appears anywhere');
for (const phrase of ['lower is better', 'Lower is better', 'worst waste', 'broke', 'killed'])
  not(html, phrase, 'banned tooltip phrase "' + phrase + '" does not appear anywhere');

const sliceFrom = (startMarker, endMarkers) => {
  const s = html.indexOf(startMarker);
  if (s < 0) return '';
  const ends = endMarkers.map(e => html.indexOf(e)).filter(i => i > s);
  const e = ends.length ? Math.min(...ends) : html.indexOf('</main>');
  return html.slice(s, e);
};
const fmt = n => Math.round(n).toLocaleString('en-US');
const communityFor = (key, pool) => {
  const r = data.community.find((row) => row[0] === key && row[1] === pool);
  return r ? { users: r[2], groups: r[3] } : { users: 0, groups: 0 };
};

// ---- 7. functional: execute the page's inline JS and drive the Over-time slides ----
{
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n');
  const makeEl = (id, extra = {}) => ({
    id, value: '', innerHTML: '', textContent: '', dataset: {}, style: {},
    addEventListener() {}, appendChild() {}, setAttribute() {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    querySelectorAll: () => [], closest: () => null,
    ...extra,
  });
  // Over time: the tabs and slides the script discovers via querySelectorAll
  const trackOn = (el) => { el.on = false; el.classList = { toggle: (c, v) => { if (c === 'on') el.on = !!v; }, add() {}, remove() {}, contains: () => false }; return el; };
  const ovTabEls = ['rhy', 'com'].map(s => { const el = trackOn(makeEl('ovtab-' + s, { dataset: { s } })); el.on = s === 'rhy'; el.addEventListener = (ev, fn) => { if (ev === 'click') el.onclick = fn; }; return el; });
  const ovSlideEls = ['gpu', 'cpu'].flatMap(pool => ['rhy', 'com'].map(s => makeEl('slide-' + pool + '-' + s, { dataset: { s }, hidden: s !== 'rhy' })));
  const timers = [];
  const setIntervalStub = (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; };
  const clearIntervalStub = (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; };
  const shown = () => [...new Set(ovSlideEls.filter(s => !s.hidden).map(s => s.dataset.s))];
  const document = {
    querySelector: (sel) => makeEl(sel.replace(/^[.#]/, '')),
    querySelectorAll: (sel) => sel === '#ovtabs button' ? ovTabEls : sel === '.ov .slide' ? ovSlideEls : [],
    getElementById: (id) => makeEl(id),
    createElement: () => makeEl('tip'),
    addEventListener: () => {},
    body: { appendChild() {} },
  };
  const window = { addEventListener: () => {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  const localStorage = { getItem: () => null, setItem() {} };
  try {
    if (!scripts.trim()) throw new Error('no <script> content found');
    new Function('document', 'window', 'localStorage', 'setInterval', 'clearInterval', scripts)(document, window, localStorage, setIntervalStub, clearIntervalStub);

    // auto-advance (R6.7): one 10 s interval armed on load; each tick shows the next slide in BOTH decks; a tab click stops it for good
    timers.length === 1 && timers[0].ms === 10000 ? ok('functional: auto-advance armed once with a 10 s interval') : bad('functional: expected one 10000 ms interval, got ' + JSON.stringify(timers.map(t => t.ms)));
    JSON.stringify(shown()) === '["rhy"]' ? ok('functional: Weekly rhythm is the only visible slide on load') : bad('functional: visible slides on load: ' + JSON.stringify(shown()));
    timers[0].fn();
    JSON.stringify(shown()) === '["com"]' && ovTabEls[1].on && !ovTabEls[0].on ? ok('functional: tick 1 shows Researchers in both decks and moves .on to its tab') : bad('functional: after tick 1 visible = ' + JSON.stringify(shown()));
    timers[0].fn();
    JSON.stringify(shown()) === '["rhy"]' ? ok('functional: tick 2 wraps back to Weekly rhythm') : bad('functional: after tick 2 visible = ' + JSON.stringify(shown()));
    ovTabEls[1].onclick({ target: ovTabEls[1] });
    JSON.stringify(shown()) === '["com"]' && timers[0].cleared ? ok('functional: clicking a tab shows its slide and clears the auto-advance') : bad('functional: tab click did not show com / clear the interval');
  } catch (e) {
    bad('functional: page JS threw while driving the Over-time slides -- ' + (e && e.message ? e.message : e));
  }
  // prefers-reduced-motion: the script must not arm the interval at all
  {
    const timers2 = [];
    const window2 = { addEventListener: () => {}, matchMedia: () => ({ matches: true, addEventListener() {} }) };
    try {
      new Function('document', 'window', 'localStorage', 'setInterval', 'clearInterval', scripts)(document, window2, localStorage, (fn, ms) => { timers2.push(ms); return 1; }, () => {});
      timers2.length === 0 ? ok('functional: under prefers-reduced-motion no auto-advance interval is armed') : bad('functional: reduced-motion run armed ' + timers2.length + ' interval(s)');
    } catch (e) { bad('functional: page JS threw under the reduced-motion shim -- ' + (e && e.message ? e.message : e)); }
  }
}

// ---- 8. blocklist: every data-tip tooltip and every rendered text node ----
const U_CODE = /\bu-\d+\b/, SCC_CODE = /\bscc-[a-z0-9]+\b/i;
{
  const tips = [...html.matchAll(/data-tip="([^"]*)"/g)].map(m => m[1]);
  const bad_t = tips.filter(t => U_CODE.test(t) || SCC_CODE.test(t));
  (tips.length > 0 && bad_t.length === 0) ? ok('every data-tip tooltip passes the blocklist (' + tips.length + ' checked)') : bad('a tooltip matches the blocklist: ' + (bad_t[0] || '(no tooltips found)'));
  const text = html.replace(/<[^>]+>/g, ' ');
  (!U_CODE.test(text) && !SCC_CODE.test(text)) ? ok('rendered text passes the blocklist') : bad('rendered text matches a blocklist pattern');
}

// ---- 9. viewport meta ----
has(html, '<meta name="viewport"', 'viewport meta present');

// ---- 10. layout-tightening pass (computed-layout pass): fitted
// GPU blocks, narrower label columns, a 3-column CPU node grid, an aligned
// 4-column KPI grid, deck-titled h3s, and a slim centered period strip ----
const styleBlock = (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
has(styleBlock, '.deck h3{', 'deck titles (GPU/CPU Pool, GPU/CPU Totals) get their own h3 rule');
not(styleBlock, '.kpi', 'no KPI card rules remain');
has(styleBlock, '.pool-gpu h3{border-color:#baf72e', 'GPU panel title carries the chartreuse pool-accent rule line');
has(styleBlock, '.pool-cpu h3{border-color:#4cc9db', 'CPU panel title carries the cyan pool-accent rule line');
not(styleBlock, 'h2{', 'the unused h2 rule was removed (dead CSS -- no <h2> in the markup)');
has(styleBlock, '.sechead{display:flex;align-items:baseline;justify-content:space-between', 'the Over time header is a section-header row (V2 mockup)');
has(styleBlock, 'border-bottom:1px solid var(--rule)', 'the section header carries a rule line underneath');
has(styleBlock, '.sechead .ttl{font-size:.8rem;font-weight:700', '.ttl (the section title) is styled per the mockup');
has(styleBlock, '.sechead .ctl{display:flex;align-items:center;gap:10px', '.ctl (the slide tabs) is styled per the mockup');
not(styleBlock, '.periodbar', 'the old .periodbar rules were removed (replaced by .sechead)');
not(styleBlock, '#periodctl', 'the old #periodctl deck rules were removed (replaced by the .sechead section header)');
has(styleBlock, '.sechead{flex-wrap:wrap', 'the section header wraps controls under the title on narrow screens (<=900px)');

// ---- 11. asymmetric pool split: CPU container wider so
// the 6-cluster E5 row renders on one line, panel heights come closer ----
has(styleBlock, '#gpupanel{flex:0 1 37%', 'GPU panel takes the narrower 37% flex share');
has(styleBlock, '#cpupanel{flex:1 1 0', 'CPU panel takes the wider (~63%) flex share');
has(styleBlock, '.hwlbl{color:var(--text);white-space:nowrap', 'hardware labels never wrap mid-name (.hwlbl gets white-space:nowrap)');
not(styleBlock, '.pool-cpu .hwnodes{display:grid', 'CPU node grid override was dropped -- back to flex-wrap now that the wider 60% column fits the E5 row on one line');
/--core-s:clamp\(5px,0\.35vw,12px\)/.test(styleBlock)
  ? ok('CPU core-square size carries a real fit buffer (clamp(5px,0.35vw,12px), ~31px margin at 1440)')
  : bad('--core-s is not buffered to the fitted clamp(5px,0.35vw,12px)');
/--gpu-w:clamp\(13px,0\.93vw,40px\)/.test(styleBlock)
  ? ok('GPU block width is retuned down (40% column is narrower than the old 50/50 half)')
  : bad('--gpu-w is not retuned to the fitted clamp(13px,0.93vw,40px)');

// ---- 12. even column gutters: a uniform-gutter grid with
// snug per-pool label/value column widths, instead of a one-size-fits-all
// flex-basis that left ~70px of dead space before short GPU labels ----
has(styleBlock, '.hwcols,.hwrow{display:grid;grid-template-columns:var(--lblw) var(--valw) 1fr;column-gap:18px', 'hardware rows use a uniform-gutter grid (one column-gap, per-pool column widths via --lblw/--valw); GPU keeps this shared 3-column template unmodified');
has(styleBlock, '.pool-gpu{--lblw:80px;--valw:56px', 'GPU panel gets snug columns sized to its longest label/value ("RTXP6000" / "144 GB")');
has(styleBlock, '.pool-cpu .hwcols,.pool-cpu .hwrow{grid-template-columns:var(--lblw) var(--valw) var(--ramw) 1fr;}', 'CPU gets a pool-scoped 4th column (RAM) via an override rule, not by changing the shared 3-column template');
has(styleBlock, '.pool-cpu{--lblw:120px;--valw:60px;--ramw:66px', 'CPU panel columns are sized to real measured text: label narrows (still fits "Xeon E5-2660\\u00a0v3"), Cores/RAM widen from the brief\'s literal 44px/64px pitch to fit the longest real values ("32 cores" / "1,007 GB")');

// ---- 12b. memory shown exactly once per panel: CPU gains a RAM column
// (Cores/RAM/Nodes plus the label -> CPU, Cores, RAM, Nodes); both panels'
// model tooltips drop the redundant RAM/VRAM line (node-square tooltips and
// the GPU panel's own VRAM column are unchanged) ----
const gpuPanel = sliceFrom('id="gpupanel"', ['id="cpupanel"']);
const cpuPanel = sliceFrom('id="cpupanel"', ['id="ovhead"']);
gpuPanel && cpuPanel ? ok('both hardware panels were located in the page') : bad('could not locate both hardware panels');
{
  const cpuColsBlock = (cpuPanel.match(/<div class="hwcols">([\s\S]*?)<\/div>/) || ['', ''])[1];
  const cpuColLabels = [...cpuColsBlock.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map(m => m[1]);
  JSON.stringify(cpuColLabels) === JSON.stringify(['CPU', 'Cores', 'RAM', 'Nodes'])
    ? ok('CPU .hwcols header reads CPU, Cores, RAM, Nodes in that order')
    : bad('CPU .hwcols header is ' + JSON.stringify(cpuColLabels) + ', want ["CPU","Cores","RAM","Nodes"]');

  const gpuColsBlock = (gpuPanel.match(/<div class="hwcols">([\s\S]*?)<\/div>/) || ['', ''])[1];
  const gpuColLabels = [...gpuColsBlock.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map(m => m[1]);
  JSON.stringify(gpuColLabels) === JSON.stringify(['GPU', 'VRAM', 'Nodes'])
    ? ok('GPU .hwcols header is unchanged: GPU, VRAM, Nodes')
    : bad('GPU .hwcols header is ' + JSON.stringify(gpuColLabels) + ', want ["GPU","VRAM","Nodes"] (unchanged)');
}
{
  // recompute each CPU model's per-node RAM straight from capacity.cpu.types
  // (5th field, GB) and check every rendered RAM cell against it
  const cpuRows = [...cpuPanel.matchAll(/<div class="hwrow">([\s\S]*?)<\/div>/g)].map(m => m[1]);
  cpuRows.length === data.capacity.cpu.types.length
    ? ok('CPU panel renders one .hwrow per capacity.cpu.types entry (' + cpuRows.length + ')')
    : bad('CPU panel renders ' + cpuRows.length + ' .hwrow, want ' + data.capacity.cpu.types.length);
  cpuRows.forEach((row, i) => {
    const ramCell = (row.match(/<span class="hwc hwram">([^<]*)<\/span>/) || ['', ''])[1];
    const shapeOk = /^\d{1,3}(,\d{3})* GB$/.test(ramCell);
    const ramGb = Number(data.capacity.cpu.types[i][4]);
    const expected = Math.round(ramGb).toLocaleString('en-US') + ' GB';
    (shapeOk && ramCell === expected)
      ? ok('CPU row ' + i + ' RAM cell reads "' + ramCell + '" (matches capacity.cpu.types, /^\\d{1,3}(,\\d{3})* GB$/)')
      : bad('CPU row ' + i + ' RAM cell is "' + ramCell + '", want "' + expected + '" matching /^\\d{1,3}(,\\d{3})* GB$/');
  });
}
{
  // every model tooltip (both panels) is exactly "<b>Model</b><br>Server: X" --
  // no RAM/VRAM line. Node-square tooltips (class="cnode") are untouched and
  // deliberately excluded from this selector.
  const tips = [...html.matchAll(/class="hwlbl" data-tip="([^"]*)"/g)].map(m => m[1]);
  tips.length > 0
    ? ok('found ' + tips.length + ' model tooltips (.hwlbl data-tip) to check')
    : bad('found no .hwlbl model tooltips');
  const unesc = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<');
  tips.forEach((t, i) => {
    const plain = unesc(t);
    /^<b>[^<]+<\/b><br>Server: [^<]+$/.test(plain)
      ? ok('model tooltip ' + i + ' matches "<b>Model</b><br>Server: X" exactly (no RAM/VRAM line)')
      : bad('model tooltip ' + i + ' is "' + plain + '", does not match "<b>Model</b><br>Server: X"');
  });
  for (const needle of ['RAM:', 'VRAM:'])
    not(html, needle, 'no data-tip (or any other page text) contains "' + needle + '" -- memory appears once, as the CPU RAM column / the GPU VRAM column');
}

// ---- 13. sticky footer + wide-screen growth ----
has(styleBlock, 'body{display:flex;flex-direction:column', 'body is a flex column (sticky-footer pattern)');
has(styleBlock, 'main{max-width:min(var(--content-max),98vw);width:100%;margin:0 auto;padding:14px var(--content-pad) 60px;flex:1 0 auto', 'main grows to fill the flex column (flex:1 0 auto)');
has(styleBlock, 'main{max-width:min(var(--content-max),98vw);width:100%', 'main carries width:100% -- in a column-flex body a margin:0 auto item is fit-content wide unless width is set, and the >=1700px growth rule + all fit margins assume main = min(var(--content-max),98vw)');
has(styleBlock, 'margin-top:auto', 'the footer is pushed to the bottom on tall/short pages (margin-top:auto)');
{
  const bodyIdx = html.indexOf('<body');
  const headerIdx = html.indexOf('<header');
  const mainIdx = html.indexOf('<main>');
  const footerIdx = html.indexOf('<footer');
  (bodyIdx >= 0 && bodyIdx < headerIdx && headerIdx < mainIdx && mainIdx < footerIdx)
    ? ok('header, main, footer are direct children of body in that order')
    : bad('header/main/footer are not in the expected body order');
}
has(styleBlock, '@media(min-width:1700px){.pool-cpu{--core-s:clamp(8px,0.5vw,12px)', 'wide-screen (>=1700px) media block retunes --core-s for bigger units on desktops');
has(styleBlock, '.pool-gpu{--gpu-w:clamp(22px,1.4vw,40px);--gpu-h:clamp(11px,0.7vw,20px)', 'wide-screen media block retunes --gpu-w/--gpu-h');
has(styleBlock, '.deck{padding:13px 14px', 'wide-screen media block gives decks slightly airier padding');

// ---- 14. tighter page margins: 96vw -> 98vw, content-pad
// 20px -> 12px, deck padding tightened to match ----
has(styleBlock, '--content-max:2100px;--content-pad:12px', 'content-pad is tightened to 12px');
has(styleBlock, 'main{max-width:min(var(--content-max),98vw)', 'main uses the wider 98vw outer gutter');
has(styleBlock, '.hwrap{max-width:min(var(--content-max),98vw)', 'the header lockup (.hwrap) uses the wider 98vw outer gutter (stays aligned with the decks)');
has(styleBlock, '.pagefoot{max-width:min(var(--content-max),98vw)', 'the footer (.pagefoot) uses the wider 98vw outer gutter (stays aligned with the decks)');
has(styleBlock, '.deck{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:11px 12px', 'deck padding is tightened to 11px 12px below the wide-screen breakpoint');

// ---- 15. footer mirrors the portals ----
{
  const footerStart = html.indexOf('<footer class="pagefoot"');
  const footerEnd = html.indexOf('</footer>', footerStart) + '</footer>'.length;
  const footerBlock = footerStart >= 0 ? html.slice(footerStart, footerEnd) : '';

  P('div.ft-l') === 'footer.pagefoot' ? ok('.ft-l sits inside <footer class="pagefoot">') : bad('.ft-l parent is ' + P('div.ft-l'));
  P('div.ft-c') === 'footer.pagefoot' ? ok('.ft-c sits inside <footer class="pagefoot">') : bad('.ft-c parent is ' + P('div.ft-c'));
  P('div.ft-r') === 'footer.pagefoot' ? ok('.ft-r sits inside <footer class="pagefoot">') : bad('.ft-r parent is ' + P('div.ft-r'));
  (footerBlock.indexOf('class="ft-l"') >= 0 && footerBlock.indexOf('class="ft-l"') < footerBlock.indexOf('class="ft-c"') && footerBlock.indexOf('class="ft-c"') < footerBlock.indexOf('class="ft-r"'))
    ? ok('footer zones appear in order: ft-l, ft-c, ft-r')
    : bad('footer zones are not in ft-l/ft-c/ft-r order');

  (footerBlock.match(/class="ft-emblem"/g) || []).length === 1
    ? ok('exactly one .ft-emblem image in the footer (single emblem, no theme pair)')
    : bad('footer does not have exactly one .ft-emblem image');
  for (const needle of ['ft-light', 'ft-dark', 'id="poke"', 'ft-m'])
    not(html, needle, 'no "' + needle + '" anywhere (no theme pair, no codename toggle)');

  const ftGh = (footerBlock.match(/<a class="ft-link ft-gh"[^>]*>/) || [''])[0];
  has(ftGh, 'href="https://github.com/BU-CDS/cds-scc-pub"', '.ft-gh anchor points at this page\'s own public repo');
  has(ftGh, 'target="_blank"', '.ft-gh anchor opens in a new tab');
  has(ftGh, 'rel="noopener"', '.ft-gh anchor carries rel="noopener"');
  has(ftGh, 'aria-label="GitHub repository"', '.ft-gh anchor carries an aria-label');
  (footerBlock.match(/<svg viewBox="0 0 16 16"/g) || []).length === 1
    ? ok('.ft-gh contains exactly one <svg viewBox="0 0 16 16"> (the GitHub mark)')
    : bad('.ft-gh does not contain exactly one GitHub-mark svg');

  const ftR = (footerBlock.match(/<div class="ft-r">([\s\S]*?)<\/div>/) || ['', ''])[1];
  has(ftR, 'href="https://www.bu.edu/policies/digital-privacy-statement/"', '.ft-r anchor links to the BU Privacy Statement');
  has(ftR, 'rel="noopener"', '.ft-r anchor carries rel="noopener"');
  has(ftR, '>Privacy Statement<', '.ft-r anchor reads "Privacy Statement"');

  const FOOTER_CSS_RULES = [
    '.pagefoot{max-width:min(var(--content-max),98vw);width:100%;margin:0 auto;margin-top:auto;padding:18px var(--content-pad) 30px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;}',
    '.pagefoot .ft-l{flex:1 1 200px;display:flex;align-items:center;}',
    '.pagefoot .ft-c{flex:0 0 auto;text-align:center;}',
    '.pagefoot .ft-r{flex:1 1 200px;text-align:right;}',
    '.ft-emblem{height:30px;width:auto;display:block;}',
    '.ft-link{color:var(--muted);font-size:0.75rem;text-decoration:none;display:inline-flex;align-items:center;}',
    '.ft-link:hover{color:var(--used);text-decoration:underline;}',
    '.ft-gh{color:var(--muted);}',
    '.ft-gh:hover{color:var(--used);}',
    '.ft-gh svg{height:30px;width:auto;display:block;}',
  ];
  for (const rule of FOOTER_CSS_RULES) has(styleBlock, rule, 'footer CSS rule present verbatim: ' + rule.slice(0, 44) + (rule.length > 44 ? '...' : ''));
  not(html, 'ft-text', '.ft-text is gone from both markup and CSS');
  has(styleBlock, '.pagefoot{max-width:min(var(--content-max),98vw);width:100%', '.pagefoot carries width:100% -- in a column-flex body a margin:0 auto item is fit-content wide unless width is set, which was shrink-wrapping the footer\'s three zones into a jumbled center block');

  const LIVEWRAP_PREFIX = '<div class="livewrap"><span class="liveupd"><a href="https://rcs.bu.edu" target="_blank" rel="noopener">Data from BU SCC</a> · updated quarterly · ';
  const livewrapCount = html.split(LIVEWRAP_PREFIX).length - 1;
  livewrapCount === 1
    ? ok('the livewrap status line occurs exactly once')
    : bad('livewrap occurs ' + livewrapCount + ' times, want exactly 1');
  const mainIdx = html.indexOf('<main>');
  const livewrapIdx = html.indexOf(LIVEWRAP_PREFIX);
  const firstDeckrowIdx = html.indexOf('<div class="deckrow">');
  (mainIdx >= 0 && livewrapIdx > mainIdx && livewrapIdx < firstDeckrowIdx)
    ? ok('livewrap sits between <main> and the first deckrow')
    : bad('livewrap is not positioned between <main> and the first deckrow');
  not(footerBlock, 'updated quarterly', 'the footer no longer carries the data stamp (moved to livewrap)');
  not(html, 'SGE accounting', '"SGE accounting" no longer appears anywhere (status line reads "Data from BU SCC")');
}

// ---- 16. livewrap must not double-pad: it is nested
// inside <main>, which already applies the 98vw max-width and content-pad,
// so .livewrap itself must carry neither -- only the portals' top-level
// .livewrap needs its own gutter ----
has(styleBlock, '.livewrap{margin:0 0 10px;padding:0;display:flex;flex-wrap:wrap;gap:16px;align-items:center;}', '.livewrap uses the no-double-pad rule (nested under main, not top-level like the portals\')');
{
  const livewrapRule = (styleBlock.match(/\.livewrap\{[^}]*\}/) || [''])[0];
  (!livewrapRule.includes('var(--content-pad)') && !livewrapRule.includes('max-width'))
    ? ok('.livewrap carries neither var(--content-pad) nor max-width (main already applies both)')
    : bad('.livewrap still double-pads: ' + livewrapRule);
}

// ---- 17. status-line stamp copy + link: "Data from
// SGE accounting and gpustats" renamed to "Data from BU SCC", hyperlinked
// to rcs.bu.edu; " · updated quarterly · <date>" stays plain text ----
has(styleBlock, '.liveupd a{color:inherit;text-decoration:underline;text-decoration-color:var(--muted);text-underline-offset:2px;}', '.liveupd a carries the underline-link styling');
has(styleBlock, '.liveupd a:hover{color:var(--used);text-decoration-color:currentColor;}', '.liveupd a:hover carries the hover-color rule');

// ---- 18a. no embedded font (2026-11-15): BU's Whitney licence (MarCom; a Monotype web
// project with page-view tracking) does not cover a public, self-contained copy, so the page
// carries no font file and names no Whitney face; the header uses the system sans stack ----
for (const needle of ['@font-face', 'font/woff', 'Whitney'])
  not(html, needle, 'no embedded font: "' + needle + '" appears nowhere in the page');

// ---- 18. embedded assets are never silently empty (b64() now fails closed on a
// missing file at build time; this checks the payloads it does embed aren't
// near-empty either -- each must clear a real floor size) ----
{
  const payloads = [...html.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)].map(m => m[1]);
  payloads.length === 2
    ? ok('found exactly 2 embedded base64 image payloads (plate, emblem)')
    : bad('found ' + payloads.length + ' embedded base64 image payloads, want 2 (plate, emblem)');
  payloads.forEach((p, i) => {
    p.length > 1024
      ? ok('embedded asset payload #' + (i + 1) + ' clears the empty-file floor (' + p.length + ' base64 chars)')
      : bad('embedded asset payload #' + (i + 1) + ' is suspiciously small (' + p.length + ' base64 chars) -- possible truncated/near-empty asset');
  });
}

// ---- 20. R5.2 growth note: a pool panel's <h3> ("GPU Pool" / "CPU Pool", not
// the totals cards) carries a right-aligned, muted <span class="hnote"> reading
// "{n} GPUs/GPU added in the past 12 months" (GPU) / "{n} cores/core added in
// the past 12 months" (CPU; added_12m counts cores, 2026-11-15), rendered ONLY when that pool's added_12m is > 0;
// no .hnote at all otherwise. Checked against today's real data (present case:
// GPU; absent case: CPU) ----
{
  const gpuPanelH3 = (gpuPanel.match(/<h3>([\s\S]*?)<\/h3>/) || ['', ''])[1];
  const cpuPanelH3 = (cpuPanel.match(/<h3>([\s\S]*?)<\/h3>/) || ['', ''])[1];
  const gpuAdded = Number(data.capacity.gpu.added_12m);
  const cpuAdded = Number(data.capacity.cpu.added_12m);
  const gpuWord = gpuAdded === 1 ? 'GPU' : 'GPUs';
  const cpuWord = cpuAdded === 1 ? 'core' : 'cores';
  if (gpuAdded > 0) {
    has(gpuPanelH3, '<span class="hnote">' + gpuAdded + ' ' + gpuWord + ' added in the past 12 months</span>', 'GPU panel <h3> carries the growth note span (added_12m=' + gpuAdded + ')');
  } else {
    not(gpuPanelH3, 'class="hnote"', 'GPU panel <h3> carries no .hnote (added_12m=0)');
  }
  if (cpuAdded > 0) {
    has(cpuPanelH3, '<span class="hnote">' + cpuAdded + ' ' + cpuWord + ' added in the past 12 months</span>', 'CPU panel <h3> carries the growth note span (added_12m=' + cpuAdded + ')');
  } else {
    not(cpuPanelH3, 'class="hnote"', 'CPU panel <h3> carries no .hnote (added_12m=0)');
  }
  has(styleBlock, '.pool h3{display:flex;justify-content:space-between;align-items:baseline}', '.pool h3 gets the flex rule that right-aligns the growth note');
  has(styleBlock, '.hnote{font-weight:400;font-size:0.72rem;color:var(--muted);letter-spacing:0;white-space:nowrap}', '.hnote is styled per R5.2 (muted, small, non-wrapping)');
}

// ---- 20b. fixture checks: rebuild the page from a copy of the real data
// with capacity.{cpu,gpu}.added_12m mutated, to prove the growth note is
// genuinely data-driven rather than hardcoded ----
const buildFixturePage = (mutator) => {
  const tmp = mkdtempSync(join(tmpdir(), 'cluster-page-fixture-'));
  try {
    const pageSrc = readFileSync(join(SDIR, '..', 'build_cluster_page.R'), 'utf8');
    writeFileSync(join(tmp, 'build_cluster_page.R'), pageSrc);
    mkdirSync(join(tmp, 'assets'));
    writeFileSync(join(tmp, 'assets', 'favicon.ico'), readFileSync(join(SDIR, '..', 'assets', 'favicon.ico')));   // the one in-tree asset the builder reads
    const fixture = JSON.parse(JSON.stringify(data));
    mutator(fixture);
    mkdirSync(join(tmp, 'output'), { recursive: true });
    writeFileSync(join(tmp, 'output', 'cluster_data.json'), JSON.stringify(fixture));
    execFileSync('Rscript', [join(tmp, 'build_cluster_page.R')], { stdio: 'pipe' });
    const fixtureHtml = readFileSync(join(tmp, 'index.html'), 'utf8');
    const fGpuPanel = fixtureHtml.slice(fixtureHtml.indexOf('id="gpupanel"'), fixtureHtml.indexOf('id="cpupanel"'));
    const fCpuPanel = fixtureHtml.slice(fixtureHtml.indexOf('id="cpupanel"'), fixtureHtml.indexOf('id="ovhead"'));
    return {
      gpuH3: (fGpuPanel.match(/<h3>([\s\S]*?)<\/h3>/) || ['', ''])[1],
      cpuH3: (fCpuPanel.match(/<h3>([\s\S]*?)<\/h3>/) || ['', ''])[1],
      html: fixtureHtml,
    };
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
};

// swapped: capacity.cpu.added_12m and capacity.gpu.added_12m swapped, confirm
// which panel carries the .hnote span flips with it -- proves the note is
// genuinely data-driven, not hardcoded to "GPU always present / CPU always absent"
{
  try {
    const { gpuH3: fGpuH3, cpuH3: fCpuH3 } = buildFixturePage((fixture) => {
      fixture.capacity.cpu.added_12m = 32;   // one 32-core node
      fixture.capacity.gpu.added_12m = 0;
    });
    not(fGpuH3, 'class="hnote"', 'fixture (swapped): GPU panel <h3> carries no .hnote once its added_12m is 0');
    has(fCpuH3, '<span class="hnote">32 cores added in the past 12 months</span>', 'fixture (swapped): CPU panel <h3> now carries the growth note, in cores, once its added_12m is > 0 -- the note flips panels with the data');
    not(fCpuH3, 'nodes added', 'fixture (swapped): the CPU note never calls cores "nodes"');
  } catch (e) {
    bad('fixture (swapped) growth-note rebuild failed: ' + (e && e.message ? e.message : e));
  }
}

// singular: added_12m === 1 must render the singular word ("1 GPU added...",
// never "1 GPUs added...")
{
  try {
    const { gpuH3: fGpuH3, cpuH3: fCpuH3 } = buildFixturePage((fixture) => {
      fixture.capacity.gpu.added_12m = 1;
      fixture.capacity.cpu.added_12m = 1;
    });
    has(fGpuH3, '<span class="hnote">1 GPU added in the past 12 months</span>', 'fixture (added_12m=1): GPU panel <h3> uses the singular "GPU" wording, not "GPUs"');
    not(fGpuH3, '1 GPUs added', 'fixture (added_12m=1): GPU panel <h3> never renders the plural "GPUs" wording for n=1');
    has(fCpuH3, '<span class="hnote">1 core added in the past 12 months</span>', 'fixture (added_12m=1): CPU panel <h3> uses the singular "core" wording');
  } catch (e) {
    bad('fixture (added_12m=1) growth-note rebuild failed: ' + (e && e.message ? e.message : e));
  }
}

// ---- 21. negative: no user code or project name from either internal
// de-identified emit (read fresh at test time, mirroring scripts/gate_cluster.mjs's
// own leak-check reader) appears anywhere in the page. Same rule as the gate (2026-11-15):
// whole words, any case, HTML entities decoded, embedded base64 assets skipped (fixed font
// and image files carry no data). A bare substring test failed on a 2-character project
// name inside "<head>" and a 3-character one inside an image. ----
{
  const PUB_CPU_CLONE = process.env.PUB_CPU_CLONE || '/usr3/bustaff/mhorn/repos/cpu-cds-scc';
  const PUB_GPU_CLONE = process.env.PUB_GPU_CLONE || '/usr3/bustaff/mhorn/repos/gpu-cds-scc';
  const readInternalCodes = (path) => {
    let d;
    try { d = JSON.parse(readFileSync(path, 'utf8')); }
    catch { return { users: [], projects: [] }; }
    const cols = d.Fcols || [];
    const ui = cols.indexOf('user'), pi = cols.indexOf('proj');
    if (ui < 0 || pi < 0) return { users: [], projects: [] };
    const users = new Set(), projects = new Set();
    for (const row of d.F || []) {
      if (row[ui]) users.add(row[ui]);
      if (row[pi]) projects.add(row[pi]);
    }
    return { users: [...users], projects: [...projects] };
  };
  const cpuCodes = readInternalCodes(join(PUB_CPU_CLONE, 'output', 'portal_data.json'));
  const gpuCodes = readInternalCodes(join(PUB_GPU_CLONE, 'output', 'portal_data.json'));
  const userCodes = [...new Set([...cpuCodes.users, ...gpuCodes.users])];
  const projectNames = [...new Set([...cpuCodes.projects, ...gpuCodes.projects])];
  (userCodes.length > 0 && projectNames.length > 0)
    ? ok('leak-check blocklist loaded from both internal emits (' + userCodes.length + ' user codes, ' + projectNames.length + ' project names)')
    : bad('leak-check blocklist is empty -- internal emit unreadable/unusable');
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const scanText = html.replace(/data:[a-z0-9\/+.-]+;base64,[A-Za-z0-9+\/=]+/gi, 'data:')
    .replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e.toLowerCase()] ?? m));
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hit = (v) => new RegExp('\\b' + escRe(v) + '\\b', 'i').test(scanText);
  const leakedUsers = userCodes.filter(hit);
  const leakedProjects = projectNames.filter(hit);
  leakedUsers.length === 0 ? ok('no internal-emit user code appears anywhere in the page') : bad('user code(s) leaked into the page: ' + leakedUsers.length + ' hit(s)');
  leakedProjects.length === 0 ? ok('no internal-emit project name appears anywhere in the page') : bad('project name(s) leaked into the page: ' + leakedProjects.length + ' hit(s)');
}

// ---- 22. Over time (R6): header + tabs, two Activity decks, two server-rendered
// slides each (rhy visible, com hidden; Monthly volume removed 2026-11-15); columns, tooltips, hero and peak figures recomputed from cluster_data.json ----
// the page's public rounding (build_cluster_page.R round_sig2 / round_to), mirrored
const sig2 = (x) => (x < 100 ? Math.round(x) : (p => Math.round(x / p) * p)(10 ** (Math.floor(Math.log10(x)) - 1)));
const roundTo = (x, k) => k * Math.round(x / k);
const dayLabel = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };
const plusDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const allUnionOv = [...new Set([...data.meta.months_cpu, ...data.meta.months_gpu])].sort();
{
  const ovheadStart = html.indexOf('id="ovhead"');
  (ovheadStart > html.indexOf('id="cpupanel"') && ovheadStart < html.indexOf('</main>')) ? ok('the Over time header follows the pool panels inside main') : bad('#ovhead is not between the pool panels and </main>');
  P('div#ovhead.sechead') === 'main' ? ok('#ovhead is a direct child of main') : bad('#ovhead parent is ' + P('div#ovhead.sechead'));
  P('div#gpuov.deck.ov') === 'div.deckrow' ? ok('GPU Activity deck sits inside a deckrow') : bad('GPU Activity deck parent is ' + P('div#gpuov.deck.ov'));
  P('div#cpuov.deck.ov') === 'div.deckrow' ? ok('CPU Activity deck sits inside a deckrow') : bad('CPU Activity deck parent is ' + P('div#cpuov.deck.ov'));
  (html.indexOf('id="gpuov"') < html.indexOf('id="cpuov"')) ? ok('GPU Activity deck precedes the CPU deck') : bad('GPU Activity deck does not precede the CPU deck');
  const ovhead = html.slice(ovheadStart, html.indexOf('<div class="deckrow">', ovheadStart));
  const ovTtl = (ovhead.match(/class="ttl">([\s\S]*?)<\/div>/) || ['', ''])[1];
  has(ovTtl, 'Over time', '.ttl reads "Over time"');
  has(ovTtl, 'Over time<span>' + rangeTextJS(allUnionOv) + '</span>', '.ttl states the full record range (union of both pools) and nothing else');
  const ovCtl = ovhead.slice(ovhead.indexOf('class="ctl"'));
  has(ovCtl, 'class="seg" id="ovtabs"', '.ctl carries the #ovtabs segmented bar');
  has(ovCtl, '<button class="on" data-s="rhy">Weekly rhythm</button>', 'Weekly rhythm tab is first and on by default');
  has(ovCtl, '<button data-s="com">Researchers</button>', 'Researchers tab present');
  (ovCtl.match(/<button\b/g) || []).length === 2 ? ok('exactly two slide tabs') : bad('slide tab count != 2');
  not(html, 'Monthly volume', 'the Monthly volume slide and tab are gone');
  not(html, 'Nominal capacity', 'no nominal-capacity figure remains');
  not(html, 'class="trk"', 'no capacity track remains');
}
const ovDeck = (pool) => pool === 'gpu' ? sliceFrom('id="gpuov"', ['id="cpuov"']) : sliceFrom('id="cpuov"', ['</main>']);
const slideOf = (deck, s) => {
  const a = deck.indexOf('<div class="slide" data-s="' + s + '"'); if (a < 0) return '';
  const rest = deck.slice(a);
  const nexts = ['rhy', 'com'].filter(x => x !== s).map(x => rest.indexOf('<div class="slide" data-s="' + x + '"')).filter(i => i > 0);
  return rest.slice(0, nexts.length ? Math.min(...nexts) : rest.length);
};
for (const pool of ['gpu', 'cpu']) {
  const deck = ovDeck(pool), P_ = pool.toUpperCase();
  const months = pool === 'gpu' ? data.meta.months_gpu : data.meta.months_cpu;
  const unit = pool === 'gpu' ? 'GPU-h' : 'core-h', unitLong = pool === 'gpu' ? 'GPU-hours' : 'core-hours';
  const weekly = data.weekly.filter(r => r[1] === pool).slice().sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(r => [r[0], r[1], sig2(r[2])]);
  has(deck, '<h3>' + P_ + ' Activity</h3>', P_ + ' Activity deck heading');
  const order = ['rhy', 'com'].map(s => deck.indexOf('<div class="slide" data-s="' + s + '"'));
  (order[0] >= 0 && order[0] < order[1]) ? ok(P_ + ': slides in the order rhy, com') : bad(P_ + ': slides missing or out of order');
  has(deck, '<div class="slide" data-s="rhy"><div class="cap">', P_ + ': Weekly rhythm slide is visible in the server render');
  has(deck, '<div class="slide" data-s="com" hidden>', P_ + ': Researchers slide is hidden in the server render');
  const rhy = slideOf(deck, 'rhy'), com = slideOf(deck, 'com');
  const cols = (s) => [...s.matchAll(/<span class="col" data-tip="/g)];
  const rc = cols(rhy), cc = cols(com);
  rc.length === weekly.length ? ok(P_ + ' rhy: one column per weekly row (' + rc.length + ')') : bad(P_ + ' rhy: ' + rc.length + ' columns, want ' + weekly.length);
  cc.length === months.length ? ok(P_ + ' com: one column per published month (' + cc.length + ')') : bad(P_ + ' com: ' + cc.length + ' columns, want ' + months.length);
  for (const [name, s, n] of [['rhy', rhy, rc.length], ['com', com, cc.length]]) {
    (s.match(/data-tip="/g) || []).length === n ? ok(P_ + ' ' + name + ': every column has a tooltip and nothing else does') : bad(P_ + ' ' + name + ': tooltip count != column count');
    (s.match(/<em class="pk"/g) || []).length === 1 ? ok(P_ + ' ' + name + ': exactly one peak label') : bad(P_ + ' ' + name + ': peak label count != 1');
    const first = (s.match(/<div class="xax">.*?<span style="left:[\d.]+%">([^<]+)<\/span>/) || ['', ''])[1];
    /\d{4}$/.test(first) ? ok(P_ + ' ' + name + ': first x label carries a year (' + first + ')') : bad(P_ + ' ' + name + ': first x label lacks a year: "' + first + '"');
    const yax = (s.match(/<div class="yax">([\s\S]*?)<\/div>/) || ['', ''])[1];
    const vals = [...yax.matchAll(/style="bottom:([\d.]+)%">([\d.]+)(k|M)?</g)].filter(m => m[1] !== '0').map(m => Number(m[2]) * (m[3] === 'M' ? 1e6 : m[3] === 'k' ? 1e3 : 1));
    const diffs = vals.slice(1).map((v, i) => v - vals[i]);
    (vals.length >= 3 && vals.length <= 5 && diffs.every(d => Math.abs(d - diffs[0]) < 1e-6)) ? ok(P_ + ' ' + name + ': 3-5 evenly spaced round y ticks (' + vals.join(',') + ')') : bad(P_ + ' ' + name + ': y ticks not 3-5 evenly spaced: ' + JSON.stringify(vals));
  }
  if (weekly.length) {
    const peakW = weekly.reduce((a, r) => (r[2] > a[2] ? r : a), weekly[0]);
    has(rhy, '<span class="hero"><b>' + fmt(peakW[2]) + '</b>' + unitLong + ' in the busiest week (' + dayLabel(peakW[0]) + ')</span>', P_ + ' rhy: hero = busiest week');
    has(rhy, 'complete weeks, ' + dayLabel(weekly[0][0]) + ' – ' + dayLabel(plusDays(weekly[weekly.length - 1][0], 6)), P_ + ' rhy: subtitle spans first Monday – last Sunday');
    has(rhy, '<div class="plot wk">', P_ + ' rhy: weekly plot carries the .wk class');
    has(rhy, '&lt;b>Week of ' + dayLabel(weekly[0][0]) + '&lt;/b>&lt;br>' + fmt(weekly[0][2]) + ' ' + unit + ' reserved', P_ + ' rhy: first week tooltip');
    // bar heights carry the rounded value too (heights are % of top = 1.04 x the rounded max)
    const top = Math.max(...weekly.map(r => r[2]), 1) * 1.04;
    const hs = [...rhy.matchAll(/<i class="bar" style="height:([\d.]+)%">/g)].map(m => Number(m[1]));
    (hs.length === weekly.length && hs.every((h, i) => Math.abs(h - 100 * weekly[i][2] / top) < 0.006))
      ? ok(P_ + ' rhy: every bar height is drawn from the rounded weekly value')
      : bad(P_ + ' rhy: bar heights do not match the rounded weekly values');
  } else bad(P_ + ' rhy: no weekly rows for this pool in cluster_data.json');
  const allRaw = communityFor('ALL', pool), all = { users: roundTo(allRaw.users, 10), groups: roundTo(allRaw.groups, 10) };
  has(com, '<span class="hero"><b>' + fmt(all.users) + '</b>researchers · <b>' + fmt(all.groups) + '</b>research groups since ' + monthLbl(months[0], true) + '</span>', P_ + ' com: hero = distinct researchers/groups over the record');
  has(com, '<span class="lg"><i class="u"></i>Researchers<i class="g"></i>Research groups</span>', P_ + ' com: legend present (two series)');
  const usersR = (m) => roundTo(communityFor('M:' + m, pool).users, 5), groupsR = (m) => roundTo(communityFor('M:' + m, pool).groups, 5);
  const peakU = months.reduce((a, m) => (usersR(m) > usersR(a) ? m : a), months[0]);
  has(com, '">' + fmt(usersR(peakU)) + '</em>', P_ + ' com: peak label = max monthly researchers, rounded to 5');
  months.every(m => com.includes('&lt;b>' + monthLbl(m, true) + '&lt;/b>&lt;br>' + fmt(usersR(m)) + ' researchers · ' + fmt(groupsR(m)) + ' research groups'))
    ? ok(P_ + ' com: every month tooltip shows counts rounded to 5')
    : bad(P_ + ' com: a month tooltip does not show counts rounded to 5');
}
has(styleBlock, '.slide[hidden]{display:none}', 'hidden slides are display:none explicitly');
has(styleBlock, '#gpuov{flex:0 1 37%;}#cpuov{flex:1 1 0;}', 'Activity decks keep the 37%/63% split');
has(styleBlock, '#gpuov h3{border-color:#baf72e;}', 'GPU Activity h3 carries the chartreuse accent');
has(styleBlock, '#cpuov h3{border-color:#4cc9db;}', 'CPU Activity h3 carries the cyan accent');
has(styleBlock, '.ov .slot,.ov .pair{position:relative;width:100%;max-width:24px;height:100%;}', 'columns are capped at 24px');
has(styleBlock, '.ov .cols{position:absolute;inset:0;display:flex;align-items:flex-end;gap:2px;', 'adjacent columns keep a 2px surface gap');
has(styleBlock, '.ov .wk .cols{gap:1px;}', 'weekly columns use a 1px gap');
has(styleBlock, '.ov .bar{position:absolute;left:0;right:0;bottom:0;background:var(--used);border-radius:4px 4px 0 0;}', 'bars: teal, 4px rounded top, full opacity');
not(styleBlock, 'opacity:var(--dim)', 'no column is dimmed: there is no period highlight');
has(styleBlock, '.ov .pair .g{background:var(--ember);}', 'research-groups bars use the ember hue');
has(styleBlock, '.ov .grid i{position:absolute;left:0;right:0;border-top:1px solid var(--grid);}', 'gridlines are solid hairlines');
has(html, "matchMedia('(prefers-reduced-motion: reduce)')", 'auto-advance consults prefers-reduced-motion');
has(html, 'setInterval(', 'auto-advance uses a timer');
not(html, 'prefers-color-scheme', 'still no theme machinery');

// ---- 22b. fixture: a pool with no weekly rows renders "No <POOL> data" in place
// of its rhythm plot (R6.6) ----
{
  try {
    const { html: fh } = buildFixturePage((fixture) => { fixture.weekly = fixture.weekly.filter(r => r[1] !== 'gpu'); });
    const fGpu = fh.slice(fh.indexOf('id="gpuov"'), fh.indexOf('id="cpuov"'));
    has(fGpu, '<div class="nodata">No GPU data</div>', 'fixture (no GPU weekly rows): GPU rhythm slide shows "No GPU data"');
    not(fGpu, '<div class="plot wk">', 'fixture (no GPU weekly rows): GPU rhythm slide draws no weekly plot');
    const fCpu = fh.slice(fh.indexOf('id="cpuov"'), fh.indexOf('</main>'));
    has(fCpu, '<div class="plot wk">', 'fixture (no GPU weekly rows): CPU rhythm plot unaffected');
  } catch (e) { bad('fixture (no GPU weekly rows) rebuild failed: ' + (e && e.message ? e.message : e)); }
}

// ---- 22c. y-axis tick labels keep the .5 on 2.5-step scales (regression): when
// nice_ticks() picks a 2 500-unit step (top in [12k,15k)), tick_label() must not
// turn 2500/7500 into "3k"/"8k" -- decoding the shown labels back to numbers
// must still be evenly spaced, exactly like the §22 y-tick check ----
{
  try {
    const { html: fh } = buildFixturePage((fixture) => {
      const gpuWeekly = fixture.weekly.filter((r) => r[1] === 'gpu');
      if (gpuWeekly.length) gpuWeekly[0][2] = 12000; // forces nice_ticks() to the 2500 step (top = 12480)
    });
    const fGpu = fh.slice(fh.indexOf('id="gpuov"'), fh.indexOf('id="cpuov"'));
    const rhyStart = fGpu.indexOf('<div class="slide" data-s="rhy"');
    const rhyRest = rhyStart >= 0 ? fGpu.slice(rhyStart) : '';
    const comIdx = rhyRest.indexOf('<div class="slide" data-s="com"');
    const rhySlide = comIdx > 0 ? rhyRest.slice(0, comIdx) : rhyRest;
    has(rhySlide, '>2.5k<', 'fixture (GPU weekly max forced to 12,000): a "2.5k" tick label is rendered, not rounded to "3k"');
    const yax = (rhySlide.match(/<div class="yax">([\s\S]*?)<\/div>/) || ['', ''])[1];
    const vals = [...yax.matchAll(/style="bottom:([\d.]+)%">([\d.]+)(k|M)?</g)].filter((m) => m[1] !== '0').map((m) => Number(m[2]) * (m[3] === 'M' ? 1e6 : m[3] === 'k' ? 1e3 : 1));
    const diffs = vals.slice(1).map((v, i) => v - vals[i]);
    (vals.length >= 3 && vals.length <= 5 && diffs.every((d) => Math.abs(d - diffs[0]) < 1e-6))
      ? ok('fixture (GPU weekly max forced to 12,000): GPU rhythm y ticks decode evenly spaced (' + vals.join(',') + ')')
      : bad('fixture (GPU weekly max forced to 12,000): GPU rhythm y ticks not evenly spaced: ' + JSON.stringify(vals));
  } catch (e) { bad('fixture (GPU weekly max forced to 12,000) rebuild failed: ' + (e && e.message ? e.message : e)); }
}

// ---- 23. Explorer links: a header utilities cluster in the pool explorers' own
// .hutils/.hbtn pill design, pinned top-right: GPU Explorer and CPU Explorer in the
// panels' left-to-right order. The explorers are org-restricted (an anonymous visitor
// is redirected to sign-in), hence a tooltip on each pill, in the page's own data-tip
// form so it shows at once and styled like every other tip; a native title would
// wait on the browser's hover delay. The "Members" caption that once opened the
// cluster is gone (2026-09-02): it said what the tip says. Same-tab navigation, as
// the explorers' own cross-links. Below 1000px the cluster unpins and sits
// right-aligned under the lockup: this page's lockup is longer than the explorers',
// and the pinned pills collide with it at ~820px. ----
{
  const headerBlock = (html.match(/<header>([\s\S]*?)<\/header>/) || ['', ''])[1];
  const hutils = (headerBlock.match(/<div class="hutils">([\s\S]*?)<\/div>/) || ['', ''])[1];
  hutils ? ok('header carries a .hutils utilities cluster') : bad('no <div class="hutils"> inside <header>');
  (headerBlock.indexOf('<div class="hutils">') > headerBlock.indexOf('</h1>'))
    ? ok('.hutils follows the h1 lockup in the markup (so the unpinned narrow layout flows under it)')
    : bad('.hutils does not follow the h1 lockup');
  not(hutils, 'class="hcap"', 'no caption before the pills (the tip carries the members note)');
  const btns = [...hutils.matchAll(/<a class="hbtn"[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);
  btns.length === 2 ? ok('exactly two .hbtn anchors') : bad('found ' + btns.length + ' .hbtn anchors, want 2');
  const [g = '', c = ''] = btns;
  has(g, 'href="https://gpu.cds.bu.edu"', 'first pill links to the GPU Explorer');
  has(g, '<span class="gpuword">GPU</span> Explorer', 'first pill reads GPU Explorer with the GPU word in its accent span');
  has(c, 'href="https://cpu.cds.bu.edu"', 'second pill links to the CPU Explorer');
  has(c, '<span class="cpuword">CPU</span> Explorer', 'second pill reads CPU Explorer with the CPU word in its accent span');
  for (const b of btns) {
    has(b, 'data-tip="CDS members: sign-in required"', 'each pill carries the members / sign-in note as a page tip');
    not(b, 'title=', 'no native title tooltip on the pill (the browser delays those)');
    not(b, 'target=', "pills navigate in the same tab, like the explorers' own cross-links");
  }
  has(styleBlock, '.hutils{position:absolute;top:10px;right:18px;display:flex;gap:8px;z-index:2;align-items:center;}', '.hutils is pinned top-right of the header');
  has(styleBlock, '.hbtn{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.28);color:var(--headfg);font:inherit;font-size:0.688rem;padding:3px 10px;border-radius:5px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;}', ".hbtn is the explorers' translucent pill, verbatim");
  has(styleBlock, '.hbtn:hover{background:rgba(255,255,255,.2);}', '.hbtn hover brightens');
  has(styleBlock, '.gpuword{color:#baf72e;}', 'GPU word in CDS chartreuse');
  has(styleBlock, '.cpuword{color:#4cc9db;}', 'CPU word in the cyan the explorers use');
  has(styleBlock, '.hbtn .gpuword,.hbtn .cpuword{margin-right:.28em;}', 'the accent span keeps its word space inside the inline-flex pill');
  not(styleBlock, '.hcap{', 'no caption rule remains in the stylesheet');
  has(styleBlock, '@media(max-width:1000px){.hutils{position:static;justify-content:flex-end;margin-top:8px;}}', 'below 1000px the cluster unpins and right-aligns under the lockup');
}

const BU_ICO = 'AAABAAEAEBAQAAEABAAoAQAAFgAAACgAAAAQAAAAIAAAAAEABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMwAERHPAGBg3wBmZuAAoKDsALW18ADu7vwA////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAd3d3d3d3d3d3d3d3d3d3dwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABXdzA3dzAAAAcwcXQDcAAABzBwcgBwAAAHdjByAHAAAAcwcHIAcAAAV3c1dQV1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHd3d3d3d3d3d3d3d3d3d3cAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';   // https://www.bu.edu/favicon.ico, 318 bytes, fetched 2026-09-02 (the bytes in assets/favicon.ico)

// ---- BU favicon: the head declares the icon inline -- BU's own favicon.ico (the
// 16x16 ICO www.bu.edu serves, byte for byte) as a data URI -- so the browser never
// falls back to requesting /favicon.ico, which the page branch does not carry and
// GitHub Pages answers with a 404 on every load ----
{
  const head = html.slice(0, html.indexOf('</head>'));
  const icons = [...head.matchAll(/<link\b[^>]*\brel="icon"[^>]*>/g)].map(m => m[0]);
  icons.length === 1 ? ok('the head carries exactly one rel="icon" link') : bad('rel="icon" links in the head: ' + icons.length + ', want 1');
  has(head, '<link rel="icon" type="image/x-icon" href="data:image/x-icon;base64,' + BU_ICO + '">', "the icon is BU's favicon.ico inline as a data URI, byte for byte");
  const at = head.indexOf('<link rel="icon"');
  (at > head.indexOf('</title>') && at < head.indexOf('googletagmanager.com/gtag/js')) ? ok('the icon link sits after the title and ahead of the Google tag') : bad('the icon link is not between the title and the Google tag');
}

// ---- the favicon is this repo's own asset, assets/favicon.ico, read at build time and
// embedded like the sibling-clone assets, and the build fails closed without it. Two
// rebuilds against a sibling-assets fixture that carries NO icon prove both: with
// assets/favicon.ico staged the page carries the icon (so it did not come from the
// sibling), without it the build fails naming this repo's own file ----
{
  const PUB_CPU_CLONE = process.env.PUB_CPU_CLONE || '/usr3/bustaff/mhorn/repos/cpu-cds-scc';
  const stage = (withIcon) => {
    const tmp = mkdtempSync(join(tmpdir(), 'cluster-page-icon-'));
    writeFileSync(join(tmp, 'build_cluster_page.R'), readFileSync(join(SDIR, '..', 'build_cluster_page.R'), 'utf8'));
    mkdirSync(join(tmp, 'output'), { recursive: true });
    writeFileSync(join(tmp, 'output', 'cluster_data.json'), JSON.stringify(data));
    mkdirSync(join(tmp, 'cpu', 'assets'), { recursive: true });
    for (const a of ['bu_plate_white.png', 'faculty_compt_data_sci_signature_toptier_rgb.png'])
      writeFileSync(join(tmp, 'cpu', 'assets', a), readFileSync(join(PUB_CPU_CLONE, 'assets', a)));   // the sibling clone's assets, no icon among them
    if (withIcon) { mkdirSync(join(tmp, 'assets')); writeFileSync(join(tmp, 'assets', 'favicon.ico'), readFileSync(join(SDIR, '..', 'assets', 'favicon.ico'))); }
    return tmp;
  };
  const build = (tmp) => {
    try { execFileSync('Rscript', [join(tmp, 'build_cluster_page.R')], { stdio: 'pipe', env: { ...process.env, PUB_CPU_CLONE: join(tmp, 'cpu') } }); return ''; }
    catch (e) { return String(e.stderr || e.message) || 'build failed'; }
  };
  let tmp = stage(true);
  try {
    const err = build(tmp);
    if (err) bad('fixture (own assets/favicon.ico, sibling assets without one): build failed -- ' + err.slice(0, 140));
    else has(readFileSync(join(tmp, 'index.html'), 'utf8'), 'href="data:image/x-icon;base64,' + BU_ICO + '"', "fixture (own assets/favicon.ico, sibling assets without one): the page carries the icon, so it came from this repo's own assets/");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  tmp = stage(false);
  try {
    const err = build(tmp);
    (err.includes('missing asset') && err.includes(join(tmp, 'assets', 'favicon.ico')))
      ? ok("fixture (no assets/favicon.ico): the build fails closed naming this repo's own assets/favicon.ico")
      : bad('fixture (no assets/favicon.ico): the build did not fail on this repo\'s own missing icon' + (err ? ' -- stderr: ' + err.slice(0, 140) : ' (it succeeded)'));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// ---- 13. phone layout (2026-09-03, the explorers' rules of the same day): five rules, each pinned as
// a string since the shim has no layout engine. Before them a 375px phone saw the CPU Pool's four grid
// columns push its clusters past the viewport (page 402px wide), the GPU Pool stack one cluster per
// line, the segment labels split into two-line buttons, the footer signature overrun its cell and the
// lockup break mid-name.
has(styleBlock, '@media(max-width:800px){.pool-gpu .hwcols,.pool-gpu .hwrow{grid-template-columns:1fr var(--valw);}.pool-cpu .hwcols,.pool-cpu .hwrow{grid-template-columns:1fr var(--valw) var(--ramw);}.hwrow{row-gap:4px;}.hwcols .hwnodes{display:none;}.hwrow .hwnodes{grid-column:1/-1;}}', 'below 800px both pool panels put their clusters on a second grid row spanning the card, the label column takes the slack and the Nodes header goes');
has(styleBlock, '@media(max-width:480px){.pagefoot{gap:12px 18px;}.pagefoot .ft-l{min-width:0;}.ft-emblem{height:auto;max-height:30px;max-width:100%;}}', 'below 480px the footer signature scales to fit its cell');
has(styleBlock, '@media(pointer:coarse){header{padding-top:16px;padding-bottom:16px;}.hbtn,.seg button,.ft-link{min-height:40px;}}', 'on a coarse pointer the pills, segments and footer links stand at least 40px tall, keyed on the pointer so tablets get it and narrow desktop windows do not');
has(styleBlock, '@media(max-width:700px){.hsep{display:block;height:0;padding:0;overflow:hidden;}}@media(max-width:480px){header h1{font-size:0.9rem;}}', 'below 700px the title takes its own line under the plate and name, and below 480px the h1 steps down');
has(styleBlock, '@media(max-width:360px){.seg button{padding:4px 6px;font-size:0.7rem;}.liveupd{white-space:normal;}}', 'below 360px the slide tabs tighten and step down a size so the row holds on the narrowest phones');
has(styleBlock, '.sechead .ctl{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}', 'the section controls wrap under the title rather than squeezing it');
has(styleBlock, 'padding:4px 10px;cursor:pointer;color:var(--text);border-radius:0;white-space:nowrap;}', 'a segment label never breaks across lines');

console.log(FAILS ? FAILS + ' FAILED' : 'ALL PASS');
process.exit(FAILS ? 1 : 0);
