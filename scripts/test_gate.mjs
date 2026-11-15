// test_gate.mjs — fixture test for gate_cluster.mjs.
//
// Contract v2 (design revision of 2026-08-31): cpu_monthly rows widen to
// [month,node_class,held_h,utilized_h,fail_h,wkill_h,njobs,wa_used_h,wa_req_h];
// gpu_monthly rows widen to
// [month,card,held_h,real_h,residle_h,kwh,vram_h,fail_h,wkill_h,njobs];
// meta.window3 (trailing <=3 complete months common to both pools) replaces
// window6; conservation recomputes held_h/njobs over window3.
//
// Contract v3 (2026-09-01) adds: `community` [window_key,pool,users,groups]
// (window_key vocab, monotone P3<=P6<=ALL and every M:<=ALL per pool/metric);
// `capacity_monthly` [month,pool,cap_h] (month whitelisted per pool, cap_h>0);
// `capacity.*.added_12m` (non-negative integer <= that pool's total units);
// meta.contract===3. Contract v4 (2026-09-01) adds `weekly` [monday,pool,held_h]:
// Monday dates only, dense and bounded per pool by that pool's published months,
// Σ within 5 % of the monthly Σheld_h; meta.contract===4.
// Contract v5 (2026-11-15) narrows the file to what the page and the gate read:
// cpu_monthly, gpu_monthly, headline (and conservation), capacity_monthly and the
// P3/P6 community rows are gone, and refused if they come back. `monthly`
// [month,pool,held_h] carries one row per published month per pool, for the weekly
// cross-check; `capacity` admits only cpu/gpu with numeric totals; the built page
// may hold no JSON object with the file's keys; a passing page is stamped
// (.gate-pass = its git blob hash) and a failing one is left unstamped.
// The gate now also reads output/portal_data.json under
// both fixture clone dirs (the internal de-identified emits) for its leak
// check, so this file writes small internal-emit fixtures with distinctive
// user codes / project names to test that check.
//
// Run: module load nodejs/20.12.2 && node scripts/test_gate.mjs
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SDIR = dirname(fileURLToPath(import.meta.url));
const GATE = join(SDIR, 'gate_cluster.mjs');
const dir = mkdtempSync(join(tmpdir(), 'gate-cluster-'));

// ---- fixture sibling config CSVs (small, disjoint from the real inventories) --
const cpuDir = join(dir, 'cpu-clone'); const gpuDir = join(dir, 'gpu-clone');
mkdirSync(join(cpuDir, 'config'), { recursive: true });
mkdirSync(join(gpuDir, 'config'), { recursive: true });
mkdirSync(join(cpuDir, 'output'), { recursive: true });
mkdirSync(join(gpuDir, 'output'), { recursive: true });
writeFileSync(join(cpuDir, 'config', 'cds_cpu_inventory.csv'),
  'host,server_model,cpu_type,ncpu,mem_gb,first_seen,install_date,purchase_date,retired,source,note\n' +
  'scc-fix1,PowerEdge R650,Gold-6326,32,1007,2022-01-01,2022-01-01,,,accounting+dmi,\n' +
  'scc-fix2,PowerEdge C6320,E5-2660v3,20,251,2016-01-01,2016-01-01,,,accounting+dmi,\n');
writeFileSync(join(cpuDir, 'config', 'cds_cpu_hosts.csv'),
  'host,node_class,cores,mem_gb\nscc-fix1,standard,32,1007\nscc-fix2,m1024,20,251\n');
writeFileSync(join(gpuDir, 'config', 'gpu_inventory_history.csv'),
  'host,server_model,cpu_type,ncpu,mem_gb,gpu_type,gpus,gpu_mem_gb,first_seen,install_date,purchase_date,retired,source,gpu_compute_capability,note\n' +
  'scc-gfix1,PowerEdge R770,6517P,32,503,H200,2,144,2025-01-01,2025-01-01,,,gpustats+dmi,9.0,\n');
writeFileSync(join(gpuDir, 'config', 'cds_gpu_hosts.csv'),
  'host,gpu_type,gpus,gpu_mem_gb\nscc-gfix1,H200,2,144\n');

