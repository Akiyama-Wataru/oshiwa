import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { MemberColorField } from "@/app/components/oshis/MemberColorField";
import {
  MEMBER_COLOR_LABELS,
  MEMBER_COLOR_PALETTE,
  contrastRatio,
  readableTextColor,
} from "@/lib/oshis/member-color";

function checkedValue() {
  const checked = screen
    .getAllByRole("radio")
    .find((radio) => (radio as HTMLInputElement).checked);

  return (checked as HTMLInputElement | undefined)?.value;
}

describe("MemberColorField", () => {
  it("submits the choice under the name the action expects", () => {
    render(<MemberColorField defaultValue="#1d3557" ownerLabel="ミナ" />);

    const radios = screen.getAllByRole("radio") as HTMLInputElement[];

    expect(radios).toHaveLength(MEMBER_COLOR_PALETTE.length);
    for (const radio of radios) {
      expect(radio).toHaveAttribute("name", "color");
    }
    expect(radios.map((radio) => radio.value)).toEqual([
      ...MEMBER_COLOR_PALETTE,
    ]);
    expect(checkedValue()).toBe("#1d3557");
  });

  it("falls back to the first preset when the stored colour is unusable", () => {
    render(<MemberColorField defaultValue="#abcdef" ownerLabel="ミナ" />);

    expect(checkedValue()).toBe(MEMBER_COLOR_PALETTE[0]);
  });

  it("names the field after the oshi it belongs to", () => {
    render(<MemberColorField ownerLabel="ミナ" />);

    expect(
      screen.getByRole("group", { name: "ミナのメンバーカラー" }),
    ).toBeInTheDocument();
  });

  it("never identifies a swatch by colour alone", () => {
    render(<MemberColorField ownerLabel="ミナ" />);

    const options = within(screen.getByRole("list")).getAllByRole("radio");

    for (const [index, option] of options.entries()) {
      const label = MEMBER_COLOR_LABELS[MEMBER_COLOR_PALETTE[index]];

      expect(label).toBeTruthy();
      expect(screen.getByLabelText(label)).toBe(option);
    }
  });

  it("lets the keyboard change the selection", async () => {
    const user = userEvent.setup();
    render(<MemberColorField defaultValue="#ff6f91" ownerLabel="ミナ" />);

    await user.click(screen.getByLabelText("ネイビー"));

    expect(checkedValue()).toBe("#1d3557");
  });

  it("disables every option while the form is pending", () => {
    render(<MemberColorField disabled ownerLabel="ミナ" />);

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }
  });

  it("only offers colours whose stylesheet ink clears WCAG AA", () => {
    for (const preset of MEMBER_COLOR_PALETTE) {
      expect(
        contrastRatio(preset, readableTextColor(preset)),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
