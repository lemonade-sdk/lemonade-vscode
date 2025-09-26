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

To package the extension, run `npx @vscode/vsce package`. To install the extension, run `code --install-extension lemonade-sdk-0.0.1.vsix`.
