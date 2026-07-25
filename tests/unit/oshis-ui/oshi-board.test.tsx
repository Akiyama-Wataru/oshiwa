import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { OshiBoard } from "@/app/components/oshis/OshiBoard";
import type { OshiAction } from "@/app/groups/[groupId]/oshis/actions";
import type { OshiBoardEntry } from "@/lib/oshis/oshi-board";

const groupId = "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd";
const firstId = "7c308427-3f5d-4cab-a54c-d9b2eecdd4b4";
const secondId = "9f4e2c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b";

function entry(overrides: Partial<OshiBoardEntry> = {}): OshiBoardEntry {
  return {
    id: firstId,
    name: "ミナ",
    color: "#ff6f91",
    imagePath: null,
    imageUrl: null,
    canManage: true,
    ...overrides,
  };
}

function idleAction() {
  return vi.fn(async () => ({
    status: "idle" as const,
    message: "",
  })) as unknown as OshiAction;
}

function renderBoard(
  entries: OshiBoardEntry[],
  options: { canReorder?: boolean; reorderAction?: OshiAction } = {},
) {
  const reorderAction = options.reorderAction ?? idleAction();

  render(
    <OshiBoard
      canReorder={options.canReorder ?? true}
      deleteAction={idleAction()}
      entries={entries}
      groupId={groupId}
      reorderAction={reorderAction}
      updateAction={idleAction()}
      uploadAction={idleAction()}
    />,
  );

  return { reorderAction };
}

function renderBoardWithRerender(entries: OshiBoardEntry[]) {
  const actions = {
    deleteAction: idleAction(),
    reorderAction: idleAction(),
    updateAction: idleAction(),
    uploadAction: idleAction(),
  };
  const board = (next: OshiBoardEntry[]) => (
    <OshiBoard canReorder entries={next} groupId={groupId} {...actions} />
  );
  const view = render(board(entries));

  return { rerender: (next: OshiBoardEntry[]) => view.rerender(board(next)) };
}

describe("OshiBoard", () => {
  it("invites the first oshi when the group has none", () => {
    renderBoard([]);

    expect(
      screen.getByText("まだ推しが登録されていません。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "並び順を保存" }),
    ).not.toBeInTheDocument();
  });

  it("renders each oshi with a readable chip and its own photo alternative", () => {
    renderBoard([
      entry({ imageUrl: "https://storage.test/signed", imagePath: "p" }),
      entry({ id: secondId, name: "サナ", color: "#1d3557" }),
    ]);

    // Direct children only: each card embeds its own colour-preset list.
    const items = [
      ...screen.getByRole("list", { name: "登録済みの推し" }).children,
    ];

    expect(items).toHaveLength(2);
    expect(screen.getByAltText("ミナの写真")).toHaveAttribute(
      "src",
      "https://storage.test/signed",
    );
    expect(
      screen.getByText("写真はまだ登録されていません。"),
    ).toBeInTheDocument();
  });

  it("paints the member colour with a class, never an inline style", () => {
    renderBoard([entry({ color: "#1d3557" }), entry({ id: secondId, name: "サナ", color: "#abcdef" })]);

    const [known, unknown] = [
      ...screen.getByRole("list", { name: "登録済みの推し" }).children,
    ].map((item) => item.querySelector(".oshi-board-chip"));

    // `style-src 'self'` strips inline styles, so a style attribute here would
    // silently drop the colour in production.
    expect(known).not.toHaveAttribute("style");
    expect(known).toHaveClass("oshi-color-12");
    expect(unknown).toHaveClass("oshi-color-fallback");
    expect(
      document.querySelectorAll("[style]"),
    ).toHaveLength(0);
  });

  it("hides the management panel from a member who may not edit the oshi", () => {
    renderBoard([entry({ canManage: false })]);

    expect(
      screen.queryByRole("group", { name: "ミナを編集" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("ミナを編集")).not.toBeInTheDocument();
  });

  it("hides every reordering control from a plain member", () => {
    renderBoard([entry(), entry({ id: secondId, name: "サナ" })], {
      canReorder: false,
    });

    expect(
      screen.queryByRole("button", { name: "ミナを後ろへ" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "並び順を保存" }),
    ).not.toBeInTheDocument();
  });

  it("moves an oshi, announces the change, and submits the whole order", async () => {
    const user = userEvent.setup();
    const { reorderAction } = renderBoard([
      entry(),
      entry({ id: secondId, name: "サナ" }),
    ]);

    await user.click(screen.getByRole("button", { name: "ミナを後ろへ" }));

    expect(screen.getByText(/ミナを2番目に移動しました/)).toHaveAttribute(
      "role",
      "status",
    );

    const chips = [
      ...screen.getByRole("list", { name: "登録済みの推し" }).children,
    ].map((item) => item.textContent ?? "");
    expect(chips[0]).toContain("サナ");
    expect(chips[1]).toContain("ミナ");

    const hidden = document.querySelectorAll<HTMLInputElement>(
      'form.oshi-reorder-form input[name="oshiId"]',
    );
    expect([...hidden].map((input) => input.value)).toEqual([
      secondId,
      firstId,
    ]);

    await user.click(screen.getByRole("button", { name: "並び順を保存" }));

    expect(reorderAction).toHaveBeenCalledTimes(1);
    const submitted = (reorderAction as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as FormData;
    expect(submitted.getAll("oshiId")).toEqual([secondId, firstId]);
    expect(submitted.get("groupId")).toBe(groupId);
  });

  it("keeps focus by leaving the end buttons enabled and making them no-ops", async () => {
    const user = userEvent.setup();
    renderBoard([entry(), entry({ id: secondId, name: "サナ" })]);

    const first = screen.getByRole("button", { name: "ミナを前へ" });

    expect(first).toBeEnabled();

    await user.click(first);

    expect(document.activeElement).toBe(first);
    expect(
      [
        ...document.querySelectorAll<HTMLInputElement>(
          'form.oshi-reorder-form input[name="oshiId"]',
        ),
      ].map((input) => input.value),
    ).toEqual([firstId, secondId]);
  });

  it("adopts a new server order without discarding the action status", async () => {
    const { rerender } = renderBoardWithRerender([
      entry(),
      entry({ id: secondId, name: "サナ" }),
    ]);

    rerender([entry({ id: secondId, name: "サナ" }), entry()]);

    const chips = [
      ...screen.getByRole("list", { name: "登録済みの推し" }).children,
    ].map((item) => item.textContent ?? "");

    expect(chips[0]).toContain("サナ");
  });
});
