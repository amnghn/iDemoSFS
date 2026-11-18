/**
 * The About tab: author, contact (email built at run time, so that it is hard for spam bots to
 * read), feedback, citation, licence, disclaimer, AI declaration, validation, version, related
 * tools and the reference list. Placeholders stay until the author gives the email address and
 * the repository URL (STOP 3).
 */

import { DOCS, BUILD, REFERENCE_LIST, RELATED_TOOLS } from "../generated/content.ts";
import { SITE, repoFile } from "../site_config.ts";
import { h } from "./dom.ts";

function link(href: string, text: string): string {
  return `<a href="${href}" rel="noopener">${text}</a>`;
}

export function citationText(): string {
  const year = BUILD.lastChange.slice(0, 4);
  const parts = SITE.author.split(" ");
  const short = `${parts.slice(1).join(" ")} ${parts[0][0]}`; // "Ghane A"
  return `${short} (${year}) ${SITE.title}: an interactive teaching tool. Version ${BUILD.version}. ${SITE.repo}`;
}

export function mountAboutView(root: HTMLElement): void {
  const about = DOCS.about;
  const placeholderNote = SITE.repoIsPlaceholder ? ' <span class="muted">(placeholder: the repository address is added before publication)</span>' : "";
  const fill = (html: string): string =>
    html
      .replace(/\{\{AUTHOR\}\}/g, SITE.author)
      .replace(/\{\{AFFILIATION\}\}/g, SITE.affiliation)
      .replace(/\{\{EMAIL\}\}/g, '<span id="contact-email"></span>')
      .replace(/\{\{ISSUES\}\}/g, link(`${SITE.repo}/issues`, "GitHub Issues") + placeholderNote)
      .replace(/\{\{CITATION\}\}/g, `<blockquote class="box note">${citationText()}</blockquote>`)
      .replace(/\{\{CITATION_CFF\}\}/g, link(repoFile("CITATION.cff"), "CITATION.cff") + placeholderNote)
      .replace(/\{\{VALIDATION\}\}/g, link(repoFile("docs/VALIDATION.md"), "docs/VALIDATION.md"))
      .replace(/\{\{PROMPT\}\}/g, link(repoFile("docs/PROMPT.md"), "docs/PROMPT.md"))
      .replace(/\{\{CHANGELOG\}\}/g, link(repoFile("CHANGELOG.md"), "CHANGELOG.md"))
      .replace(/\{\{VERSION\}\}/g, BUILD.version)
      .replace(/\{\{LAST_CHANGE\}\}/g, new Date(BUILD.lastChange).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric", timeZone: "Europe/Vienna" }));
  root.append(
    h(
      "article",
      { class: "prose" },
      h("h2", { style: "margin-top:0" }, "About"),
      h("div", { html: fill(about.intro) }),
      ...about.sections.map((s) => h("section", { id: s.id }, h("h2", { html: s.title }), h("div", { html: fill(s.html) }))),
      h(
        "section",
        { id: "about-related" },
        h("h2", {}, "Related tools"),
        h("p", {}, "Other free tools and resources for teaching and learning population genetics and demographic models. Each link was checked before it was added; this list is not complete."),
        h(
          "ul",
          {},
          ...RELATED_TOOLS.map((t) => h("li", {}, h("a", { href: t.url, rel: "noopener" }, t.name), `: ${t.what}`)),
        ),
      ),
      h(
        "section",
        { id: "about-references" },
        h("h2", {}, `References (${BUILD.referenceCount})`),
        h("p", { class: "muted" }, "Every reference was verified: articles through Crossref and their DOI, books through an ISBN record or the publisher."),
        ...REFERENCE_LIST.map((g) => h("div", {}, h("h3", {}, g.group), h("ul", { class: "refs" }, ...g.items.map((it) => h("li", { html: it.html }))))),
      ),
    ),
  );
  // the email is assembled at run time; the page source contains no address
  const slot = root.querySelector("#contact-email");
  if (slot) {
    if (SITE.email) {
      const [user, domain] = SITE.email;
      const a = h("a", { href: "#" }, `${user} [at] ${domain}`);
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        window.location.href = `mailto:${user}@${domain}`;
      });
      a.addEventListener("focus", () => a.setAttribute("href", `mailto:${user}@${domain}`), { once: true });
      a.addEventListener("mouseenter", () => a.setAttribute("href", `mailto:${user}@${domain}`), { once: true });
      slot.replaceWith(a);
    } else slot.replaceWith(h("span", { class: "placeholder" }, "[EMAIL_PLACEHOLDER]"));
  }
}
