#!/bin/bash
#SBATCH --job-name=validation_report
#SBATCH --account=botany
#SBATCH --cpus-per-task=1
#SBATCH --mem=4G
#SBATCH --time=00:30:00
#SBATCH --no-requeue
#SBATCH --output=validation/logs/%x-%j.out
#SBATCH --error=validation/logs/%x-%j.err
# Phase 1: unit tests (Vitest with the fresh moments fixtures; pytest), the selection closure
# study (TypeScript), then the figures and
# tables of docs/VALIDATION.md. Node.js and Conda run in separate child shells.
#   sbatch --dependency=afterany:<B>:<D>:<E3>:<H> validation/slurm/validation_report.sbatch

set -euo pipefail
PROJ="${SLURM_SUBMIT_DIR:-$PWD}"
cd "$PROJ"
echo "== host / start"; hostname; TZ=Europe/Vienna date -Iseconds
(
  module load nodejs/22.17.1-GCCcore-14.3.0
  cd app
  ./node_modules/.bin/tsc --noEmit -p .
  ./node_modules/.bin/vitest run
  ./node_modules/.bin/tsx scripts/selection_closure_study.ts > ../validation/output/selection_closure_error.tsv
)
bash -c 'set -euo pipefail
  module load Conda
  eval "$(conda shell.bash hook)"
  conda activate "'"$PROJ"'/envs/sfs-validate"
  python -m pytest validation/tests -q -p no:cacheprovider
  if [ -d validation/output/msprime_extra_16000 ]; then
    python validation/compare_engine_vs_msprime.py --ms-dir validation/output/msprime_extra_16000 \
      --out validation/output/compare_engine_vs_msprime_extra16000.tsv
  fi
  python validation/make_validation_report.py'
echo "== end"; TZ=Europe/Vienna date -Iseconds
