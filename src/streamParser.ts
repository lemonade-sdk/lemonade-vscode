import * as vscode from "vscode";
import { tryParseJSONObject } from "./utils";

/**
 * Parses one streamed chat completion into VS Code response parts.
 * Holds per-request state, so create a new instance for each request.
 */
export class ChatStreamParser {
	/** Buffer for assembling streamed tool calls by index. */
	private _toolCallBuffers: Map<number, { id?: string; name?: string; args: string }> = new Map<
		number,
		{ id?: string; name?: string; args: string }
	>();

	/** Indices for which a tool call has been fully emitted. */
	private _completedToolCallIndices = new Set<number>();

	/** Track if we emitted any assistant text before seeing tool calls (SSE-like begin-tool-calls hint). */
	private _hasEmittedAssistantText = false;

	/** Track if we emitted the begin-tool-calls whitespace flush. */
	private _emittedBeginToolCallsHint = false;

	// Lightweight tokenizer state for tool calls embedded in text
	private _textToolParserBuffer = "";
	private _textToolActive:
		| undefined
		| {
			name?: string;
			index?: number;
			argBuffer: string;
			emitted?: boolean;
		};
	private _emittedTextToolCallKeys = new Set<string>();
	private _emittedTextToolCallIds = new Set<string>();

	/** Buffer for handling control tokens that might be split across streaming chunks. */
	private _controlTokenBuffer = "";

	/**
	 * Token usage captured from the stream (typically the final chunk before
	 * [DONE], which carries `usage` and empty choices). Empty when the server
	 * did not report usage.
	 */
	readonly usage: Record<string, unknown> = {};

