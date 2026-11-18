#!/bin/bash
#SBATCH --job-name=stats_ts
#SBATCH --account=botany
#SBATCH --cpus-per-task=1
#SBATCH --mem=4G
#SBATCH --time=00:20:00
#SBATCH --no-requeue
#SBATCH --output=validation/logs/%x-%j.out
#SBATCH --error=validation/logs/%x-%j.err
# Phase 1, statistics check part 2: the TypeScript statistics for the simulated spectra
# (Node.js only; no conda in this job).
#   sbatch --dependency=afterok:<stats reference job id> validation/slurm/stats_ts.sbatch

set -euo pipefail
PROJ="${SLURM_SUBMIT_DIR:-$PWD}"
cd "$PROJ/app"
module load nodejs/22.17.1-GCCcore-14.3.0
echo "== host / start"; hostname; TZ=Europe/Vienna date -Iseconds
./node_modules/.bin/tsx scripts/engine_cli.ts stats --in ../validation/output/stats/stats_input_for_ts.json --out ../validation/output/stats/stats_ts.json
echo "== end"; TZ=Europe/Vienna date -Iseconds
