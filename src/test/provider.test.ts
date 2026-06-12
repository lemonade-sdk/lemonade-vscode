import * as assert from "assert";
import * as vscode from "vscode";
import { LemonadeChatModelProvider } from "../provider";
import { convertMessages, convertTools, validateRequest, validateTools, tryParseJSONObject } from "../utils";
import type { LemonadeEndpoint } from "../types";

interface OpenAIToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}
interface ConvertedMessage {
	role: "user" | "assistant" | "tool";
	content?: string;
	name?: string;
	tool_calls?: OpenAIToolCall[];
	tool_call_id?: string;
}

suite("Lemonade Chat Provider Extension", () => {
	suite("provider", () => {
		test("prepareLanguageModelChatInformation returns array", async () => {
			const provider = new LemonadeChatModelProvider({
				get: async () => undefined,
				store: async () => {},
				delete: async () => {},
				onDidChange: (_listener: unknown) => ({ dispose() {} }),
			} as unknown as vscode.SecretStorage, "GitHubCopilotChat/test VSCode/test");

			const infos = await provider.prepareLanguageModelChatInformation(
				{ silent: true },
				new vscode.CancellationTokenSource().token
			);
			assert.ok(Array.isArray(infos));
		});

		test("provideTokenCount counts simple string", async () => {
			const provider = new LemonadeChatModelProvider({
				get: async () => undefined,
				store: async () => {},
				delete: async () => {},
				onDidChange: (_listener: unknown) => ({ dispose() {} }),
			} as unknown as vscode.SecretStorage, "GitHubCopilotChat/test VSCode/test");

			const est = await provider.provideTokenCount(
				{
					id: "m",
					name: "m",
					family: "lemonade",
					version: "1.0.0",
					maxInputTokens: 1000,
					maxOutputTokens: 1000,
					capabilities: {},
				} as unknown as vscode.LanguageModelChatInformation,
				"hello world",
				new vscode.CancellationTokenSource().token
			);
			assert.equal(typeof est, "number");
			assert.ok(est > 0);
		});

		test("provideTokenCount counts message parts", async () => {
			const provider = new LemonadeChatModelProvider({
				get: async () => undefined,
				store: async () => {},
				delete: async () => {},
				onDidChange: (_listener: unknown) => ({ dispose() {} }),
			} as unknown as vscode.SecretStorage, "GitHubCopilotChat/test VSCode/test");

			const msg: vscode.LanguageModelChatMessage = {
				role: vscode.LanguageModelChatMessageRole.User,
				content: [new vscode.LanguageModelTextPart("hello world")],
				name: undefined,
			};
			const est = await provider.provideTokenCount(
				{
					id: "m",
					name: "m",
					family: "lemonade",
					version: "1.0.0",
					maxInputTokens: 1000,
					maxOutputTokens: 1000,
					capabilities: {},
				} as unknown as vscode.LanguageModelChatInformation,
				msg,
				new vscode.CancellationTokenSource().token
			);
			assert.equal(typeof est, "number");
			assert.ok(est > 0);
		});

		test("provideLanguageModelChatResponse works without API key", async () => {
			const provider = new LemonadeChatModelProvider({
				get: async () => undefined,
				store: async () => {},
				delete: async () => {},
				onDidChange: (_listener: unknown) => ({ dispose() {} }),
			} as unknown as vscode.SecretStorage, "GitHubCopilotChat/test VSCode/test");

			// This should not throw since Lemonade doesn't require API keys
			// However, it will still fail due to no server running, which is expected
			let threw = false;
			try {
				await provider.provideLanguageModelChatResponse(
					{
						id: "m",
						name: "m",
						family: "lemonade",
						version: "1.0.0",
						maxInputTokens: 1000,
						maxOutputTokens: 1000,
						capabilities: {},
					} as unknown as vscode.LanguageModelChatInformation,
					[],
					{} as unknown as vscode.LanguageModelChatRequestHandleOptions,
					{ report: () => {} },
					new vscode.CancellationTokenSource().token
				);
			} catch (error) {
				// Should throw due to connection error, not missing API key
				threw = true;
				const errMsg = error instanceof Error ? error.message : String(error);
				assert.ok(!errMsg.includes("API key"), "Should not fail due to API key");
			}
			assert.ok(threw, "Should throw due to connection error");
		});

		// ------------------------------------------------------------------
		// Multi-endpoint tests
		// ------------------------------------------------------------------

		test("getEndpoints returns default when nothing stored", async () => {
			const provider = new LemonadeChatModelProvider({
				get: async () => undefined,
				store: async () => {},
				delete: async () => {},
				onDidChange: (_listener: unknown) => ({ dispose() {} }),
			} as unknown as vscode.SecretStorage, "test/test");

			const endpoints = await provider.getEndpoints();
			assert.ok(Array.isArray(endpoints) && endpoints.length === 1);
			assert.equal(endpoints[0].shortname, "default");
			assert.ok(endpoints[0].url.startsWith("http://localhost"));
		});

		test("getEndpoints migrates legacy serverUrl secret", async () => {
			const store: Record<string, string> = {
				"lemonade.serverUrl": "http://192.168.1.17:8000/api/v1",
				"lemonade.apiKey": "mykey",
			};
			const deleted: string[] = [];
			const provider = new LemonadeChatModelProvider({
				get: async (k: string) => store[k],
				store: async (k: string, v: string) => { store[k] = v; },
				delete: async (k: string) => { deleted.push(k); delete store[k]; },
				onDidChange: (_listener: unknown) => ({ dispose() {} }),
			} as unknown as vscode.SecretStorage, "test/test");

			const endpoints = await provider.getEndpoints();
			assert.equal(endpoints.length, 1);
			assert.equal(endpoints[0].shortname, "default");
			assert.equal(endpoints[0].url, "http://192.168.1.17:8000/api/v1");
			assert.equal(endpoints[0].apiKey, "mykey");
			// Legacy keys must be deleted after migration
			assert.ok(deleted.includes("lemonade.serverUrl"));
			assert.ok(deleted.includes("lemonade.apiKey"));
			// New key must be written
			assert.ok(store["lemonade.endpoints"]);
		});

		test("getEndpoints reads multiple stored endpoints", async () => {
			const endpoints: LemonadeEndpoint[] = [
				{ shortname: "node-17", url: "http://192.168.1.17:8000/api/v1" },
				{ shortname: "node-80", url: "http://192.168.1.80:8000/api/v1", apiKey: "secret" },
			];
			const provider = new LemonadeChatModelProvider({
				get: async (k: string) => k === "lemonade.endpoints" ? JSON.stringify(endpoints) : undefined,
				store: async () => {},
				delete: async () => {},
				onDidChange: (_listener: unknown) => ({ dispose() {} }),
			} as unknown as vscode.SecretStorage, "test/test");

			const result = await provider.getEndpoints();
			assert.equal(result.length, 2);
			assert.equal(result[0].shortname, "node-17");
			assert.equal(result[1].shortname, "node-80");
			assert.equal(result[1].apiKey, "secret");
		});

		test("prepareLanguageModelChatInformation prefixes model ids with shortname", async () => {
			const endpoints: LemonadeEndpoint[] = [
				{ shortname: "node-17", url: "http://192.168.1.17:8000/api/v1" },
			];
			// Mock fetch to return a single model
			const originalFetch = global.fetch;
			try {
				(global as unknown as Record<string, unknown>).fetch = async () => ({
					ok: true,
					json: async () => ({ object: "list", data: [{ id: "Llama-3.2-3B", object: "model" }] }),
				});

				const provider = new LemonadeChatModelProvider({
					get: async (k: string) => k === "lemonade.endpoints" ? JSON.stringify(endpoints) : undefined,
					store: async () => {},
					delete: async () => {},
					onDidChange: (_listener: unknown) => ({ dispose() {} }),
				} as unknown as vscode.SecretStorage, "test/test");

				const infos = await provider.prepareLanguageModelChatInformation(
					{ silent: true },
					new vscode.CancellationTokenSource().token
				);
				assert.equal(infos.length, 1);
				assert.equal(infos[0].id, "node-17/Llama-3.2-3B");
				assert.equal(infos[0].name, "node-17/Llama-3.2-3B");
			} finally {
				(global as unknown as Record<string, unknown>).fetch = originalFetch;
			}
		});
	});

	suite("utils/convertMessages", () => {
		test("maps user/assistant text", () => {
			const messages: vscode.LanguageModelChatMessage[] = [
				{
					role: vscode.LanguageModelChatMessageRole.User,
					content: [new vscode.LanguageModelTextPart("hi")],
					name: undefined,
				},
				{
					role: vscode.LanguageModelChatMessageRole.Assistant,
					content: [new vscode.LanguageModelTextPart("hello")],
					name: undefined,
				},
			];
			const out = convertMessages(messages) as ConvertedMessage[];
			assert.deepEqual(out, [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "hello" },
			]);
		});

		test("maps tool calls and results", () => {
			const toolCall = new vscode.LanguageModelToolCallPart("abc", "toolA", { foo: 1 });
			const toolResult = new vscode.LanguageModelToolResultPart("abc", [new vscode.LanguageModelTextPart("result")]);
			const messages: vscode.LanguageModelChatMessage[] = [
				{ role: vscode.LanguageModelChatMessageRole.Assistant, content: [toolCall], name: undefined },
				{ role: vscode.LanguageModelChatMessageRole.Assistant, content: [toolResult], name: undefined },
			];
			const out = convertMessages(messages) as ConvertedMessage[];
			const hasToolCalls = out.some((m: ConvertedMessage) => Array.isArray(m.tool_calls));
			const hasToolMsg = out.some((m: ConvertedMessage) => m.role === "tool");
			assert.ok(hasToolCalls && hasToolMsg);
		});

		test("handles mixed text + tool calls in one assistant message", () => {
			const toolCall = new vscode.LanguageModelToolCallPart("call1", "search", { q: "hello" });
			const msg: vscode.LanguageModelChatMessage = {
				role: vscode.LanguageModelChatMessageRole.Assistant,
				content: [
					new vscode.LanguageModelTextPart("before "),
					toolCall,
					new vscode.LanguageModelTextPart(" after"),
				],
				name: undefined,
			};
			const out = convertMessages([msg]) as ConvertedMessage[];
			assert.equal(out.length, 1);
			assert.equal(out[0].role, "assistant");
			assert.ok(out[0].content?.includes("before"));
			assert.ok(out[0].content?.includes("after"));
			assert.ok(Array.isArray(out[0].tool_calls) && out[0].tool_calls.length === 1);
			assert.equal(out[0].tool_calls?.[0].function.name, "search");
		});
	});

	suite("utils/tools", () => {
		test("convertTools returns function tool definitions", () => {
			const out = convertTools({
				tools: [
					{
						name: "do_something",
						description: "Does something",
						inputSchema: { type: "object", properties: { x: { type: "number" } }, additionalProperties: false },
					},
				],
			} satisfies vscode.LanguageModelChatRequestHandleOptions);

			assert.ok(out);
			assert.equal(out.tool_choice, "auto");
			assert.ok(Array.isArray(out.tools) && out.tools[0].type === "function");
			assert.equal(out.tools[0].function.name, "do_something");
		});

		test("convertTools respects ToolMode.Required for single tool", () => {
			const out = convertTools({
				toolMode: vscode.LanguageModelChatToolMode.Required,
				tools: [
					{
						name: "only_tool",
						description: "Only tool",
						inputSchema: {},
					},
				],
			} satisfies vscode.LanguageModelChatRequestHandleOptions);
			assert.deepEqual(out.tool_choice, { type: "function", function: { name: "only_tool" } });
		});

	test("validateTools rejects invalid names", () => {
		const badTools: vscode.LanguageModelChatTool[] = [
			{ name: "bad name!", description: "", inputSchema: {} },
		];
		assert.throws(() => validateTools(badTools));
	});
	});

	suite("utils/validation", () => {
		test("validateRequest enforces tool result pairing", () => {
			const callId = "xyz";
			const toolCall = new vscode.LanguageModelToolCallPart(callId, "toolA", { q: 1 });
			const toolRes = new vscode.LanguageModelToolResultPart(callId, [new vscode.LanguageModelTextPart("ok")]);
			const valid: vscode.LanguageModelChatMessage[] = [
				{ role: vscode.LanguageModelChatMessageRole.Assistant, content: [toolCall], name: undefined },
				{ role: vscode.LanguageModelChatMessageRole.User, content: [toolRes], name: undefined },
			];
			assert.doesNotThrow(() => validateRequest(valid));

			const invalid: vscode.LanguageModelChatMessage[] = [
				{ role: vscode.LanguageModelChatMessageRole.Assistant, content: [toolCall], name: undefined },
				{ role: vscode.LanguageModelChatMessageRole.User, content: [new vscode.LanguageModelTextPart("missing")], name: undefined },
			];
			assert.throws(() => validateRequest(invalid));
		});
	});

	suite("utils/json", () => {
		test("tryParseJSONObject handles valid and invalid JSON", () => {
			assert.deepEqual(tryParseJSONObject("{\"a\":1}"), { ok: true, value: { a: 1 } });
			assert.deepEqual(tryParseJSONObject("[1,2,3]"), { ok: false });
			assert.deepEqual(tryParseJSONObject("not json"), { ok: false });
		});
	});
});
