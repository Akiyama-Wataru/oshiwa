import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JoinForm } from "@/app/components/auth/JoinForm";
import type { JoinAction } from "@/app/join/[token]/actions";

describe("JoinForm", () => {
  it("requires a 12-character password and confirmation", () => {
    const action = vi.fn() as unknown as JoinAction;

    render(<JoinForm action={action} token={"a".repeat(64)} />);

    expect(screen.getByLabelText("新しいパスワード")).toHaveAttribute(
      "minLength",
      "12",
    );
    expect(screen.getByLabelText("パスワード（確認）")).toHaveAttribute(
      "minLength",
      "12",
    );
    expect(screen.getByRole("button", { name: "招待に参加する" })).toBeEnabled();
    expect(screen.getByText(/12文字以上/)).toBeVisible();
  });
});
