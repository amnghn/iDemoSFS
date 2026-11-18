#!/bin/bash
#SBATCH --job-name=stats_reference_from_simulations
#SBATCH --account=botany
#SBATCH --cpus-per-task=1
#SBATCH --mem=8G
#SBATCH --time=01:00:00
#SBATCH --no-requeue
#SBATCH --output=validation/logs/%x-%j.out
#SBATCH --error=validation/logs/%x-%j.err
# Phase 1, statistics check part 1: simulate data (msprime) and compute reference statistics
# with tskit, scikit-allel and egglib. Needs the Demes YAML of engine_spectra_ts.sbatch.
#   sbatch --dependency=afterok:<engine job id> validation/slurm/stats_reference_from_simulations.sbatch

set -euo pipefail
PROJ="${SLURM_SUBMIT_DIR:-$PWD}"
cd "$PROJ"
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
module load Conda
eval "$(conda shell.bash hook)"
conda activate "$PROJ/envs/sfs-validate"
echo "== host / start"; hostname; TZ=Europe/Vienna date -Iseconds
python validation/stats_reference_from_simulations.py
echo "== end"; TZ=Europe/Vienna date -Iseconds