	/**
	 * Read and parse the Lemonade server streaming (SSE-like) response and report parts.
	 * @param responseBody The readable stream body.
	 * @param progress Progress reporter for streamed parts.
	 * @param token Cancellation token.
	 */
    async processStreamingResponse(
        responseBody: ReadableStream<Uint8Array>,
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
        token: vscode.CancellationToken,
    ): Promise<void> {
        const reader = responseBody.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

		try {
			while (!token.isCancellationRequested) {
				const { done, value } = await reader.read();
                if (done || token.isCancellationRequested) { break; }

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					if (token.isCancellationRequested) { break; }
					if (!line.startsWith("data: ")) {
						continue;
					}
					const data = line.slice(6);
                    if (data === "[DONE]") {
                        // Do not throw on [DONE]; any incomplete/empty buffers are ignored.
                        await this.flushToolCallBuffers(progress, /*throwOnInvalid*/ false);
                        // Flush any in-progress text-embedded tool call (silent if incomplete)
                        await this.flushActiveTextToolCall(progress);
                        continue;
                    }

					try {
						const parsed = JSON.parse(data);
                        await this.processDelta(parsed, progress);
                    } catch {
                        // Silently ignore malformed SSE lines temporarily
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

	/**
	 * Handle a single streamed delta chunk, emitting text and tool call parts.
	 * @param delta Parsed SSE chunk from the Router.
	 * @param progress Progress reporter for parts.
	 */
    private async processDelta(
        delta: Record<string, unknown>,
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    ): Promise<boolean> {
        let emitted = false;
        // Extract usage data from the response chunk (typically in the last chunk
        // before [DONE], which carries `usage` with an empty `choices` array).
        const usage = (delta.usage as Record<string, unknown> | undefined);
        if (usage && typeof usage === "object") {
            Object.assign(this.usage, usage);
        }
        const choice = (delta.choices as Record<string, unknown>[] | undefined)?.[0];
        if (!choice) { return false; }

		const deltaObj = choice.delta as Record<string, unknown> | undefined;

		// report thinking progress if backend provides it and host supports it
		// llama.cpp streams reasoning as `reasoning_content` rather than `thinking`
		try {
			const maybeThinking = (choice as Record<string, unknown> | undefined)?.thinking
				?? (deltaObj as Record<string, unknown> | undefined)?.thinking
				?? (deltaObj as Record<string, unknown> | undefined)?.reasoning_content;
			if (maybeThinking !== undefined) {
				const vsAny = (vscode as unknown as Record<string, unknown>);
				const ThinkingCtor = vsAny["LanguageModelThinkingPart"] as
					| (new (text: string, id?: string, metadata?: unknown) => unknown)
					| undefined;
                    if (ThinkingCtor) {
                        let text = "";
                        let id: string | undefined;
                        let metadata: unknown;
                        if (maybeThinking && typeof maybeThinking === "object") {
                            const mt = maybeThinking as Record<string, unknown>;
                            text = typeof mt["text"] === "string" ? (mt["text"] as string) : "";
                            id = typeof mt["id"] === "string" ? (mt["id"] as string) : undefined;
                            metadata = mt["metadata"];
                        } else if (typeof maybeThinking === "string") {
                            text = maybeThinking;
                        }
                        if (text) {
                            progress.report(new (ThinkingCtor as new (text: string, id?: string, metadata?: unknown) => unknown)(text, id, metadata) as unknown as vscode.LanguageModelResponsePart);
                            emitted = true;
                        }
                    }
                }
            } catch {
                // ignore errors here temporarily
            }
            if (deltaObj?.content) {
                const content = String(deltaObj.content);
                const res = this.processTextContent(content, progress);
                if (res.emittedText) {
                    this._hasEmittedAssistantText = true;
                }
                if (res.emittedAny) {
                    emitted = true;
                }
            }

			if (deltaObj?.tool_calls) {
                const toolCalls = deltaObj.tool_calls as Array<Record<string, unknown>>;

				// SSEProcessor-like: if first tool call appears after text, emit a whitespace
				// to ensure any UI buffers/linkifiers are flushed without adding visible noise.
				if (!this._emittedBeginToolCallsHint && this._hasEmittedAssistantText && toolCalls.length > 0) {
					progress.report(new vscode.LanguageModelTextPart(" "));
					this._emittedBeginToolCallsHint = true;
				}

				for (const tc of toolCalls) {
					const idx = (tc.index as number) ?? 0;
					// Ignore any further deltas for an index we've already completed
					if (this._completedToolCallIndices.has(idx)) {
						continue;
					}
					const buf = this._toolCallBuffers.get(idx) ?? { args: "" };
					if (tc.id && typeof tc.id === "string") {
						buf.id = tc.id as string;
					}
					const func = tc.function as Record<string, unknown> | undefined;
					if (func?.name && typeof func.name === "string") {
						buf.name = func.name as string;
					}
					if (typeof func?.arguments === "string") {
						buf.args += func.arguments as string;
					}
					this._toolCallBuffers.set(idx, buf);

					// Emit immediately once arguments become valid JSON to avoid perceived hanging
                    await this.tryEmitBufferedToolCall(idx, progress);
                }
            }

        const finish = (choice.finish_reason as string | undefined) ?? undefined;
        if (finish === "tool_calls" || finish === "stop") {
            // On both 'tool_calls' and 'stop', emit any buffered calls and throw on invalid JSON
            await this.flushToolCallBuffers(progress, /*throwOnInvalid*/ true);
        }
        return emitted;
    }

	/**
	 * Strip control tokens with buffering to handle tokens split across chunks.
	 * This handles older-style control tokens like <tool_call> and <function=...
	 */
	private stripControlTokensWithBuffering(text: string): string {
		const data = this._controlTokenBuffer + text;
		let result = "";
		let pos = 0;

		while (pos < data.length) {
			let foundMatch = false;

			// Check for complete control token patterns
			const controlPatterns = [
				/<tool_call>/g,
				/<\/function>/g,
				/<\|tool_calls_section_(?:begin|end)\|>/g,
				/<\|tool_call_(?:argument_)?(?:begin|end)\|>/g,
				/<function=[a-zA-Z0-9_\-.]+>/g  // Match complete function tags
			];

			// Try to match any control pattern at current position
			for (const pattern of controlPatterns) {
				pattern.lastIndex = 0; // Reset regex state
				const remaining = data.slice(pos);
				const match = pattern.exec(remaining);

				if (match && match.index === 0) {
					// Found a complete token at current position, skip it
					pos += match[0].length;
					foundMatch = true;
					break;
				}
			}

			if (!foundMatch) {
				// Check for potential incomplete control tokens near end of chunk
				let isPartialToken = false;
				if (pos >= data.length - 50) { // Check last 50 chars for partial tokens
					const remaining = data.slice(pos);

					// Check for partial patterns that could complete in next chunk
					const partialPatterns = [
						/^<tool_cal?$/,
						/^<tool_call?$/,
						/^<\|tool_calls?$/,
						/^<\|tool_calls_section?$/,
						/^<\|tool_calls_section_(?:begin|end)?$/,
						/^<\|tool_call?$/,
						/^<\|tool_call_(?:argument_)?$/,
						/^<\|tool_call_(?:argument_)?(?:begin|end)?$/,
						/^<function?$/,
						/^<function=?$/,
						/^<function=[a-zA-Z0-9_\-.]*$/,  // Partial function name
						/^<\/function?$/
					];

					for (const pattern of partialPatterns) {
						if (pattern.test(remaining)) {
							isPartialToken = true;
							break;
						}
					}
				}

				if (isPartialToken) {
					// Keep remaining text in buffer for next chunk
					this._controlTokenBuffer = data.slice(pos);
					break;
				} else {
					// Safe to emit this character
					result += data[pos];
					pos++;
				}
			}
		}

		// If we consumed everything, clear the buffer
		if (pos >= data.length) {
			this._controlTokenBuffer = "";
		}

		return result;
	}

    /**
     * Process streamed text content for inline tool-call control tokens and emit text/tool calls.
     * Returns which parts were emitted for logging/flow control.
     */
    private processTextContent(
        input: string,
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    ): { emittedText: boolean; emittedAny: boolean } {
        const BEGIN = "<|tool_call_begin|>";
        const ARG_BEGIN = "<|tool_call_argument_begin|>";
        const END = "<|tool_call_end|>";

        let data = this._textToolParserBuffer + input;
        let emittedText = false;
        let emittedAny = false;
        let visibleOut = "";

        while (data.length > 0) {
            if (!this._textToolActive) {
                const b = data.indexOf(BEGIN);
                if (b === -1) {
                    // No tool-call start: emit visible portion, but keep any partial BEGIN prefix as buffer
                    const longestPartialPrefix = ((): number => {
                        for (let k = Math.min(BEGIN.length - 1, data.length - 1); k > 0; k--) {
                            if (data.endsWith(BEGIN.slice(0, k))) { return k; }
                        }
                        return 0;
                    })();
                    if (longestPartialPrefix > 0) {
                        const visible = data.slice(0, data.length - longestPartialPrefix);
                        if (visible) { visibleOut += this.stripControlTokensWithBuffering(visible); }
                        this._textToolParserBuffer = data.slice(data.length - longestPartialPrefix);
                        data = "";
                        break;
                    } else {
                        // All visible, clean other control tokens with buffering
                        visibleOut += this.stripControlTokensWithBuffering(data);
                        data = "";
                        break;
                    }
                }
                // Emit text before the token
                const pre = data.slice(0, b);
                if (pre) {
                    visibleOut += this.stripControlTokensWithBuffering(pre);
                }
                // Advance past BEGIN
                data = data.slice(b + BEGIN.length);

                // Find the delimiter that ends the name/index segment
                const a = data.indexOf(ARG_BEGIN);
                const e = data.indexOf(END);
                let delimIdx = -1;
                let delimKind: "arg" | "end" | undefined = undefined;
                if (a !== -1 && (e === -1 || a < e)) { delimIdx = a; delimKind = "arg"; }
                else if (e !== -1) { delimIdx = e; delimKind = "end"; }
                else {
                    // Incomplete header; keep for next chunk (re-add BEGIN so we don't lose it)
                    this._textToolParserBuffer = BEGIN + data;
                    data = "";
                    break;
                }

                const header = data.slice(0, delimIdx).trim();
                const m = header.match(/^([A-Za-z0-9_\-.]+)(?::(\d+))?/);
                const name = m?.[1] ?? undefined;
                const index = m?.[2] ? Number(m?.[2]) : undefined;
                this._textToolActive = { name, index, argBuffer: "", emitted: false };
                // Advance past delimiter token
                if (delimKind === "arg") {
                    data = data.slice(delimIdx + ARG_BEGIN.length);
                } else /* end */ {
                    // No args, finalize immediately
                    data = data.slice(delimIdx + END.length);
                    const did = this.emitTextToolCallIfValid(progress, this._textToolActive, "{}");
                    if (did) {
                        this._textToolActive.emitted = true;
                        emittedAny = true;
                    }
                    this._textToolActive = undefined;
                }
                continue;
            }

            // We are inside arguments, collect until END and emit as soon as JSON becomes valid
            const e2 = data.indexOf(END);
            if (e2 === -1) {
                // No end marker yet, accumulate and check for early valid JSON
                this._textToolActive.argBuffer += data;
                // Early emit when JSON becomes valid and we haven't emitted yet
                if (!this._textToolActive.emitted) {
                    const did = this.emitTextToolCallIfValid(progress, this._textToolActive, this._textToolActive.argBuffer);
                    if (did) {
                        this._textToolActive.emitted = true;
                        emittedAny = true;
                    }
                }
                data = "";
                break;
            } else {
                this._textToolActive.argBuffer += data.slice(0, e2);
                // Consume END
                data = data.slice(e2 + END.length);
                // Final attempt to emit if not already
                if (!this._textToolActive.emitted) {
                    const did = this.emitTextToolCallIfValid(progress, this._textToolActive, this._textToolActive.argBuffer);
                    if (did) {
                        emittedAny = true;
                    }
                }
                this._textToolActive = undefined;
                continue;
            }
        }

        // Emit any visible text
        const textToEmit = visibleOut;
        if (textToEmit && textToEmit.length > 0) {
            progress.report(new vscode.LanguageModelTextPart(textToEmit));
            emittedText = true;
            emittedAny = true;
        }

        // Store leftover for next chunk
        this._textToolParserBuffer = data;

        return { emittedText, emittedAny };
    }

    private emitTextToolCallIfValid(
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
        call: { name?: string; index?: number; argBuffer: string; emitted?: boolean },
        argText: string,
    ): boolean {
        const name = call.name ?? "unknown_tool";
        const parsed = tryParseJSONObject(argText);
        if (!parsed.ok) {
            return false;
        }
        const canonical = JSON.stringify(parsed.value);
        const key = `${name}:${canonical}`;
        // identity-based dedupe when index is present
        if (typeof call.index === "number") {
            const idKey = `${name}:${call.index}`;
            if (this._emittedTextToolCallIds.has(idKey)) {
                return false;
            }
            // Mark identity as emitted
            this._emittedTextToolCallIds.add(idKey);
        } else if (this._emittedTextToolCallKeys.has(key)) {
            return false;
        }
        this._emittedTextToolCallKeys.add(key);
        const id = `tct_${Math.random().toString(36).slice(2, 10)}`;
        progress.report(new vscode.LanguageModelToolCallPart(id, name, parsed.value));
        return true;
    }

    private async flushActiveTextToolCall(
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    ): Promise<void> {
        if (!this._textToolActive) {
            return;
        }
        const argText = this._textToolActive.argBuffer;
        const parsed = tryParseJSONObject(argText);
        if (!parsed.ok) {
            return;
        }
        // Emit (dedupe ensures we don't double-emit)
        this.emitTextToolCallIfValid(progress, this._textToolActive, argText);
        this._textToolActive = undefined;
    }

	/**
	 * Try to emit a buffered tool call when a valid name and JSON arguments are available.
	 * @param index The tool call index from the stream.
	 * @param progress Progress reporter for parts.
	 */
    private async tryEmitBufferedToolCall(
        index: number,
        progress: vscode.Progress<vscode.LanguageModelResponsePart>
    ): Promise<void> {
        const buf = this._toolCallBuffers.get(index);
        if (!buf) {
            return;
        }
        if (!buf.name) {
            return;
        }
        const canParse = tryParseJSONObject(buf.args);
        if (!canParse.ok) {
            return;
        }
        const id = buf.id ?? `call_${Math.random().toString(36).slice(2, 10)}`;
        const parameters = canParse.value;
        try {
            const canonical = JSON.stringify(parameters);
            this._emittedTextToolCallKeys.add(`${buf.name}:${canonical}`);
        } catch { /* ignore */ }
        progress.report(new vscode.LanguageModelToolCallPart(id, buf.name, parameters));
        this._toolCallBuffers.delete(index);
        this._completedToolCallIndices.add(index);
    }

	/**
	 * Flush all buffered tool calls, optionally throwing if arguments are not valid JSON.
	 * @param progress Progress reporter for parts.
	 * @param throwOnInvalid If true, throw when a tool call has invalid JSON args.
	 */
    private async flushToolCallBuffers(
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
        throwOnInvalid: boolean,
    ): Promise<void> {
        if (this._toolCallBuffers.size === 0) {
            return;
        }
        for (const [idx, buf] of Array.from(this._toolCallBuffers.entries())) {
            const parsed = tryParseJSONObject(buf.args);
            if (!parsed.ok) {
                if (throwOnInvalid) {
                    console.error("[Lemonade Model Provider] Invalid JSON for tool call", { idx, snippet: (buf.args || "").slice(0, 200) });
                    throw new Error("Invalid JSON for tool call");
                }
                // When not throwing (e.g. on [DONE]), drop silently to reduce noise
                continue;
            }
            const id = buf.id ?? `call_${Math.random().toString(36).slice(2, 10)}`;
            const name = buf.name ?? "unknown_tool";
            try {
                const canonical = JSON.stringify(parsed.value);
                this._emittedTextToolCallKeys.add(`${name}:${canonical}`);
            } catch { /* ignore */ }
            progress.report(new vscode.LanguageModelToolCallPart(id, name, parsed.value));
            this._toolCallBuffers.delete(idx);
            this._completedToolCallIndices.add(idx);
        }
    }
}
