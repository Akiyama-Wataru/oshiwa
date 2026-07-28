import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PostComposer } from "@/app/components/posts/PostComposer";
import { TimelineFilters } from "@/app/components/posts/TimelineFilters";
import type { PostAction } from "@/app/groups/[groupId]/posts/actions";
import type { TimelineOshi } from "@/lib/posts/timeline";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const groupId = "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd";
const oshiId = "9f4e2c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const basePath = `/groups/${groupId}/posts`;
const oshis: TimelineOshi[] = [{ id: oshiId, name: "ミナ", color: "#ff6f91" }];

function renderComposer(action: PostAction) {
  render(<PostComposer action={action} groupId={groupId} oshis={oshis} />);
}

/**
 * jsdom reports a `required` field as invalid even once it is filled and drops
 * file contents from its FormData copy, so the submit event is dispatched
 * directly. The real upload path is covered by the browser end-to-end run.
 */
async function submitComposer() {
  await act(async () => {
    fireEvent.submit(document.querySelector("form.post-composer")!);
  });
}

describe("PostComposer", () => {
  it("accepts several photos of only the types the server allows", () => {
    renderComposer(vi.fn() as unknown as PostAction);

    const input = screen.getByLabelText("写真");

    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(input).toHaveAttribute("multiple");
    expect(screen.getByText("1件の投稿につき4枚までです。")).toBeVisible();
  });

  it("caps the body at the length the database will accept", () => {
    renderComposer(vi.fn() as unknown as PostAction);

    expect(screen.getByLabelText("今日のできごと")).toHaveAttribute(
      "maxlength",
      "2000",
    );
  });

  it("offers each oshi as a checkbox rather than a multi select", () => {
    renderComposer(vi.fn() as unknown as PostAction);

    const option = screen.getByLabelText("ミナ");

    expect(option).toHaveAttribute("type", "checkbox");
    expect(option).not.toBeChecked();
  });

  it("carries the group the post belongs to", async () => {
    let submitted: FormData | undefined;
    const action = vi.fn(async (_state: unknown, formData: FormData) => {
      submitted = formData;
      return { status: "success" as const, message: "投稿しました。" };
    });
    renderComposer(action as unknown as PostAction);

    await submitComposer();

    expect(submitted?.get("groupId")).toBe(groupId);
  });

  it("announces the compression and blocks a second submission", async () => {
    let finish: ((value: { status: "success"; message: string }) => void) | undefined;
    const action = vi.fn(
      () =>
        new Promise<{ status: "success"; message: string }>((resolve) => {
          finish = resolve;
        }),
    ) as unknown as PostAction;
    renderComposer(action);

    await submitComposer();

    expect(
      await screen.findByText("写真を圧縮して送信しています…"),
    ).toHaveAttribute("role", "status");
    expect(screen.getByRole("button", { name: "送信中" })).toBeDisabled();

    await act(async () => {
      finish?.({ status: "success", message: "投稿しました。" });
    });

    expect(await screen.findByText("投稿しました。")).toBeVisible();
  });

  it("marks a rejection so it is styled and announced as an error", async () => {
    const action = vi.fn(async () => ({
      status: "error" as const,
      message: "写真は1件の投稿につき4枚までです。",
    })) as unknown as PostAction;
    renderComposer(action);

    await submitComposer();

    const status = await screen.findByRole("status");

    expect(status).toHaveTextContent("写真は1件の投稿につき4枚までです。");
    expect(status).toHaveClass("is-error");
  });
});

describe("TimelineFilters", () => {
  function renderFilters(active: { oshi?: string; tag?: string } = {}) {
    render(
      <TimelineFilters
        activeOshiId={active.oshi ?? null}
        activeTag={active.tag ?? null}
        basePath={basePath}
        oshis={oshis}
      />,
    );
  }

  it("filters with a plain GET form so it works without scripting", () => {
    renderFilters();

    const form = document.querySelector("form.timeline-filter-form");

    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", basePath);
  });

  it("shows the filter that is already applied", () => {
    renderFilters({ oshi: oshiId, tag: "尊い" });

    expect(screen.getByLabelText("推し")).toHaveValue(oshiId);
    expect(screen.getByLabelText("ハッシュタグ")).toHaveValue("尊い");
    expect(
      screen.getByRole("link", { name: "絞り込みを解除" }),
    ).toHaveAttribute("href", basePath);
  });

  it("marks the active oshi shortcut for assistive technology", () => {
    renderFilters({ oshi: oshiId });

    expect(screen.getByRole("link", { name: "ミナ" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("offers no way to clear a filter that is not set", () => {
    renderFilters();

    expect(screen.queryByRole("link", { name: "絞り込みを解除" })).toBeNull();
  });
});