// ---- fixture internal de-identified emits (contract v3 leak-check source) ----
// Small Fcols/F shape carrying only what the gate's leak check reads (proj/user);
// distinctive fixture codes so leak tests below can target one specifically.
const FCOLS_INTERNAL = ['pt', 'p', 'proj', 'user', 'held'];
writeFileSync(join(cpuDir, 'output', 'portal_data.json'), JSON.stringify({
  Fcols: FCOLS_INTERNAL,
  F: [
    ['M', '2026-06', 'fixture-proj-a', 'u-9001', '1'],
    ['M', '2026-07', 'fixture-proj-c', 'u-9003', '1'],
  ],
}));
writeFileSync(join(gpuDir, 'output', 'portal_data.json'), JSON.stringify({
  Fcols: FCOLS_INTERNAL,
  F: [
    ['M', '2026-06', 'fixture-proj-b', 'u-9002', '1'],
    ['M', '2026-07', 'fixture&corp', 'u-9005', '1'],   // literal "&" for the entity-decode leak test
  ],
}));

// ---- a second clone pair whose internal emits both have F: [] (empty leak-check
// blocklist), reusing the same config CSVs as the main pair above -- for the
// "leak check itself is unusable" test. ----
const emptyDir = mkdtempSync(join(tmpdir(), 'gate-cluster-empty-'));
const emptyCpuDir = join(emptyDir, 'cpu-clone'); const emptyGpuDir = join(emptyDir, 'gpu-clone');
mkdirSync(join(emptyCpuDir, 'config'), { recursive: true });
mkdirSync(join(emptyGpuDir, 'config'), { recursive: true });
mkdirSync(join(emptyCpuDir, 'output'), { recursive: true });
mkdirSync(join(emptyGpuDir, 'output'), { recursive: true });
writeFileSync(join(emptyCpuDir, 'config', 'cds_cpu_inventory.csv'), readFileSync(join(cpuDir, 'config', 'cds_cpu_inventory.csv')));
writeFileSync(join(emptyCpuDir, 'config', 'cds_cpu_hosts.csv'), readFileSync(join(cpuDir, 'config', 'cds_cpu_hosts.csv')));
writeFileSync(join(emptyGpuDir, 'config', 'gpu_inventory_history.csv'), readFileSync(join(gpuDir, 'config', 'gpu_inventory_history.csv')));
writeFileSync(join(emptyGpuDir, 'config', 'cds_gpu_hosts.csv'), readFileSync(join(gpuDir, 'config', 'cds_gpu_hosts.csv')));
writeFileSync(join(emptyCpuDir, 'output', 'portal_data.json'), JSON.stringify({ Fcols: FCOLS_INTERNAL, F: [] }));
writeFileSync(join(emptyGpuDir, 'output', 'portal_data.json'), JSON.stringify({ Fcols: FCOLS_INTERNAL, F: [] }));

// ---- a clean cluster_data.json fixture, shaped like the real contract v5 output --
// monthly row: [month,pool,held_h]; community row: [window_key,pool,users,groups]
const goodData = {
  meta: { updated: '2026-08-31', public: true,
          months_cpu: ['2026-06', '2026-07'], months_gpu: ['2026-06', '2026-07'],
          window3: ['2026-06', '2026-07'], contract: 5 },
  capacity: {
    cpu: { nodes: 2, cores: 52, ram_gb: 1258,
           types: [['Gold-6326', 'PowerEdge R650', 1, 32, 1007], ['E5-2660v3', 'PowerEdge C6320', 1, 20, 251]],
           added_12m: 5 },
    gpu: { nodes: 1, gpus: 2, vram_gb: 288,
           types: [['H200', 'PowerEdge R770', 1, 2, 144]],
           added_12m: 1 },
  },
  // held_h: cpu 150+170=320, gpu 200+210=410
  monthly: [
    ['2026-06', 'cpu', 150], ['2026-07', 'cpu', 170],
    ['2026-06', 'gpu', 200], ['2026-07', 'gpu', 210],
  ],
  community: [
    ['M:2026-06', 'cpu', 10, 5], ['M:2026-06', 'gpu', 8, 4],
    ['M:2026-07', 'cpu', 12, 6], ['M:2026-07', 'gpu', 9, 4],
    ['ALL', 'cpu', 15, 8], ['ALL', 'gpu', 12, 6],
  ],
  // weekly: [monday, pool, held_h] -- months 2026-06..07 -> Mondays 06-01 .. 07-20 (8 weeks; 2026-06-01 is a Monday,
  // the last Sunday inside July is 07-26). Σ per pool equals the monthly Σheld_h exactly (cpu 320, gpu 410).
  weekly: [
    ...['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06', '2026-07-13', '2026-07-20'].map((d) => [d, 'cpu', 40]),
    ...['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06', '2026-07-13', '2026-07-20'].map((d) => [d, 'gpu', 51.25]),
  ],
};

