import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: vi.fn(),
}));

const groupId = "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd";
const postId = "7c308427-3f5d-4cab-a54c-d9b2eecdd4b4";
const replyId = "9f4e2c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const postsPath = `/groups/${groupId}/posts`;
const postPath = `${postsPath}/${postId}`;
const idleState = { status: "idle", message: "" } as const;

type RpcResult = { data: unknown; error: unknown };

function createClient(overrides: Record<string, RpcResult> = {}) {
  const results: Record<string, RpcResult> = {
    toggle_post_like: { data: true, error: null },
    create_reply: { data: replyId, error: null },
    delete_reply: { data: true, error: null },
    share_post: { data: "5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c", error: null },
    unshare_post: { data: true, error: null },
    ...overrides,
  };
  const rpc = vi.fn(
    async (name: string) => results[name] ?? { data: null, error: null },
  );

  return { client: { rpc }, rpc };
}

function formData(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

async function loadActions() {
  return import("@/app/groups/[groupId]/posts/reactions");
}

describe("reaction actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("togglePostLikeAction", () => {
    it("sends the post and refreshes both places it is shown", async () => {
      const { client, rpc } = createClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { togglePostLikeAction } = await loadActions();

      const result = await togglePostLikeAction(
        idleState,
        formData({ groupId, postId }),
      );

      expect(rpc).toHaveBeenCalledWith("toggle_post_like", {
        target_post_id: postId,
      });
      expect(result.status).toBe("success");
      expect(mocks.revalidatePath).toHaveBeenCalledWith(postsPath);
      expect(mocks.revalidatePath).toHaveBeenCalledWith(postPath);
    });

    it("says which way the toggle went", async () => {
      mocks.createServerSupabaseClient.mockResolvedValue(
        createClient({ toggle_post_like: { data: false, error: null } }).client,
      );
      const { togglePostLikeAction } = await loadActions();

      const result = await togglePostLikeAction(
        idleState,
        formData({ groupId, postId }),
      );

      expect(result.message).toContain("取り消し");
    });

    it("refuses a post that is not addressed by an identifier", async () => {
      const { client, rpc } = createClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { togglePostLikeAction } = await loadActions();

      const result = await togglePostLikeAction(
        idleState,
        formData({ groupId, postId: "not-a-uuid" }),
      );

      expect(result.status).toBe("error");
      expect(rpc).not.toHaveBeenCalled();
    });

    it("hides why the database refused", async () => {
      mocks.createServerSupabaseClient.mockResolvedValue(
        createClient({
          toggle_post_like: {
            data: null,
            error: new Error("Group membership required"),
          },
        }).client,
      );
      const { togglePostLikeAction } = await loadActions();

      const result = await togglePostLikeAction(
        idleState,
        formData({ groupId, postId }),
      );

      expect(result.status).toBe("error");
      expect(result.message).not.toContain("membership");
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("createReplyAction", () => {
    it("sends the trimmed reply", async () => {
      const { client, rpc } = createClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { createReplyAction } = await loadActions();

      const result = await createReplyAction(
        idleState,
        formData({ groupId, postId, body: "  わたしも行きたかった  " }),
      );

      expect(rpc).toHaveBeenCalledWith("create_reply", {
        target_post_id: postId,
        reply_body: "わたしも行きたかった",
      });
      expect(result.status).toBe("success");
    });

    it("refuses an empty reply without a database call", async () => {
      const { client, rpc } = createClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { createReplyAction } = await loadActions();

      const result = await createReplyAction(
        idleState,
        formData({ groupId, postId, body: "   " }),
      );

      expect(result.status).toBe("error");
      expect(rpc).not.toHaveBeenCalled();
    });

    it("treats a refusal without an error as a failure", async () => {
      mocks.createServerSupabaseClient.mockResolvedValue(
        createClient({ create_reply: { data: null, error: null } }).client,
      );
      const { createReplyAction } = await loadActions();

      const result = await createReplyAction(
        idleState,
        formData({ groupId, postId, body: "ありがとう" }),
      );

      expect(result.status).toBe("error");
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("deleteReplyAction", () => {
    it("removes the named reply", async () => {
      const { client, rpc } = createClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { deleteReplyAction } = await loadActions();

      const result = await deleteReplyAction(
        idleState,
        formData({ groupId, replyId }),
      );

      expect(rpc).toHaveBeenCalledWith("delete_reply", {
        target_reply_id: replyId,
      });
      expect(result.status).toBe("success");
    });

    it("hides why the database refused", async () => {
      mocks.createServerSupabaseClient.mockResolvedValue(
        createClient({
          delete_reply: {
            data: null,
            error: new Error("Reply removal permission required"),
          },
        }).client,
      );
      const { deleteReplyAction } = await loadActions();

      const result = await deleteReplyAction(
        idleState,
        formData({ groupId, replyId }),
      );

      expect(result.status).toBe("error");
      expect(result.message).not.toContain("permission");
    });
  });

  describe("sharePostAction", () => {
    it("names the circle the post already belongs to", async () => {
      const { client, rpc } = createClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { sharePostAction } = await loadActions();

      const result = await sharePostAction(
        idleState,
        formData({ groupId, postId, note: " これ見て " }),
      );

      // The circle is sent explicitly so that carrying a post out of its own
      // circle is a refusal rather than an oversight.
      expect(rpc).toHaveBeenCalledWith("share_post", {
        target_post_id: postId,
        target_group_id: groupId,
        share_note: "これ見て",
      });
      expect(result.status).toBe("success");
    });

    it("shares without a note when the field is left empty", async () => {
      const { client, rpc } = createClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { sharePostAction } = await loadActions();

      await sharePostAction(idleState, formData({ groupId, postId, note: "" }));

      expect(rpc).toHaveBeenCalledWith("share_post", {
        target_post_id: postId,
        target_group_id: groupId,
        share_note: null,
      });
    });

    it("says so plainly when the post is already shared", async () => {
      mocks.createServerSupabaseClient.mockResolvedValue(
        createClient({
          share_post: {
            data: null,
            error: new Error("This post is already shared"),
          },
        }).client,
      );
      const { sharePostAction } = await loadActions();

      const result = await sharePostAction(
        idleState,
        formData({ groupId, postId }),
      );

      expect(result.status).toBe("error");
      expect(result.message).toContain("共有");
      expect(result.message).not.toContain("already");
    });
  });

  describe("unsharePostAction", () => {
    it("withdraws the reader's own share", async () => {
      const { client, rpc } = createClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { unsharePostAction } = await loadActions();

      const result = await unsharePostAction(
        idleState,
        formData({ groupId, postId }),
      );

      expect(rpc).toHaveBeenCalledWith("unshare_post", {
        target_post_id: postId,
      });
      expect(result.status).toBe("success");
    });

    it("treats nothing to withdraw as an error rather than a success", async () => {
      mocks.createServerSupabaseClient.mockResolvedValue(
        createClient({ unshare_post: { data: false, error: null } }).client,
      );
      const { unsharePostAction } = await loadActions();

      expect(
        (await unsharePostAction(idleState, formData({ groupId, postId })))
          .status,
      ).toBe("error");
    });
  });
});
