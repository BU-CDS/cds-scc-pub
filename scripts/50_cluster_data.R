# =====================================================================
# 50_cluster_data.R — strip + combine the CPU and GPU sibling emits into
# the one public fact table this page's charts read.
#
# Reads (read-only, env-overridable):
#   $PUB_CPU_CLONE/output/portal_data.json        (CPU internal de-identified emit)
#   $PUB_GPU_CLONE/output/portal_data.json        (GPU internal de-identified emit)
#   $PUB_CPU_CLONE/config/cds_cpu_inventory.csv
#   $PUB_GPU_CLONE/config/gpu_inventory_history.csv
# Writes: output/cluster_data.json
#
# proj/user/queue/host never reach the output: both emits' F tables are
# aggregated away to (month, pool) and (week, pool); hardware inventory is read
# for capacity counts only (host is never emitted, just counted). Refuses
# identified or stale input outright — this is the only place either
# sibling clone's data touches a public artifact.
#
# Contract v3 (2026-09-01) adds a third input, the GPU internal
# de-identified emit, read ONLY for pt=="M" rows' (p, user, proj) columns
# (its PI/U/N/Cu/JW/Wraw/H tables are never touched) and joined with the
# CPU internal emit's own (p, user, proj) columns for month-grain
# "community" membership (distinct users/groups per selectable period);
# plus `capacity_monthly` (nominal capacity-hours per month, prorated by
# each inventory row's install_date/retired) and `capacity.*.added_12m`
# (nominal units installed in the past 12 months, not retired). Distinct
# user codes and project names are computed only to be counted — the
# codes/names themselves never reach community or any other emitted field.
#
# Contract v4 (R6, 2026-09-01): the GPU public emit is gone -- the GPU internal
# de-identified emit (already read for membership) also supplies gpu_monthly,
# aggregated to (month, card) exactly as the CPU emit is aggregated to
# (month, node_class). A pool's published months exclude the in-progress
# month AND any month starting before its emit's meta$start (a partial first
# month). New `weekly` rows [monday, pool, held_h]: Σ held over the emit's
# pt=="W" rows per ISO week, keyed by that week's Monday (YYYY-MM-DD), dense
# over the complete weeks inside the pool's published months.
#
# Contract v5 (2026-11-15): narrowed to what the page and the gate read. The page
# no longer embeds this file and shows only the weekly series and researcher
# counts, so cpu_monthly / gpu_monthly (per node class / card, with failed,
# wall-killed, walltime and idle hours), headline, capacity_monthly and the
# P3/P6 community rows are gone. `monthly` [month, pool, held_h] stays, one row
# per published month per pool, only so the gate can cross-check the weekly
# series; community keeps "M:<month>" and "ALL". The emits are read for held
# hours and (p, user, proj) only.
#
# Run: module load R/4.5.2 && Rscript scripts/50_cluster_data.R   (~1 s)
# =====================================================================
.f    <- sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE))
ROOT  <- if (length(.f)) normalizePath(file.path(dirname(.f[[1]]), "..")) else normalizePath("..")
OUTPUT_DIR <- file.path(ROOT, "output")
dir.create(OUTPUT_DIR, showWarnings = FALSE)

suppressPackageStartupMessages({
  library(data.table)
  library(jsonlite)
})
source(file.path(ROOT, "scripts", "week_helpers.R"))

PUB_CPU_CLONE <- Sys.getenv("PUB_CPU_CLONE", "/usr3/bustaff/mhorn/repos/cpu-cds-scc")
PUB_GPU_CLONE <- Sys.getenv("PUB_GPU_CLONE", "/usr3/bustaff/mhorn/repos/gpu-cds-scc")

CPU_MAX_AGE_H <- 48    # CPU internal emit refreshes ~daily
GPU_MAX_AGE_H <- 48    # GPU internal de-identified emit refreshes ~daily

cpu_inf <- file.path(PUB_CPU_CLONE, "output", "portal_data.json")
gpu_inf <- file.path(PUB_GPU_CLONE, "output", "portal_data.json")
stopifnot(file.exists(cpu_inf), file.exists(gpu_inf))

cpu <- fromJSON(cpu_inf, simplifyMatrix = TRUE)
gpu <- fromJSON(gpu_inf, simplifyMatrix = TRUE)

