import * as vscode from "vscode";
import {
	CancellationToken,
	LanguageModelChatInformation,
	LanguageModelChatMessage,
	LanguageModelChatProvider,
	LanguageModelChatRequestHandleOptions,
	LanguageModelResponsePart,
	Progress,
} from "vscode";

import { convertTools, convertMessages, filterModels, validateRequest } from "./utils";
import { ChatStreamParser } from "./streamParser";
import type { LemonadeEndpoint, LemonadeModel, LemonadeModelsResponse } from "./types";
import { resolveModelContextLengths } from "./modelContext";

const DEFAULT_BASE_URL = "http://localhost:13305/api/v1";
const DEFAULT_MAX_OUTPUT_TOKENS = 16000;
const DEFAULT_CONTEXT_LENGTH = 128000;
const DEFAULT_API_KEY = "lemonade";
const ENDPOINTS_SECRET_KEY = "lemonade.endpoints";

const REASONING_LEVEL_LABELS: Record<string, string> = {
	none: "None",
	low: "Low",
	medium: "Medium",
	high: "High",
};

/**
 * Resolve supported reasoning effort levels for a model. The `lemonade.reasoningEfforts`
 * setting maps a case-insensitive substring of the model id to its levels; "*" is the
 * fallback and only applies to models labelled "reasoning". An empty list disables the picker.
 */
function resolveReasoningLevels(modelId: string, labels: string[] | undefined): string[] | undefined {
	const map = vscode.workspace.getConfiguration("lemonade").get<Record<string, string[]>>("reasoningEfforts") ?? {};
	const id = modelId.toLowerCase();
	const key = Object.keys(map).find((k) => k !== "*" && id.includes(k.toLowerCase()));
	const levels = key !== undefined ? map[key] : labels?.includes("reasoning") ? map["*"] : undefined;
	return Array.isArray(levels) && levels.length > 0 ? levels : undefined;
}

function buildConfigurationSchema(levels: string[]) {
	return {
		properties: {
			reasoningEffort: {
				type: "string",
				title: "Reasoning",
				description: "Reasoning effort sent to the Lemonade server as reasoning_effort.",
				enum: levels,
				enumItemLabels: levels.map((l) => REASONING_LEVEL_LABELS[l] ?? l),
				default: levels.includes("medium") ? "medium" : levels[0],
				group: "navigation",
			},
		},
	};
}

/**
 * Resolve the context length to use. Reads LEMONADE_CTX_SIZE from the
 * environment; falls back to DEFAULT_CONTEXT_LENGTH when the variable is
 * absent or not a positive integer.
 */
function resolveContextLength(): number {
	const raw = process.env["LEMONADE_CTX_SIZE"];
	if (raw) {
		const parsed = parseInt(raw, 10);
		if (Number.isFinite(parsed) && parsed > 0) {
			return parsed;
		}
	}
	return DEFAULT_CONTEXT_LENGTH;
}

/**
 * VS Code Chat provider backed by Lemonade local LLM server.
 */
export class LemonadeChatModelProvider implements LanguageModelChatProvider {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

	/** Ask VS Code to re-query the model list (e.g. after settings change). */
	refresh(): void {
		this._onDidChange.fire();
	}

	private _chatEndpoints: { model: string; modelMaxPromptTokens: number }[] = [];
	/** Endpoint each model info object was built from; chat receives the same object back. */
	private _endpointByModel = new WeakMap<LanguageModelChatInformation, { endpoint: LemonadeEndpoint; modelId: string }>();
	/**
	 * Create a provider using the given secret storage for the server URL.
	 * @param secrets VS Code secret storage.
	 */
	constructor(private readonly secrets: vscode.SecretStorage, private readonly userAgent: string) {}

	/** Roughly estimate tokens for VS Code chat messages (text only) */
	private estimateMessagesTokens(msgs: readonly vscode.LanguageModelChatMessage[]): number {
		let total = 0;
		for (const m of msgs) {
			for (const part of m.content) {
				if (part instanceof vscode.LanguageModelTextPart) {
					total += Math.ceil(part.value.length / 4);
				}
			}
		}
		return total;
	}

	/** Rough token estimate for tool definitions by JSON size */
	private estimateToolTokens(tools: { type: string; function: { name: string; description?: string; parameters?: object } }[] | undefined): number {
		if (!tools || tools.length === 0) { return 0; }
		try {
			const json = JSON.stringify(tools);
			return Math.ceil(json.length / 4);
		} catch {
			return 0;
		}
	}

