import * as assert from "assert";
import { resolveModelContextLengths } from "../modelContext";
import type { LemonadeModel } from "../types";

suite("Lemonade model context resolution", () => {
	const model = (id: string, extra: Partial<LemonadeModel> = {}): LemonadeModel => ({
		id, object: "model", ...extra,
	});

	test("prefers effective context_length for configured and cloud models without extra requests", async () => {
		const result = await resolveModelContextLengths([
			model("configured", { recipe_options: { ctx_size: 32768 }, context_length: 24576 }),
			model("old", { recipe_options: { ctx_size: 64000 } }),
			model("cloud", { recipe: "cloud", context_length: 131072 }),
		], 128000, async () => { throw new Error("Unexpected extra request"); });

		assert.deepStrictEqual(result, [24576, 64000, 131072]);
	});

	test("uses loaded runtime context before resolving unloaded auto contexts", async () => {
		const requested: string[] = [];
		const result = await resolveModelContextLengths([
			model("running", { recipe_options: { ctx_size: -1 }, context_length: 262144 }),
			model("user/model one", { recipe_options: { ctx_size: -1 }, context_length: 262144 }),
			model("unset", { context_length: 65536 }),
		], 128000, async (path) => {
			requested.push(path);
			if (path === "/health") {
				return { all_models_loaded: [
					{ model_name: "running", recipe_options: { ctx_size: 32768 } },
				] };
			}
			if (path === "/models/user%2Fmodel%20one/options") { return { resolved_ctx_size: 8192 }; }
			if (path === "/models/unset/options") { return { resolved_ctx_size: 24576 }; }
			throw new Error(`Unexpected path ${path}`);
		});

		assert.deepStrictEqual(result, [32768, 8192, 24576]);
		assert.ok(requested.includes("/health"));
		assert.ok(!requested.includes("/models/running/options"));
	});

	test("failed or unavailable options retain the fallback without trusting a theoretical maximum", async () => {
		const result = await resolveModelContextLengths([
			model("auto", { recipe_options: { ctx_size: -1 }, context_length: 262144 }),
			model("limited", { context_length: 4096 }),
			model("legacy"),
		], 128000, async (path) => {
			if (path === "/health") { throw new Error("unavailable"); }
			if (path === "/models/auto/options") { return { resolved_ctx_size: -1 }; }
			throw new Error("404");
		});

		assert.deepStrictEqual(result, [128000, 4096, 128000]);
	});

	test("bounds concurrent auto-size probes", async () => {
		let inFlight = 0;
		let peak = 0;
		const models = Array.from({ length: 11 }, (_, n) => model(`m${n}`, { recipe_options: { ctx_size: -1 } }));
		const result = await resolveModelContextLengths(models, 128000, async (path) => {
			if (path === "/health") { return { all_models_loaded: [] }; }
			inFlight++;
			peak = Math.max(peak, inFlight);
			await Promise.resolve();
			inFlight--;
			return { resolved_ctx_size: 16384 };
		});
		assert.deepStrictEqual(result, models.map(() => 16384));
		assert.ok(peak <= 4, `unexpected parallel requests: ${peak}`);
		assert.ok(peak > 1);
	});
});