if (isTRUE(cpu$meta$identified) || !isTRUE(cpu$meta$deid))
  stop("50_cluster_data: CPU portal_data.json is identified or unmarked; refusing to build cluster_data")
if (isTRUE(gpu$meta$identified) || !isTRUE(gpu$meta$deid))
  stop("50_cluster_data: GPU portal_data.json (internal emit) is identified or unmarked; refusing to build cluster_data")

now <- as.numeric(Sys.time())
cpu_age_h <- (now - cpu$meta$generated_epoch) / 3600
if (cpu_age_h > CPU_MAX_AGE_H)
  stop(sprintf("50_cluster_data: CPU input stale (%.1f h > %d h limit)", cpu_age_h, CPU_MAX_AGE_H))
gpu_age_h <- (now - gpu$meta$generated_epoch) / 3600
if (gpu_age_h > GPU_MAX_AGE_H)
  stop(sprintf("50_cluster_data: GPU portal_data.json (internal emit) stale (%.1f h > %d h limit)", gpu_age_h, GPU_MAX_AGE_H))

# R6.2 complete months: the in-progress month never publishes, nor does a month
# that started before the emit's own first day (a partial first month would
# advertise a dip that is really missing data).
cur <- format(Sys.Date(), "%Y-%m")
complete_months <- function(periods_m, start, label) {
  if (is.null(start) || !nzchar(start))
    stop(sprintf("50_cluster_data: %s has no meta$start; cannot decide which months are complete", label))
  ms <- setdiff(periods_m, cur)
  ms[as.Date(paste0(ms, "-01")) >= as.Date(start)]
}
months_cpu <- complete_months(cpu$periods$M, cpu$meta$start, "CPU portal_data.json")
months_gpu <- complete_months(gpu$periods$M, gpu$meta$start, "GPU portal_data.json")
stopifnot(length(months_cpu) >= 1, length(months_gpu) >= 1)
window3 <- tail(sort(intersect(months_cpu, months_gpu)), 3)   # trailing (<=3) months common to both; feeds the lag guard below

# Guard: window3 must end at the calendar month just closed (America/New_York),
# not merely "whatever the two emits happen to agree on". Without this, an input
# that stops advancing on one side (e.g. a dropped producer cron) silently ages
# the published "Past 3 months" by a month every run until a freshness ceiling
# finally trips -- loud only after the damage is already done. Fail closed instead.
cur_et <- format(as.POSIXct(Sys.time(), tz = "America/New_York"), "%Y-%m")
expected_month <- format(seq(as.Date(paste0(cur_et, "-01")), by = "-1 month", length.out = 2)[2], "%Y-%m")
last_common <- if (length(window3)) tail(window3, 1) else "(none)"
if (last_common != expected_month)
  stop(sprintf("50_cluster_data: window3 lag -- last common complete month is %s, expected %s (the month just closed)",
               last_common, expected_month))

# all_months: the union of both pools' published complete months, sorted ascending
# (build_cluster_page.R's `all_months`); community is keyed by each of them plus ALL.
all_months <- sort(unique(c(months_cpu, months_gpu)))

# columns read from the sibling emits' own F tables, by name. Fail closed if one is
# missing: better a broken build than silently zero-filling a published series.
require_cols <- function(cols, have, label) {
  missing <- setdiff(cols, have)
  if (length(missing))
    stop(sprintf("50_cluster_data: %s missing required column(s): %s", label, paste(missing, collapse = ", ")))
}
require_cols(c("pt", "p", "held", "user", "proj"), cpu$Fcols, "CPU portal_data.json")
require_cols(c("pt", "p", "held", "user", "proj"), gpu$Fcols, "GPU portal_data.json")

tomat  <- function(m, cols) { x <- as.data.table(m); setnames(x, cols); x }
numify <- function(x, cc) { for (col in cc) x[, (col) := as.numeric(get(col))]; x }
# Row-wise list, not as.matrix(): a data.table mixing character and numeric columns
# would have as.matrix() coerce every column to character (and pad-quote the numbers),
# so held_h/count/per_node/per_node_ram_gb must serialize as JSON numbers, not
# strings. Each row becomes an unnamed list; auto_unbox turns its length-1 elements
# into bare scalars, so toJSON renders one mixed-type JSON array per row.
to_rows <- function(dt) unname(lapply(seq_len(nrow(dt)), function(i) unname(as.list(dt[i]))))