const write = (name, obj) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(obj)); return p; };
// runWith: full {status, stderr} so a test can isolate WHICH check fired (by
// message text), not just that the gate failed for some reason or other.
const runWith = (dataObj, html, cpuD = cpuDir, gpuD = gpuDir) => {
  const args = [GATE, write('cluster_data.json', dataObj)];
  if (html !== undefined) { writeFileSync(join(dir, 'page.html'), html); args.push(join(dir, 'page.html')); }
  const env = { ...process.env, PUB_CPU_CLONE: cpuD, PUB_GPU_CLONE: gpuD };
  try { execFileSync('node', args, { env }); return { status: 0, stderr: '' }; }
  catch (e) { return { status: e.status, stderr: (e.stderr ?? Buffer.from('')).toString() }; }
};
const run = (dataObj, html) => runWith(dataObj, html).status;
const clone = o => JSON.parse(JSON.stringify(o));
const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } };
const pass = (msg) => console.log('PASS: ' + msg);

assert(run(goodData) === 0, 'clean json (no html arg) passes'); pass('clean json (no html arg) passes');
assert(run(goodData, '<html>410 gpu-h delivered</html>') === 0, 'clean json + clean html passes'); pass('clean json + clean html passes');

// hostname-shaped placeholder, not a real inventory host (this repo is world-readable;
// a real hostname must never land in it, even as a rejected/bad-path fixture)
let bad = clone(goodData); bad.capacity.cpu.types[0][0] = 'scc-notarealhost';
assert(run(bad) === 1, 'unknown string (hostname-shaped) in json fails'); pass('unknown string (hostname-shaped) in json fails');

bad = clone(goodData); bad.capacity.gpu.types[0][0] = 'RTX4090Ti';
assert(run(bad) === 1, 'unknown gpu card model fails'); pass('unknown model in json fails');

bad = clone(goodData); bad.monthly[0][0] = '2026-6';
assert(run(bad) === 1, 'non-YYYY-MM period fails'); pass('non-YYYY-MM period fails');

bad = clone(goodData); bad.extra_key = 1;
assert(run(bad) === 1, 'unexpected top-level key fails'); pass('unexpected top-level key fails');

assert(run(goodData, '<html>14,000 core-h reserved; 950 GPU-h reserved; 65 researchers · 30 research groups; <b>320</b>researchers · <b>130</b>research groups</html>') === 0, 'rounded chart figures in html pass');
pass('rounded chart figures in html pass');
for (const [html, what] of [
  ['<html>13,702 core-h reserved</html>', 'reserved hours not at two significant figures'],
  ['<html><b>3,755</b>GPU-hours in the busiest week</html>', 'busiest-week hours not at two significant figures'],
  ['<html>64 researchers · 30 research groups</html>', 'a monthly count not rounded to 5'],
  ['<html><b>318</b>researchers · <b>130</b>research groups</html>', 'an all-time count not rounded to 10'],
]) { assert(run(goodData, html) === 1, what + ' fails'); pass(what + ' fails'); }
assert(run(goodData, '<html>node scc-fix1 was busy</html>') === 1, 'real hostname in html fails');
pass('real hostname in html fails');

// the footer's own repo link: "cds-scc-pub" is a slug, not a host. \b sits between
// "-" and "s", so a bare \bscc- pattern read it as the host "scc-pub" and failed the
// 2026-10-09 publish right after the GitHub rename.
assert(run(goodData, '<html><a href="https://github.com/BU-CDS/cds-scc-pub">GitHub</a></html>') === 0,
       'the repo slug cds-scc-pub in html passes');
pass('the repo slug cds-scc-pub in html passes');

assert(run(goodData, '<html>owned by u-1234</html>') === 1, 'registry code (u-1234) in html fails');
pass('registry code (u-1234) in html fails');

// ---- contract v5: monthly [month, pool, held_h] ----
assert(run(goodData) === 0, 'clean contract v5 json passes'); pass('clean contract v5 json passes');

bad = clone(goodData); bad.monthly[0] = [...bad.monthly[0], 0];
assert(run(bad) === 1, 'monthly row wider than 3 fails'); pass('monthly row wider than 3 elements fails');

