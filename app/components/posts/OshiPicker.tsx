import { memberColorClassName } from "@/lib/oshis/member-color";
import type { TimelineOshi } from "@/lib/posts/timeline";

/**
 * Checkboxes rather than a multi-select: on a phone a native multi-select is
 * close to unusable, and the member colour has to be visible while choosing.
 */
export function OshiPicker({
  disabled = false,
  idPrefix,
  oshis,
  selected,
}: {
  disabled?: boolean;
  idPrefix: string;
  oshis: readonly TimelineOshi[];
  selected: readonly string[];
}) {
  if (oshis.length === 0) {
    return null;
  }

  return (
    <fieldset className="post-oshi-picker">
      <legend>関連する推し</legend>
      {oshis.map((oshi) => (
        <label
          className={`post-oshi-option ${memberColorClassName(oshi.color)}`}
          htmlFor={`${idPrefix}-oshi-${oshi.id}`}
          key={oshi.id}
        >
          <input
            defaultChecked={selected.includes(oshi.id)}
            disabled={disabled}
            id={`${idPrefix}-oshi-${oshi.id}`}
            name="oshiId"
            type="checkbox"
            value={oshi.id}
          />
          {oshi.name}
        </label>
      ))}
    </fieldset>
  );
}
