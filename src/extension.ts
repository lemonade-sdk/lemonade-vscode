import * as vscode from "vscode";
import { LemonadeChatModelProvider } from "./provider";

export function activate(context: vscode.ExtensionContext) {
	// Build a descriptive User-Agent to help quantify API usage
	const ext = vscode.extensions.getExtension("Lemonade.lemonade-server");
	const extVersion = ext?.packageJSON?.version ?? "unknown";
	const vscodeVersion = vscode.version;
	// Keep UA minimal: only extension version and VS Code version
	const ua = `lemonade-server/${extVersion} VSCode/${vscodeVersion}`;

	const provider = new LemonadeChatModelProvider(context.secrets, ua);
	// Register the Lemonade provider under the vendor id used in package.json
	vscode.lm.registerLanguageModelChatProvider("lemonade", provider);

	// Management command to configure server settings (no API key needed for local server)
	context.subscriptions.push(
		vscode.commands.registerCommand("lemonade.manage", async () => {
			const existing = await context.secrets.get("lemonade.serverUrl");
			const defaultUrl = "http://127.0.0.1:8000/api/v1";
			const serverUrl = await vscode.window.showInputBox({
				title: "Lemonade Server URL",
				prompt: existing ? "Update your Lemonade server URL" : "Enter your Lemonade server URL",
				ignoreFocusOut: true,
				value: existing ?? defaultUrl,
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
			vscode.window.showInformationMessage("Lemonade server URL saved.");
		})
	);
}

export function deactivate() {}
