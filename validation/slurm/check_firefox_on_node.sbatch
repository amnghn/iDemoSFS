#!/bin/bash
#SBATCH --job-name=ff_check
#SBATCH --cpus-per-task=1
#SBATCH --mem=1G
#SBATCH --time=00:05:00
#SBATCH --output=validation/logs/check_firefox_on_node_%j.log
set -euo pipefail
hostname
ls -l /usr/bin/firefox || echo "no firefox"
firefox --version || true
