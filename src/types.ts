/**
 * OpenAI function-call entry emitted by assistant messages.
 */
export interface OpenAIToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

/**
 * OpenAI function tool definition used to advertise tools.
 */
export interface OpenAIFunctionToolDef {
	type: "function";
	function: { name: string; description?: string; parameters?: object };
}

/**
 * OpenAI text content part for multimodal chat messages.
 */
export interface OpenAITextContentPart {
	type: "text";
	text: string;
}

/**
 * OpenAI image content part for multimodal chat messages.
 */
export interface OpenAIImageContentPart {
	type: "image_url";
	image_url: {
		url: string;
		detail?: "auto" | "low" | "high";
	};
}

/**
 * Supported message content part types in OpenAI-compatible multimodal requests.
 */
export type OpenAIMessageContentPart = OpenAITextContentPart | OpenAIImageContentPart;

/**
 * OpenAI-style chat message used for Lemonade server requests.
 */
export interface OpenAIChatMessage {
	role: OpenAIChatRole;
	content?: string | OpenAIMessageContentPart[];
	name?: string;
	tool_calls?: OpenAIToolCall[];
	tool_call_id?: string;
}

/**
 * Buffer used to accumulate streamed tool call parts until arguments are valid JSON.
 */
export interface ToolCallBuffer {
	id?: string;
	name?: string;
	args: string;
}

/**
 * A configured Lemonade server endpoint with an optional shortname.
 */
export interface LemonadeEndpoint {
	shortname: string;  // e.g. "node-17"
	url: string;        // e.g. "http://192.168.1.17:8000/api/v1"
	apiKey?: string;    // per-endpoint key; falls back to DEFAULT_API_KEY when absent
	models?: string[];  // optional allow-list of server model ids; all models when absent or empty
}

/**
 * Model entry from the /models endpoint
 */
export interface LemonadeModel {
	id: string;
	object: string;
	created?: number;
	owned_by?: string;
	recipe?: string;
	context_length?: number;
	recipe_options?: {
		ctx_size?: number;
	};
	labels?: string[];
	mmproj?: string;
	modalities?: string[];
	capabilities?: Record<string, unknown>;
	vision?: boolean;
	imageInput?: boolean;
	checkpoints?: { mmproj?: string };
}

/**
 * Response from the /models endpoint
 */
export interface LemonadeModelsResponse {
	object: string;
	data: LemonadeModel[];
}

/** OpenAI-style chat roles. */
export type OpenAIChatRole = "system" | "user" | "assistant" | "tool";
