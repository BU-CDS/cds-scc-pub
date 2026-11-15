# CDS on the BU SCC — public cluster page

Public, self-contained page for the CDS buy-in pools on the BU Shared
Computing Cluster: the CPU pool and the GPU pool side by side — the hardware
in each (every node and card, drawn at capacity) and two
over-time charts per pool (weekly rhythm, researchers and groups), with
hours rounded to two significant figures and counts to the nearest 5. One `index.html`, no server. Google Analytics counts
visits under BU's digital privacy statement. Updates quarterly. Two header
buttons take CDS members to the interactive GPU and CPU explorers (sign-in
required).

## View it

**https://cluster.cds.bu.edu/**

Offline copy:

```
git show origin/page:index.html > page.html
```

## Pipeline

`refresh_public.sh` runs the whole thing under a lock and publishes only if
every step is green:

1. `scripts/50_cluster_data.R` — reads the two pool dashboards' internal,
   already de-identified emitted data (read-only; locations via
   `PUB_CPU_CLONE` / `PUB_GPU_CLONE`) and writes `output/cluster_data.json`
   (data contract 5): pool hardware from the inventory records, reserved hours
   per pool for each complete week and each complete month, and distinct
   researchers and groups per month and in all. It reads only reserved hours
   and the user and project codes it counts. No user code, project name or
   host name survives the aggregation.
2. `scripts/gate_cluster.mjs` — whitelist / blocklist gate over that JSON:
   only the contract's fields (a dropped one coming back fails), every model,
   card and period on the allow-list, numeric hardware totals, no host names or
   registry codes anywhere, and the weekly series within 5% of the monthly
   totals. Over the built page it also refuses an embedded copy of the data and
   any figure without its public rounding. A page that passes is stamped:
   `.gate-pass` holds its git blob hash.
3. `build_cluster_page.R` — renders `index.html` (panels and over-time
   charts; the JSON itself is not embedded) with the assets embedded:
   fonts, plate and emblem from the CPU clone, the favicon from this repo's
   own `assets/`.
4. `scripts/test_page.mjs` + `validate.mjs` — structure/containment tests and
   a run of the page's inline script under a DOM shim; the gate runs a second
   time over the built HTML.
5. `deploy.sh` — publishes `index.html`, `.nojekyll` and `CNAME`, and nothing
   else, to the `page` branch GitHub Pages serves. It refuses a page whose
   bytes do not match the gate's `.gate-pass` stamp, one that reaches outside
   itself, and one without the "updated quarterly" stamp.

Before step 1 the script checks the checkout itself: every step's file must
exist, and a run that could push (the default) must be on `main`
(`PUB_EXPECT_BRANCH` names another branch deliberately). `DEPLOY_PUSH=0`
stages from any branch.

## Tests

```
Rscript scripts/test_cluster_data.R
node scripts/test_gate.mjs
node scripts/test_page.mjs
bash scripts/test_deploy.sh
bash scripts/test_refresh_guard.sh
DEPLOY_PUSH=0 ./refresh_public.sh      # full pipeline, nothing pushed
```

Failure alerts go to the address in `config/alert_email` (untracked); with no
such file the pipeline stays silent.
