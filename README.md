# 🍋 Lemonade for GitHub Copilot

![Demo](https://github.com/lemonade-sdk/assets/blob/main/copilot/demo.gif?raw=true)

Lemonade allows you to use local LLMs on GitHub Copilot Chat!

## 🚀 Getting Started
1. Make sure [Lemonade](https://lemonade-server.ai/) is running
    * We recommend setting the context size to at least 32k by using the Lemonade tray or --ctx-size cli option.
1. Install the [Lemonade for GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=lemonade-sdk.lemonade-sdk) extension
1. Open VS Code's chat interface, click the model picker, and click "Manage Models..."
1. Select "Lemonade" provider and choose a model (Qwen3-Coder-30B is a great start!)

You can now start chatting with your local LLM models! 🥳

> NOTE: If needed, configure a custom server URL using the "Manage Lemonade Provider" command

## 🌟 Why Choose Lemonade for Copilot?
* **🔒 Complete Privacy**: Your code never leaves your machine. Everything stays local and secure
* **💰 Zero API Costs**: No usage fees, no tokens to buy - just pure local AI power
* **⚡ Lightning Fast**: Direct connection to your local server means instant responses
* **🌐 Works Offline**: No internet? No problem! Code assistance anytime, anywhere
* **🛠️ Advanced Tool Support**: Full function calling capabilities for complex tasks

## Requirements
* VS Code 1.104.0 or higher
* Lemonade server 8.1.10 or higher


## 🔧 Configuration
The extension connects to `http://localhost:8000/api/v1` by default. You can change this by:
1. Opening VS Code Command Palette (Ctrl+Shift+P)
2. Running "Manage Lemonade Provider" command
3. Entering your custom Lemonade server URL
4. Optionally, entering your API key (if your server has `LEMONADE_API_KEY` configured)

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LEMONADE_CTX_SIZE` | `128000` | Context window size (in tokens) reported to VS Code. Set this to match the `--ctx-size` value used when starting Lemonade so the model picker displays the correct context limits. For example, `LEMONADE_CTX_SIZE=262144` for a 256 k context window. |

> **Tip:** Launch VS Code from a terminal where `LEMONADE_CTX_SIZE` is already set, or add it to your system/user environment variables so it is always picked up.

## Support & License
* Open issues: https://github.com/lemonade-sdk/lemonade/issues
* License: MIT License Copyright (c) 2025 Lemonade

## 🙏 Acknowledgments

This plugin was originally based on the excellent work by the [Hugging Face team](https://github.com/huggingface/huggingface-vscode-chat). We're grateful for their foundational work.