bad = clone(goodData); bad.monthly[0][2] = 'nope';
assert(run(bad) === 1, 'non-numeric monthly held_h fails'); pass('non-numeric monthly held_h fails');

bad = clone(goodData); bad.monthly[0][2] = -1;
assert(run(bad) === 1, 'negative monthly held_h fails'); pass('negative monthly held_h fails');

bad = clone(goodData); bad.monthly[0][1] = 'tpu';
assert(run(bad) === 1, 'monthly unknown pool fails'); pass('monthly: unknown pool fails');

bad = clone(goodData); bad.monthly.push(['2099-01', 'cpu', 0]);
assert(run(bad) === 1, 'monthly month outside the list fails'); pass("monthly: a month outside meta's month list fails");

bad = clone(goodData); bad.monthly = bad.monthly.filter((r) => !(r[0] === '2026-07' && r[1] === 'gpu'));
{ const r = runWith(bad); assert(r.status === 1 && /expected exactly 1 row for month 2026-07 \/ pool gpu, found 0/.test(r.stderr), 'monthly: a missing month fails'); pass('monthly: a missing month fails, naming it'); }

bad = clone(goodData); bad.monthly.push(['2026-06', 'cpu', 0]);
{ const r = runWith(bad); assert(r.status === 1 && /found 2/.test(r.stderr), 'monthly: a duplicate month fails'); pass('monthly: a duplicate (month, pool) row fails'); }

bad = clone(goodData); bad.monthly = [];
assert(run(bad) === 1, 'empty monthly table fails'); pass('empty monthly table fails');

// ---- contract v5: the dropped fields are refused if they come back ----
for (const [key, val] of [
  ['cpu_monthly', [['2026-06', 'standard', 100, 90, 3, 1, 10, 95, 98]]],
  ['gpu_monthly', [['2026-06', 'H200', 200, 150, 8, 300, 180, 3, 1, 20]]],
  ['headline', { cpu_core_h: 320, gpu_h: 410, jobs: 73 }],
  ['capacity_monthly', [['2026-06', 'cpu', 38000]]],
]) {
  bad = clone(goodData); bad[key] = val;
  const r = runWith(bad);
  assert(r.status === 1 && r.stderr.includes(`unexpected top-level key: ${key}`), `dropped field ${key} is refused`);
  pass(`dropped field ${key} is refused`);
}

// ---- contract v5: capacity holds only cpu/gpu, with numeric totals ----
bad = clone(goodData); bad.capacity.m1024 = { nodes: 1 };
{ const r = runWith(bad); assert(r.status === 1 && r.stderr.includes('unexpected capacity key: m1024'), 'unexpected capacity key fails'); pass('an unexpected key under capacity fails'); }

bad = clone(goodData); bad.capacity.cpu.nodes = '2';
assert(run(bad) === 1, 'string capacity count fails'); pass('a capacity count given as a string fails');

bad = clone(goodData); bad.capacity.gpu.gpus = 2.5;
assert(run(bad) === 1, 'fractional capacity count fails'); pass('a fractional capacity count fails');

bad = clone(goodData); bad.capacity.cpu.ram_gb = null;
assert(run(bad) === 1, 'null ram_gb fails'); pass('a null capacity.cpu.ram_gb fails');

bad = clone(goodData); bad.capacity.gpu.types = { H200: 2 };
assert(run(bad) === 1, 'capacity types not a list fails'); pass('capacity.gpu.types that is not a list fails');

// ---- contract v2: meta.window3 replaces window6 ----
bad = clone(goodData); bad.meta.window6 = bad.meta.window3; delete bad.meta.window3;
assert(run(bad) === 1, 'meta.window6 (old v1 key) fails: window3 required'); pass('meta.window6 (old v1 key) fails: window3 required');

bad = clone(goodData); bad.meta.window3 = ['2026-01', '2026-02', '2026-03', '2026-04'];
assert(run(bad) === 1, 'meta.window3 with more than 3 months fails'); pass('meta.window3 with more than 3 months fails');

// ---- contract v3: community ----
bad = clone(goodData); bad.community[0][0] = 'M:2099-01';   // not in months_cpu/months_gpu
assert(run(bad) === 1, 'community: bad window key fails'); pass('community: bad window key (month not in whitelist) fails');

