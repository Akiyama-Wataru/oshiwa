import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MEMBER_COLOR_LABELS,
  MEMBER_COLOR_PALETTE,
  contrastRatio,
  isMemberColorPreset,
  memberColorClassName,
  normalizeMemberColor,
  readableTextColor,
} from "@/lib/oshis/member-color";

describe("normalizeMemberColor", () => {
  it("lowercases and expands the shorthand notation", () => {
    expect(normalizeMemberColor("#FF66AA")).toBe("#ff66aa");
    expect(normalizeMemberColor("  #F6A  ")).toBe("#ff66aa");
  });

  it("returns null for anything that is not a plain hex colour", () => {
    for (const invalid of [
      "",
      "#",
      "ff66aa",
      "#ff66a",
      "#ff66aaa",
      "#gg66aa",
      "rgb(255,102,170)",
      "var(--accent)",
      "#ff66aa; background:url(javascript:alert(1))",
    ]) {
      expect(normalizeMemberColor(invalid)).toBeNull();
    }
  });
});

describe("readableTextColor", () => {
  it("pairs dark ink with light colours and light ink with dark colours", () => {
    expect(readableTextColor("#ffffff")).toBe("#000000");
    expect(readableTextColor("#000000")).toBe("#ffffff");
    expect(readableTextColor("#ffe066")).toBe("#000000");
    expect(readableTextColor("#1d3557")).toBe("#ffffff");
  });

  it("keeps every possible member colour above the WCAG AA 4.5:1 threshold", () => {
    const samples = [
      "#000000",
      "#ffffff",
      "#767676",
      "#808080",
      "#7f7f7f",
      "#949494",
      "#777777",
      ...MEMBER_COLOR_PALETTE,
    ];

    for (const color of samples) {
      expect(contrastRatio(color, readableTextColor(color))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("stays above the threshold across a dense sweep of the colour cube", () => {
    for (let red = 0; red <= 255; red += 51) {
      for (let green = 0; green <= 255; green += 51) {
        for (let blue = 0; blue <= 255; blue += 51) {
          const color = `#${[red, green, blue]
            .map((channel) => channel.toString(16).padStart(2, "0"))
            .join("")}`;

          expect(
            contrastRatio(color, readableTextColor(color)),
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

describe("MEMBER_COLOR_PALETTE", () => {
  it("offers distinct, already-normalised preset colours", () => {
    expect(MEMBER_COLOR_PALETTE.length).toBeGreaterThanOrEqual(8);
    expect(new Set(MEMBER_COLOR_PALETTE).size).toBe(
      MEMBER_COLOR_PALETTE.length,
    );

    for (const color of MEMBER_COLOR_PALETTE) {
      expect(normalizeMemberColor(color)).toBe(color);
    }
  });
});

describe("contrastRatio", () => {
  it("reports the documented extremes and is order independent", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#123456", "#123456")).toBeCloseTo(1, 5);
  });

  it("returns 1 when either colour cannot be parsed", () => {
    expect(contrastRatio("nope", "#ffffff")).toBe(1);
    expect(contrastRatio("#ffffff", "nope")).toBe(1);
  });
});

describe("memberColorClassName", () => {
  const stylesheet = readFileSync(
    join(process.cwd(), "app", "globals.css"),
    "utf8",
  );

  it("maps every preset onto its own class", () => {
    const classNames = MEMBER_COLOR_PALETTE.map(memberColorClassName);

    expect(new Set(classNames).size).toBe(MEMBER_COLOR_PALETTE.length);
    expect(memberColorClassName("#FF6F91")).toBe(
      memberColorClassName("#ff6f91"),
    );
  });

  it("degrades an unknown or malformed colour to the neutral class", () => {
    for (const value of ["#abcdef", "url(javascript:alert(1))", "", "red"]) {
      expect(memberColorClassName(value)).toBe("oshi-color-fallback");
    }
  });

  it("has a stylesheet rule with the matching ink for every class it emits", () => {
    for (const preset of MEMBER_COLOR_PALETTE) {
      const rule = stylesheet.match(
        new RegExp(`\\.${memberColorClassName(preset)} \\{[^}]*\\}`),
      )?.[0];

      expect(rule).toBeTruthy();
      expect(rule).toContain(`--oshi-color: ${preset}`);
      expect(rule).toContain(`--oshi-ink: ${readableTextColor(preset)}`);
    }

    expect(stylesheet).toContain(".oshi-color-fallback {");
  });

  it("never paints a chip with an inline style the CSP would strip", () => {
    expect(stylesheet).toContain("background: var(--oshi-color)");
    expect(stylesheet).toContain("color: var(--oshi-ink)");
  });
});

describe("isMemberColorPreset and MEMBER_COLOR_LABELS", () => {
  it("recognises presets and names all of them", () => {
    for (const preset of MEMBER_COLOR_PALETTE) {
      expect(isMemberColorPreset(preset)).toBe(true);
      expect(MEMBER_COLOR_LABELS[preset]).toBeTruthy();
    }

    expect(isMemberColorPreset("#abcdef")).toBe(false);
    expect(isMemberColorPreset("#FF6F91")).toBe(false);
  });
});
