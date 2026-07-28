import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}));

const groupId = "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd";
const postId = "7c308427-3f5d-4cab-a54c-d9b2eecdd4b4";
const oshiId = "9f4e2c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const otherOshiId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const postsPath = `/groups/${groupId}/posts`;
const idleState = { status: "idle", message: "" } as const;

function pngBytes(padding = 64) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const bytes = new Uint8Array(signature.length + padding);
  bytes.set(signature, 0);
  return bytes;
}

function pngFile(type = "image/png", padding = 64) {
  return new File([pngBytes(padding)], "photo.png", { type });
}

type RpcResult = { data: unknown; error: unknown };

function createSupabaseClient(
  overrides: {
    results?: Record<string, RpcResult>;
    rpc?: ReturnType<typeof vi.fn>;
    upload?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const results: Record<string, RpcResult> = {
    create_post: { data: postId, error: null },
    update_post: { data: true, error: null },
    delete_post: { data: [], error: null },
    attach_post_image: { data: 1, error: null },
    detach_post_image: { data: null, error: null },
    ...overrides.results,
  };
  const rpc =
    overrides.rpc ??
    vi.fn(async (name: string) => results[name] ?? { data: null, error: null });
  const upload =
    overrides.upload ?? vi.fn().mockResolvedValue({ data: {}, error: null });
  const from = vi.fn(() => ({ upload }));
  return { client: { rpc, storage: { from } }, rpc, upload, from };
}

function createAdminClient(removeError: unknown = null) {
  const remove = vi.fn().mockResolvedValue({ error: removeError });
  const from = vi.fn(() => ({ remove }));
  return { client: { storage: { from } }, remove, from };
}

async function loadActions() {
  return import("@/app/groups/[groupId]/posts/actions");
}

function composeFormData(
  overrides: {
    body?: string;
    hashtags?: string;
    oshiIds?: string[];
    images?: File[];
  } = {},
) {
  const formData = new FormData();
  formData.set("groupId", groupId);
  formData.set("body", overrides.body ?? "一曲目からよかった");
  formData.set("hashtags", overrides.hashtags ?? "");

  for (const id of overrides.oshiIds ?? []) {
    formData.append("oshiId", id);
  }

  for (const image of overrides.images ?? []) {
    formData.append("image", image);
  }

  return formData;
}

function rpcCall(rpc: ReturnType<typeof vi.fn>, name: string) {
  return rpc.mock.calls.filter((call) => call[0] === name);
}

describe("post server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAdminSupabaseClient.mockImplementation(() => {
      throw new Error("admin client not configured for this test");
    });
  });

  describe("createPostAction", () => {
    it("writes the normalised body, oshis and hashtags", async () => {
      const { client, rpc } = createSupabaseClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { createPostAction } = await loadActions();

      const result = await createPostAction(
        idleState,
        composeFormData({
          body: "  一曲目から\r\nよかった  ",
          hashtags: " #今日の推し 　#尊い ",
          oshiIds: [oshiId, otherOshiId],
        }),
      );

      expect(rpc).toHaveBeenCalledWith("create_post", {
        target_group_id: groupId,
        post_body: "一曲目から\nよかった",
        oshi_ids: [oshiId, otherOshiId],
        hashtags: ["今日の推し", "尊い"],
      });
      expect(result.status).toBe("success");
      expect(mocks.revalidatePath).toHaveBeenCalledWith(postsPath);
    });

    it("never reaches the database for a body it cannot accept", async () => {
      const { client, rpc } = createSupabaseClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { createPostAction } = await loadActions();

      for (const body of ["   ", "あ".repeat(2001), `壊${"‮"}れた`]) {
        expect(
          (await createPostAction(idleState, composeFormData({ body }))).status,
        ).toBe("error");
      }

      expect(rpc).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    it("stores every photo under the new post and records each one", async () => {
      const { client, rpc, upload, from } = createSupabaseClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { createPostAction } = await loadActions();

      const result = await createPostAction(
        idleState,
        composeFormData({ images: [pngFile(), pngFile(), pngFile()] }),
      );

      expect(from).toHaveBeenCalledWith("post-images");
      expect(upload).toHaveBeenCalledTimes(3);

      const paths = upload.mock.calls.map(([path]) => path);
      for (const path of paths) {
        expect(path).toMatch(
          new RegExp(`^${groupId}/${postId}/[0-9a-f]{32}\\.png$`),
        );
        expect(path).not.toContain("photo.png");
      }
      expect(new Set(paths).size).toBe(3);

      expect(rpcCall(rpc, "attach_post_image")).toHaveLength(3);
      expect(rpc).toHaveBeenCalledWith("attach_post_image", {
        target_post_id: postId,
        new_image_path: paths[0],
      });
      expect(result.status).toBe("success");
    });

    it("refuses a fifth photo before writing anything", async () => {
      const { client, rpc, upload } = createSupabaseClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { createPostAction } = await loadActions();

      const result = await createPostAction(
        idleState,
        composeFormData({
          images: [pngFile(), pngFile(), pngFile(), pngFile(), pngFile()],
        }),
      );

      expect(result.status).toBe("error");
      expect(result.message).toContain("4");
      expect(rpc).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
    });

    it("inspects the bytes before the post exists", async () => {
      const { client, rpc, upload } = createSupabaseClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { createPostAction } = await loadActions();

      const disguisedSvg = new File(
        [new TextEncoder().encode("<svg><script>alert(1)</script></svg>")],
        "photo.png",
        { type: "image/png" },
      );

      const result = await createPostAction(
        idleState,
        composeFormData({ images: [pngFile(), disguisedSvg] }),
      );

      expect(result.status).toBe("error");
      expect(result.message).toContain("JPEG");
      expect(rpc).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
    });

    it("takes the whole post back when a photo cannot be stored", async () => {
      const storedPath = `${groupId}/${postId}/${"a".repeat(32)}.png`;
      const upload = vi
        .fn()
        .mockResolvedValueOnce({ data: {}, error: null })
        .mockResolvedValueOnce({
          data: null,
          error: new Error("new row violates row-level security policy"),
        });
      const { client, rpc } = createSupabaseClient({
        upload,
        results: { delete_post: { data: [storedPath], error: null } },
      });
      const admin = createAdminClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      mocks.createAdminSupabaseClient.mockReturnValue(admin.client);
      const { createPostAction } = await loadActions();

      const result = await createPostAction(
        idleState,
        composeFormData({ images: [pngFile(), pngFile()] }),
      );

      expect(rpc).toHaveBeenCalledWith("delete_post", {
        target_post_id: postId,
      });
      expect(admin.from).toHaveBeenCalledWith("post-images");
      expect(admin.remove).toHaveBeenCalledWith(
        expect.arrayContaining([storedPath]),
      );
      expect(result.status).toBe("error");
      expect(result.message).not.toContain("row-level security");
      expect(result.message).not.toContain(storedPath);
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    it("keeps the words and warns when the rollback itself fails", async () => {
      const upload = vi.fn().mockResolvedValue({
        data: null,
        error: new Error("storage unavailable"),
      });
      const { client } = createSupabaseClient({
        upload,
        results: {
          delete_post: { data: null, error: new Error("deletion refused") },
        },
      });
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { createPostAction } = await loadActions();

      const result = await createPostAction(
        idleState,
        composeFormData({ images: [pngFile()] }),
      );

      expect(result.status).toBe("warning");
      expect(result.message).not.toContain("storage unavailable");
      expect(mocks.revalidatePath).toHaveBeenCalledWith(postsPath);
    });

    it("hides the database failure behind a public message", async () => {
      const { client } = createSupabaseClient({
        results: {
          create_post: {
            data: null,
            error: new Error("Hourly post quota exceeded"),
          },
        },
      });
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { createPostAction } = await loadActions();

      const result = await createPostAction(idleState, composeFormData());

      expect(result.status).toBe("error");
      expect(result.message).not.toContain("quota");
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    it("explains a missing local configuration outside production", async () => {
      const { SupabaseConfigurationError } = await import("@/lib/env");
      mocks.createServerSupabaseClient.mockRejectedValue(
        new SupabaseConfigurationError("not configured"),
      );
      const { createPostAction } = await loadActions();

      const result = await createPostAction(idleState, composeFormData());

      expect(result.message).toContain("ローカルプレビュー");
    });
  });

  describe("updatePostAction", () => {
    function updateFormData(overrides: { body?: string } = {}) {
      const formData = new FormData();
      formData.set("groupId", groupId);
      formData.set("postId", postId);
      formData.set("body", overrides.body ?? " 書き直した ");
      formData.set("hashtags", "#ライブ");
      formData.append("oshiId", oshiId);
      return formData;
    }

    it("replaces the body and the associations in one call", async () => {
      const { client, rpc } = createSupabaseClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { updatePostAction } = await loadActions();

      const result = await updatePostAction(idleState, updateFormData());

      expect(rpc).toHaveBeenCalledWith("update_post", {
        target_post_id: postId,
        post_body: "書き直した",
        oshi_ids: [oshiId],
        hashtags: ["ライブ"],
      });
      expect(result.status).toBe("success");
      expect(mocks.revalidatePath).toHaveBeenCalledWith(postsPath);
    });

    it("treats a refused edit as a plain error without revalidating", async () => {
      const { client } = createSupabaseClient({
        results: { update_post: { data: false, error: null } },
      });
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { updatePostAction } = await loadActions();

      const result = await updatePostAction(idleState, updateFormData());

      expect(result.status).toBe("error");
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("deletePostAction", () => {
    function deleteFormData() {
      const formData = new FormData();
      formData.set("groupId", groupId);
      formData.set("postId", postId);
      return formData;
    }

    it("removes every object the post left behind", async () => {
      const paths = [
        `${groupId}/${postId}/${"a".repeat(32)}.webp`,
        `${groupId}/${postId}/${"b".repeat(32)}.webp`,
      ];
      const { client, rpc } = createSupabaseClient({
        results: { delete_post: { data: paths, error: null } },
      });
      const admin = createAdminClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      mocks.createAdminSupabaseClient.mockReturnValue(admin.client);
      const { deletePostAction } = await loadActions();

      const result = await deletePostAction(idleState, deleteFormData());

      expect(rpc).toHaveBeenCalledWith("delete_post", {
        target_post_id: postId,
      });
      expect(admin.remove).toHaveBeenCalledWith(paths);
      expect(result.status).toBe("success");
      expect(result.message).not.toContain(paths[0]);
      expect(mocks.revalidatePath).toHaveBeenCalledWith(postsPath);
    });

    it("skips storage entirely for a post without photos", async () => {
      const { client } = createSupabaseClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { deletePostAction } = await loadActions();

      const result = await deletePostAction(idleState, deleteFormData());

      expect(result.status).toBe("success");
      expect(mocks.createAdminSupabaseClient).not.toHaveBeenCalled();
    });

    it("warns when the orphaned objects cannot be removed", async () => {
      const paths = [`${groupId}/${postId}/${"a".repeat(32)}.webp`];
      const { client } = createSupabaseClient({
        results: { delete_post: { data: paths, error: null } },
      });
      const admin = createAdminClient(new Error("storage unavailable"));
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      mocks.createAdminSupabaseClient.mockReturnValue(admin.client);
      const { deletePostAction } = await loadActions();

      const result = await deletePostAction(idleState, deleteFormData());

      expect(result.status).toBe("warning");
      expect(result.message).not.toContain(paths[0]);
    });

    it("reports a refusal without saying which post it was", async () => {
      const { client } = createSupabaseClient({
        results: {
          delete_post: {
            data: null,
            error: new Error("Post removal permission required"),
          },
        },
      });
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { deletePostAction } = await loadActions();

      const result = await deletePostAction(idleState, deleteFormData());

      expect(result.status).toBe("error");
      expect(result.message).not.toContain("permission required");
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("attachPostImageAction", () => {
    function attachFormData(file: File) {
      const formData = new FormData();
      formData.set("groupId", groupId);
      formData.set("postId", postId);
      formData.set("image", file);
      return formData;
    }

    it("uploads an opaque object name and records it", async () => {
      const { client, rpc, upload, from } = createSupabaseClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { attachPostImageAction } = await loadActions();

      const result = await attachPostImageAction(
        idleState,
        attachFormData(pngFile()),
      );

      expect(from).toHaveBeenCalledWith("post-images");
      const [objectPath, , uploadOptions] = upload.mock.calls[0];
      expect(objectPath).toMatch(
        new RegExp(`^${groupId}/${postId}/[0-9a-f]{32}\\.png$`),
      );
      expect(uploadOptions).toMatchObject({
        contentType: "image/png",
        upsert: false,
      });
      expect(rpc).toHaveBeenCalledWith("attach_post_image", {
        target_post_id: postId,
        new_image_path: objectPath,
      });
      expect(result.status).toBe("success");
    });

    it("rolls the upload back when the database refuses it", async () => {
      const { client, upload } = createSupabaseClient({
        results: {
          attach_post_image: {
            data: null,
            error: new Error("A post may carry at most 4 images"),
          },
        },
      });
      const admin = createAdminClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      mocks.createAdminSupabaseClient.mockReturnValue(admin.client);
      const { attachPostImageAction } = await loadActions();

      const result = await attachPostImageAction(
        idleState,
        attachFormData(pngFile()),
      );

      const [objectPath] = upload.mock.calls[0];
      expect(admin.remove).toHaveBeenCalledWith([objectPath]);
      expect(result.status).toBe("error");
      expect(result.message).not.toContain("at most 4");
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("detachPostImageAction", () => {
    const imagePath = `${groupId}/${postId}/${"a".repeat(32)}.webp`;

    function detachFormData(path = imagePath) {
      const formData = new FormData();
      formData.set("groupId", groupId);
      formData.set("postId", postId);
      formData.set("imagePath", path);
      return formData;
    }

    it("removes the object the database released", async () => {
      const { client, rpc } = createSupabaseClient({
        results: { detach_post_image: { data: imagePath, error: null } },
      });
      const admin = createAdminClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      mocks.createAdminSupabaseClient.mockReturnValue(admin.client);
      const { detachPostImageAction } = await loadActions();

      const result = await detachPostImageAction(idleState, detachFormData());

      expect(rpc).toHaveBeenCalledWith("detach_post_image", {
        target_post_id: postId,
        target_image_path: imagePath,
      });
      expect(admin.from).toHaveBeenCalledWith("post-images");
      expect(admin.remove).toHaveBeenCalledWith([imagePath]);
      expect(result.status).toBe("success");
      expect(mocks.revalidatePath).toHaveBeenCalledWith(postsPath);
    });

    it("refuses a path that does not look like one this app wrote", async () => {
      const { client, rpc } = createSupabaseClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { detachPostImageAction } = await loadActions();

      for (const path of [
        "../../etc/passwd",
        `${groupId}/${postId}/${"a".repeat(32)}.svg`,
        "",
      ]) {
        expect(
          (await detachPostImageAction(idleState, detachFormData(path))).status,
        ).toBe("error");
      }

      expect(rpc).not.toHaveBeenCalled();
    });

    it("warns when the released object survives in storage", async () => {
      const { client } = createSupabaseClient({
        results: { detach_post_image: { data: imagePath, error: null } },
      });
      const admin = createAdminClient(new Error("storage unavailable"));
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      mocks.createAdminSupabaseClient.mockReturnValue(admin.client);
      const { detachPostImageAction } = await loadActions();

      const result = await detachPostImageAction(idleState, detachFormData());

      expect(result.status).toBe("warning");
      expect(result.message).not.toContain(imagePath);
    });
  });
});
