# 🍋 Lemonade Provider for GitHub Copilot Chat


Use your local Lemonade LLM server with VS Code GitHub Copilot Chat! Connect to your locally running Lemonade server to use local LLM models for code assistance and chat.

## 🚀 Getting Started
1. Make sure your Lemonade server is running on `http://127.0.0.1:8000`
2. Install the Lemonade Copilot Chat extension
3. Open VS Code's chat interface
4. Click the model picker and click "Manage Models..."
5. Select "Lemonade" provider
6. If needed, configure a custom server URL using the "Manage Lemonade Provider" command
7. Select from any models that are loaded in your Lemonade server (automatically detected)
8. Start chatting with your local LLM models! 🥳

## 🌟 Why Choose Lemonade for Copilot?
* **🔒 Complete Privacy**: Your code never leaves your machine. Everything stays local and secure
* **💰 Zero API Costs**: No usage fees, no tokens to buy - just pure local AI power
* **⚡ Lightning Fast**: Direct connection to your local server means instant responses
* **🌐 Works Offline**: No internet? No problem! Code assistance anytime, anywhere
* **🛠️ Advanced Tool Support**: Full function calling capabilities for complex tasks
* **Simple setup**: No API keys required
* **Dynamic model discovery**: Automatically detects available models from your server

## Requirements
* VS Code 1.104.0 or higher
* Lemonade server running locally on port 8000 (default)
* One or more models loaded in your Lemonade server (any OpenAI-compatible models)
* Server must support the `/models` endpoint for model discovery

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

## Support & License
* Open issues: https://github.com/lemonade/lemonade-server/issues
* License: MIT License Copyright (c) 2025 Lemonade

## 🙏 Acknowledgments

This project was originally based on the excellent work by the [Hugging Face team](https://github.com/huggingface/huggingface-vscode-chat). We're grateful for their foundational work.