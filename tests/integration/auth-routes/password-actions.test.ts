import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

const idleState = { status: "idle", message: "" } as const;
const userId = "1f0f2b1c-4b6f-4a3d-9d0e-2b6f1a2c3d4e";
const strongPassword = "correct horse battery staple";

function resetFormData(email: string) {
  const formData = new FormData();
  formData.set("email", email);
  return formData;
}

function updateFormData(
  password = strongPassword,
  confirmation = strongPassword,
) {
  const formData = new FormData();
  formData.set("password", password);
  formData.set("passwordConfirmation", confirmation);
  return formData;
}

function createClient(options: {
  claims?: unknown;
  claimsError?: unknown;
  resetError?: unknown;
  updateError?: unknown;
  user?: { id: string } | null;
} = {}) {
  const resetPasswordForEmail = vi
    .fn()
    .mockResolvedValue({ data: {}, error: options.resetError ?? null });
  const updateUser = vi
    .fn()
    .mockResolvedValue({ data: {}, error: options.updateError ?? null });
  const getUser = vi.fn().mockResolvedValue({
    data: { user: options.user === undefined ? { id: userId } : options.user },
    error: options.user === null ? new Error("no session") : null,
  });
  const getClaims = vi.fn().mockResolvedValue({
    data: {
      claims:
        options.claims === undefined
          ? { amr: [{ method: "recovery" }] }
          : options.claims,
    },
    error: options.claimsError ?? null,
  });

  return {
    client: {
      auth: { resetPasswordForEmail, updateUser, getUser, getClaims },
    },
    resetPasswordForEmail,
    updateUser,
  };
}

async function loadActions() {
  return import("@/app/password/actions");
}

describe("requestPasswordResetAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = "https://oshiwa.test";
  });

  it("sends the member back through the confirm route", async () => {
    const { client, resetPasswordForEmail } = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(client);
    const { requestPasswordResetAction } = await loadActions();

    const result = await requestPasswordResetAction(
      idleState,
      resetFormData(" Fan@Example.com "),
    );

    expect(resetPasswordForEmail).toHaveBeenCalledWith("fan@example.com", {
      redirectTo: "https://oshiwa.test/auth/confirm?next=%2Fpassword%2Fupdate",
    });
    expect(result.status).toBe("success");
  });

  it("answers the same whether or not the address is registered", async () => {
    const registered = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(registered.client);
    const { requestPasswordResetAction } = await loadActions();

    const known = await requestPasswordResetAction(
      idleState,
      resetFormData("member@example.com"),
    );

    const unknown_ = createClient({
      resetError: new Error("User not found"),
    });
    mocks.createServerSupabaseClient.mockResolvedValue(unknown_.client);

    const stranger = await requestPasswordResetAction(
      idleState,
      resetFormData("stranger@example.com"),
    );

    // Differing copy here would turn the form into a membership oracle.
    expect(stranger).toEqual(known);
    expect(stranger.status).toBe("success");
  });

  it("refuses a malformed address without sending anything", async () => {
    const { client, resetPasswordForEmail } = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(client);
    const { requestPasswordResetAction } = await loadActions();

    const result = await requestPasswordResetAction(
      idleState,
      resetFormData("not-an-address"),
    );

    expect(result.status).toBe("error");
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe("updatePasswordAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets the password for a session the emailed link established", async () => {
    const { client, updateUser } = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(client);
    const { updatePasswordAction } = await loadActions();

    await expect(
      updatePasswordAction(idleState, updateFormData()),
    ).rejects.toThrow("REDIRECT:/groups");

    expect(updateUser).toHaveBeenCalledWith({ password: strongPassword });
  });

  it("refuses a session that was established with a password", async () => {
    const { client, updateUser } = createClient({
      claims: { amr: [{ method: "password" }] },
    });
    mocks.createServerSupabaseClient.mockResolvedValue(client);
    const { updatePasswordAction } = await loadActions();

    const result = await updatePasswordAction(idleState, updateFormData());

    // Otherwise a stolen session could lock the owner out of their own account
    // without ever knowing the password it replaced.
    expect(result.status).toBe("error");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("refuses a session it cannot account for at all", async () => {
    for (const options of [
      { user: null },
      { claimsError: new Error("claims unavailable") },
      { claims: {} },
      { claims: { amr: [{ method: "password" }, { method: "recovery" }] } },
    ]) {
      const { client, updateUser } = createClient(options);
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { updatePasswordAction } = await loadActions();

      expect(
        (await updatePasswordAction(idleState, updateFormData())).status,
      ).toBe("error");
      expect(updateUser).not.toHaveBeenCalled();
    }
  });

  it("holds the password to the same rule the login form states", async () => {
    const { client, updateUser } = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(client);
    const { updatePasswordAction } = await loadActions();

    const short = await updatePasswordAction(
      idleState,
      updateFormData("short", "short"),
    );
    const mismatched = await updatePasswordAction(
      idleState,
      updateFormData(strongPassword, "something else entirely"),
    );

    expect(short.status).toBe("error");
    expect(mismatched.status).toBe("error");
    expect(mismatched.message).toContain("一致");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("hides the reason Supabase refused the new password", async () => {
    const { client } = createClient({
      updateError: new Error("New password should be different from the old"),
    });
    mocks.createServerSupabaseClient.mockResolvedValue(client);
    const { updatePasswordAction } = await loadActions();

    const result = await updatePasswordAction(idleState, updateFormData());

    expect(result.status).toBe("error");
    expect(result.message).not.toContain("old");
  });
});
