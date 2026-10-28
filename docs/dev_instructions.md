# 🍋 Dev Resources

## 🛠️ Development
```bash
git clone https://github.com/lemonade-sdk/lemonade-vscode
cd lemonade-vscode
npm install
npm run compile
```
Press F5 to launch an Extension Development Host.

Common scripts:
* Build: `npm run compile`
* Watch: `npm run watch`
* Lint: `npm run lint`
* Format: `npm run format`

To package the extension:
* `del .\node_modules\`
* `npm install`
* `npm run compile`
* Run `npx @vscode/vsce package`
* Try it using `code --install-extension lemonade-sdk-0.0.1.vsix`.

## Manual test: chat cancellation

1. Run `npm run compile`, then press F5 and choose **Run Extension**.
   Use the new **Extension Development Host** window, not the original window
   or a previously installed VSIX.
2. Configure a Lemonade endpoint in that window's model picker and select a
   local text/chat model. Use Ask mode to avoid executing tools during the test.
3. Ask for a long response, for example: "Write 200 numbered sentences explaining
   how a compiler works." While text is streaming, press **Stop**.
4. Confirm the chat stops promptly, no further text appears, and cancellation
   does not produce a connection/API error notification. Send a short follow-up
   such as "Reply only OK" and confirm it succeeds.
5. Repeat with a cold or slow-loading model. Press **Stop** before the first
   response token. The request should stop without waiting for model loading or
   the next response chunk.
6. If available, inspect Lemonade's server/backend logs or active-request view:
   confirm the request disconnects/cancels. A model remaining loaded in memory
   is normal and does not mean generation is still running. Client disconnection
   cannot guarantee backend inference stops if the backend ignores disconnects.
7. As a negative check, use an unreachable endpoint and send a prompt: a genuine
   connection failure must still be reported rather than treated as cancellation.

The cold-model check may be hard to reproduce on a fast machine. Automated tests
use a loopback HTTP server that deliberately withholds headers or stalls its
response stream. They require both provider completion and server-observed
connection closure within 1.5 seconds of cancellation.

Run the focused regression tests after compilation:

```bash
npx --no-install vscode-test --run out/test/cancellation.test.js
```

If the test runner fails with `Electron ENOENT` on a newer macOS VS Code
installation, use its renamed `Code` executable explicitly:

```bash
VSCODE_TEST_EXECUTABLE_PATH="/Applications/Visual Studio Code.app/Contents/MacOS/Code" \
  npx --no-install vscode-test --run out/test/cancellation.test.js
```

`VSCODE_TEST_EXECUTABLE_PATH` can also point to another installed VS Code
executable. The runner still uses an isolated test profile.
