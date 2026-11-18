#!/bin/bash
#SBATCH --job-name=compare_engine_vs_msprime
#SBATCH --account=botany
#SBATCH --cpus-per-task=1
#SBATCH --mem=4G
#SBATCH --time=00:20:00
#SBATCH --no-requeue
#SBATCH --output=validation/logs/%x-%j.out
#SBATCH --error=validation/logs/%x-%j.err
# Phase 1: summarise the msprime array (z-scores of the mean simulated SFS).
#   sbatch --dependency=afterany:<array job id> validation/slurm/compare_engine_vs_msprime.sbatch

set -euo pipefail
PROJ="${SLURM_SUBMIT_DIR:-$PWD}"
cd "$PROJ"
module load Conda
eval "$(conda shell.bash hook)"
conda activate "$PROJ/envs/sfs-validate"
echo "== host / start"; hostname; TZ=Europe/Vienna date -Iseconds
python validation/compare_engine_vs_msprime.py
echo "== end"; TZ=Europe/Vienna date -Iseconds
