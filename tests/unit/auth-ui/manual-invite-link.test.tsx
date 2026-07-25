import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ManualInviteLink } from "@/app/components/auth/ManualInviteLink";

const token = "a".repeat(64);
const path = `/join/${token}`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ManualInviteLink", () => {
  it("shows and copies an absolute URL using the Clipboard API", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    const absoluteUrl = new URL(path, window.location.origin).toString();

    render(<ManualInviteLink path={path} />);

    expect(await screen.findByText(absoluteUrl)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "手動リンクをコピー" }));

    expect(writeText).toHaveBeenCalledWith(absoluteUrl);
    expect(await screen.findByText("リンクをコピーしました。")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("falls back to document copy when Clipboard API is unavailable", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    render(<ManualInviteLink path={path} />);
    await user.click(screen.getByRole("button", { name: "手動リンクをコピー" }));

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(await screen.findByText("リンクをコピーしました。")).toBeVisible();
  });

  it("announces a safe error when every copy method fails", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });

    render(<ManualInviteLink path={path} />);
    await user.click(screen.getByRole("button", { name: "手動リンクをコピー" }));

    expect(
      await screen.findByText(
        "コピーできませんでした。リンクを選択してコピーしてください。",
      ),
    ).toHaveAttribute("role", "alert");
  });
});
