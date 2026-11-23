import type { LemonadeModel } from "./types";

const MAX_CONCURRENT_LOOKUPS = 4;

function positiveContextLength(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0
		? value
		: undefined;
}

/**
 * Resolve the context budget VS Code should advertise for each model.
 * /models.context_length describes the loaded context or a configured context,
 * but for unloaded auto-tuned models it can be only the model's theoretical max.
 * When auto-size resolution fails, caps the reported length at the unresolved limit.
 * If nothing is known about a model's context size, zero is returned.
 */
export async function resolveModelContextLengths(
	models: readonly LemonadeModel[],
	maxUnresolvedContextLength: number,
	fetchJson: (path: string) => Promise<unknown>
): Promise<number[]> {
	const needsResolution = (model: LemonadeModel) =>
		model.recipe !== "cloud" && !positiveContextLength(model.recipe_options?.ctx_size);

	if (!models.some(needsResolution)) {
		return models.map((model) =>
			positiveContextLength(model.context_length) ??
			positiveContextLength(model.recipe_options?.ctx_size) ?? 0
		);
	}

	// One health request per endpoint: a running model's actual context takes
	// precedence over what auto-tuning would choose for a *new* load.
	const loadedContexts = new Map<string, number>();
	try {
		const health = await fetchJson("/health") as {
			all_models_loaded?: { model_name?: string; recipe_options?: { ctx_size?: number } }[];
		};
		if (Array.isArray(health?.all_models_loaded)) {
			for (const loaded of health.all_models_loaded) {
				const context = positiveContextLength(loaded?.recipe_options?.ctx_size);
				if (typeof loaded?.model_name === "string" && context !== undefined) {
					loadedContexts.set(loaded.model_name, context);
				}
			}
		}
	} catch {
		// Older servers or an unavailable health endpoint: keep the models visible.
	}

	// Only ask for effective options on unloaded auto/unset-context models.
	// Bound concurrency because each resolution can probe available GPU memory.
	const unresolved = models.filter((model) => needsResolution(model) && !loadedContexts.has(model.id));
	const resolvedContexts = new Map<string, number>();
	for (let i = 0; i < unresolved.length; i += MAX_CONCURRENT_LOOKUPS) {
		await Promise.all(unresolved.slice(i, i + MAX_CONCURRENT_LOOKUPS).map(async (model) => {
			try {
				const options = await fetchJson(`/models/${encodeURIComponent(model.id)}/options`) as {
					resolved_ctx_size?: number;
				};
				const context = positiveContextLength(options?.resolved_ctx_size);
				if (context !== undefined) {
					resolvedContexts.set(model.id, context);
				}
			} catch {
				// A failure for one model must not hide the other models.
			}
		}));
	}

	return models.map((model) => {
		const reported = positiveContextLength(model.context_length);
		const configured = positiveContextLength(model.recipe_options?.ctx_size);
		if (!needsResolution(model)) {
			return reported ?? configured ?? 0;
		}
		// Loaded runtime context and a successfully resolved auto-size are authoritative.
		const resolved = loadedContexts.get(model.id) ?? resolvedContexts.get(model.id);
		if (resolved !== undefined) {
			return resolved;
		}
		// Older servers may report a theoretical maximum for unresolved auto-sized models.
		return Math.min(reported ?? maxUnresolvedContextLength, maxUnresolvedContextLength);
	});
}
