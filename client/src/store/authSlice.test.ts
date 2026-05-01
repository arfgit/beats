import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/audio/engine", () => ({
  audioEngine: {
    ensureStarted: vi.fn().mockResolvedValue(undefined),
    play: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    startRecording: vi.fn().mockResolvedValue(undefined),
    stopRecording: vi.fn().mockResolvedValue(new Blob()),
    isStarted: vi.fn().mockReturnValue(false),
    previewTrack: vi.fn(),
    setPattern: vi.fn(),
    subscribe: vi.fn().mockReturnValue(() => undefined),
    reset: vi.fn(),
  },
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

vi.mock("firebase/database", async () => {
  const actual =
    await vi.importActual<typeof import("firebase/database")>(
      "firebase/database",
    );
  return {
    ...actual,
    push: vi.fn(),
    set: vi.fn(),
    ref: vi.fn(() => ({})),
    onValue: vi.fn(),
    off: vi.fn(),
    serverTimestamp: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
    onDisconnect: vi.fn(() => ({
      remove: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

vi.mock("firebase/firestore", async () => {
  const actual =
    await vi.importActual<typeof import("firebase/firestore")>(
      "firebase/firestore",
    );
  return {
    ...actual,
    onSnapshot: vi.fn(() => () => undefined),
    collection: vi.fn(() => ({})),
    doc: vi.fn(() => ({})),
  };
});

const apiPostMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue({}),
    post: (...args: unknown[]) => apiPostMock(...args),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
  ApiCallError: class ApiCallError extends Error {
    apiError: { code: string; message: string };
    constructor(apiError: { code: string; message: string }) {
      super(apiError.message);
      this.apiError = apiError;
    }
  },
}));

const { useBeatsStore } = await import("./useBeatsStore");

const baseUser = {
  id: "uid-1",
  schemaVersion: 2 as const,
  displayName: "Test User",
  username: "",
  usernameLower: "",
  email: "test@example.com",
  emailVerified: false,
  authProviders: ["password" as const],
  photoUrl: null,
  bio: "",
  socialLinks: [],
  role: "user" as const,
  isPublic: false,
  createdAt: 0,
};

describe("authSlice status transitions", () => {
  beforeEach(() => {
    apiPostMock.mockReset();
    useBeatsStore.setState((s) => ({
      auth: {
        ...s.auth,
        user: null,
        fbUser: null,
        status: "idle",
        errorMessage: null,
      },
    }));
  });

  it("claimUsername flips status from needsUsername to authed on success", async () => {
    useBeatsStore.setState((s) => ({
      auth: {
        ...s.auth,
        user: { ...baseUser },
        status: "needsUsername",
      },
    }));
    apiPostMock.mockResolvedValueOnce({
      ...baseUser,
      username: "neon-rider",
      usernameLower: "neon-rider",
    });
    await useBeatsStore.getState().claimUsername("neon-rider");
    const state = useBeatsStore.getState().auth;
    expect(state.status).toBe("authed");
    expect(state.user?.username).toBe("neon-rider");
    expect(state.errorMessage).toBeNull();
  });

  it("claimUsername preserves needsUsername when the server returns an empty username", async () => {
    // Defensive: if the server somehow responds with an empty handle
    // (e.g. a bug in the claim endpoint), the slice should stay in
    // onboarding rather than silently flipping to 'authed'.
    useBeatsStore.setState((s) => ({
      auth: {
        ...s.auth,
        user: { ...baseUser },
        status: "needsUsername",
      },
    }));
    apiPostMock.mockResolvedValueOnce({
      ...baseUser,
      username: "",
      usernameLower: "",
    });
    await useBeatsStore.getState().claimUsername("anything");
    expect(useBeatsStore.getState().auth.status).toBe("needsUsername");
  });

  it("claimUsername propagates server errors without mutating state", async () => {
    useBeatsStore.setState((s) => ({
      auth: {
        ...s.auth,
        user: { ...baseUser },
        status: "needsUsername",
      },
    }));
    const before = useBeatsStore.getState().auth;
    apiPostMock.mockRejectedValueOnce(new Error("conflict"));
    await expect(
      useBeatsStore.getState().claimUsername("taken"),
    ).rejects.toThrow("conflict");
    const after = useBeatsStore.getState().auth;
    expect(after.status).toBe(before.status);
    expect(after.user).toBe(before.user);
  });

  it("refreshSession is a no-op when no fbUser is present", async () => {
    // No fbUser → return early without API call.
    apiPostMock.mockClear();
    await useBeatsStore.getState().refreshSession();
    expect(apiPostMock).not.toHaveBeenCalled();
  });
});
