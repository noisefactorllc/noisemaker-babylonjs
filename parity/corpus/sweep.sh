#!/usr/bin/env bash
# corpus/sweep.sh — grade the live NoiseBLASTER! corpus (real shared compositions from
# blaster.noisedeck.app) through the Babylon backend, evolved to a 30s steady state.
#
#   bash parity/corpus/fetch.sh        # (optional) refresh raw/<code>.json from the live feed
#   NM_REFERENCE_ROOT=../noisemaker bash parity/corpus/sweep.sh
#
# Real third-party compositions are LOCAL-ONLY test fixtures (raw/ is gitignored); we commit the
# harness, not the art. Stateful programs (particles/navierStokes/feedback) so evolved 30s.
set -uo pipefail
cd "$(dirname "$0")/../.."
PY="parity/.venv/bin/python"
EVO_FRAMES="${CORPUS_FRAMES:-1800}"
EVO_TS="${CORPUS_TS:-0.0016667}"
MAN="parity/_corpus.manifest"

# 1. Extract DSL from each raw/<code>.json into parity/programs/corpus_<code>.dsl + build manifest.
#    Skip compositions the REFERENCE compiler itself rejects (unknown/newer effects) — ungradeable.
node -e '
const fs=require("fs");
import("./tools/export-fat-graph.mjs").then(async ({exportFatGraph})=>{
  const dir="parity/corpus/raw";
  if(!fs.existsSync(dir)){ console.error("no corpus — run parity/corpus/fetch.sh first"); process.exit(2); }
  const lines=[], skipped=[];
  for(const f of fs.readdirSync(dir).filter(x=>x.endsWith(".json"))){
    const c=JSON.parse(fs.readFileSync(dir+"/"+f)); const dsl=c.dsl||"";
    const name="corpus_"+c.code.replace(/[^A-Za-z0-9]/g,"_");
    try{ await exportFatGraph(dsl); fs.writeFileSync(`parity/programs/${name}.dsl`,dsl); lines.push(`${name}\tparity/programs/${name}.dsl\t${c.title||""}`); }
    catch(e){ skipped.push(`${c.code} (${c.title}) — reference rejects: ${(e.diagnostics&&e.diagnostics[0]&&e.diagnostics[0].message||"").slice(0,40)}`); }
  }
  fs.writeFileSync("parity/_corpus.manifest", lines.map(l=>l.split("\t").slice(0,2).join("\t")).join("\n")+"\n");
  console.error(`[corpus] ${lines.length} gradeable, ${skipped.length} skipped`);
  skipped.forEach(s=>console.error("  SKIP "+s));
})
'
[[ -s "$MAN" ]] || { echo "no gradeable corpus programs"; exit 1; }
NAMES=$(cut -f1 "$MAN" | tr "\n" " ")

# 2. Golden (reference demo viewer) + 3. candidate (Babylon), both evolved.
echo "=== goldens (reference WebGL2, ${EVO_FRAMES}f) ==="
node parity/batch-golden.mjs "$MAN" parity/out --size 256 --time 0.25 --frames "$EVO_FRAMES" --timestep "$EVO_TS" 2>&1 | grep -iE "ok,|fail" | tail -1
echo "=== candidates (Babylon, ${EVO_FRAMES}f) ==="
node parity/render-batch.mjs $NAMES --frames "$EVO_FRAMES" --timestep "$EVO_TS" 2>&1 | grep -E "ERR|rendered" | tail -2

# 4. Grade.
pass=0; fail=0; failed=""
for n in $NAMES; do
  [[ -f "parity/out/$n.golden.png" && -f "parity/out/$n.candidate.png" ]] || { fail=$((fail+1)); failed="$failed $n"; continue; }
  r=$("$PY" parity/compare.py "parity/out/$n.golden.png" "parity/out/$n.candidate.png" --name "$n" --tolerance 2.001 --ssim-min 0.98 2>&1)
  echo "  $(echo "$r" | sed 's/ (tol.*//')"
  echo "$r" | grep -q "\[PASS\]" && pass=$((pass+1)) || { fail=$((fail+1)); failed="$failed $n"; }
done
echo ""; echo "=== CORPUS: $pass / $((pass+fail)) PASS ==="
[[ -n "$failed" ]] && echo "    FAILED:$failed"
[[ "$fail" -eq 0 ]]
