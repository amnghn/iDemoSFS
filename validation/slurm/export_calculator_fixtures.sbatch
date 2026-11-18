#!/bin/bash
#SBATCH --job-name=export_calculator_fixtures
#SBATCH --account=botany
#SBATCH --cpus-per-task=1
#SBATCH --mem=4G
#SBATCH --time=00:20:00
#SBATCH --no-requeue
#SBATCH --output=validation/logs/%x-%j.out
#SBATCH --error=validation/logs/%x-%j.err
# Phase 2: reference values for the calculator mode (parsers, residuals, haploid WC, VCF WC)
# from moments 1.7.1 and scikit-allel, written to app/test/fixtures/calculator_fixtures.json.
#   sbatch validation/slurm/export_calculator_fixtures.sbatch

set -euo pipefail
PROJ="${SLURM_SUBMIT_DIR:-$PWD}"
cd "$PROJ"
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
module load Conda
eval "$(conda shell.bash hook)"
conda activate "$PROJ/envs/sfs-validate"
echo "== host / start"; hostname; TZ=Europe/Vienna date -Iseconds
python validation/export_calculator_fixtures.py
echo "== end"; TZ=Europe/Vienna date -Iseconds