Fc <- numify(tomat(cpu$F, cpu$Fcols), "held")[pt == "M" & p %chin% months_cpu]
Fg <- numify(tomat(gpu$F, gpu$Fcols), "held")[pt == "M" & p %chin% months_gpu]

# community membership: (p, user, proj) only, from the CPU internal emit (cpu$F,
# already read above) and the GPU internal de-identified emit (gpu$F). RULING
# (2026-09-01): each pool's membership is restricted to that
# SAME pool's own published month list (months_cpu / months_gpu -- the same
# months its hour table covers), not the wider all_months union -- so every
# tile on a card covers the same span (the coverage caption already discloses
# partial coverage). A window whose months don't overlap that pool's own list
# at all (e.g. a CPU-only month, for the GPU pool) naturally yields 0 users /
# 0 groups once intersected below, not a phantom stray-month count. user/proj
# are read only to be counted distinct below -- never emitted themselves.
Fm_cpu <- tomat(cpu$F, cpu$Fcols)[pt == "M" & p %chin% months_cpu, .(p, user, proj)]
Fm_gpu <- tomat(gpu$F, gpu$Fcols)[pt == "M" & p %chin% months_gpu, .(p, user, proj)]

# monthly: [month, pool, held_h] -- one row per published month per pool (0 where
# the emit has no rows), summed over node classes / cards. Never shown on the page;
# kept so the gate can check the weekly series against it.
monthly_for <- function(Fx, months, pool) {
  sums <- Fx[, .(held_h = sum(held)), by = p]
  out <- merge(data.table(p = months, pool = pool), sums, by = "p", all.x = TRUE, sort = TRUE)
  out[is.na(held_h), held_h := 0]
  out[, .(month = p, pool, held_h = round(held_h, 2))]
}
monthly <- rbind(monthly_for(Fc, months_cpu, "cpu"), monthly_for(Fg, months_gpu, "gpu"))

stopifnot(!any(c("proj", "user", "host", "code", "codename") %in% names(monthly)))   # belt: the strip is structural

# community: [window_key, pool, users, groups] -- distinct users/groups for
# "M:YYYY-MM" (each month in all_months) and "ALL" (all of them), the keys the
# Researchers slide reads. Each pool's month set is the window intersected with
# that pool's own published months (Fm_cpu/Fm_gpu are already restricted), so a
# month outside a pool's coverage yields 0/0, not an error.
window_keys <- c(paste0("M:", all_months), "ALL")
community <- rbindlist(lapply(window_keys, function(k) {
  ms <- if (k == "ALL") all_months else sub("^M:", "", k)
  data.table(window_key = k, pool = c("cpu", "gpu"),
             users  = c(uniqueN(Fm_cpu[p %chin% ms, user]), uniqueN(Fm_gpu[p %chin% ms, user])),
             groups = c(uniqueN(Fm_cpu[p %chin% ms, proj]), uniqueN(Fm_gpu[p %chin% ms, proj])))
}))

# capacity: hardware inventory, config-sourced so a node with zero samples in
# the window still advertises. Retired nodes never count.
cpu_inv <- fread(file.path(PUB_CPU_CLONE, "config", "cds_cpu_inventory.csv"), colClasses = "character")[retired == "" & nzchar(host)]
gpu_inv <- fread(file.path(PUB_GPU_CLONE, "config", "gpu_inventory_history.csv"), colClasses = "character")[retired == "" & nzchar(host)]

# every inventory row, retired ones included: added_12m below reads install/retire dates.
cpu_inv_all <- fread(file.path(PUB_CPU_CLONE, "config", "cds_cpu_inventory.csv"), colClasses = "character")[nzchar(host)]
gpu_inv_all <- fread(file.path(PUB_GPU_CLONE, "config", "gpu_inventory_history.csv"), colClasses = "character")[nzchar(host)]

