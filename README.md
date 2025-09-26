# 🍋 Lemonade for GitHub Copilot Chat

![Demo](assets/demo.gif)

Use your local Lemonade LLM server with VS Code GitHub Copilot Chat!

## 🚀 Getting Started
1. Make sure your Lemonade server is running
    * We recommend setting the context size to at least 32k by using the Lemonade tray or --ctx-size cli option.
1. Install the Lemonade Copilot Chat extension
1. Open VS Code's chat interface
1. Click the model picker and click "Manage Models..."
1. Select "Lemonade" provider
1. Select from any models that are loaded in your Lemonade server (automatically detected)
1. Start chatting with your local LLM models! 🥳

> NOTE: If needed, configure a custom server URL using the "Manage Lemonade Provider" command

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
* Lemonade server 8.1.10 or higher


## 🔧 Configuration
The extension connects to `http://127.0.0.1:8000/api/v1` by default. You can change this by:
1. Opening VS Code Command Palette (Ctrl+Shift+P)
2. Running "Manage Lemonade Provider" command
3. Entering your custom Lemonade server URL

## Support & License
* Open issues: https://github.com/lemonade-sdk/lemonade/issues
* License: MIT License Copyright (c) 2025 Lemonade

## 🙏 Acknowledgments

This plugin was originally based on the excellent work by the [Hugging Face team](https://github.com/huggingface/huggingface-vscode-chat). We're grateful for their foundational work.