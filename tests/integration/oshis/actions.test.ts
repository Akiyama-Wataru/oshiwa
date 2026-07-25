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
const oshiId = "7c308427-3f5d-4cab-a54c-d9b2eecdd4b4";
const otherOshiId = "9f4e2c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const oshisPath = `/groups/${groupId}/oshis`;
const idleState = { status: "idle", message: "" } as const;

function pngBytes(padding = 64) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const bytes = new Uint8Array(signature.length + padding);
  bytes.set(signature, 0);
  return bytes;
}

function pngFile(type = "image/png", padding = 64) {
  return new File([pngBytes(padding)], "oshi.png", { type });
}

function createSupabaseClient(
  overrides: {
    rpc?: ReturnType<typeof vi.fn>;
    upload?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const rpc = overrides.rpc ?? vi.fn().mockResolvedValue({ data: null, error: null });
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
  return import("@/app/groups/[groupId]/oshis/actions");
}

describe("oshi server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAdminSupabaseClient.mockImplementation(() => {
      throw new Error("admin client not configured for this test");
    });
  });

  describe("createOshiAction", () => {
    it("creates an oshi from a trimmed name and normalised colour", async () => {
      const { client, rpc } = createSupabaseClient({
        rpc: vi.fn().mockResolvedValue({ data: oshiId, error: null }),
      });
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { createOshiAction } = await loadActions();

      const formData = new FormData();
      formData.set("groupId", groupId);
      formData.set("name", "  ミナ  ");
      formData.set("color", "#FF6F91");

      const result = await createOshiAction(idleState, formData);

      expect(rpc).toHaveBeenCalledWith("create_oshi", {
        target_group_id: groupId,
        oshi_name: "ミナ",
        oshi_color: "#ff6f91",
      });
      expect(result.status).toBe("success");
      expect(mocks.revalidatePath).toHaveBeenCalledWith(oshisPath);
    });

    it("never reaches the database for invalid input", async () => {
      const { client, rpc } = createSupabaseClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { createOshiAction } = await loadActions();

      for (const [name, color] of [
        [" ", "#ff6f91"],
        ["ミナ", "red"],
        ["あ".repeat(41), "#ff6f91"],
      ]) {
        const formData = new FormData();
        formData.set("groupId", groupId);
        formData.set("name", name);
        formData.set("color", color);

        const result = await createOshiAction(idleState, formData);

        expect(result.status).toBe("error");
      }

      expect(rpc).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    it("hides the database failure behind a public message", async () => {
      const { client } = createSupabaseClient({
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: new Error("Oshi quota exceeded for group 2b75e8eb"),
        }),
      });
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { createOshiAction } = await loadActions();

      const formData = new FormData();
      formData.set("groupId", groupId);
      formData.set("name", "ミナ");
      formData.set("color", "#ff6f91");

      const result = await createOshiAction(idleState, formData);

      expect(result.status).toBe("error");
      expect(result.message).not.toContain("quota");
      expect(result.message).not.toContain(groupId);
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    it("explains a missing local configuration outside production", async () => {
      const { SupabaseConfigurationError } = await import("@/lib/env");
      mocks.createServerSupabaseClient.mockRejectedValue(
        new SupabaseConfigurationError("not configured"),
      );
      const { createOshiAction } = await loadActions();

      const formData = new FormData();
      formData.set("groupId", groupId);
      formData.set("name", "ミナ");
      formData.set("color", "#ff6f91");

      const result = await createOshiAction(idleState, formData);

      expect(result.status).toBe("error");
      expect(result.message).toContain("ローカルプレビュー");
    });
  });

  describe("updateOshiAction", () => {
    it("sends the normalised values and reports success", async () => {
      const { client, rpc } = createSupabaseClient({
        rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
      });
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { updateOshiAction } = await loadActions();

      const formData = new FormData();
      formData.set("groupId", groupId);
      formData.set("oshiId", oshiId);
      formData.set("name", " サナ ");
      formData.set("color", "#59A5F5");

      const result = await updateOshiAction(idleState, formData);

      expect(rpc).toHaveBeenCalledWith("update_oshi", {
        target_oshi_id: oshiId,
        oshi_name: "サナ",
        oshi_color: "#59a5f5",
      });
      expect(result.status).toBe("success");
      expect(mocks.revalidatePath).toHaveBeenCalledWith(oshisPath);
    });

    it("treats a refused update as a plain error without revalidating", async () => {
      const { client } = createSupabaseClient({
        rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
      });
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { updateOshiAction } = await loadActions();

      const formData = new FormData();
      formData.set("groupId", groupId);
      formData.set("oshiId", oshiId);
      formData.set("name", "サナ");
      formData.set("color", "#59a5f5");

      const result = await updateOshiAction(idleState, formData);

      expect(result.status).toBe("error");
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("deleteOshiAction", () => {
    it("removes the orphaned object with the admin client", async () => {
      const imagePath = `${groupId}/${oshiId}/${"a".repeat(32)}.webp`;
      const { client, rpc } = createSupabaseClient({
        rpc: vi.fn().mockResolvedValue({ data: imagePath, error: null }),
      });
      const admin = createAdminClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      mocks.createAdminSupabaseClient.mockReturnValue(admin.client);
      const { deleteOshiAction } = await loadActions();

      const formData = new FormData();
      formData.set("groupId", groupId);
      formData.set("oshiId", oshiId);

      const result = await deleteOshiAction(idleState, formData);

      expect(rpc).toHaveBeenCalledWith("delete_oshi", {
        target_oshi_id: oshiId,
      });
      expect(admin.from).toHaveBeenCalledWith("oshi-images");
      expect(admin.remove).toHaveBeenCalledWith([imagePath]);
      expect(result.status).toBe("success");
      expect(result.message).not.toContain(imagePath);
      expect(mocks.revalidatePath).toHaveBeenCalledWith(oshisPath);
    });

    it("skips storage entirely when the oshi had no image", async () => {
      const { client } = createSupabaseClient({
        rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { deleteOshiAction } = await loadActions();

      const formData = new FormData();
      formData.set("groupId", groupId);
      formData.set("oshiId", oshiId);

      const result = await deleteOshiAction(idleState, formData);

      expect(result.status).toBe("success");
      expect(mocks.createAdminSupabaseClient).not.toHaveBeenCalled();
    });

    it("warns when the orphaned object cannot be removed", async () => {
      const imagePath = `${groupId}/${oshiId}/${"a".repeat(32)}.webp`;
      const { client } = createSupabaseClient({
        rpc: vi.fn().mockResolvedValue({ data: imagePath, error: null }),
      });
      const admin = createAdminClient(new Error("storage unavailable"));
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      mocks.createAdminSupabaseClient.mockReturnValue(admin.client);
      const { deleteOshiAction } = await loadActions();

      const formData = new FormData();
      formData.set("groupId", groupId);
      formData.set("oshiId", oshiId);

      const result = await deleteOshiAction(idleState, formData);

      expect(result.status).toBe("warning");
      expect(result.message).not.toContain(imagePath);
      expect(mocks.revalidatePath).toHaveBeenCalledWith(oshisPath);
    });
  });

  describe("reorderOshisAction", () => {
    it("forwards the submitted order as a uuid array", async () => {
      const { client, rpc } = createSupabaseClient({
        rpc: vi.fn().mockResolvedValue({ data: 2, error: null }),
      });
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { reorderOshisAction } = await loadActions();

      const formData = new FormData();
      formData.set("groupId", groupId);
      formData.append("oshiId", otherOshiId);
      formData.append("oshiId", oshiId);

      const result = await reorderOshisAction(idleState, formData);

      expect(rpc).toHaveBeenCalledWith("reorder_oshis", {
        target_group_id: groupId,
        ordered_ids: [otherOshiId, oshiId],
      });
      expect(result.status).toBe("success");
    });

    it("refuses a duplicated or empty order without a database call", async () => {
      const { client, rpc } = createSupabaseClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { reorderOshisAction } = await loadActions();

      const duplicated = new FormData();
      duplicated.set("groupId", groupId);
      duplicated.append("oshiId", oshiId);
      duplicated.append("oshiId", oshiId);

      const empty = new FormData();
      empty.set("groupId", groupId);

      expect((await reorderOshisAction(idleState, duplicated)).status).toBe(
        "error",
      );
      expect((await reorderOshisAction(idleState, empty)).status).toBe("error");
      expect(rpc).not.toHaveBeenCalled();
    });
  });

  describe("uploadOshiImageAction", () => {
    function imageFormData(file: File) {
      const formData = new FormData();
      formData.set("groupId", groupId);
      formData.set("oshiId", oshiId);
      formData.set("image", file);
      return formData;
    }

    it("uploads an opaque object name and records it through the RPC", async () => {
      const { client, rpc, upload, from } = createSupabaseClient({
        rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { uploadOshiImageAction } = await loadActions();

      const result = await uploadOshiImageAction(
        idleState,
        imageFormData(pngFile()),
      );

      expect(from).toHaveBeenCalledWith("oshi-images");
      const [objectPath, , uploadOptions] = upload.mock.calls[0];
      expect(objectPath).toMatch(
        new RegExp(`^${groupId}/${oshiId}/[0-9a-f]{32}\\.png$`),
      );
      expect(objectPath).not.toContain("oshi.png");
      expect(uploadOptions).toMatchObject({
        contentType: "image/png",
        upsert: false,
      });
      expect(rpc).toHaveBeenCalledWith("set_oshi_image", {
        target_oshi_id: oshiId,
        new_image_path: objectPath,
      });
      expect(result.status).toBe("success");
      expect(result.message).not.toContain(objectPath);
    });

    it("rejects a scriptable or spoofed image before touching storage", async () => {
      const { client, rpc, upload } = createSupabaseClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { uploadOshiImageAction } = await loadActions();

      const svg = new File(
        [new TextEncoder().encode("<svg><script>alert(1)</script></svg>")],
        "oshi.svg",
        { type: "image/svg+xml" },
      );
      const disguisedSvg = new File(
        [new TextEncoder().encode("<svg></svg>")],
        "oshi.png",
        { type: "image/png" },
      );
      const spoofedType = pngFile("image/jpeg");

      for (const file of [svg, disguisedSvg, spoofedType]) {
        const result = await uploadOshiImageAction(
          idleState,
          imageFormData(file),
        );

        expect(result.status).toBe("error");
        expect(result.message).toContain("JPEG");
      }

      expect(upload).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    });

    it("rejects an oversized or empty image before touching storage", async () => {
      const { MAX_OSHI_IMAGE_BYTES } = await import(
        "@/lib/media/image-signature"
      );
      const { client, upload } = createSupabaseClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { uploadOshiImageAction } = await loadActions();

      const oversized = await uploadOshiImageAction(
        idleState,
        imageFormData(pngFile("image/png", MAX_OSHI_IMAGE_BYTES)),
      );
      const empty = await uploadOshiImageAction(
        idleState,
        imageFormData(new File([], "oshi.png", { type: "image/png" })),
      );

      expect(oversized.status).toBe("error");
      expect(oversized.message).toMatch(/1MB|圧縮/);
      expect(empty.status).toBe("error");
      expect(upload).not.toHaveBeenCalled();
    });

    it("removes the replaced object so no orphan is left behind", async () => {
      const previousPath = `${groupId}/${oshiId}/${"b".repeat(32)}.jpg`;
      const { client } = createSupabaseClient({
        rpc: vi.fn().mockResolvedValue({ data: previousPath, error: null }),
      });
      const admin = createAdminClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      mocks.createAdminSupabaseClient.mockReturnValue(admin.client);
      const { uploadOshiImageAction } = await loadActions();

      const result = await uploadOshiImageAction(
        idleState,
        imageFormData(pngFile()),
      );

      expect(admin.remove).toHaveBeenCalledWith([previousPath]);
      expect(result.status).toBe("success");
    });

    it("rolls the upload back when the database refuses the new path", async () => {
      const { client, upload } = createSupabaseClient({
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: new Error("Oshi management permission required"),
        }),
      });
      const admin = createAdminClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      mocks.createAdminSupabaseClient.mockReturnValue(admin.client);
      const { uploadOshiImageAction } = await loadActions();

      const result = await uploadOshiImageAction(
        idleState,
        imageFormData(pngFile()),
      );

      const [objectPath] = upload.mock.calls[0];
      expect(admin.remove).toHaveBeenCalledWith([objectPath]);
      expect(result.status).toBe("error");
      expect(result.message).not.toContain("permission required");
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    it("reports a storage rejection without leaking the object name", async () => {
      const { client, rpc } = createSupabaseClient({
        upload: vi.fn().mockResolvedValue({
          data: null,
          error: new Error("new row violates row-level security policy"),
        }),
      });
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { uploadOshiImageAction } = await loadActions();

      const result = await uploadOshiImageAction(
        idleState,
        imageFormData(pngFile()),
      );

      expect(result.status).toBe("error");
      expect(result.message).not.toContain("row-level security");
      expect(rpc).not.toHaveBeenCalled();
    });

    it("warns when the replaced object cannot be cleaned up", async () => {
      const previousPath = `${groupId}/${oshiId}/${"b".repeat(32)}.jpg`;
      const { client } = createSupabaseClient({
        rpc: vi.fn().mockResolvedValue({ data: previousPath, error: null }),
      });
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { uploadOshiImageAction } = await loadActions();

      const result = await uploadOshiImageAction(
        idleState,
        imageFormData(pngFile()),
      );

      expect(result.status).toBe("warning");
      expect(result.message).not.toContain(previousPath);
      expect(mocks.revalidatePath).toHaveBeenCalledWith(oshisPath);
    });
  });
});
