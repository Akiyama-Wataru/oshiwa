/**
 * Member colours come from a fixed palette rather than a free colour picker.
 *
 * The app's CSP is `style-src 'self'` with no `'unsafe-inline'`, so a dynamic
 * `style` attribute would simply be dropped by the browser. A closed palette
 * lets every colour live in the stylesheet as a class, which keeps the CSP
 * intact and makes the ink pairing auditable.
 *
 * Text is never painted in the member colour itself. It is only used as a chip
 * background, and the ink is chosen here so the pairing clears WCAG AA (4.5:1)
 * for every colour in the sRGB cube: the better of pure black and pure white is
 * at worst 4.58:1 against any background. The palette classes in globals.css
 * are generated from exactly this rule.
 */

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/;

const DARK_INK = "#000000";
const LIGHT_INK = "#ffffff";

/** Preset swatches offered in the UI; members may still pick any colour. */
export const MEMBER_COLOR_PALETTE = [
  "#ff6f91",
  "#ff9671",
  "#ffc75f",
  "#f9f871",
  "#9bde7e",
  "#4dd0b1",
  "#59a5f5",
  "#7d7bf0",
  "#c874f0",
  "#f06292",
  "#8d99ae",
  "#1d3557",
] as const;

/** Spoken labels for the presets; a bare hex value reads terribly aloud. */
export const MEMBER_COLOR_LABELS: Record<string, string> = {
  "#ff6f91": "ピンク",
  "#ff9671": "コーラル",
  "#ffc75f": "アプリコット",
  "#f9f871": "レモン",
  "#9bde7e": "リーフ",
  "#4dd0b1": "ミント",
  "#59a5f5": "スカイ",
  "#7d7bf0": "ラベンダー",
  "#c874f0": "パープル",
  "#f06292": "ローズ",
  "#8d99ae": "グレー",
  "#1d3557": "ネイビー",
};

/** Applied when a row somehow holds a colour outside the palette. */
const FALLBACK_COLOR_CLASS = "oshi-color-fallback";

export function isMemberColorPreset(value: string): boolean {
  return (MEMBER_COLOR_PALETTE as readonly string[]).includes(value);
}

/**
 * Maps a stored colour onto its stylesheet class. The database only constrains
 * the column to `#rrggbb`, so an unknown value degrades to the neutral class
 * instead of leaving the chip unstyled.
 */
export function memberColorClassName(value: string): string {
  const normalized = normalizeMemberColor(value);
  const index = normalized
    ? (MEMBER_COLOR_PALETTE as readonly string[]).indexOf(normalized)
    : -1;

  return index < 0 ? FALLBACK_COLOR_CLASS : `oshi-color-${index + 1}`;
}

export function normalizeMemberColor(value: string): string | null {
  const candidate = value.trim().toLowerCase();

  if (!HEX_COLOR_PATTERN.test(candidate)) {
    return null;
  }

  if (candidate.length === 7) {
    return candidate;
  }

  const [, red, green, blue] = candidate;
  return `#${red}${red}${green}${green}${blue}${blue}`;
}

function channelLuminance(channel: number): number {
  const ratio = channel / 255;
  return ratio <= 0.03928
    ? ratio / 12.92
    : ((ratio + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: string): number | null {
  const normalized = normalizeMemberColor(color);

  if (!normalized) {
    return null;
  }

  const [red, green, blue] = [1, 3, 5].map((offset) =>
    Number.parseInt(normalized.slice(offset, offset + 2), 16),
  );

  return (
    0.2126 * channelLuminance(red) +
    0.7152 * channelLuminance(green) +
    0.0722 * channelLuminance(blue)
  );
}

export function contrastRatio(
  foreground: string,
  background: string,
): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);

  if (first === null || second === null) {
    return 1;
  }

  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);

  return (lighter + 0.05) / (darker + 0.05);
}

export function readableTextColor(background: string): string {
  const luminance = relativeLuminance(background);

  if (luminance === null) {
    return DARK_INK;
  }

  const darkInkContrast = (luminance + 0.05) / 0.05;
  const lightInkContrast = 1.05 / (luminance + 0.05);

  return darkInkContrast >= lightInkContrast ? DARK_INK : LIGHT_INK;
}
