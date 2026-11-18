#!/bin/bash
#SBATCH --job-name=compare_engine_vs_moments_dadi
#SBATCH --account=botany
#SBATCH --cpus-per-task=1
#SBATCH --mem=8G
#SBATCH --time=02:00:00
#SBATCH --no-requeue
#SBATCH --output=validation/logs/%x-%j.out
#SBATCH --error=validation/logs/%x-%j.err
# Phase 1: compare the TypeScript spectra with moments (all models) and dadi (inbreeding).
# Needs the output of engine_spectra_ts.sbatch. Submit from the project root:
#   sbatch --dependency=afterok:<engine job id> validation/slurm/compare_engine_vs_moments_dadi.sbatch

set -euo pipefail
PROJ="${SLURM_SUBMIT_DIR:-$PWD}"
cd "$PROJ"
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
module load Conda
eval "$(conda shell.bash hook)"
conda activate "$PROJ/envs/sfs-validate"
echo "== host / start"; hostname; TZ=Europe/Vienna date -Iseconds
python validation/compare_engine_vs_moments.py
python validation/export_moments_fixtures.py
python validation/compare_inbreeding_vs_dadi.py
echo "== end"; TZ=Europe/Vienna date -Iseconds
