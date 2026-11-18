/**
 * Site settings that are not known yet. Placeholders until STOP 3 (decision of the author):
 * the contact email and the GitHub repository URL. Do not guess them.
 */

export const SITE = {
  author: "Amin Ghane",
  affiliation: "Department of Botany and Biodiversity Research, University of Vienna",
  /** Contact email as [user, domain]; null shows the placeholder. Set only after the author gives it. */
  email: null as null | [string, string],
  /** GitHub repository URL (placeholder until the author gives it). */
  repo: "https://github.com/REPO_OWNER/REPO_NAME",
  repoIsPlaceholder: true,
  /** Default branch used for links to files in the repository. */
  branch: "main",
  year: 2026,
  title: "Demographic history and the expected SFS",
};

export const repoFile = (path: string): string => `${SITE.repo}/blob/${SITE.branch}/${path}`;
