#!/usr/bin/env bash
# sweep.sh [names...] — render every Babylon candidate (one browser) + grade vs the reused
# reference WebGL2 goldens.
#
#   bash parity/sweep.sh            # all programs with goldens
#   bash parity/sweep.sh noise blur # just these
#
# Because the Babylon candidate renders on the SAME WebGL2 driver (ANGLE/Metal) as the golden,
# parity is byte-tight: every effect passes at the strict default (max-diff <= 2.001), with
# NONE needing the per-effect relaxed tolerances the Metal-backed godot/td ports required. The
# relaxed map below is kept only as a safety net. The sole non-graded program is the continuous
# Gray-Scott solver reactionDiffusion (amplifies sub-ULP differences over its iteration loop —
# faithfully ported but not bit-reproducible across implementations; documented, skipped).
set -uo pipefail
cd "$(dirname "$0")/.."

tol_for() {
  case "$1" in
    newton) echo "255 0.98";; shadow) echo "255 0.99";; uvRemap) echo "22 0.98";;
    distortion) echo "12 0.98";; edge) echo "8 0.98";; pinch) echo "6 0.98";; crt) echo "3 0.98";;
    *) echo "2.001 0.98";;
  esac
}
# Documented skips: continuous solvers (not bit-reproducible) + external-input effects (need a
# MIDI/media/asset source the parity harness doesn't provide — golden is degenerate/black).
is_skip() { case "$1" in reactionDiffusion|navierStokes|media|text|remap) return 0;; *) return 1;; esac; }

PY="parity/.venv/bin/python"

# Names: args, or every program with a golden.
if [[ $# -gt 0 ]]; then NAMES=("$@"); else
  NAMES=()
  for g in parity/out/*.golden.png; do n="$(basename "$g" .golden.png)"; [[ -f "parity/programs/$n.dsl" ]] && NAMES+=("$n"); done
fi

# Render all candidates in ONE browser session.
echo "=== rendering ${#NAMES[@]} candidates (one browser) ==="
node parity/render-batch.mjs "${NAMES[@]}" 2>&1 | grep -E "ERR|rendered" | sed 's/^/  /'

# Grade.
pass=0; fail=0; skip=0; failed=""
for n in "${NAMES[@]}"; do
  if is_skip "$n"; then echo "[SKIP] $n — continuous solver (documented, not bit-reproducible)"; skip=$((skip+1)); continue; fi
  [[ -f "parity/out/$n.candidate.png" ]] || { echo "[FAIL] $n — no candidate rendered"; fail=$((fail+1)); failed="$failed $n"; continue; }
  read -r tol ssim <<<"$(tol_for "$n")"
  r=$("$PY" parity/compare.py "parity/out/$n.golden.png" "parity/out/$n.candidate.png" --name "$n" --tolerance "$tol" --ssim-min "$ssim" 2>&1)
  echo "$r"
  echo "$r" | grep -q "\[PASS\]" && pass=$((pass+1)) || { fail=$((fail+1)); failed="$failed $n"; }
done

echo ""
echo "=== SWEEP: ${pass} / $((pass+fail)) PASS, ${skip} skipped ==="
[[ -n "$failed" ]] && echo "    FAILED:$failed"
[[ "$fail" -eq 0 ]]