	/**
	 * Get the list of available language models contributed by this provider.
	 * Fans out to all configured endpoints concurrently; failures on individual
	 * endpoints are swallowed so healthy nodes still appear.
	 */
	async prepareLanguageModelChatInformation(
		options: { silent: boolean; group?: string; configuration?: { readonly [key: string]: unknown } },
		_token: CancellationToken
	): Promise<LanguageModelChatInformation[]> {
		const groupEndpoint = this.endpointFromConfiguration(options.group, options.configuration);
		const endpoints = groupEndpoint ? [groupEndpoint] : await this.getEndpoints({ includeDefault: false });
		const fallbackContextLength = resolveContextLength();

		// Fetch models from all endpoints concurrently; ignore per-endpoint errors
		const results = await Promise.all(
			endpoints.map(async (ep) => {
				try {
					const models = filterModels(await this.fetchModels(ep), ep.models);
					const contextSignal = AbortSignal.timeout(2500);
					const contextLengths = await resolveModelContextLengths(
						models, fallbackContextLength, async (path) => {
							const response = await fetch(`${ep.url}${path}`, {
								method: "GET",
								headers: {
									Authorization: `Bearer ${ep.apiKey || DEFAULT_API_KEY}`,
									"User-Agent": this.userAgent,
								},
								signal: contextSignal,
							});
							return response.ok ? response.json() : undefined;
						}
					);
					return { ep, models, contextLengths };
				} catch {
					return { ep, models: [] as LemonadeModel[], contextLengths: [] as number[] };
				}
			})
		);

		const infos: LanguageModelChatInformation[] = [];
		for (const { ep, models, contextLengths } of results) {
			for (const [index, model] of models.entries()) {
				// Group-configured endpoints are resolved via _endpointByModel, so the raw id is used.
				const id = groupEndpoint ? model.id : `${ep.shortname}/${model.id}`;
				const contextLength = contextLengths[index];
				// Preserve a usable input budget even when auto-tuning selects a small context.
				const maxOutput = Math.min(DEFAULT_MAX_OUTPUT_TOKENS, Math.max(1, Math.floor(contextLength / 2)));
				const maxInput = Math.max(1, contextLength - maxOutput);
				const levels = resolveReasoningLevels(model.id, model.labels);
				const info = {
					id,
					// Only disambiguate with the endpoint name when several endpoints are listed together.
					name: results.length > 1 ? id : model.id,
					tooltip: `Lemonade node: ${ep.url}`,
					family: "lemonade",
					version: "1.0.0",
					maxInputTokens: maxInput,
					maxOutputTokens: maxOutput,
					capabilities: {
						toolCalling: true,
						imageInput: false,
					},
					// Proposed API (chatProvider): renders a reasoning picker in the model menu.
					...(levels ? { configurationSchema: buildConfigurationSchema(levels) } : {}),
				} satisfies LanguageModelChatInformation;
				this._endpointByModel.set(info, { endpoint: ep, modelId: model.id });
				infos.push(info);
			}
		}

		if (infos.length === 0 && !options.silent) {
			vscode.window.showWarningMessage(
				"No models available from any Lemonade endpoint. Make sure at least one server is running. You can download it from lemonade-server.ai."
			);
		}

		this._chatEndpoints = infos.map((info) => ({
			model: info.id,
			modelMaxPromptTokens: info.maxInputTokens + info.maxOutputTokens,
		}));

		return infos;
	}

	async provideLanguageModelChatInformation(
		options: { silent: boolean; group?: string; configuration?: { readonly [key: string]: unknown } },
		_token: CancellationToken
	): Promise<LanguageModelChatInformation[]> {
		return this.prepareLanguageModelChatInformation({ ...options, silent: options.silent ?? false }, _token);
	}

	/** Build an endpoint from a provider group's configuration (declared in package.json). */
	private endpointFromConfiguration(
		group: string | undefined,
		configuration: { readonly [key: string]: unknown } | undefined
	): LemonadeEndpoint | undefined {
		const url = typeof configuration?.url === "string" ? configuration.url.trim().replace(/\/+$/, "") : "";
		if (!url) { return undefined; }
		const apiKey = typeof configuration?.apiKey === "string" ? configuration.apiKey.trim() : "";
		const models = Array.isArray(configuration?.models)
			? configuration.models.filter((m): m is string => typeof m === "string" && m.trim().length > 0).map((m) => m.trim())
			: [];
		return {
			shortname: group ?? "default",
			url,
			...(apiKey ? { apiKey } : {}),
			...(models.length > 0 ? { models } : {}),
		};
	}