bad = clone(goodData); bad.community[0][0] = 'past3';   // not one of M:/ALL
assert(run(bad) === 1, 'community: non-vocabulary window key fails'); pass('community: non-vocabulary window key fails');

bad = clone(goodData); bad.community.push(['P3', 'cpu', 15, 8], ['P3', 'gpu', 12, 6]);   // dropped in contract v5
assert(run(bad) === 1, 'community: a P3 row fails'); pass('community: a P3 row (dropped in contract v5) fails');

bad = clone(goodData); bad.community[0][1] = 'tpu';
assert(run(bad) === 1, 'community: unknown pool fails'); pass('community: unknown pool fails');

bad = clone(goodData); bad.community[0][2] = -1;
assert(run(bad) === 1, 'community: negative count fails'); pass('community: negative users count fails');

bad = clone(goodData); bad.community[0][3] = 2.5;
assert(run(bad) === 1, 'community: non-integer count fails'); pass('community: non-integer groups count fails');

bad = clone(goodData);   // M:2026-07 cpu users (12) exceeds ALL (now 10) for cpu
bad.community = bad.community.map((r) => (r[0] === 'ALL' && r[1] === 'cpu' ? [r[0], r[1], 10, 8] : r));
assert(run(bad) === 1, 'community: M: > ALL fails'); pass('community: an M: window exceeding ALL for a pool fails');

// ---- contract v3: added_12m ----
bad = clone(goodData); bad.capacity.cpu.added_12m = bad.capacity.cpu.cores + 1;   // exceeds pool total (cores)
assert(run(bad) === 1, 'capacity.cpu.added_12m > pool total fails'); pass('capacity.cpu.added_12m exceeding the pool total fails');

bad = clone(goodData); bad.capacity.gpu.added_12m = -1;
assert(run(bad) === 1, 'capacity.gpu.added_12m negative fails'); pass('capacity.gpu.added_12m negative fails');

// ---- contract v3: meta.contract ----
bad = clone(goodData); bad.meta.contract = 4;
assert(run(bad) === 1, 'meta.contract != 5 fails'); pass('meta.contract must be 5');

// ---- contract v5: no embedded data object in the page ----
{
  const r = runWith(goodData, '<html><script>const DATA={"community":[["ALL","cpu",15,8]]};</script></html>');
  assert(r.status === 1 && r.stderr.includes('embedded data object'), 'an embedded data object in html fails');
  pass('an embedded data object in html fails, naming the check');
}

// ---- gate stamp: a passing page gets .gate-pass = its git blob hash; a failing one none ----
{
  const stamp = join(dir, '.gate-pass');
  rmSync(stamp, { force: true });
  assert(run(goodData) === 0 && !existsSync(stamp), 'a json-only run writes no stamp');
  pass('a json-only run writes no stamp');
  assert(run(goodData, '<html>410 gpu-h delivered</html>') === 0, 'clean page passes');
  const want = execFileSync('git', ['hash-object', join(dir, 'page.html')]).toString().trim();
  assert(existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === want, 'the stamp equals git hash-object of the page');
  pass('a passing page is stamped with its git blob hash');
  assert(run(goodData, '<html>node scc-fix1 was busy</html>') === 1 && !existsSync(stamp), 'a failing page removes the stamp');
  pass('a failing page leaves no stamp (the earlier one is removed)');
}

// ---- contract v3: leak check reads both internal emits' user codes/project names --
// (not the generic u-\d+/scc-.* patterns above -- these target the NEW,
// emit-driven check specifically, including a project name, which has no
// generic pattern of its own). Isolated from the pre-existing checks above by
// asserting on the stderr CATEGORY text ("leaked project name" / "leaked user
// code"), not just the exit code -- several of these values would also trip
// the generic u-\d+ pattern, so exit-code-1 alone wouldn't prove this check
// (rather than an old one) actually fired.
{
  const r0 = runWith(goodData, '<html><img src="data:image/png;base64,AAAA+fixture-proj-a+BBBB"></html>');
  assert(r0.status === 0, 'a blocked name inside an embedded base64 asset is not a leak');
  pass('a blocked name inside an embedded base64 asset is not a leak');
  const r = runWith(goodData, '<html>usage reported for fixture-proj-a this quarter</html>');
  assert(r.status === 1, 'fixture project name (CPU internal emit) leaking into html fails');
  assert(r.stderr.includes('leaked project name'), 'failure names the project-name category');
  assert(!r.stderr.includes('fixture-proj-a'), 'stderr never echoes the leaked value itself');
  pass('fixture project name (CPU internal emit) leaking into html fails, isolated by category text');
}

