#!/bin/bash
#SBATCH --job-name=compare_stats
#SBATCH --account=botany
#SBATCH --cpus-per-task=1
#SBATCH --mem=4G
#SBATCH --time=00:20:00
#SBATCH --no-requeue
#SBATCH --output=validation/logs/%x-%j.out
#SBATCH --error=validation/logs/%x-%j.err
# Phase 1, statistics check part 3: compare the TypeScript statistics with the references.
#   sbatch --dependency=afterok:<stats_ts job id> validation/slurm/compare_stats.sbatch

set -euo pipefail
PROJ="${SLURM_SUBMIT_DIR:-$PWD}"
cd "$PROJ"
module load Conda
eval "$(conda shell.bash hook)"
conda activate "$PROJ/envs/sfs-validate"
echo "== host / start"; hostname; TZ=Europe/Vienna date -Iseconds
python validation/compare_stats.py
echo "== end"; TZ=Europe/Vienna date -Iseconds