	/**
	 * Return the list of configured endpoints. Falls back to a single default
	 * endpoint when nothing has been configured yet, and migrates legacy
	 * single-URL secrets on first access.
	 */
	async getEndpoints(options: { includeDefault?: boolean } = {}): Promise<LemonadeEndpoint[]> {
		const includeDefault = options.includeDefault ?? true;
		// Migration: promote legacy single-URL secrets to the new format
		const legacyUrl = await this.secrets.get("lemonade.serverUrl");
		if (legacyUrl) {
			const legacyKey = await this.secrets.get("lemonade.apiKey");
			const migrated: LemonadeEndpoint[] = [{
				shortname: "default",
				url: legacyUrl,
				...(legacyKey ? { apiKey: legacyKey } : {}),
			}];
			await this.secrets.store(ENDPOINTS_SECRET_KEY, JSON.stringify(migrated));
			await this.secrets.delete("lemonade.serverUrl");
			await this.secrets.delete("lemonade.apiKey");
			return migrated;
		}

		const stored = await this.secrets.get(ENDPOINTS_SECRET_KEY);
		if (stored) {
			try {
				const parsed = JSON.parse(stored) as LemonadeEndpoint[];
				if (Array.isArray(parsed) && parsed.length > 0) {
					return parsed;
				}
			} catch {
				// fall through to default
			}
		}

		// Listing skips the built-in default: it would duplicate a localhost server added through the form
		if (!includeDefault) { return []; }
		return [{ shortname: "default", url: DEFAULT_BASE_URL }];
	}

