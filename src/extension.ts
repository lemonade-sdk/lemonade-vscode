import * as vscode from "vscode";
import { LemonadeChatModelProvider } from "./provider";

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
			const existingUrl = await context.secrets.get("lemonade.serverUrl");
			const existingApiKey = await context.secrets.get("lemonade.apiKey");
			const defaultUrl = "http://localhost:8000/api/v1";

			// Step 1: Server URL configuration
			const serverUrl = await vscode.window.showInputBox({
				title: "Lemonade Server URL",
				prompt: existingUrl ? "Update your Lemonade server URL" : "Enter your Lemonade server URL",
				ignoreFocusOut: true,
				value: existingUrl ?? defaultUrl,
			});
			if (serverUrl === undefined) {
				return; // user canceled
			}
			if (!serverUrl.trim()) {
				await context.secrets.delete("lemonade.serverUrl");
				vscode.window.showInformationMessage("Lemonade server URL reset to default.");
				return;
			}
			await context.secrets.store("lemonade.serverUrl", serverUrl.trim());

			// Step 2: API Key configuration (optional)
			const apiKey = await vscode.window.showInputBox({
				title: "Lemonade API Key",
				prompt: existingApiKey
					? "Update your Lemonade API key (leave empty to reset to default)"
					: "Enter your Lemonade API key (optional, leave empty to use default)",
				ignoreFocusOut: true,
				password: true,
				value: existingApiKey ?? "",
				placeHolder: "Leave empty to use default API key",
			});
			if (apiKey === undefined) {
				// User canceled, but URL was already saved
				vscode.window.showInformationMessage("Lemonade server URL saved. API key unchanged.");
				return;
			}
			if (!apiKey.trim()) {
				await context.secrets.delete("lemonade.apiKey");
				vscode.window.showInformationMessage("Lemonade settings saved. API key reset to default.");
				return;
			}
			await context.secrets.store("lemonade.apiKey", apiKey.trim());
			vscode.window.showInformationMessage("Lemonade settings saved.");
		})
	);
}

export function deactivate() {}
