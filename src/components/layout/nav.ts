export const mainNav = [
  { href: "/services", label: "Services" },
  { href: "/builds", label: "Builds" },
  { href: "/gallery", label: "Gallery" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
] as const;

/** true when `href` is the current section (e.g. /gallery/switch → Gallery) */
export const isCurrent = (pathname: string, href: string) => {
  const p = pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/";
  return p === href || p.startsWith(`${href}/`);
};
