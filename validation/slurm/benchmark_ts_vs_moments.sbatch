#!/bin/bash
#SBATCH --job-name=benchmark_ts_vs_moments
#SBATCH --account=botany
#SBATCH --cpus-per-task=1
#SBATCH --mem=4G
#SBATCH --time=01:00:00
#SBATCH --no-requeue
#SBATCH --output=validation/logs/%x-%j.out
#SBATCH --error=validation/logs/%x-%j.err
# Phase 1: speed of the TypeScript engine (Node.js; dt_fac 0.02 = full accuracy, 0.1 = draft)
# and of moments (from_demes), all validation models, on the same core of the same node.
# Node.js and Conda run in separate child shells (LiSC rule: never mix Conda and Lmod).
#   sbatch --dependency=afterok:<engine job id> validation/slurm/benchmark_ts_vs_moments.sbatch

set -euo pipefail
PROJ="${SLURM_SUBMIT_DIR:-$PWD}"
cd "$PROJ"
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
echo "== host / start"; hostname; lscpu | grep -E 'Model name' || true; TZ=Europe/Vienna date -Iseconds
(
  module load nodejs/22.17.1-GCCcore-14.3.0
  cd app
  node --version
  for f in 0.02 0.1; do
    ./node_modules/.bin/tsx scripts/engine_cli.ts bench --csv ../validation/models.csv --root .. \
      --out "../validation/benchmarks/ts_engine_timing_dtfac${f}.tsv" --reps 7 --dtfac "$f"
  done
)
bash -c 'set -euo pipefail
  module load Conda
  eval "$(conda shell.bash hook)"
  conda activate "'"$PROJ"'/envs/sfs-validate"
  python validation/benchmarks/benchmark_moments_from_demes.py'
echo "== end"; TZ=Europe/Vienna date -Iseconds