# weekly: [monday, pool, held_h] -- contract v4 (R6.3). An ISO week key
# "YYYY-Www" names the week whose Monday is the Monday on or before 4 January
# of that ISO year plus 7*(w-1) days. Rows exist only for complete weeks
# inside the pool's published months (first Monday >= first day of its first
# month .. last Monday whose Sunday <= last day of its last month), one per
# Monday, held_h = 0 where the emit has no rows; so "the in-progress month
# never publishes" stays literally true at week grain too.
# iso_monday() / week_mondays() come from scripts/week_helpers.R (sourced above).
weekly_for <- function(emit, cols, months, pool, label) {
  Fw <- numify(tomat(emit$F, cols), "held")[pt == "W"]
  if (nrow(Fw) && !all(grepl("^\\d{4}-W\\d{2}$", Fw$p)))
    stop(sprintf("50_cluster_data: %s has a W-grain period not shaped YYYY-Www", label))
  Fw[, monday := iso_monday(p)]
  sums <- Fw[, .(held_h = sum(held)), by = monday]
  out <- merge(data.table(monday = week_mondays(months), pool = pool), sums, by = "monday", all.x = TRUE, sort = TRUE)
  out[is.na(held_h), held_h := 0]
  out[, .(monday = format(monday, "%Y-%m-%d"), pool, held_h = round(held_h, 2))]
}
weekly <- rbind(weekly_for(cpu, cpu$Fcols, months_cpu, "cpu", "CPU portal_data.json"),
                weekly_for(gpu, gpu$Fcols, months_gpu, "gpu", "GPU portal_data.json"))
stopifnot(!any(c("proj", "user", "host", "code", "codename") %in% names(weekly)))

# added_12m: nominal units (not rows) installed within the 12 months ending on
# the run date, excluding units that are (now) retired.
today_d  <- Sys.Date()
start_12 <- seq(today_d, by = "-12 months", length.out = 2)[2]
added_12m_units <- function(inv, unit_col) {
  d <- suppressWarnings(as.Date(ifelse(nzchar(inv$install_date), inv$install_date, NA)))
  keep <- !is.na(d) & inv$retired == "" & d >= start_12 & d <= today_d
  sum(as.integer(inv[[unit_col]])[keep])
}
cpu_added_12m <- as.integer(added_12m_units(cpu_inv_all, "ncpu"))
gpu_added_12m <- as.integer(added_12m_units(gpu_inv_all, "gpus"))

cpu_types <- cpu_inv[, .(count = .N), by = .(label = cpu_type, server = server_model,
                                              per_node = as.integer(ncpu), per_node_ram_gb = as.numeric(mem_gb))]
setorder(cpu_types, -per_node_ram_gb)
gpu_types <- gpu_inv[, .(count = .N), by = .(label = gpu_type, server = server_model,
                                              per_node = as.integer(gpus), per_node_ram_gb = as.numeric(gpu_mem_gb))]
setorder(gpu_types, -per_node_ram_gb)

capacity <- list(
  cpu = list(nodes = nrow(cpu_inv),
             cores = sum(as.integer(cpu_inv$ncpu)),
             ram_gb = round(sum(as.numeric(cpu_inv$mem_gb)), 1),
             types = to_rows(cpu_types[, .(label, server, count, per_node, per_node_ram_gb)]),
             added_12m = cpu_added_12m),
  gpu = list(nodes = nrow(gpu_inv),
             gpus = sum(as.integer(gpu_inv$gpus)),
             vram_gb = round(sum(as.integer(gpu_inv$gpus) * as.numeric(gpu_inv$gpu_mem_gb)), 1),
             types = to_rows(gpu_types[, .(label, server, count, per_node, per_node_ram_gb)]),
             added_12m = gpu_added_12m)
)

meta <- list(updated = format(Sys.Date(), "%Y-%m-%d"), public = TRUE,
             months_cpu = I(months_cpu), months_gpu = I(months_gpu), window3 = I(window3),
             contract = 5L)

out <- list(meta = meta, capacity = capacity,
            monthly = to_rows(monthly),
            community = to_rows(community),
            weekly = to_rows(weekly))

.outf <- file.path(OUTPUT_DIR, "cluster_data.json")
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA), paste0(.outf, ".tmp"))
if (!file.rename(paste0(.outf, ".tmp"), .outf))   # atomic, same as the siblings' 52/57; a failed swap must not leave the old file looking fresh
  stop("50_cluster_data: could not replace ", .outf)
cat(sprintf("wrote cluster_data.json (contract 5) — monthly %d rows (cpu %s..%s, gpu %s..%s); community %d rows; added_12m cpu %d / gpu %d; weekly %d rows\n",
            nrow(monthly), months_cpu[1], months_cpu[length(months_cpu)], months_gpu[1], months_gpu[length(months_gpu)],
            nrow(community), cpu_added_12m, gpu_added_12m, nrow(weekly)))
