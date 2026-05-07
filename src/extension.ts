import * as vscode from "vscode";
import { LemonadeChatModelProvider } from "./provider";
import type { LemonadeEndpoint } from "./types";

const ENDPOINTS_SECRET_KEY = "lemonade.endpoints";

export function activate(context: vscode.ExtensionContext) {
	const ext = vscode.extensions.getExtension("lemonade-sdk.lemonade-sdk");
	const extVersion = ext?.packageJSON?.version ?? "unknown";
	const vscodeVersion = vscode.version;
	// Keep UA minimal: only extension version and VS Code version
	const ua = `lemonade-sdk/${extVersion} VSCode/${vscodeVersion}`;

	const provider = new LemonadeChatModelProvider(context.secrets, ua);
	// Register the Lemonade provider under the vendor id used in package.json
	vscode.lm.registerLanguageModelChatProvider("lemonade", provider);

	// Management command to configure server settings
	context.subscriptions.push(
		vscode.commands.registerCommand("lemonade.manage", async () => {
			await manageEndpoints(context.secrets, provider);
		})
	);
}

export function deactivate() {}

// ---------------------------------------------------------------------------
// Endpoint management UI
// ---------------------------------------------------------------------------

async function saveEndpoints(secrets: vscode.SecretStorage, endpoints: LemonadeEndpoint[]): Promise<void> {
	await secrets.store(ENDPOINTS_SECRET_KEY, JSON.stringify(endpoints));
}

async function manageEndpoints(secrets: vscode.SecretStorage, provider: LemonadeChatModelProvider): Promise<void> {
	// Use the provider's own getEndpoints so migration also runs here
	const endpoints = await provider.getEndpoints();

	const ADD_LABEL = "$(add) Add endpoint";
	const DONE_LABEL = "$(check) Done";

	const items: vscode.QuickPickItem[] = [
		...endpoints.map(ep => ({
			label: ep.shortname,
			description: ep.url,
			detail: ep.apiKey ? "Custom API key configured" : undefined,
		})),
		{ label: "", kind: vscode.QuickPickItemKind.Separator },
		{ label: ADD_LABEL },
		{ label: DONE_LABEL },
	];

	const pick = await vscode.window.showQuickPick(items, {
		title: "Lemonade Endpoints",
		placeHolder: "Select an endpoint to edit/remove, or add a new one",
	});

	if (!pick || pick.label === DONE_LABEL) { return; }

	if (pick.label === ADD_LABEL) {
		const added = await addEndpointFlow(endpoints);
		if (added) {
			await saveEndpoints(secrets, endpoints);
			vscode.window.showInformationMessage(`Endpoint "${added.shortname}" added.`);
		}
		return;
	}

	// Edit or remove an existing endpoint
	const idx = endpoints.findIndex(ep => ep.shortname === pick.label);
	if (idx === -1) { return; }

	const action = await vscode.window.showQuickPick(
		[
			{ label: "$(edit) Edit", value: "edit" },
			{ label: "$(trash) Remove", value: "remove" },
			{ label: "$(close) Cancel", value: "cancel" },
		],
		{ title: `Endpoint: ${endpoints[idx].shortname}` }
	);

	if (!action || action.value === "cancel") { return; }

	if (action.value === "remove") {
		const confirm = await vscode.window.showWarningMessage(
			`Remove endpoint "${endpoints[idx].shortname}"?`,
			{ modal: true },
			"Remove"
		);
		if (confirm !== "Remove") { return; }
		endpoints.splice(idx, 1);
		await saveEndpoints(secrets, endpoints);
		vscode.window.showInformationMessage("Endpoint removed.");
		return;
	}

	// Edit
	const updated = await editEndpointFlow(endpoints[idx], endpoints, idx);
	if (updated) {
		endpoints[idx] = updated;
		await saveEndpoints(secrets, endpoints);
		vscode.window.showInformationMessage(`Endpoint "${updated.shortname}" updated.`);
	}
}

function isValidShortname(value: string): string | undefined {
	if (!value.trim()) { return "Shortname cannot be empty."; }
	if (!/^[a-zA-Z0-9][a-zA-Z0-9\-_]*$/.test(value.trim())) {
		return "Shortname must start with a letter or digit and contain only letters, digits, hyphens, and underscores.";
	}
	return undefined;
}

function isValidUrl(value: string): string | undefined {
	if (!value.trim()) { return "URL cannot be empty."; }
	if (!/^https?:\/\/.+/.test(value.trim())) { return "URL must start with http:// or https://"; }
	return undefined;
}

async function addEndpointFlow(
	existing: LemonadeEndpoint[]
): Promise<LemonadeEndpoint | undefined> {
	const shortname = await vscode.window.showInputBox({
		title: "Add Lemonade Endpoint (1/3) — Shortname",
		prompt: "Enter a unique shortname for this endpoint (e.g. node-17)",
		ignoreFocusOut: true,
		validateInput: (v) => {
			const err = isValidShortname(v);
			if (err) { return err; }
			if (existing.some(ep => ep.shortname === v.trim())) {
				return "A endpoint with this shortname already exists.";
			}
			return undefined;
		},
	});
	if (shortname === undefined) { return undefined; }

	const url = await vscode.window.showInputBox({
		title: "Add Lemonade Endpoint (2/3) — URL",
		prompt: "Enter the server URL (e.g. http://fqdn.local:13305/api/v1)",
		value: "http://",
		ignoreFocusOut: true,
		validateInput: isValidUrl,
	});
	if (url === undefined) { return undefined; }

	const apiKey = await vscode.window.showInputBox({
		title: "Add Lemonade Endpoint (3/3) — API Key (optional)",
		prompt: "Enter the API key for this endpoint, or leave empty to use the default",
		ignoreFocusOut: true,
		password: true,
		placeHolder: "Leave empty to use default API key",
	});
	if (apiKey === undefined) { return undefined; }

	const ep: LemonadeEndpoint = {
		shortname: shortname.trim(),
		url: url.trim(),
		...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
	};
	existing.push(ep);
	return ep;
}

async function editEndpointFlow(
	ep: LemonadeEndpoint,
	existing: LemonadeEndpoint[],
	selfIdx: number
): Promise<LemonadeEndpoint | undefined> {
	const shortname = await vscode.window.showInputBox({
		title: `Edit Endpoint "${ep.shortname}" (1/3) — Shortname`,
		ignoreFocusOut: true,
		value: ep.shortname,
		validateInput: (v) => {
			const err = isValidShortname(v);
			if (err) { return err; }
			if (existing.some((e, i) => i !== selfIdx && e.shortname === v.trim())) {
				return "A endpoint with this shortname already exists.";
			}
			return undefined;
		},
	});
	if (shortname === undefined) { return undefined; }

	const url = await vscode.window.showInputBox({
		title: `Edit Endpoint "${ep.shortname}" (2/3) — URL`,
		ignoreFocusOut: true,
		value: ep.url,
		validateInput: isValidUrl,
	});
	if (url === undefined) { return undefined; }

	const apiKey = await vscode.window.showInputBox({
		title: `Edit Endpoint "${ep.shortname}" (3/3) — API Key (optional)`,
		ignoreFocusOut: true,
		password: true,
		value: ep.apiKey ?? "",
		placeHolder: "Leave empty to use default API key",
	});
	if (apiKey === undefined) { return undefined; }

	return {
		shortname: shortname.trim(),
		url: url.trim(),
		...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
	};
}
