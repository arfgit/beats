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

const pushMock = vi.fn().mockResolvedValue(undefined);
const dbSetMock = vi.fn().mockResolvedValue(undefined);
vi.mock("firebase/database", async () => {
  const actual =
    await vi.importActual<typeof import("firebase/database")>(
      "firebase/database",
    );
  return {
    ...actual,
    push: (...args: unknown[]) => pushMock(...args),
    set: (...args: unknown[]) => dbSetMock(...args),
    ref: vi.fn(() => ({})),
    onValue: vi.fn(),
    onChildAdded: vi.fn(),
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

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue({ code: "BX-TEST1" }),
    post: vi.fn().mockResolvedValue({}),
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

describe("collabSlice broadcast guards", () => {
  beforeEach(() => {
    pushMock.mockClear();
    dbSetMock.mockClear();
    useBeatsStore.getState().resetMatrix();
    useBeatsStore.getState().resetPattern();
  });

  it("emitEdit no-ops when no session is active", () => {
    useBeatsStore.getState().emitEdit({ kind: "pattern/setBpm", bpm: 140 });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("emitEdit no-ops while applyingRemote is true (broadcast loop guard)", () => {
    // Simulate being in a session as an editor.
    useBeatsStore.setState((s) => ({
      auth: { ...s.auth, user: { ...(s.auth.user ?? makeFakeUser()) } },
      collab: {
        ...s.collab,
        session: {
          ...s.collab.session,
          id: "sess-1",
          meta: {
            v: 1,
            sessionId: "sess-1",
            projectId: "p1",
            ownerUid: "uid-1",
            createdAt: 0,
            status: "open",
          },
          role: "editor",
          applyingRemote: true, // <-- the guard under test
        },
      },
    }));
    useBeatsStore.getState().emitEdit({ kind: "pattern/setBpm", bpm: 150 });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("emitEdit no-ops for viewer role (read-only sessions)", () => {
    useBeatsStore.setState((s) => ({
      auth: { ...s.auth, user: { ...(s.auth.user ?? makeFakeUser()) } },
      collab: {
        ...s.collab,
        session: {
          ...s.collab.session,
          id: "sess-1",
          meta: {
            v: 1,
            sessionId: "sess-1",
            projectId: "p1",
            ownerUid: "uid-1",
            createdAt: 0,
            status: "open",
          },
          role: "viewer",
          applyingRemote: false,
        },
      },
    }));
    useBeatsStore.getState().emitEdit({ kind: "pattern/setBpm", bpm: 160 });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("emitEdit pushes to RTDB when session is active and role is editor", () => {
    useBeatsStore.setState((s) => ({
      auth: { ...s.auth, user: { ...(s.auth.user ?? makeFakeUser()) } },
      collab: {
        ...s.collab,
        session: {
          ...s.collab.session,
          id: "sess-1",
          meta: {
            v: 1,
            sessionId: "sess-1",
            projectId: "p1",
            ownerUid: "uid-1",
            createdAt: 0,
            status: "open",
          },
          role: "editor",
          applyingRemote: false,
        },
      },
    }));
    useBeatsStore.getState().emitEdit({ kind: "pattern/setBpm", bpm: 170 });
    expect(pushMock).toHaveBeenCalledTimes(1);
    const message = pushMock.mock.calls[0]![1];
    expect(message.op).toEqual({ kind: "pattern/setBpm", bpm: 170 });
    expect(message.peerId).toBe("uid-1");
    expect(message.v).toBe(1);
  });
});

function makeFakeUser() {
  return {
    id: "uid-1",
    displayName: "test-user",
    email: "test@example.com",
    photoUrl: null,
    bio: "",
    socialLinks: [],
    role: "user" as const,
    isPublic: false,
    createdAt: 0,
  };
}
