/**
 * Site settings given by the author. The contact email was given at STOP 3 (2026-11-19).
 * The GitHub repository URL is still a placeholder until the author gives it. Do not guess it.
 */

export const SITE = {
  author: "Amin Ghane",
  affiliation: "Department of Botany and Biodiversity Research, University of Vienna",
  /** Contact email as [user, domain] (given by the author, 2026-11-19); built into an address at run time only. */
  email: ["aminghane", "univie.ac.at"] as null | [string, string],
  /** GitHub repository URL (placeholder until the author gives it). */
  repo: "https://github.com/REPO_OWNER/REPO_NAME",
  repoIsPlaceholder: true,
  /** Default branch used for links to files in the repository. */
  branch: "main",
  year: 2026,
  title: "Demographic history and the expected SFS",
};

export const repoFile = (path: string): string => `${SITE.repo}/blob/${SITE.branch}/${path}`;
