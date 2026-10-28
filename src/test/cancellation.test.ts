import * as assert from "assert";
import { once } from "events";
import { createServer, type Server, type ServerResponse } from "http";
import * as vscode from "vscode";
import { LemonadeChatModelProvider } from "../provider";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

async function promptly<T>(promise: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error("Cancellation did not complete within 1500 ms")), 1500);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

suite("Chat HTTP cancellation", () => {
	let server: Server;
	let provider: LemonadeChatModelProvider;
	let source: vscode.CancellationTokenSource;
	let token: vscode.CancellationToken;
	let cancellationListeners: number;
	let secretChanges: vscode.EventEmitter<vscode.SecretStorageChangeEvent>;
	let handleRequest: (response: ServerResponse) => void;
	let requestCount: number;

	setup(async () => {
		requestCount = 0;
		source = new vscode.CancellationTokenSource();
		cancellationListeners = 0;
		token = {
			get isCancellationRequested() { return source.token.isCancellationRequested; },
			onCancellationRequested: (listener, thisArgs, disposables) => {
				const registration = source.token.onCancellationRequested(listener, thisArgs);
				cancellationListeners++;
				const disposable = new vscode.Disposable(() => {
					registration.dispose();
					cancellationListeners--;
				});
				disposables?.push(disposable);
				return disposable;
			},
		};
		secretChanges = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();
		handleRequest = (response) => response.end();
		server = createServer((request, response) => {
			request.resume();
			requestCount++;
			handleRequest(response);
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address();
		assert.ok(address && typeof address !== "string");
		const endpoints = JSON.stringify([{
			shortname: "default",
			url: `http://127.0.0.1:${address.port}/api/v1`,
		}]);
		const secrets: vscode.SecretStorage = {
			get: async (key) => key === "lemonade.endpoints" ? endpoints : undefined,
			store: async () => {},
			delete: async () => {},
			onDidChange: secretChanges.event,
		};
		provider = new LemonadeChatModelProvider(secrets, "test/test");
	});

	teardown(async () => {
		source.dispose();
		secretChanges.dispose();
		const closed = new Promise<void>((resolve, reject) => {
			server.close((error) => error ? reject(error) : resolve());
		});
		server.closeAllConnections();
		await closed;
		assert.equal(cancellationListeners, 0, "Request cancellation listeners must be disposed");
	});

	function chat(report: (part: vscode.LanguageModelResponsePart) => void = () => {}) {
		return provider.provideLanguageModelChatResponse(
			{
				id: "test",
				name: "test",
				family: "lemonade",
				version: "1.0.0",
				maxInputTokens: 4096,
				maxOutputTokens: 4096,
				capabilities: {},
			},
			[{
				role: vscode.LanguageModelChatMessageRole.User,
				content: [new vscode.LanguageModelTextPart("hi")],
				name: undefined,
			}],
			{},
			{ report },
			token
		);
	}

	test("an already-cancelled request never reaches the server", async () => {
		source.cancel();
		await promptly(chat());
		assert.equal(requestCount, 0);
	});

	test("cancellation before response headers disconnects the HTTP request", async () => {
		const received = deferred<void>();
		const disconnected = deferred<void>();
		handleRequest = (response) => {
			response.once("close", () => disconnected.resolve());
			received.resolve();
		};

		const response = chat();
		await received.promise;
		source.cancel();
		await promptly(Promise.all([response, disconnected.promise]));
		assert.equal(requestCount, 1);
	});

	test("cancellation interrupts a stalled stream and the next request still succeeds", async () => {
		const firstPart = deferred<void>();
		const disconnected = deferred<void>();
		handleRequest = (response) => {
			response.once("close", () => disconnected.resolve());
			response.writeHead(200, { "Content-Type": "text/event-stream" });
			response.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n');
		};
		const parts: vscode.LanguageModelResponsePart[] = [];
		const response = chat((part) => {
			parts.push(part);
			firstPart.resolve();
		});
		await firstPart.promise;
		source.cancel();
		await promptly(Promise.all([response, disconnected.promise]));
		assert.equal(parts.length, 1);

		source.dispose();
		source = new vscode.CancellationTokenSource();
		handleRequest = (response) => {
			response.writeHead(200, { "Content-Type": "text/event-stream" });
			response.end('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
		};
		const followUp: vscode.LanguageModelResponsePart[] = [];
		await promptly(chat((part) => followUp.push(part)));
		assert.equal(requestCount, 2);
		assert.ok(followUp[0] instanceof vscode.LanguageModelTextPart);
		assert.equal(followUp[0].value, "OK");
	});

	test("cancellation does not report remaining deltas from the same chunk", async () => {
		handleRequest = (response) => {
			response.writeHead(200, { "Content-Type": "text/event-stream" });
			response.end(
				'data: {"choices":[{"delta":{"content":"first"}}]}\n\n' +
				'data: {"choices":[{"delta":{"content":"second"}}]}\n\n'
			);
		};
		const parts: vscode.LanguageModelResponsePart[] = [];
		await promptly(chat((part) => {
			parts.push(part);
			source.cancel();
		}));
		assert.equal(parts.length, 1);
	});

	test("cancellation interrupts reading an unfinished HTTP error body", async () => {
		const headersReceived = deferred<void>();
		const disconnected = deferred<void>();
		handleRequest = (response) => {
			response.once("close", () => disconnected.resolve());
			response.writeHead(500);
			response.write("unfinished error");
		};
		const originalFetch = global.fetch;
		try {
			global.fetch = async (...args) => {
				const response = await originalFetch(...args);
				headersReceived.resolve();
				return response;
			};
			const response = chat();
			await headersReceived.promise;
			source.cancel();
			await promptly(Promise.all([response, disconnected.promise]));
		} finally {
			global.fetch = originalFetch;
		}
	});

	test("HTTP errors without cancellation remain visible", async () => {
		handleRequest = (response) => {
			response.writeHead(503, { "Content-Type": "text/plain" });
			response.end("backend unavailable");
		};
		await assert.rejects(chat(), /Lemonade API error: 503[\s\S]*backend unavailable/);
	});

	test("network errors without cancellation remain visible", async () => {
		handleRequest = (response) => response.destroy();
		await assert.rejects(chat(), /fetch failed/);
	});
});