{
  const r = runWith(goodData, '<html>heaviest user was fixture-proj-b</html>');
  assert(r.status === 1, 'fixture project name (GPU internal emit) leaking into html fails');
  assert(r.stderr.includes('leaked project name'), 'failure names the project-name category');
  pass('fixture project name (GPU internal emit) leaking into html fails, isolated by category text');
}

bad = clone(goodData); bad.capacity.cpu.types[0][0] = 'fixture-proj-a';   // leaks into the JSON itself, not html
{
  const r = runWith(bad);
  assert(r.status === 1, 'fixture project name leaking into cluster_data.json fails');
  assert(r.stderr.includes('leaked project name'), 'failure names the project-name category');
  pass('fixture project name leaking into cluster_data.json fails, isolated by category text');
}

{
  // "owned by u-9001" also trips the pre-existing generic u-\d+ registry-code
  // pattern -- the category-text assertion is what proves the emit-driven
  // check independently caught it too, not just the old generic one.
  const r = runWith(goodData, '<html>owned by u-9001</html>');
  assert(r.status === 1, 'fixture user code (CPU internal emit) leaking into html fails');
  assert(r.stderr.includes('leaked user code'), 'failure names the user-code category');
  pass('fixture user code (CPU internal emit) leaking into html fails, isolated by category text');
}

// leak hit carries a short, non-revealing local reference (first 6 hex chars
// of sha1) so an operator can grep their own copy of the internal emits --
// never the value itself.
{
  const r = runWith(goodData, '<html>heaviest user was fixture-proj-b</html>');
  assert(/ref [0-9a-f]{6}\)/.test(r.stderr), 'leak failure carries a 6-hex-char sha1 reference');
  assert(!r.stderr.includes('fixture-proj-b'), 'stderr never echoes the leaked project name itself');
  pass('leak failure message carries a hash reference, never the raw value');
}

// entity-decoded scan: a fixture project name containing "&", present in the
// page ONLY in its HTML-escaped form (&amp;), must still be caught.
{
  const r = runWith(goodData, '<html>usage reported for fixture&amp;corp this quarter</html>');
  assert(r.status === 1, 'entity-escaped fixture project name (&amp;) in html fails');
  assert(r.stderr.includes('leaked project name'), 'entity-decoded leak reports the project-name category');
  pass('a fixture project name containing "&", present in the page only as "&amp;", fails via entity-decoded scan');
}

// leak-check blocklist itself must never come back empty -- that means the
// check is unusable (e.g. an internal emit with F: []), not "nothing to leak".
{
  const r = runWith(goodData, undefined, emptyCpuDir, emptyGpuDir);
  assert(r.status === 1, 'internal emit with F: [] (empty leak-check blocklist) fails closed');
  assert(r.stderr.includes('leak-check blocklist empty'), 'failure names the empty-blocklist reason');
  pass('internal emit with F: [] fails closed (empty leak-check blocklist), not a silent no-op');
}

// each internal emit must contribute to the blocklist on its own: a single
// producer shipping F: [] while the other stays healthy would otherwise leave
// the leak scan half-blind behind a PASS
{
  const r = runWith(goodData, undefined, cpuDir, emptyGpuDir);
  assert(r.status === 1 && r.stderr.includes('leak-check blocklist empty'), 'GPU internal emit alone with F: [] fails closed');
  pass('GPU internal emit alone with F: [] fails closed');
}
{
  const r = runWith(goodData, undefined, emptyCpuDir, gpuDir);
  assert(r.status === 1 && r.stderr.includes('leak-check blocklist empty'), 'CPU internal emit alone with F: [] fails closed');
  pass('CPU internal emit alone with F: [] fails closed');
}

// ---- contract v4: weekly [monday, pool, held_h] ----
bad = clone(goodData); bad.weekly[0][0] = '2026-06-02';   // a Tuesday
{ const r = runWith(bad); assert(r.status === 1 && /not a Monday/.test(r.stderr), 'weekly: non-Monday date fails'); pass('weekly: a non-Monday date fails, naming the check'); }

