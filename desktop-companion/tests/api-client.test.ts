// API client tests — tests the REST client logic (mocked fetch).
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the ConfigManager and LocalDb
const mockConfig = {
  get: vi.fn((key: string) => {
    if (key === "apiEndpoint") return "http://localhost:29473";
    if (key === "token") return "test-token-123";
    if (key === "userEmail") return "test@chroma.lab";
    return null;
  }),
  set: vi.fn(),
};

const mockDb = {
  log: vi.fn(),
};

// Import after mocks are set up
const { ApiClient } = await import("../src/main/api-client");

describe("ApiClient", () => {
  let client: any;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new ApiClient(mockConfig as any, mockDb as any);
  });

  it("should construct with config and db", () => {
    expect(client).toBeDefined();
  });

  it("should return the correct base URL", () => {
    // The base URL should strip trailing slashes
    mockConfig.get.mockReturnValue("http://localhost:29473/");
    const url = (client as any).getBaseUrl();
    expect(url).toBe("http://localhost:29473");
  });

  it("should include auth headers when token is present", () => {
    mockConfig.get.mockImplementation((key: string) => {
      if (key === "token") return "test-token-123";
      return null;
    });
    const headers = (client as any).authHeaders();
    expect(headers.Authorization).toBe("Bearer test-token-123");
  });

  it("should not include auth headers when token is null", () => {
    mockConfig.get.mockImplementation((key: string) => {
      if (key === "token") return null;
      return null;
    });
    const headers = (client as any).authHeaders();
    expect(headers.Authorization).toBeUndefined();
  });

  it("should report authenticated status when token exists", () => {
    mockConfig.get.mockImplementation((key: string) => {
      if (key === "token") return "test-token-123";
      return null;
    });
    expect(client.isAuthenticated()).toBe(true);
  });

  it("should report unauthenticated status when token is null", () => {
    mockConfig.get.mockImplementation((key: string) => {
      if (key === "token") return null;
      return null;
    });
    expect(client.isAuthenticated()).toBe(false);
  });

  it("should clear token on logout", () => {
    client.logout();
    expect(mockConfig.set).toHaveBeenCalledWith("token", null);
    expect(mockConfig.set).toHaveBeenCalledWith("userEmail", null);
  });
});
