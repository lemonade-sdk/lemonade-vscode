# 🍋 Lemonade Server Provider for GitHub Copilot Chat

## Dev Testing
### Install dependencies
npm install

### Compile the TypeScript code
npm run compile

Open this project on VSCode and press F5.

---

Use your local Lemonade LLM server with VS Code GitHub Copilot Chat! Connect to your locally running Lemonade server (port 8000) to use the Qwen3-0.6B-GGUF model for code assistance and chat.

---

## ⚡ Quick Start
1. Make sure your Lemonade server is running on `http://127.0.0.1:8000`
2. Install the Lemonade Copilot Chat extension
3. Open VS Code's chat interface
4. Click the model picker and click "Manage Models..."
5. Select "Lemonade" provider
6. If needed, configure a custom server URL using the "Manage Lemonade Provider" command
7. Start chatting with your local Qwen3-0.6B-GGUF model! 🥳

## ✨ Why use the Lemonade provider in Copilot
* **Privacy**: All processing happens locally on your machine
* **No API costs**: No external API calls or usage fees
* **Speed**: Direct connection to your local server
* **Offline capability**: Works without internet connection
* **Tool calling**: Supports function calling capabilities
* **Simple setup**: No API keys required

---

## Requirements
* VS Code 1.104.0 or higher
* Lemonade server running locally on port 8000 (default)
* Qwen3-0.6B-GGUF model loaded in your Lemonade server

## 🛠️ Development
```bash
git clone https://github.com/lemonade/lemonade-server
cd lemonade-server
npm install
npm run compile
```
Press F5 to launch an Extension Development Host.

Common scripts:
* Build: `npm run compile`
* Watch: `npm run watch`
* Lint: `npm run lint`
* Format: `npm run format`

## 🔧 Configuration
The extension connects to `http://127.0.0.1:8000/api/v1` by default. You can change this by:
1. Opening VS Code Command Palette (Ctrl+Shift+P)
2. Running "Manage Lemonade Provider" command
3. Entering your custom Lemonade server URL

## 📚 Learn more
* Lemonade Server: Set up your local LLM server
* VS Code Chat Provider API: https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider

---

## Support & License
* Open issues: https://github.com/lemonade/lemonade-server/issues
* License: MIT License Copyright (c) 2025 Lemonade