bad = clone(goodData); bad.weekly[0][0] = '2026-6-1';
assert(run(bad) === 1, 'weekly: bad date shape fails'); pass('weekly: a date not shaped YYYY-MM-DD fails');

bad = clone(goodData); bad.weekly[0][1] = 'tpu';
assert(run(bad) === 1, 'weekly: unknown pool fails'); pass('weekly: unknown pool fails');

bad = clone(goodData); bad.weekly[0][2] = -1;
assert(run(bad) === 1, 'weekly: negative held_h fails'); pass('weekly: negative held_h fails');

bad = clone(goodData); bad.weekly[0][2] = 'lots';
assert(run(bad) === 1, 'weekly: non-numeric held_h fails'); pass('weekly: non-numeric held_h fails');

bad = clone(goodData); bad.weekly = bad.weekly.filter((r) => !(r[0] === '2026-06-15' && r[1] === 'cpu'));
{ const r = runWith(bad); assert(r.status === 1 && /expected exactly 1 row for week 2026-06-15 \/ pool cpu, found 0/.test(r.stderr), 'weekly: a missing week fails'); pass('weekly: a missing week fails via density, naming the week'); }

bad = clone(goodData); bad.weekly.push(['2026-06-15', 'cpu', 40]);
{ const r = runWith(bad); assert(r.status === 1 && /found 2/.test(r.stderr), 'weekly: a duplicate week fails'); pass('weekly: a duplicate (week, pool) row fails'); }

bad = clone(goodData); bad.weekly.push(['2026-05-25', 'cpu', 0]);   // a Monday, but its Sunday precedes 2026-06-01
{ const r = runWith(bad); assert(r.status === 1 && /outside that pool's published months/.test(r.stderr), 'weekly: a week outside the bounds fails'); pass('weekly: a week before the first published month fails'); }

bad = clone(goodData); bad.weekly.push(['2026-07-27', 'gpu', 0]);   // its Sunday (08-02) falls after 2026-07-31
assert(run(bad) === 1, 'weekly: a week whose Sunday is past the last published month fails'); pass('weekly: a week running past the last published month fails');

bad = clone(goodData); bad.weekly = bad.weekly.map((r) => (r[1] === 'cpu' ? [r[0], r[1], 1] : r));   // Σ 8 vs monthly 320
{ const r = runWith(bad); assert(r.status === 1 && /more than 5% off/.test(r.stderr), 'weekly: Σheld_h far from the monthly Σ fails'); pass('weekly: a pool whose weekly Σheld_h is >5% off its monthly Σheld_h fails'); }

bad = clone(goodData); bad.weekly = bad.weekly.map((r) => (r[1] === 'cpu' ? [r[0], r[1], 41] : r));   // Σ 328 = +2.5%
assert(run(bad) === 0, 'weekly: Σ within 5% passes'); pass('weekly: a Σheld_h within 5% of the monthly Σheld_h passes (dropped edge days are tolerated)');

bad = clone(goodData); bad.weekly = [];
assert(run(bad) === 1, 'empty weekly table fails'); pass('empty weekly table fails (every expected week missing)');

bad = clone(goodData); delete bad.weekly;
assert(run(bad) === 1, 'missing weekly key fails'); pass('missing top-level weekly key fails');

// ---- contract v3: completeness (every window key/pool or month/pool pair
// present exactly once) -- distinct from the vocab/monotone checks above,
// which pass silently on a missing row rather than an invalid one ----
bad = clone(goodData); bad.community = [];
assert(run(bad) === 1, 'empty community table fails'); pass('empty community table fails (missing every window key x pool row)');

bad = clone(goodData); bad.community = bad.community.filter((r) => r[0] !== 'ALL');
{
  const r = runWith(bad);
  assert(r.status === 1, 'community missing every ALL row (both pools) fails');
  assert(/expected exactly 1 row for window ALL/.test(r.stderr), 'failure names the missing ALL rows specifically');
  pass('community missing every ALL row fails via completeness');
}

// fail-closed on unreadable json input
{
  const args = [GATE, join(dir, 'does-not-exist.json')];
  const env = { ...process.env, PUB_CPU_CLONE: cpuDir, PUB_GPU_CLONE: gpuDir };
  let status = 0;
  try { execFileSync('node', args, { env }); } catch (e) { status = e.status; }
  assert(status === 1, 'unreadable json input fails closed (exit 1, not a crash)');
  pass('unreadable json input fails closed');
}

console.log('ALL PASS');
