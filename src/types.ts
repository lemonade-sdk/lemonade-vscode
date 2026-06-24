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
 * OpenAI-style chat message used for Lemonade server requests.
 */
export interface OpenAIChatMessage {
	role: OpenAIChatRole;
	content?: string;
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
}

/**
 * Model entry from the /models endpoint
 */
export interface LemonadeModel {
	id: string;
	object: string;
	created?: number;
	owned_by?: string;
	recipe_options?: {
		ctx_size?: number;
	};
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
