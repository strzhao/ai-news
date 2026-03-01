import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as GET_TAG_GROUPS } from "@/app/api/v1/tags/groups/route";
import { DELETE as DELETE_TAG, PUT as PUT_TAG } from "@/app/api/v1/tags/groups/[group_key]/[tag_key]/route";
import { deactivateTagDefinition, listTagGroups, upsertTagDefinition } from "@/lib/article-db/repository";

vi.mock("@/lib/article-db/repository", () => {
  return {
    listTagGroups: vi.fn(),
    upsertTagDefinition: vi.fn(),
    deactivateTagDefinition: vi.fn(),
  };
});

describe("article-db tags routes", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ARTICLE_DB_API_TOKEN;
  });

  it("lists tag groups", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "secret-token";
    vi.mocked(listTagGroups).mockResolvedValue([
      {
        group_key: "topic",
        tags: [
          {
            group_key: "topic",
            tag_key: "agent",
            display_name: "agent",
            description: "",
            aliases: [],
            is_active: true,
            managed_by: "ai",
            updated_at: "2026-03-01T00:00:00.000Z",
          },
        ],
      },
    ]);

    const response = await GET_TAG_GROUPS(
      new Request("https://example.com/api/v1/tags/groups", {
        headers: { Authorization: "Bearer secret-token" },
      }),
    );

    const payload = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.group_count).toBe(1);
  });

  it("upserts tag definition", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "secret-token";
    vi.mocked(upsertTagDefinition).mockResolvedValue();

    const response = await PUT_TAG(
      new Request("https://example.com/api/v1/tags/groups/topic/agent", {
        method: "PUT",
        headers: {
          Authorization: "Bearer secret-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          display_name: "Agent",
          aliases: ["multi-agent"],
        }),
      }),
      { params: Promise.resolve({ group_key: "topic", tag_key: "agent" }) },
    );

    expect(response.status).toBe(200);
    expect(upsertTagDefinition).toHaveBeenCalledWith({
      groupKey: "topic",
      tagKey: "agent",
      displayName: "Agent",
      description: "",
      aliases: ["multi-agent"],
      isActive: undefined,
      managedBy: "ai_manual",
    });
  });

  it("deactivates tag definition", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "secret-token";
    vi.mocked(deactivateTagDefinition).mockResolvedValue(true);

    const response = await DELETE_TAG(
      new Request("https://example.com/api/v1/tags/groups/topic/agent", {
        method: "DELETE",
        headers: { Authorization: "Bearer secret-token" },
      }),
      { params: Promise.resolve({ group_key: "topic", tag_key: "agent" }) },
    );

    const payload = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(deactivateTagDefinition).toHaveBeenCalledWith("topic", "agent");
  });
});
