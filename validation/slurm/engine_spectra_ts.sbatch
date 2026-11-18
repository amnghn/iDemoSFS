#!/bin/bash
#SBATCH --job-name=engine_spectra_ts
#SBATCH --account=botany
#SBATCH --cpus-per-task=1
#SBATCH --mem=4G
#SBATCH --time=00:30:00
#SBATCH --no-requeue
#SBATCH --output=validation/logs/%x-%j.out
#SBATCH --error=validation/logs/%x-%j.err
# Phase 1: write the TypeScript engine's spectra and Demes YAML for every row of
# validation/models.csv (Node.js only; no conda in this job).
# Submit from the project root:  sbatch validation/slurm/engine_spectra_ts.sbatch

set -euo pipefail
PROJ="${SLURM_SUBMIT_DIR:-$PWD}"
cd "$PROJ"
module load nodejs/22.17.1-GCCcore-14.3.0
echo "== host / start"; hostname; node --version; TZ=Europe/Vienna date -Iseconds
python3 validation/make_validation_models.py
cd app
./node_modules/.bin/vitest run
./node_modules/.bin/tsc --noEmit -p .
./node_modules/.bin/tsx scripts/engine_cli.ts spectra --csv ../validation/models.csv --root .. --out ../validation/output/ts --dtfac 0.02
echo "== end"; TZ=Europe/Vienna date -Iseconds
