#!/bin/bash
#SBATCH --job-name=benchmark_moments_timing_n20
#SBATCH --account=botany
#SBATCH --cpus-per-task=1
#SBATCH --mem=4G
#SBATCH --time=00:30:00
#SBATCH --no-requeue
#SBATCH --output=validation/logs/%x-%j.out
#SBATCH --error=validation/logs/%x-%j.err
# Phase 0, step 0.3: single-thread timing baseline of moments 1.7.1 for n = 20 (1D) and 20x20 (2D).
# Submit from the project root (after create_env_sfs-validate has finished OK):
#   sbatch --dependency=afterok:<env_job_id> validation/slurm/benchmark_moments_timing_n20.sbatch

set -euo pipefail

PROJ="${SLURM_SUBMIT_DIR:-$PWD}"   # the project root (the job is submitted from there)
cd "$PROJ"

# Single thread, so the numbers compare with one browser Web Worker.
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1

module load Conda
eval "$(conda shell.bash hook)"
conda activate "$PROJ/envs/sfs-validate"

echo "== host / start"; hostname; lscpu | grep -E 'Model name' || true; TZ=Europe/Vienna date -Iseconds
python validation/benchmarks/benchmark_moments_timing_n20.py
echo "== end"; TZ=Europe/Vienna date -Iseconds
