# =====================================================================
# build_cluster_page.R — the public showcase: a portal-lift of the two pool
# builders' own hardware/status panels (design revision of 2026-08-31). Twin
# pool panels (GPU left, CPU right) render pure CAPACITY -- every square/
# block fully saturated, no live occupancy, no LIVE/STALE badge -- and an
# "Over time" section under them: two server-rendered slides per pool
# (Weekly rhythm / Researchers) as CSS bar columns. The page
# ships one inline <script>, self-contained -- no fetch/XHR, no storage, no
# embedded data object -- that only switches slides, runs a gentle
# auto-advance and shows tooltips. The period selector and the per-pool KPI
# totals cards were removed on 2026-11-15 (too much to share publicly); with
# them went the page's embedded copy of cluster_data.json, which put every
# monthly row (failed, wall-killed and idle hours included) in the source. The
# Monthly volume slide (monthly reserved hours against nominal capacity) went
# the same day: with the weekly series it let a reader isolate sub-week totals.
# Visual source of truth: cpu-cds-scc/build_cpu_portal.R and
# gpu-cds-scc/build_gpu_portal.R, read only.
#
# Reads:  output/cluster_data.json          (contract v5, the strip+combine emit)
# Assets (base64-embedded, read from the sibling clone, never copied in):
#   $PUB_CPU_CLONE/assets/bu_plate_white.png
#   $PUB_CPU_CLONE/assets/faculty_compt_data_sci_signature_toptier_rgb.png
# No font is embedded (2026-11-15): BU licenses Whitney through MarCom and a Monotype web
# project with page-view tracking, which a public, self-contained page cannot honour, so the
# header uses the system sans stack like the rest of the page.
# Own asset (base64-embedded; the one asset in this tree -- BU's public favicon carries none of
# the licensing that keeps the plate and emblem in the sibling clone):
#   assets/favicon.ico                                       (BU's favicon, 16x16 ICO)
# Writes: index.html (repo root, gitignored)
# Run: module load R/4.5.2 && Rscript build_cluster_page.R
# =====================================================================
suppressPackageStartupMessages({
  library(jsonlite)
})

.f   <- sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE))
ROOT <- if (length(.f)) normalizePath(dirname(.f[[1]])) else normalizePath(".")

PUB_CPU_CLONE <- Sys.getenv("PUB_CPU_CLONE", "/usr3/bustaff/mhorn/repos/cpu-cds-scc")

dataf <- file.path(ROOT, "output", "cluster_data.json")
stopifnot(file.exists(dataf))
d <- fromJSON(dataf, simplifyVector = TRUE)

b64 <- function(path) {
  if (!file.exists(path)) stop("build_cluster_page: missing asset ", path)
  paste(system2("base64", c("-w0", path), stdout = TRUE), collapse = "")
}
plate_uri     <- paste0("data:image/png;base64,", b64(file.path(PUB_CPU_CLONE, "assets", "bu_plate_white.png")))
emblem_uri    <- paste0("data:image/png;base64,", b64(file.path(PUB_CPU_CLONE, "assets", "faculty_compt_data_sci_signature_toptier_rgb.png")))
favicon_uri   <- paste0("data:image/x-icon;base64,", b64(file.path(ROOT, "assets", "favicon.ico")))   # BU's own favicon (www.bu.edu/favicon.ico: 16x16 ICO, 318 bytes), declared inline so no load asks GitHub Pages for a /favicon.ico the page branch does not carry

# ---- helpers ----------------------------------------------------------------
jround <- function(x) floor(as.numeric(x) + 0.5)   # JS Math.round semantics (round-half-up, x >= 0) so R's server-render and the page's own JS agree bit-for-bit
fmt    <- function(x) format(jround(as.numeric(x)), big.mark = ",", trim = TRUE, scientific = FALSE)

# Public rounding (2026-11-15): every figure the Over-time charts show is coarsened before it is
# drawn, so tooltips, labels and bar heights all carry the rounded value. Hours keep two
# significant figures (13,702 -> 14,000; under 100, the nearest whole hour); monthly
# researcher/group counts go to the nearest 5 and the all-time totals to the nearest 10.
# Half rounds up, matching JS Math.round, so the test and gate mirrors agree exactly.
round_sig2 <- function(x) { x <- as.numeric(x); if (x < 100) return(jround(x)); p <- 10^(floor(log10(x)) - 1); floor(x / p + 0.5) * p }
round_to   <- function(x, k) k * floor(as.numeric(x) / k + 0.5)

esc_h <- function(s) { s <- gsub("&", "&amp;", s, fixed = TRUE); gsub("<", "&lt;", s, fixed = TRUE) }
esc_a <- function(s) { s <- gsub("&", "&amp;", s, fixed = TRUE); s <- gsub("\"", "&quot;", s, fixed = TRUE); gsub("<", "&lt;", s, fixed = TRUE) }