	/**
	 * Fetch the list of available models from the Lemonade server.
	 */
	private async fetchModels(endpoint: LemonadeEndpoint): Promise<LemonadeModel[]> {
		const apiKey = endpoint.apiKey || DEFAULT_API_KEY;

		const response = await fetch(`${endpoint.url}/models`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"User-Agent": this.userAgent,
			},
		});

		if (!response.ok) {
			throw new Error(`[Lemonade] Failed to fetch models from ${endpoint.shortname}: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as LemonadeModelsResponse;
		return data.data || [];
	}

	/**
	 * Returns the response for a chat request, passing the results to the progress callback.
	 * The {@linkcode LanguageModelChatProvider} must emit the response parts to the progress callback as they are received from the language model.
	 * @param model The language model to use
	 * @param messages The messages to include in the request
	 * @param options Options for the request
	 * @param progress The progress to emit the streamed response chunks to
	 * @param token A cancellation token for the request
	 * @returns A promise that resolves when the response is complete. Results are actually passed to the progress callback.
	 */
	async provideLanguageModelChatResponse(
		model: LanguageModelChatInformation,
		messages: readonly LanguageModelChatMessage[],
		options: LanguageModelChatRequestHandleOptions,
		progress: Progress<LanguageModelResponsePart>,
		token: CancellationToken
	): Promise<void> {
		if (token.isCancellationRequested) {
			return;
		}

		const abortController = new AbortController();
		const cancellation = token.onCancellationRequested(() => abortController.abort());
		let requestBody: Record<string, unknown> | undefined;
		const trackingProgress: Progress<LanguageModelResponsePart> = {
			report: (part) => {
				if (token.isCancellationRequested) {
					return;
				}
				try {
					progress.report(part);
				} catch (e) {
					console.error("[Lemonade Model Provider] Progress.report failed", {
						modelId: model.id,
						error: e instanceof Error ? { name: e.name, message: e.message } : String(e),
					});
				}
			},
		};
		try {
			const mapped = this._endpointByModel.get(model);
			// Fall back to decoding "<shortname>/<modelId>" when the info object is unknown
			const slashIdx = mapped ? -1 : model.id.indexOf("/");
			const shortname = slashIdx >= 0 ? model.id.slice(0, slashIdx) : "default";
			const realModelId = mapped?.modelId ?? (slashIdx >= 0 ? model.id.slice(slashIdx + 1) : model.id);

			const endpoints = await this.getEndpoints();
			const endpoint = mapped?.endpoint
				?? endpoints.find(ep => ep.shortname === shortname)
				?? endpoints[0]
				?? { shortname: "default", url: DEFAULT_BASE_URL };

			const baseUrl = endpoint.url;
			const apiKey = endpoint.apiKey || DEFAULT_API_KEY;

			// Check if ephemeral data filtering is enabled (default: true)
			const filterEphemeralSetting = await this.secrets.get("lemonade.filterEphemeralData");
			const filterEphemeral = filterEphemeralSetting !== "false";

            const openaiMessages = convertMessages(messages, filterEphemeral);

			validateRequest(messages);

            const toolConfig = convertTools(options);

        if (options.tools && options.tools.length > 128) {
            throw new Error("Cannot have more than 128 tools per request.");
        }

            const inputTokenCount = this.estimateMessagesTokens(messages);
            const toolTokenCount = this.estimateToolTokens(toolConfig.tools);
            const tokenLimit = Math.max(1, model.maxInputTokens);
            if (inputTokenCount + toolTokenCount > tokenLimit) {
                console.error("[Lemonade Provider] Message exceeds token limit", { total: inputTokenCount + toolTokenCount, tokenLimit });
                throw new Error("Message exceeds token limit.");
            }

            requestBody = {
                model: realModelId,
                messages: openaiMessages,
                stream: true,
                max_tokens: Math.min(options.modelOptions?.max_tokens || 4096, model.maxOutputTokens),
                temperature: options.modelOptions?.temperature ?? 0.7,
            };

			// Allow-list model options
			if (options.modelOptions) {
				const mo = options.modelOptions as Record<string, unknown>;
				if (typeof mo.stop === "string" || Array.isArray(mo.stop)) {
					(requestBody as Record<string, unknown>).stop = mo.stop;
				}
				if (typeof mo.frequency_penalty === "number") {
					(requestBody as Record<string, unknown>).frequency_penalty = mo.frequency_penalty;
				}
				if (typeof mo.presence_penalty === "number") {
					(requestBody as Record<string, unknown>).presence_penalty = mo.presence_penalty;
				}
			}

			const modelConfiguration = (options as { modelConfiguration?: Record<string, unknown> }).modelConfiguration;
			const pickerEffort = modelConfiguration?.reasoningEffort;
			const settingEffort = vscode.workspace.getConfiguration("lemonade").get<string>("reasoningEffort");
			const effort = typeof pickerEffort === "string" && pickerEffort ? pickerEffort : settingEffort;
			if (typeof effort === "string" && effort) {
				(requestBody as Record<string, unknown>).reasoning_effort = effort;
				// Per-request kwargs take precedence over server-level --chat-template-kwargs.
				(requestBody as Record<string, unknown>).chat_template_kwargs = { reasoning_effort: effort };
			}

			if (toolConfig.tools) {
				(requestBody as Record<string, unknown>).tools = toolConfig.tools;
			}
			if (toolConfig.tool_choice) {
				(requestBody as Record<string, unknown>).tool_choice = toolConfig.tool_choice;
			}
			if (token.isCancellationRequested) {
				return;
			}
			const response = await fetch(`${baseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
					"User-Agent": this.userAgent,
                },
                body: JSON.stringify(requestBody),
				signal: abortController.signal,
            });

			if (!response.ok) {
				const errorText = await response.text();
				console.error("[Lemonade Model Provider] API error response", errorText);
				throw new Error(
					`Lemonade API error: ${response.status} ${response.statusText}${errorText ? `\n${errorText}` : ""}`
				);
			}

			if (!response.body) {
				throw new Error("No response body from Lemonade API");
			}
			await new ChatStreamParser().processStreamingResponse(response.body, trackingProgress, token);
		} catch (err) {
			if (token.isCancellationRequested && abortController.signal.aborted) {
				return;
			}
			console.error("[Lemonade Model Provider] Chat request failed", {
				modelId: model.id,
				messageCount: messages.length,
				error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
			});
			throw err;
		} finally {
			cancellation.dispose();
			// Also close an unread response body if processing ended early.
			abortController.abort();
		}
	}

	/**
	 * Returns the number of tokens for a given text using the model specific tokenizer logic
	 * @param model The language model to use
	 * @param text The text to count tokens for
	 * @param token A cancellation token for the request
	 * @returns A promise that resolves to the number of tokens
	 */
	async provideTokenCount(
		model: LanguageModelChatInformation,
		text: string | LanguageModelChatMessage,
		_token: CancellationToken
	): Promise<number> {
		if (typeof text === "string") {
			return Math.ceil(text.length / 4);
		} else {
			let totalTokens = 0;
			for (const part of text.content) {
				if (part instanceof vscode.LanguageModelTextPart) {
					totalTokens += Math.ceil(part.value.length / 4);
				}
			}
			return totalTokens;
		}
	}

	/** Strip provider control tokens like <|tool_calls_section_begin|> and <|tool_call_begin|> from streamed text. */
	private stripControlTokens(text: string): string {
		try {
			// Remove section markers and explicit tool call begin/argument/end markers that some backends stream as text
			return text
				.replace(/<\|[a-zA-Z0-9_-]+_section_(?:begin|end)\|>/g, "")
				.replace(/<\|tool_call_(?:argument_)?(?:begin|end)\|>/g, "");
		} catch {
			return text;
		}
	}
}