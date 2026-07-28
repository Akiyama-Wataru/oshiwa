import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OshiImageForm } from "@/app/components/oshis/OshiImageForm";
import type { OshiAction } from "@/app/groups/[groupId]/oshis/actions";

const groupId = "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd";
const oshiId = "7c308427-3f5d-4cab-a54c-d9b2eecdd4b4";

function renderForm(action: OshiAction) {
  render(
    <OshiImageForm
      action={action}
      groupId={groupId}
      name="ミナ"
      oshiId={oshiId}
    />,
  );
}

/**
 * jsdom treats a `required` file input as invalid even after a file is
 * attached, and its FormData copy drops the file contents, so the submit event
 * is dispatched directly here. The real click and upload path is covered by
 * the browser end-to-end run, and the compression step by the unit tests for
 * lib/media/image-form-data.
 */
async function submitForm() {
  await act(async () => {
    fireEvent.submit(document.querySelector("form.oshi-image-form")!);
  });
}

describe("OshiImageForm", () => {
  it("offers only the raster types the server accepts", () => {
    renderForm(vi.fn() as unknown as OshiAction);

    const input = screen.getByLabelText("ミナの写真");

    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(input).toBeRequired();
  });

  it("carries the identifiers the action needs to scope the object path", async () => {
    const action = vi.fn(async () => ({
      status: "success" as const,
      message: "画像を登録しました。",
    })) as unknown as OshiAction;
    renderForm(action);

    await submitForm();

    const formData = (action as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as FormData;

    expect(formData.get("groupId")).toBe(groupId);
    expect(formData.get("oshiId")).toBe(oshiId);
  });

  it("announces progress and blocks a second submission while working", async () => {
    let finish: ((value: { status: "success"; message: string }) => void) | undefined;
    const action = vi.fn(
      () =>
        new Promise<{ status: "success"; message: string }>((resolve) => {
          finish = resolve;
        }),
    ) as unknown as OshiAction;
    renderForm(action);

    await submitForm();

    expect(
      await screen.findByText("写真を圧縮して送信しています…"),
    ).toHaveAttribute("role", "status");
    expect(screen.getByRole("button", { name: "送信中" })).toBeDisabled();

    await act(async () => {
      finish?.({ status: "success", message: "画像を登録しました。" });
    });

    expect(await screen.findByText("画像を登録しました。")).toBeVisible();
  });

  it("marks a rejection so it is styled and announced as an error", async () => {
    const action = vi.fn(async () => ({
      status: "error" as const,
      message: "画像はJPEG・PNG・WebPのみ登録できます。",
    })) as unknown as OshiAction;
    renderForm(action);

    await submitForm();

    const status = await screen.findByRole("status");

    expect(status).toHaveTextContent("画像はJPEG・PNG・WebPのみ登録できます。");
    expect(status).toHaveClass("is-error");
  });
});