# Human-readable CPU model labels (GPU cards render as-is -- already short vendor
# names like L40S/H200). Lifted verbatim from cpu-cds-scc/build_cpu_portal.R's
# cpuLabel(): a Gold-/Silver-/Platinum-/Bronze- prefix loses its hyphen for a space;
# an EPYC- prefix becomes "AMD EPYC "; a trailing digit-v-digit ("2660v3") gets a
# space before the v; then "Xeon " is prepended when the label opens with E<digit>/
# Gold/Silver/Platinum/Bronze/W, or is a bare 4-digit(+letter) model.
model_label <- function(x) {
  x <- sub("^(Gold|Silver|Platinum|Bronze)-", "\\1 ", x)
  x <- sub("^EPYC-", "AMD EPYC ", x)
  x <- sub("(\\d)v(\\d)$", "\\1\u00a0v\\2", x)   # non-breaking space so "v3" never orphans onto its own line in the narrowed .hwlbl column
  xeon <- grepl("^(E\\d|Gold|Silver|Platinum|Bronze|W)", x) | grepl("^\\d{4}[A-Za-z]?$", x)
  ifelse(xeon, paste0("Xeon ", x), x)
}

MON <- c("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
month_label <- function(m) paste0(MON[as.integer(substr(m, 6, 7))], " ", substr(m, 1, 4))

# range text for the "Over time" header, e.g. "May – Jul 2026" (year shown once
# when both ends share a year) or "Jul 2026" for a single month.
range_text <- function(months) {
  if (!length(months)) return("")
  a <- months[1]; b <- months[length(months)]
  if (a == b) return(month_label(a))
  a_lbl <- if (substr(a, 1, 4) == substr(b, 1, 4)) MON[as.integer(substr(a, 6, 7))] else month_label(a)
  paste0(a_lbl, " – ", month_label(b))
}

# ---- pool panels: one hardware row per capacity.types[] entry. No live data
# exists for this page (capacity, not occupancy) -- every block renders
# saturated. Node clusters are built purely from count x per_node; tooltips
# carry only the model and server -- no hostnames, no install dates. Per-node
# RAM / per-GPU VRAM appears exactly once per panel: as its own column on the
# CPU panel (a second .hwc cell, tagged .hwram so tests can target it), and as
# the GPU panel's existing VRAM column -- never duplicated into tooltip text.
# Adaptation of gpu-cds-scc build_gpu_portal.R livePanel() / cpu-cds-scc
# build_cpu_portal.R renderLive(): same hwtop/hwcols/hwrow/cnode idiom,
# held-related bits dropped since there is no live feed. ----
panel_row <- function(label, server, count, per_node, ram, pool) {
  disp <- if (pool == "cpu") model_label(label) else label
  unit <- if (pool == "cpu") paste0(fmt(per_node), " cores") else paste0(fmt(ram), " GB")
  row_tip <- paste0("<b>", esc_h(disp), "</b><br>Server: ", esc_h(server))
  cluster_tip <- if (pool == "cpu") paste0(fmt(per_node), " cores")
                 else paste0(fmt(per_node), " GPUs · ", fmt(ram), " GB each")
  square <- '<i class="on"></i>'
  one_cluster <- sprintf('<span class="cnode" data-tip="%s">%s</span>', esc_a(cluster_tip), paste(rep(square, per_node), collapse = ""))
  clusters <- paste(rep(one_cluster, count), collapse = "")
  ram_cell <- if (pool == "cpu") sprintf('<span class="hwc hwram">%s GB</span>', fmt(ram)) else ""
  sprintf('<div class="hwrow"><span class="hwlbl" data-tip="%s">%s</span><span class="hwc">%s</span>%s<span class="hwnodes">%s</span></div>',
          esc_a(row_tip), esc_h(disp), unit, ram_cell, clusters)
}

panel_html <- function(types, pool) {
  rows <- vapply(seq_len(nrow(types)), function(i) {
    panel_row(types[i, 1], types[i, 2], as.integer(types[i, 3]), as.integer(types[i, 4]), as.numeric(types[i, 5]), pool)
  }, character(1))
  head_lbl <- if (pool == "cpu") "CPU" else "GPU"
  unit_lbl <- if (pool == "cpu") "Cores" else "VRAM"
  ram_head <- if (pool == "cpu") '<span class="hwc hwram">RAM</span>' else ""
  cols <- sprintf('<div class="hwcols"><span class="hwlbl">%s</span><span class="hwc">%s</span>%s<span class="hwnodes">Nodes</span></div>', head_lbl, unit_lbl, ram_head)
  paste0(cols, paste(rows, collapse = "\n"))
}

gpu_panel <- panel_html(d$capacity$gpu$types, "gpu")
cpu_panel <- panel_html(d$capacity$cpu$types, "cpu")

# R5.2: a data-driven growth note in a pool panel's <h3>, right-aligned by the
# .pool h3 flex rule -- rendered ONLY when that pool's added_12m is > 0
# (maintainer ruling 2026-09-01); no <span> at all otherwise. added_12m counts units,
# not servers: GPUs for the GPU pool, cores for the CPU pool (the CPU explorer's own
# unit; it said "nodes" until 2026-11-15).
GROWTH_WORD <- list(cpu = c(singular = "core", plural = "cores"), gpu = c(singular = "GPU", plural = "GPUs"))
growth_note <- function(pool, n) {
  n <- suppressWarnings(as.integer(n))
  if (is.na(n) || n <= 0) return("")
  word <- GROWTH_WORD[[pool]][[if (n == 1) "singular" else "plural"]]
  sprintf('<span class="hnote">%s %s added in the past 12 months</span>', fmt(n), word)
}
gpu_growth <- growth_note("gpu", d$capacity$gpu$added_12m)
cpu_growth <- growth_note("cpu", d$capacity$cpu$added_12m)

# ---- the tables the Over-time slides read. ----
as_mat <- function(x, ncol) if (is.null(dim(x))) matrix(x, ncol = ncol, byrow = TRUE) else x
cmty <- as_mat(d$community, 4)         # window_key,pool,users,groups
wk <- as_mat(d$weekly, 3)   # monday,pool,held_h (contract v4+)

# community is looked up by window key ("ALL" or "M:YYYY-MM"). No row reads as 0.
community_for <- function(window_key, pool) {
  idx <- which(cmty[, 1] == window_key & cmty[, 2] == pool)
  if (!length(idx)) return(list(users = 0L, groups = 0L))
  list(users = as.integer(cmty[idx[1], 3]), groups = as.integer(cmty[idx[1], 4]))
}

all_months <- sort(unique(c(d$meta$months_cpu, d$meta$months_gpu)))

# ---- R6 "Over time": two server-rendered slides per pool. The inline script
# never recomputes a chart -- it only switches slides and runs the
# auto-advance. Marks per R6.6: <= 24 px columns, 2 px surface gap (1 px
# weekly), 4 px rounded tops, hairline grid, no text in a series colour. ----
tick_label <- function(x) {   # axis ticks: 150k / 1.2M (no space, one decimal)
  if (x >= 1e6) return(paste0(sub("\\.0$", "", sprintf("%.1f", x / 1e6)), "M"))
  if (x >= 1e3) return(paste0(sub("\\.0$", "", sprintf("%.1f", x / 1e3)), "k"))
  sub("\\.0$", "", sprintf("%.1f", x))
}
nice_ticks <- function(mx) {   # top = 1.04 x max; the smallest step in {1,2,2.5,5}x10^n giving <= 5 lines below top
  top <- max(mx, 1) * 1.04
  p <- 10^floor(log10(top / 4))
  cands <- c(1, 2, 2.5, 5, 10) * p
  # "<= 5 lines below top" counts the actual rendered ticks (seq() stops at <= top,
  # i.e. floor(top/step) of them) -- comparing the raw ratio to 5 instead rejects a
  # step like 5000 for top=28254 (ratio 5.65) even though it renders exactly 5 ticks,
  # skipping straight to a coarser step that renders only 2.
  step <- cands[which(floor(top / cands) <= 5)[1]]
  list(top = top, ticks = seq(step, top, by = step))
}
pc <- function(v, top) sprintf("%.2f", 100 * as.numeric(v) / top)   # heights/offsets as % of top, 2 dp
day_label <- function(d) { d <- as.Date(d); paste(as.integer(format(d, "%d")), MON[as.integer(format(d, "%m"))], format(d, "%Y")) }
QUARTER <- c(1L, 4L, 7L, 10L)

ov_plot <- function(tk, cols, xax, cls = "") {
  yax  <- paste0('<div class="yax">', paste(sprintf('<span style="bottom:%s%%">%s</span>', pc(tk$ticks, tk$top), vapply(tk$ticks, tick_label, character(1))), collapse = ""), '<span style="bottom:0">0</span></div>')
  grid <- paste(sprintf('<i style="bottom:%s%%"></i>', pc(tk$ticks, tk$top)), collapse = "")
  sprintf('<div class="plot%s">%s<div class="area"><div class="grid">%s</div><div class="cols">%s</div></div><div class="xax">%s</div></div>',
          if (nzchar(cls)) paste0(" ", cls) else "", yax, grid, paste(cols, collapse = ""), xax)
}
# x labels at quarter months (Jan/Apr/Jul/Oct); the year on January and on the first label, set on
# a second line (<i>) so a year label never runs into its neighbour on a narrow plot
x_label <- function(m, with_year) if (with_year) paste0(MON[as.integer(substr(m, 6, 7))], "<i> ", substr(m, 1, 4), "</i>") else MON[as.integer(substr(m, 6, 7))]
ov_x_monthly <- function(months) {
  out <- character(0); n <- length(months)
  for (i in seq_len(n)) {
    mo <- as.integer(substr(months[i], 6, 7)); if (!(mo %in% QUARTER)) next
    out <- c(out, sprintf('<span style="left:%.2f%%">%s</span>', 100 * (i - 0.5) / n, x_label(months[i], mo == 1L || i == 1L)))
  }
  paste(out, collapse = "")
}
ov_x_weekly <- function(mondays) {   # anchored at the first week whose Monday falls in a quarter month
  out <- character(0); n <- length(mondays); first <- TRUE; prev <- ""
  for (i in seq_len(n)) {
    m <- format(mondays[i], "%Y-%m"); mo <- as.integer(substr(m, 6, 7)); same <- identical(m, prev); prev <- m
    if (same || !(mo %in% QUARTER)) next
    out <- c(out, sprintf('<span style="left:%.2f%%">%s</span>', 100 * (i - 1) / n, x_label(m, mo == 1L || first))); first <- FALSE
  }
  paste(out, collapse = "")
}
ov_col  <- function(tip, inner) sprintf('<span class="col" data-tip="%s">%s</span>', esc_a(tip), inner)
ov_peak <- function(h_pct, label) sprintf('<em class="pk" style="bottom:calc(%s%% + 2px)">%s</em>', h_pct, label)
ov_rhy <- function(pool, unit, unit_long) {
  rows <- wk[wk[, 2] == pool, , drop = FALSE]
  if (!nrow(rows)) return(sprintf('<div class="slide" data-s="rhy"><div class="cap"><span class="ct">Reserved %s by week</span></div><div class="nodata">No %s data</div></div>', unit_long, toupper(pool)))
  o <- order(rows[, 1]); mondays <- as.Date(rows[o, 1]); held <- vapply(as.numeric(rows[o, 3]), round_sig2, numeric(1))
  tk <- nice_ticks(max(held)); peak <- which.max(held)
  cols <- vapply(seq_along(mondays), function(i) {
    hp  <- pc(held[i], tk$top)
    tip <- sprintf("<b>Week of %s</b><br>%s %s reserved", day_label(mondays[i]), fmt(held[i]), unit)
    ov_col(tip,
           sprintf('<b class="slot"><i class="bar" style="height:%s%%"></i>%s</b>', hp, if (i == peak) ov_peak(hp, fmt(held[i])) else ""))
  }, character(1))
  sprintf('<div class="slide" data-s="rhy"><div class="cap"><span class="ct">Reserved %s by week<i>complete weeks, %s – %s</i></span><span class="hero"><b>%s</b>%s in the busiest week (%s)</span></div>%s</div>',
          unit_long, day_label(mondays[1]), day_label(mondays[length(mondays)] + 6), fmt(held[peak]), unit_long, day_label(mondays[peak]),
          ov_plot(tk, cols, ov_x_weekly(mondays), "wk"))
}
ov_com <- function(pool, months) {
  cm_m   <- lapply(paste0("M:", months), community_for, pool = pool)
  users  <- vapply(cm_m, function(x) round_to(x$users, 5), numeric(1))
  groups <- vapply(cm_m, function(x) round_to(x$groups, 5), numeric(1))
  all_r  <- lapply(community_for("ALL", pool), round_to, k = 10)
  tk <- nice_ticks(max(users)); peak <- which.max(users)
  cols <- vapply(seq_along(months), function(i) {
    up  <- pc(users[i], tk$top)
    tip <- sprintf("<b>%s</b><br>%s researchers · %s research groups", month_label(months[i]), fmt(users[i]), fmt(groups[i]))
    ov_col(tip, sprintf('<b class="pair"><i class="u" style="height:%s%%"></i><i class="g" style="height:%s%%"></i>%s</b>',
                                   up, pc(groups[i], tk$top), if (i == peak) ov_peak(up, fmt(users[i])) else ""))
  }, character(1))
  sprintf('<div class="slide" data-s="com" hidden><div class="cap"><span class="ct">Researchers and research groups by month<span class="lg"><i class="u"></i>Researchers<i class="g"></i>Research groups</span></span><span class="hero"><b>%s</b>researchers · <b>%s</b>research groups since %s</span></div>%s</div>',
          fmt(all_r$users), fmt(all_r$groups), month_label(months[1]), ov_plot(tk, cols, ov_x_monthly(months)))
}
ov_deck <- function(pool) {
  months <- if (pool == "cpu") d$meta$months_cpu else d$meta$months_gpu
  unit <- if (pool == "cpu") "core-h" else "GPU-h"; unit_long <- if (pool == "cpu") "core-hours" else "GPU-hours"
  sprintf('<div class="deck ov" id="%sov"><h3>%s Activity</h3>%s%s</div>', pool, toupper(pool),
          ov_rhy(pool, unit, unit_long), ov_com(pool, months))
}
ov_gpu_deck  <- ov_deck("gpu")
ov_cpu_deck  <- ov_deck("cpu")
ov_range_all <- range_text(all_months)

# ---- assemble ----------------------------------------------------------------
GA_ID  <- "G-0B07K1F1MX"   # Google Analytics 4 measurement id for this page's own property (one property per page). Empty = no tag.
ga_tag <- if (nzchar(GA_ID)) paste0('<script async src="https://www.googletagmanager.com/gtag/js?id=', GA_ID, '"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){window.dataLayer.push(arguments);}gtag("js",new Date());gtag("config","', GA_ID, '");</script>') else ""   # Google's snippet with one change: window.dataLayer.push instead of the bare dataLayer. validate.mjs runs the inline scripts under a shim where a bare dataLayer is undefined, and Google's copy verbatim fails the gate. In a browser the two are the same object.
html <- paste0(
r"-----(<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Research Computing at CDS</title><link rel="icon" type="image/x-icon" href=")-----", favicon_uri, r"-----(">)-----", ga_tag, r"-----(
<style>
:root{
 --t-sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
 --t-mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
 --content-max:2100px;--content-pad:12px;
 --bg:#f2efec;--surface:#ffffff;--surface2:#ebe6e0;
 --ink:#2d2926;--text:#2d2926;--muted:#6b6158;--grid:#e8e3dd;--border:#dcd5cd;
 --used:#0b7468;--idle:#c0cad4;--ember:#b4451f;--headbg:#2d2926;--headfg:#ffffff;--shadow:rgba(15,30,45,.10);--hatch:rgba(20,30,42,.34);--busy:#dc2626;--free:#2563eb;--rule:#b7ada2;--hl:#fde68a;--amber:#e0a63e;--rust:#a0522d;
}
*{box-sizing:border-box}html{font-size:110%;}html,body{height:100%;}body{display:flex;flex-direction:column;min-height:100vh;min-height:100dvh;font-family:var(--t-sans);color:var(--text);margin:0;background:var(--bg);font-size:0.813rem;line-height:1.45;-webkit-font-smoothing:antialiased;}
header{background:var(--headbg);color:var(--headfg);padding:12px var(--content-pad);position:relative;border-top:3px solid #cc0000;border-bottom:1px solid rgba(255,255,255,.08);}header h1{font-size:1rem;margin:0;font-weight:600;letter-spacing:-.01em;}.buplate{height:1.615em;vertical-align:-.449em;margin-right:.34em;}.orgname{font-weight:400;letter-spacing:0;}.hsep{color:rgba(255,255,255,.4);font-weight:400;padding:0 .6em;}
.hwrap{max-width:min(var(--content-max),98vw);margin:0 auto;display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;}
.hutils{position:absolute;top:10px;right:18px;display:flex;gap:8px;z-index:2;align-items:center;}.hbtn{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.28);color:var(--headfg);font:inherit;font-size:0.688rem;padding:3px 10px;border-radius:5px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;}.hbtn:hover{background:rgba(255,255,255,.2);}.gpuword{color:#baf72e;}.cpuword{color:#4cc9db;}.hbtn .gpuword,.hbtn .cpuword{margin-right:.28em;}@media(max-width:1000px){.hutils{position:static;justify-content:flex-end;margin-top:8px;}}
@media(max-width:700px){.hsep{display:block;height:0;padding:0;overflow:hidden;}}@media(max-width:480px){header h1{font-size:0.9rem;}}   /* phone lockup (2026-09-03, explorers 4efaf6e / 8b9bd51): below 700px the title takes its own line under the plate and name (the separator becomes a zero-height block, which breaks the line and hides the bar) instead of the name wrapping mid-phrase; below 480px the h1 steps down so plate and name hold one line on a 375px phone */
main{max-width:min(var(--content-max),98vw);width:100%;margin:0 auto;padding:14px var(--content-pad) 60px;flex:1 0 auto;}
h3{font-size:0.85rem;font-weight:600;color:var(--ink);margin:0 0 10px;}
.deck{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:11px 12px;margin-bottom:12px;box-shadow:0 1px 3px var(--shadow);}
.deck h3{font-size:0.8rem;font-weight:700;color:var(--ink);margin:0 0 8px;}
.pool-gpu h3,.pool-cpu h3{border-bottom:3px solid;padding-bottom:6px;margin-bottom:10px;}
.pool-gpu h3{border-color:#baf72e;}
.pool-cpu h3{border-color:#4cc9db;}
.pool h3{display:flex;justify-content:space-between;align-items:baseline}
.hnote{font-weight:400;font-size:0.72rem;color:var(--muted);letter-spacing:0;white-space:nowrap}
.deckrow{display:flex;gap:16px;align-items:stretch;margin-bottom:12px;}.deckrow .deck{flex:1 1 auto;margin-bottom:0;min-width:0;}
#gpupanel{flex:0 1 37%;}#cpupanel{flex:1 1 0;}
@media(max-width:900px){.deckrow{display:block;}.deckrow .deck{margin-bottom:12px;}.sechead{flex-wrap:wrap;}}
.sechead{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid var(--rule);}
.sechead .ttl{font-size:.8rem;font-weight:700;color:var(--ink);}.sechead .ttl span{font-weight:400;color:var(--muted);margin-left:8px;}
.sechead .ctl{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.seg{display:inline-flex;border:1px solid var(--border);border-radius:5px;overflow:hidden;}.seg button{border:none;border-right:1px solid var(--border);background:var(--surface);font:inherit;font-size:0.75rem;padding:4px 10px;cursor:pointer;color:var(--text);border-radius:0;white-space:nowrap;}.seg button:last-child{border-right:none;}.seg button:hover{background:var(--surface2);}.seg button.on{background:var(--used);color:#fff;}
.hwcols,.hwrow{display:grid;grid-template-columns:var(--lblw) var(--valw) 1fr;column-gap:18px;align-items:center;}.hwcols{font-size:0.75rem;border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:2px;}.hwcols span{color:var(--ink);font-weight:bold;}
.hwrow{padding:5px 0;border-bottom:1px solid var(--grid);}.hwrow:last-child{border-bottom:none;padding-bottom:0;}
.hwlbl{color:var(--text);white-space:nowrap;}.hwc{text-align:right;color:var(--text);font-variant-numeric:tabular-nums;white-space:nowrap;}
.hwnodes{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
.pool-cpu .hwcols,.pool-cpu .hwrow{grid-template-columns:var(--lblw) var(--valw) var(--ramw) 1fr;}
.pool-cpu{--lblw:120px;--valw:60px;--ramw:66px;--core-s:clamp(5px,0.35vw,12px);}.pool-cpu .cnode{display:grid;grid-template-columns:repeat(8,var(--core-s));gap:3px;padding:5px;border:1px solid var(--border);border-radius:6px;background:var(--surface2);}.pool-cpu .cnode i{width:var(--core-s);height:var(--core-s);border-radius:3px;display:block;background:var(--idle);}.pool-cpu .cnode i.on{background:var(--used);}
.pool-gpu{--lblw:80px;--valw:56px;--gpu-w:clamp(13px,0.93vw,40px);--gpu-h:clamp(10px,0.47vw,20px);}.pool-gpu .cnode{display:inline-flex;gap:3px;padding:5px;border:1px solid var(--border);border-radius:6px;background:var(--surface2);}.pool-gpu .cnode i{width:var(--gpu-w);height:var(--gpu-h);border-radius:4px;display:block;background:var(--idle);}.pool-gpu .cnode i.on{background:var(--used);}
@media(max-width:800px){.pool-gpu .hwcols,.pool-gpu .hwrow{grid-template-columns:1fr var(--valw);}.pool-cpu .hwcols,.pool-cpu .hwrow{grid-template-columns:1fr var(--valw) var(--ramw);}.hwrow{row-gap:4px;}.hwcols .hwnodes{display:none;}.hwrow .hwnodes{grid-column:1/-1;}}   /* phone layout (2026-09-03, explorers d5a2e3f / ede6464): below 800px the label column takes the slack, the Nodes header goes, and each row puts its clusters on a second grid row spanning the card. The fixed columns left the CPU pool no room for its clusters on a phone, so they ran past the card and the page scrolled sideways; the GPU pool stacked one cluster per line */
@media(min-width:1700px){.pool-cpu{--core-s:clamp(8px,0.5vw,12px);}.pool-gpu{--gpu-w:clamp(22px,1.4vw,40px);--gpu-h:clamp(11px,0.7vw,20px);}.deck{padding:13px 14px;}}
[data-tip]{cursor:help;}
#tip{position:fixed;z-index:99;max-width:300px;background:#0f1f3a;color:#eaf1fb;font-size:0.719rem;line-height:1.45;padding:7px 10px;border-radius:6px;box-shadow:0 6px 22px rgba(0,0,0,.28);pointer-events:none;display:none;}#tip b{color:#9ec5ff;font-weight:600;}
.nodata{color:var(--muted);font-size:0.8rem;padding:8px 0;grid-column:1/-1;}
.livewrap{margin:0 0 10px;padding:0;display:flex;flex-wrap:wrap;gap:16px;align-items:center;}
.liveupd{color:var(--text);font-size:0.75rem;white-space:nowrap;}
@media(max-width:360px){.seg button{padding:4px 6px;font-size:0.7rem;}.liveupd{white-space:normal;}}   /* the narrowest phones (2026-09-03): the three period segments ran over a 320px card as one row (the rule now serves the two Over-time slide tabs); below 360px they tighten and step down a size rather than break the row, and the updated line, nowrap elsewhere, may wrap. Sits after the rules it overrides: a media rule wins by order */
.liveupd a{color:inherit;text-decoration:underline;text-decoration-color:var(--muted);text-underline-offset:2px;}
.liveupd a:hover{color:var(--used);text-decoration-color:currentColor;}
.pagefoot{max-width:min(var(--content-max),98vw);width:100%;margin:0 auto;margin-top:auto;padding:18px var(--content-pad) 30px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;}
.pagefoot .ft-l{flex:1 1 200px;display:flex;align-items:center;}
.pagefoot .ft-c{flex:0 0 auto;text-align:center;}
.pagefoot .ft-r{flex:1 1 200px;text-align:right;}
.ft-emblem{height:30px;width:auto;display:block;}
.ft-link{color:var(--muted);font-size:0.75rem;text-decoration:none;display:inline-flex;align-items:center;}
@media(max-width:480px){.pagefoot{gap:12px 18px;}.pagefoot .ft-l{min-width:0;}.ft-emblem{height:auto;max-height:30px;max-width:100%;}}   /* phone footer (2026-09-03, explorers 8826c1e / 857212d): the signature is 351px wide at its 30px height and overran the footer cell on a phone; the cell may shrink and the signature scales to fit */
@media(pointer:coarse){header{padding-top:16px;padding-bottom:16px;}.hbtn,.seg button,.ft-link{min-height:40px;}}   /* touch targets (2026-09-03, explorers f245cf1 / 9f7e525): on a coarse pointer the pills, segments and footer links stand at least 40px tall and the header pads out so the pinned pills stay centred. Keyed on the pointer, not the viewport */
.ft-link:hover{color:var(--used);text-decoration:underline;}
.ft-gh{color:var(--muted);}
.ft-gh:hover{color:var(--used);}
.ft-gh svg{height:30px;width:auto;display:block;}
.slide[hidden]{display:none}
#gpuov{flex:0 1 37%;}#cpuov{flex:1 1 0;}
#gpuov h3,#cpuov h3{border-bottom:3px solid;padding-bottom:6px;margin-bottom:10px;}#gpuov h3{border-color:#baf72e;}#cpuov h3{border-color:#4cc9db;}
.ov .cap{display:flex;flex-direction:column;gap:3px;margin:0 0 8px;}
.ov .ct{font-size:.75rem;font-weight:600;color:var(--text);}.ov .ct>i{font-style:normal;font-weight:400;color:var(--muted);margin-left:8px;}
.ov .hero{font-size:.72rem;color:var(--muted);}.ov .hero b{font-size:1.25rem;font-weight:600;color:var(--ink);letter-spacing:-.01em;margin-right:5px;}.ov .hero b+b{margin-left:6px;}
.ov .lg{display:inline-flex;align-items:center;gap:10px;margin-left:10px;font-size:.7rem;font-weight:400;color:var(--muted);}.ov .lg i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;vertical-align:-1px;}.ov .lg i.u{background:var(--used);}.ov .lg i.g{background:var(--ember);}
.ov .plot{display:grid;grid-template-columns:auto 1fr;grid-template-rows:var(--h,190px) auto;column-gap:8px;}
.ov .yax{position:relative;min-width:26px;font-size:.65rem;line-height:1;color:var(--muted);font-variant-numeric:tabular-nums;text-align:right;}.ov .yax span{position:absolute;right:0;transform:translateY(50%);}
.ov .area{position:relative;}.ov .grid i{position:absolute;left:0;right:0;border-top:1px solid var(--grid);}
.ov .cols{position:absolute;inset:0;display:flex;align-items:flex-end;gap:2px;border-bottom:1px solid var(--rule);}.ov .wk .cols{gap:1px;}
.ov .col{flex:1 1 0;min-width:0;height:100%;display:flex;align-items:flex-end;justify-content:center;cursor:help;}
.ov .slot,.ov .pair{position:relative;width:100%;max-width:24px;height:100%;}
.ov .bar{position:absolute;left:0;right:0;bottom:0;background:var(--used);border-radius:4px 4px 0 0;}.ov .wk .bar{border-radius:2px 2px 0 0;}
.ov .pair{display:flex;gap:2px;align-items:flex-end;max-width:28px;}.ov .pair i{flex:1 1 0;border-radius:3px 3px 0 0;}.ov .pair .u{background:var(--used);}.ov .pair .g{background:var(--ember);}
.ov .pk{position:absolute;left:50%;transform:translateX(-50%);font-size:.62rem;font-style:normal;line-height:1;color:var(--muted);white-space:nowrap;padding-bottom:1px;}
.ov .xax{grid-column:2;position:relative;height:28px;margin-top:5px;font-size:.65rem;line-height:1;color:var(--muted);}.ov .xax span{position:absolute;top:0;white-space:nowrap;transform:translateX(-50%);}.ov .xax i{display:block;font-style:normal;margin-top:3px;}
.ov .wk .xax span{transform:none;padding-left:4px;border-left:1px solid var(--rule);margin-top:-5px;padding-top:5px;}
.ov .nodata{padding:8px 0;}
/* desktop: the Over-time cards take the rest of the screen, so no gap opens above the footer
   (2026-11-15); plots at least 220px, the card row stops at 820px;
   phones and narrow windows keep the fixed 190px plots */
@media(min-width:1000px){main{display:flex;flex-direction:column;}main>.deckrow:has(>.ov){flex:1 1 auto;max-height:820px;}.ov{display:flex;flex-direction:column;}.ov .slide:not([hidden]){flex:1 1 auto;display:flex;flex-direction:column;}.ov .plot{flex:1 1 auto;grid-template-rows:minmax(220px,1fr) auto;}}
</style></head><body>
<header><div class="hwrap"><h1><img class="buplate" src=")-----",
plate_uri,
r"-----(" alt="Boston University"><span class="orgname">Faculty of Computing &amp; Data Sciences</span><span class="hsep">|</span>Research Computing at CDS</h1></div><div class="hutils"><a class="hbtn" href="https://gpu.cds.bu.edu" data-tip="CDS members: sign-in required"><span class="gpuword">GPU</span> Explorer</a><a class="hbtn" href="https://cpu.cds.bu.edu" data-tip="CDS members: sign-in required"><span class="cpuword">CPU</span> Explorer</a></div></header>
<main>
<div class="livewrap"><span class="liveupd"><a href="https://rcs.bu.edu" target="_blank" rel="noopener">Data from BU SCC</a> · updated quarterly · )-----",
d$meta$updated,
r"-----(</span></div>
<div class="deckrow">
<div class="deck pool pool-gpu" id="gpupanel"><h3>GPU Pool)-----",
gpu_growth,
r"-----(</h3>)-----",
gpu_panel,
r"-----(</div>
<div class="deck pool pool-cpu" id="cpupanel"><h3>CPU Pool)-----",
cpu_growth,
r"-----(</h3>)-----",
cpu_panel,
r"-----(</div>
</div>
<div class="sechead" id="ovhead">
<div class="ttl">Over time<span>)-----",
ov_range_all,
r"-----(</span></div>
<div class="ctl"><span class="seg" id="ovtabs"><button class="on" data-s="rhy">Weekly rhythm</button><button data-s="com">Researchers</button></span></div>
</div>
<div class="deckrow">
)-----",
ov_gpu_deck,
"\n",
ov_cpu_deck,
r"-----(
</div>
</main>
<footer class="pagefoot"><div class="ft-l"><img class="ft-emblem" src=")-----",
emblem_uri,
r"-----(" alt="Boston University Faculty of Computing &amp; Data Sciences"></div><div class="ft-c"><a class="ft-link ft-gh" href="https://github.com/BU-CDS/cds-scc-pub" target="_blank" rel="noopener" aria-label="GitHub repository" title="GitHub repository"><svg viewBox="0 0 16 16" width="19" height="19" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg></a></div><div class="ft-r"><a class="ft-link" href="https://www.bu.edu/policies/digital-privacy-statement/" target="_blank" rel="noopener">Privacy Statement</a></div></footer>
<script>
const $=s=>document.querySelector(s);
const OV_ORDER=['rhy','com'];
const ovTabs=[...document.querySelectorAll('#ovtabs button')],ovSlides=[...document.querySelectorAll('.ov .slide')];
let ovCur=0,ovTimer=null,ovStopped=false;
const ovReduce=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
function ovShow(k){ovCur=OV_ORDER.indexOf(k);ovTabs.forEach(b=>b.classList.toggle('on',b.dataset.s===k));ovSlides.forEach(s=>{s.hidden=s.dataset.s!==k;});}
function ovStop(){if(ovTimer){clearInterval(ovTimer);ovTimer=null;}}
function ovStart(){if(ovStopped||ovReduce||ovTimer)return;ovTimer=setInterval(()=>ovShow(OV_ORDER[(ovCur+1)%OV_ORDER.length]),10000);}
ovTabs.forEach(b=>b.addEventListener('click',()=>{ovStopped=true;ovStop();ovShow(b.dataset.s);}));
['#ovhead','#gpuov','#cpuov'].forEach(s=>{const el=$(s);if(!el)return;el.addEventListener('mouseenter',ovStop);el.addEventListener('mouseleave',ovStart);});
document.addEventListener('visibilitychange',()=>{if(document.hidden)ovStop();else ovStart();});
{const h=(typeof location==='undefined'?'':(location.hash||'')).slice(1);if(OV_ORDER.includes(h)){ovStopped=true;ovShow(h);}else ovStart();}
const tipEl=document.createElement('div');tipEl.id='tip';
function posTip(x,y){const w=tipEl.offsetWidth,h=tipEl.offsetHeight;let L=x+14,T=y+16;if(L+w>innerWidth-8)L=Math.max(8,x-w-14);if(T+h>innerHeight-8)T=Math.max(8,y-h-16);tipEl.style.left=L+'px';tipEl.style.top=T+'px';}
function showTip(html,x,y){if(!html){tipEl.style.display='none';return;}tipEl.innerHTML=html;tipEl.style.display='block';posTip(x,y);}
document.body.appendChild(tipEl);
document.addEventListener('mousemove',e=>{const d=e.target.closest&&e.target.closest('[data-tip]');showTip(d?d.dataset.tip:'',e.clientX,e.clientY);});
document.addEventListener('focusin',e=>{const t=e.target,r=t.getBoundingClientRect&&t.getBoundingClientRect();if(!r)return;const d=t.closest&&t.closest('[data-tip]');showTip(d?d.dataset.tip:'',r.left,r.bottom);});
document.addEventListener('focusout',()=>showTip(''));
</script>
</body></html>
)-----"
)

writeLines(html, file.path(ROOT, "index.html"), useBytes = TRUE)
cat(sprintf("build_cluster_page: wrote index.html (%d bytes)\n", nchar(html, type = "bytes")))
