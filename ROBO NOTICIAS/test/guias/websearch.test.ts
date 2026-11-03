import { describe, expect, it, vi } from "vitest";
import { createWebSearch, extractHits, WEB_SEARCH_TOOL_TYPE } from "../../src/guias/websearch.js";

const content = [
  { type: "server_tool_use", name: "web_search" },
  {
    type: "web_search_tool_result",
    content: [
      { type: "web_search_result", title: "A", url: "https://a.com/1", page_age: "May 1, 2026" },
      { type: "web_search_result", title: "A again", url: "https://a.com/1" },
      { type: "web_search_result", title: "B", url: "https://b.com/2" },
    ],
  },
  { type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
  { type: "text", text: "OK" },
];

describe("createWebSearch", () => {
  it("extracts de-duplicated hits and ignores error results", () => {
    expect(extractHits(content)).toEqual([
      { title: "A", url: "https://a.com/1", snippet: "May 1, 2026" },
      { title: "B", url: "https://b.com/2" },
    ]);
  });

  it("sends the server tool and records tokens plus $10/1000 searches", async () => {
    const create = vi.fn(async (_req: unknown) => ({
      content,
      usage: { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 1 } },
    }));
    const recordSpend = vi.fn();
    const ws = createWebSearch({ client: { messages: { create } } as never, model: "claude-sonnet-5-5", recordSpend });
    const hits = await ws.search("phantom blade zero trophies");
    expect(hits).toHaveLength(2);
    const req = create.mock.calls[0]![0] as { tools: { type: string; max_uses: number }[] };
    expect(req.tools[0]).toMatchObject({ type: WEB_SEARCH_TOOL_TYPE, max_uses: 1 });
    // 1000*2/1e6 + 100*10/1e6 + 0.01
    expect(recordSpend).toHaveBeenCalledWith(expect.closeTo(0.013, 6), expect.stringContaining("websearch"));
  });

  it("Task 25: com MODEL_EXTRACT=Opus 5.5 a busca segue no mesmo tool (web_search_20260209 aceita Opus 5.5) e no preço do Opus", async () => {
    const create = vi.fn(async (_req: unknown) => ({ content, usage: { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 1 } } }));
    const recordSpend = vi.fn();
    const ws = createWebSearch({ client: { messages: { create } } as never, model: "claude-opus-5-5", recordSpend });
    expect(await ws.search("phantom blade zero trophies")).toHaveLength(2);
    expect(create.mock.calls[0]![0]).toMatchObject({ model: "claude-opus-5-5", tools: [{ type: "web_search_20260209", name: "web_search" }] });
    // 1000*4/1e6 + 100*20/1e6 + 0.01
    expect(recordSpend).toHaveBeenCalledWith(expect.closeTo(0.016, 6), expect.stringContaining("websearch"));
  });

  it("continues a pause_turn and records each paid turn as it happens", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        stop_reason: "pause_turn",
        content: [{ type: "server_tool_use", name: "web_search" }],
        usage: { input_tokens: 1000, output_tokens: 0, server_tool_use: { web_search_requests: 1 } },
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [
          { type: "web_search_tool_result", content: [{ type: "web_search_result", title: "C", url: "https://c.com" }] },
        ],
        usage: { input_tokens: 500, output_tokens: 10 },
      });
    const recordSpend = vi.fn();
    const ws = createWebSearch({ client: { messages: { create } } as never, model: "claude-sonnet-5-5", recordSpend });
    expect(await ws.search("q")).toEqual([{ title: "C", url: "https://c.com" }]);
    expect(create).toHaveBeenCalledTimes(2);
    const second = create.mock.calls[1]![0] as { messages: { role: string }[] };
    expect(second.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(recordSpend).toHaveBeenCalledTimes(2);
    expect(recordSpend).toHaveBeenNthCalledWith(1, expect.closeTo(1000 * 2e-6 + 0.01, 6), expect.any(String));
    expect(recordSpend).toHaveBeenNthCalledWith(2, expect.closeTo(500 * 2e-6 + 100e-6, 6), expect.any(String));
  });

  it("a turn that throws after a paid one: the paid turn is still recorded", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        stop_reason: "pause_turn",
        content: [{ type: "server_tool_use", name: "web_search" }],
        usage: { input_tokens: 1000, output_tokens: 0, server_tool_use: { web_search_requests: 1 } },
      })
      .mockRejectedValueOnce(new Error("overloaded"));
    const recordSpend = vi.fn();
    const ws = createWebSearch({ client: { messages: { create } } as never, model: "claude-sonnet-5-5", recordSpend });
    await expect(ws.search("q")).rejects.toThrow("overloaded");
    expect(recordSpend).toHaveBeenCalledTimes(1);
    expect(recordSpend).toHaveBeenCalledWith(expect.closeTo(1000 * 2e-6 + 0.01, 6), expect.stringContaining("websearch"));
  });
});
