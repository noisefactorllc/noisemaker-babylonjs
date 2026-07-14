#!/usr/bin/env bash
# sweep.sh [names...] — render every Babylon candidate (one browser) + grade vs the reused
# reference WebGL2 goldens.
#
#   bash parity/sweep.sh            # all programs with goldens
#   bash parity/sweep.sh noise blur # just these
#
# Because the Babylon candidate renders on the SAME WebGL2 driver (ANGLE/Metal) as the golden,
# parity is byte-EXACT: every graded effect passes at max-abs-diff 0. There is no per-effect
# relaxed-tolerance map: a 2026-07 full re-grade (every catalogued effect, including the
# continuous solvers reactionDiffusion/navierStokes evolved ~30s via the EVOLVE path) confirmed
# 0 diff across the board, including the handful of effects (newton, shadow, uvRemap,
# distortion, edge, pinch, crt) that once carried a relaxed tolerance here as a safety net — that
# net is retired; any non-zero diff now means a real BabylonBackend bug, not a rounding quirk.
set -uo pipefail
cd "$(dirname "$0")/.."

tol_for() { echo "0 0.999"; }
# Documented skips: external-input effects ONLY — they need a MIDI/media/glyph source the parity
# harness doesn't supply, so their program only exercises the no-input fallback path. NOTE remap
# is NOT skipped: its inputs are engine surfaces and it grades byte-identical via the std140 UBO
# path (the only "external" part is the zone-polygon config, which fills uniforms). media/text/roll
# DO numerically pass at max-abs-diff 0 on their fallback path (proving the base plumbing is
# correct on both backends) but stay policy-skipped: a pass here is necessary, not sufficient,
# evidence — it doesn't exercise the actual external-data upload (a real image/glyph atlas/MIDI
# stream), which the headless harness can't supply deterministically. Everything else is graded,
# including the continuous solvers AND the agent/points sims, all of which evolve to a
# bit-identical steady state (the EVOLVE map in render-batch.mjs runs them ~30s; the additive
# deposit blend is exact — raw blendFunc(ONE,ONE)).
is_skip() { case "$1" in media|text|roll) return 0;; *) return 1;; esac; }

PY="parity/.venv/bin/python"

# Names: args, or every effect program with a golden. The live-corpus fixtures (corpus_*) are
# EXCLUDED here — they are stateful/emergent compositions that must be evolved ~30s (their goldens
# are minted at 1800 frames) and are graded by their own harness, parity/corpus/sweep.sh. Grading
# them here (un-evolved, frame 8) would falsely fail them on a frame-count mismatch.
if [[ $# -gt 0 ]]; then NAMES=("$@"); else
  NAMES=()
  for g in parity/out/*.golden.png; do n="$(basename "$g" .golden.png)"; [[ "$n" == corpus_* ]] && continue; [[ -f "parity/programs/$n.dsl" ]] && NAMES+=("$n"); done
fi

# Render all candidates in ONE browser session.
echo "=== rendering ${#NAMES[@]} candidates (one browser) ==="
# Hardening: clear any stale candidate PNGs first. If a candidate fails to render, the file must
# be ABSENT so the grader (below) reports "no candidate rendered" — otherwise an errored render
# would be silently graded against a leftover candidate from a previous run and falsely PASS.
for n in "${NAMES[@]}"; do rm -f "parity/out/$n.candidate.png"; done
node parity/render-batch.mjs "${NAMES[@]}" 2>&1 | grep -E "ERR|rendered" | sed 's/^/  /'

# Grade.
pass=0; fail=0; skip=0; failed=""
for n in "${NAMES[@]}"; do
  if is_skip "$n"; then echo "[SKIP] $n — render-verified, not strict-graded (external input or chaotic agent sim)"; skip=$((skip+1)); continue; fi
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
