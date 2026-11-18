#!/bin/bash
#SBATCH --job-name=msprime_branch_sfs
#SBATCH --account=botany
#SBATCH --cpus-per-task=1
#SBATCH --mem=4G
#SBATCH --time=02:00:00
#SBATCH --no-requeue
#SBATCH --array=0-38%12
#SBATCH --output=validation/logs/%x-%A_%a.out
#SBATCH --error=validation/logs/%x-%A_%a.err
# Phase 1: msprime simulation check, one array task per row of validation/models.csv
# (data row = SLURM_ARRAY_TASK_ID + 2; rows not marked msprime=yes exit at once).
# Needs the output of engine_spectra_ts.sbatch. Submit from the project root:
#   sbatch --dependency=afterok:<engine job id> validation/slurm/msprime_branch_sfs_array.sbatch
# The array size must equal the number of data rows of models.csv (39 -> 0-38).

set -euo pipefail
PROJ="${SLURM_SUBMIT_DIR:-$PWD}"
cd "$PROJ"
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
module load Conda
eval "$(conda shell.bash hook)"
conda activate "$PROJ/envs/sfs-validate"
echo "== host / start / task ${SLURM_ARRAY_TASK_ID}"; hostname; TZ=Europe/Vienna date -Iseconds
python validation/simulate_msprime_branch_sfs.py "${SLURM_ARRAY_TASK_ID}"
echo "== end"; TZ=Europe/Vienna date -Iseconds
