import * as assert from "assert";
import * as vscode from "vscode";
import { LemonadeChatModelProvider } from "../provider";
import { filterModels } from "../utils";
import type { LemonadeModel } from "../types";

const model = (id: string): LemonadeModel => ({ id, object: "model" });

suite("Model allow-list", () => {
	suite("filterModels", () => {
		const models = [model("a"), model("b"), model("c")];

		test("keeps all models when the allow-list is unset or empty", () => {
			assert.deepStrictEqual(filterModels(models, undefined), models);
			assert.deepStrictEqual(filterModels(models, []), models);
		});

		test("keeps only listed ids in server order and ignores unknown names", () => {
			assert.deepStrictEqual(filterModels(models, ["c", "missing", "a"]).map((m) => m.id), ["a", "c"]);
		});

		test("matches ids exactly", () => {
			assert.deepStrictEqual(filterModels(models, ["A", "a "]), []);
		});
	});

	suite("provider configuration", () => {
		let originalFetch: typeof fetch;
		let requested: string[];

		setup(() => {
			originalFetch = global.fetch;
			requested = [];
			(global as unknown as Record<string, unknown>).fetch = async (url: string) => {
				requested.push(url);
				return {
					ok: true,
					json: async () => url.endsWith("/models")
						? { object: "list", data: [model("a"), model("b"), model("c")] }
						: undefined,
				};
			};
		});

		teardown(() => {
			(global as unknown as Record<string, unknown>).fetch = originalFetch;
		});

		function newProvider() {
			return new LemonadeChatModelProvider({
				get: async () => undefined,
				store: async () => {},
				delete: async () => {},
				onDidChange: (_listener: unknown) => ({ dispose() {} }),
			} as unknown as vscode.SecretStorage, "test/test");
		}

		async function listIds(configuration: Record<string, unknown>): Promise<string[]> {
			const infos = await newProvider().prepareLanguageModelChatInformation(
				{ silent: true, group: "node", configuration },
				new vscode.CancellationTokenSource().token
			);
			return infos.map((info) => info.id);
		}

		test("shows only configured models", async () => {
			const ids = await listIds({ url: "http://localhost:13305/api/v1", models: ["b", 7, " c ", ""] });
			assert.deepStrictEqual(ids, ["b", "c"]);
		});

		test("shows every model when none are configured", async () => {
			assert.deepStrictEqual(await listIds({ url: "http://localhost:13305/api/v1" }), ["a", "b", "c"]);
			assert.deepStrictEqual(await listIds({ url: "http://localhost:13305/api/v1", models: [] }), ["a", "b", "c"]);
		});

		test("does not resolve context for hidden models", async () => {
			await listIds({ url: "http://localhost:13305/api/v1", models: ["b"] });
			assert.ok(!requested.some((url) => url.includes("/models/a/") || url.includes("/models/c/")));
		});
	});
});
