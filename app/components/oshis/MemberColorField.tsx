"use client";

import {
  MEMBER_COLOR_LABELS,
  MEMBER_COLOR_PALETTE,
  isMemberColorPreset,
  memberColorClassName,
  normalizeMemberColor,
} from "@/lib/oshis/member-color";

/**
 * Native radios, one per palette entry. Every swatch carries its colour name as
 * text so the choice is never conveyed by colour alone, and the swatch itself
 * is painted by a stylesheet class rather than an inline style, which the app's
 * `style-src 'self'` policy would strip.
 */
export function MemberColorField({
  defaultValue,
  disabled = false,
  ownerLabel,
}: {
  defaultValue?: string;
  disabled?: boolean;
  ownerLabel: string;
}) {
  const normalized = normalizeMemberColor(defaultValue ?? "") ?? "";
  const selected = isMemberColorPreset(normalized)
    ? normalized
    : MEMBER_COLOR_PALETTE[0];

  return (
    <fieldset className="oshi-color-field" disabled={disabled}>
      <legend>{`${ownerLabel}のメンバーカラー`}</legend>
      <ul className="oshi-color-presets">
        {MEMBER_COLOR_PALETTE.map((preset) => (
          <li key={preset}>
            <label className={`oshi-color-preset ${memberColorClassName(preset)}`}>
              <input
                defaultChecked={preset === selected}
                name="color"
                type="radio"
                value={preset}
              />
              <span>{MEMBER_COLOR_LABELS[preset] ?? preset}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
