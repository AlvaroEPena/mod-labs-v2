import { describe, expect, it } from "vitest";
import { inlineSvg } from "./svg";

const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img">
  <defs><linearGradient id="ml-e"/></defs>
  <path stroke="url(#ml-e)" d="M0 0h1"/>
</svg>
`;

describe("inlineSvg", () => {
  it("returns the viewBox and the inner markup without the outer <svg>", () => {
    const { viewBox, body } = inlineSvg(raw, "hdr");
    expect(viewBox).toBe("0 0 64 64");
    expect(body).not.toMatch(/<\/?svg/);
    expect(body).toContain("<path");
  });

  it("namespaces every id and its url() references so two logos never collide", () => {
    const a = inlineSvg(raw, "hdr").body;
    const b = inlineSvg(raw, "ftr").body;
    expect(a).toContain('id="hdr-ml-e"');
    expect(a).toContain("url(#hdr-ml-e)");
    expect(b).toContain('id="ftr-ml-e"');
    expect(a).not.toContain('id="ml-e"');
  });
});
