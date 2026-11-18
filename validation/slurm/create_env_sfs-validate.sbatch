#!/bin/bash
#SBATCH --job-name=create_env_sfs-validate
#SBATCH --account=botany
#SBATCH --cpus-per-task=4
#SBATCH --mem=16G
#SBATCH --time=01:00:00
#SBATCH --no-requeue
#SBATCH --output=validation/logs/%x-%j.out
#SBATCH --error=validation/logs/%x-%j.err
# Phase 0, step 0.2: create the local validation environment ./envs/sfs-validate,
# write a lock file, and run the import smoke test.
# Submit from the project root:
#   cd <project root>
#   sbatch validation/slurm/create_env_sfs-validate.sbatch

set -euo pipefail

PROJ="${SLURM_SUBMIT_DIR:-$PWD}"   # the project root (the job is submitted from there)
ENV="$PROJ/envs/sfs-validate"
cd "$PROJ"

echo "== host / start"; hostname; TZ=Europe/Vienna date -Iseconds

# Only the Conda module in this shell (LiSC rule: never mix a Conda env with other Lmod modules).
module load Conda
eval "$(conda shell.bash hook)"

if [ -e "$ENV" ]; then
    echo "ERROR: $ENV already exists. Not touching it." >&2
    exit 1
fi

# Binary packages from conda-forge and bioconda (dadi and egglib need compiled code;
# their PyPI releases are sdists only).
conda create -y -p "$ENV" \
    -c conda-forge -c bioconda --strict-channel-priority \
    python=3.12 "numpy>=2,<3" scipy matplotlib pandas pytest "mpmath>=1.0,<1.4" \
    msprime=1.4.5 tskit=1.0.4 demes=0.2.3 demesdraw=0.4.1 \
    scikit-allel=1.3.13 dadi=2.4.3 egglib=3.6.1 "cython>=3.1"

conda activate "$ENV"

# moments-popgen is on PyPI only (cp312 manylinux wheel). --only-binary avoids any local compiling.
python -m pip install --no-cache-dir --only-binary=:all: "moments-popgen==1.7.1"

# Lock file (committed to git; the env itself is gitignored).
{
    echo "# Lock file for ./envs/sfs-validate (created by job ${SLURM_JOB_ID:-NA} on $(TZ=Europe/Vienna date -Iminutes))"
    echo "# Rebuild: conda create -p ./envs/sfs-validate --file <explicit part>; then pip install the pip part."
    echo "# ---- conda list --explicit ----"
    conda list --explicit
    echo "# ---- pip freeze ----"
    python -m pip freeze
} > "$PROJ/envs/sfs-validate.lock.txt"

echo "== smoke test"
python "$PROJ/validation/smoke_test_env_imports.py"

echo "== end"; TZ=Europe/Vienna date -Iseconds
