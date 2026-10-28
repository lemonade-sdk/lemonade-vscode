# 🍋 Lemonade for GitHub Copilot

![Demo](https://github.com/lemonade-sdk/assets/blob/main/copilot/demo.gif?raw=true)

Lemonade allows you to use local LLMs on GitHub Copilot Chat!

## 🚀 Getting Started
1. Make sure [Lemonade](https://lemonade-server.ai/) is running
    * We recommend setting the context size to at least 32k by using the Lemonade tray or --ctx-size cli option.
1. Install the [Lemonade for GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=lemonade-sdk.lemonade-sdk) extension
1. Open VS Code's chat interface, click the model picker, and click "Manage Models..."
1. Select "Lemonade" provider, confirm the server URL (defaults to `http://localhost:13305/api/v1`) and optional API key in the form
1. Choose a model (Qwen3-Coder-30B is a great start!)

You can now start chatting with your local LLM models! 🥳

> NOTE: Models appear only after a server has been added through the form above. Add one entry per Lemonade server to use several.

## 🌟 Why Choose Lemonade for Copilot?
* **🔒 Complete Privacy**: Your code never leaves your machine. Everything stays local and secure
* **💰 Zero API Costs**: No usage fees, no tokens to buy - just pure local AI power
* **⚡ Lightning Fast**: Direct connection to your local server means instant responses
* **🌐 Works Offline**: No internet? No problem! Code assistance anytime, anywhere
* **🛠️ Advanced Tool Support**: Full function calling capabilities for complex tasks

## Requirements
* VS Code 1.109.0 or higher
* Lemonade server 8.1.10 or higher


## 🔧 Configuration
The extension connects to `http://localhost:13305/api/v1` by default. You can change this by:
1. Opening VS Code Command Palette (Ctrl+Shift+P)
2. Running "Manage Lemonade Provider" command
3. Entering your custom Lemonade server URL
4. Optionally, entering your API key (if your server has `LEMONADE_API_KEY` configured)

### Limiting visible models
In the server form, the optional **Models** list restricts the model picker to the listed model ids (exactly as returned by the server, e.g. `Qwen3-Coder-30B-A3B-Instruct-GGUF`). Leave it empty to show all models. Names the server does not return are ignored.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LEMONADE_CTX_SIZE` | `128000` | Fallback context window (in tokens) for older Lemonade servers or models whose effective context cannot be resolved. Current servers use per-model context settings and runtime/auto-tuned sizes when available. |

> **Tip:** For older servers, launch VS Code with `LEMONADE_CTX_SIZE` set to the actual context limit. Current Lemonade servers normally determine this per model automatically.

## Support & License
* Open issues: https://github.com/lemonade-sdk/lemonade/issues
* License: MIT License Copyright (c) 2025 Lemonade

## 🙏 Acknowledgments

This plugin was originally based on the excellent work by the [Hugging Face team](https://github.com/huggingface/huggingface-vscode-chat). We're grateful for their foundational work.