# Local AI Setup Guide — Innovate Hub

Complete guide to installing and running all 5 supported local AI services with Innovate Hub.  
All services are **auto-detected** — just start one and Innovate Hub will find it automatically.

---

## Quick Comparison

| Service | Platforms | GPU Needed? | Ease of Use | Best For |
|---------|-----------|-------------|-------------|----------|
| **Ollama** | Windows, Mac, Linux | No (faster with GPU) | ⭐⭐⭐⭐⭐ CLI | Servers, codespaces, headless |
| **LM Studio** | Windows, Mac, Linux | Recommended | ⭐⭐⭐⭐⭐ GUI | Beginners, model browsing |
| **GPT4All** | Windows, Mac, Linux | No (faster with GPU) | ⭐⭐⭐⭐ GUI | Privacy-focused, offline |
| **Jan.ai** | Windows, Mac, Linux | Recommended | ⭐⭐⭐⭐ GUI | OpenAI-compatible workflow |
| **KoboldCPP** | Windows, Mac, Linux | No (faster with GPU) | ⭐⭐⭐ CLI | Advanced users, roleplay models |

### Minimum System Requirements

| Model Size | RAM Needed | Disk Space | Response Speed (CPU) | Response Speed (GPU) |
|-----------|------------|------------|---------------------|---------------------|
| 0.5B - 1B (tiny) | 2 GB | 0.5-1 GB | 1-3 sec | <1 sec |
| 3B (small) | 4 GB | 2-3 GB | 5-10 sec | 1-2 sec |
| 7B (medium) | 8 GB | 4-5 GB | 15-30 sec | 2-5 sec |
| 13B (large) | 16 GB | 8-10 GB | 30-60 sec | 5-10 sec |
| 70B (huge) | 48+ GB | 40+ GB | Not practical | 10-30 sec |

---

## 1. Ollama

**Website**: https://ollama.com  
**Default Port**: `11434`  
**Type**: CLI (command line)

### Installation

#### macOS
```bash
# Using the installer
curl -fsSL https://ollama.com/install.sh | sh

# Or with Homebrew
brew install ollama
```

#### Linux
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

#### Windows
1. Download from https://ollama.com/download/windows
2. Run the installer
3. Ollama runs as a system service automatically

### Starting the Server

```bash
# Start the Ollama server (runs on port 11434)
ollama serve
```

On Windows, Ollama starts automatically as a background service after installation.

### Installing Models

```bash
# List available models
ollama list

# Pull (download) models — choose based on your RAM:

# Tiny models (2-4 GB RAM) — Fast, basic quality
ollama pull qwen2.5:0.5b          # 397 MB — Fastest, good for testing
ollama pull tinyllama              # 637 MB — Small but capable

# Small models (4-8 GB RAM) — Good balance
ollama pull phi3                   # 2.2 GB — Microsoft, great for coding
ollama pull llama3.2               # 2.0 GB — Meta, good all-around
ollama pull gemma2:2b              # 1.6 GB — Google, compact

# Medium models (8-16 GB RAM) — High quality
ollama pull mistral                # 4.1 GB — Excellent quality
ollama pull llama3.1               # 4.7 GB — Meta, very capable
ollama pull gemma2                 # 5.4 GB — Google, strong reasoning
ollama pull codellama              # 3.8 GB — Meta, code-focused
ollama pull deepseek-coder         # 776 MB — Code-focused, very small

# Large models (16+ GB RAM) — Best quality
ollama pull llama3.1:70b           # 40 GB — Needs lots of RAM
ollama pull mixtral                # 26 GB — Mixture of experts
```

### Managing Models

```bash
# List installed models
ollama list

# Get model info
ollama show mistral

# Delete a model
ollama rm mistral

# Run model directly (chat in terminal)
ollama run llama3.2
```

### Verify It's Working

```bash
# Check server is running
curl http://localhost:11434

# Should return: "Ollama is running"

# List models via API
curl http://localhost:11434/api/tags

# Test a chat
curl http://localhost:11434/api/chat -d '{
  "model": "qwen2.5:0.5b",
  "messages": [{"role": "user", "content": "Hello!"}],
  "stream": false
}'
```

### Ollama Tips
- Models download once and are cached in `~/.ollama/models/`
- Multiple models can be installed but only one runs at a time
- Ollama automatically loads/unloads models as needed
- Set `OLLAMA_HOST=0.0.0.0` to allow network access

---

## 2. LM Studio

**Website**: https://lmstudio.ai  
**Default Port**: `1234`  
**Type**: GUI (desktop application)

### Installation

#### All Platforms
1. Go to https://lmstudio.ai
2. Click **Download** for your OS (Windows/Mac/Linux)
3. Install and open the app

#### macOS
```bash
# Or with Homebrew
brew install --cask lm-studio
```

### Downloading Models

1. Open LM Studio
2. Click the **Discover** tab (🔍 icon) in the left sidebar
3. Search for a model (e.g., "llama 3", "mistral", "phi-3")
4. Click **Download** next to the model variant you want

**Recommended models by RAM:**

| RAM | Model | Search Term |
|-----|-------|-------------|
| 4 GB | TinyLlama 1.1B | `tinyllama` |
| 8 GB | Llama 3.2 3B | `llama-3.2-3b` |
| 8 GB | Phi-3.5 Mini | `phi-3.5-mini` |
| 16 GB | Mistral 7B Instruct | `mistral-7b-instruct` |
| 16 GB | Llama 3.1 8B | `llama-3.1-8b` |
| 32 GB | Mixtral 8x7B | `mixtral-8x7b` |

> **Tip**: Look for **GGUF** format models. Choose **Q4_K_M** quantization for the best balance of quality and speed.

### Starting the Server

1. Click the **Developer** tab (</> icon) in the left sidebar
   - In older versions, this is called **Local Server**
2. Select a downloaded model from the dropdown at the top
3. Click **Start Server**
4. You'll see: `Server started on port 1234`

**Server settings** (optional):
- **Context Length**: 4096 (default) — increase for longer conversations
- **GPU Offload**: Set to max layers for faster inference
- **Port**: 1234 (change if needed)

### Verify It's Working

```bash
# Check server
curl http://localhost:1234/v1/models

# Test a chat
curl http://localhost:1234/v1/chat/completions -H "Content-Type: application/json" -d '{
  "model": "local-model",
  "messages": [{"role": "user", "content": "Hello!"}]
}'
```

### LM Studio Tips
- Models are stored in `~/.cache/lm-studio/models/`
- You can load multiple models and switch between them
- Enable **GPU Acceleration** in settings for faster responses
- The server is **OpenAI API compatible** — any OpenAI client works
- LM Studio requires a display — **cannot run headless on servers**

---

## 3. GPT4All

**Website**: https://gpt4all.io  
**Default Port**: `4891`  
**Type**: GUI + Python package

### Installation

#### Desktop App (Recommended for beginners)

1. Go to https://gpt4all.io
2. Click **Download** for your OS
3. Install and open the app

#### Python Package (For servers/headless)

```bash
# Install via pip
pip install gpt4all

# Or with the API server
pip install gpt4all[server]
```

### Downloading Models

#### Via Desktop App
1. Open GPT4All
2. Click **Models** button (or the download icon)
3. Browse available models
4. Click **Download** next to your chosen model

#### Via Python
```python
from gpt4all import GPT4All

# This downloads the model automatically on first use
model = GPT4All("mistral-7b-instruct-v0.1.Q4_0.gguf")
```

**Recommended models:**

| RAM | Model Name | Size |
|-----|-----------|------|
| 4 GB | `orca-mini-3b-gguf2-q4_0.gguf` | 1.8 GB |
| 8 GB | `mistral-7b-instruct-v0.1.Q4_0.gguf` | 4.1 GB |
| 8 GB | `gpt4all-falcon-newbpe-q4_0.gguf` | 3.9 GB |
| 16 GB | `nous-hermes-llama2-13b.Q4_0.gguf` | 7.3 GB |
| 16 GB | `wizardlm-13b-v1.2.Q4_0.gguf` | 7.3 GB |

### Starting the Server

#### Via Desktop App
1. Open GPT4All
2. Go to **Settings** → **Application**
3. Check **Enable API Server**
4. The server starts on port `4891`

#### Via Python (headless — for servers)
```bash
# Start the API server with a specific model
python -m gpt4all.server --model mistral-7b-instruct-v0.1.Q4_0.gguf --port 4891
```

#### Via Python script
```python
from gpt4all import GPT4All

model = GPT4All("mistral-7b-instruct-v0.1.Q4_0.gguf")

# Simple generation
output = model.generate("Hello! How are you?", max_tokens=200)
print(output)

# Chat with context
with model.chat_session():
    response = model.generate("What is Python?", max_tokens=200)
    print(response)
```

### Verify It's Working

```bash
# Check server
curl http://localhost:4891/v1/models

# Test chat
curl http://localhost:4891/v1/chat/completions -H "Content-Type: application/json" -d '{
  "model": "mistral-7b-instruct-v0.1.Q4_0.gguf",
  "messages": [{"role": "user", "content": "Hello!"}]
}'
```

### GPT4All Tips
- Models stored in `~/.local/share/nomic.ai/GPT4All/` (Linux) or `~/Library/Application Support/nomic.ai/GPT4All/` (Mac)
- Focuses on **privacy** — all data stays local
- Python package works headless on servers
- Supports GGUF model format

---

## 4. Jan.ai

**Website**: https://jan.ai  
**Default Port**: `1337`  
**Type**: GUI (desktop application)

### Installation

#### All Platforms
1. Go to https://jan.ai
2. Click **Download** for your OS
3. Install and open the app

#### Linux (AppImage)
```bash
# Download the AppImage
wget https://github.com/janhq/jan/releases/latest/download/jan-linux-x86_64.AppImage

# Make executable
chmod +x jan-linux-x86_64.AppImage

# Run
./jan-linux-x86_64.AppImage
```

### Downloading Models

1. Open Jan
2. Click **Hub** in the left sidebar
3. Browse or search for models
4. Click **Download** on your chosen model

**Recommended models:**

| RAM | Model | Category |
|-----|-------|----------|
| 4 GB | TinyLlama 1.1B | Conversation |
| 8 GB | Phi-3 Mini 4K | Coding, reasoning |
| 8 GB | Mistral 7B Instruct | General purpose |
| 16 GB | Llama 3.1 8B Instruct | High quality |
| 16 GB | CodeLlama 7B | Code generation |

### Starting the Server

1. Open Jan
2. Click **Settings** (⚙️) in the bottom-left corner
3. Go to **Advanced Settings**
4. Toggle **Local API Server** to **ON**
5. Click **Start Server**
6. Server runs on port `1337`

**Or via Settings → Model:**
1. Select a model in the **Thread** screen
2. Go to **Settings** → **Advanced**
3. Enable **API Server**

### Verify It's Working

```bash
# Check server
curl http://localhost:1337/v1/models

# Test chat
curl http://localhost:1337/v1/chat/completions -H "Content-Type: application/json" -d '{
  "model": "mistral-7b-instruct",
  "messages": [{"role": "user", "content": "Hello!"}]
}'
```

### Jan.ai Tips
- Models stored in `~/jan/models/`
- Jan uses **threads** for conversations (similar to ChatGPT)
- Supports importing custom GGUF models
- Can connect to remote APIs (OpenAI, etc.) as well
- Jan is **open source** — https://github.com/janhq/jan
- Cannot run headless — **requires a display**

---

## 5. KoboldCPP

**Website**: https://github.com/LostRuins/koboldcpp  
**Default Port**: `5001`  
**Type**: CLI + optional GUI

### Installation

#### Windows
1. Go to https://github.com/LostRuins/koboldcpp/releases
2. Download `koboldcpp.exe` (no install needed)

#### Linux (build from source)
```bash
# Clone the repository
git clone https://github.com/LostRuins/koboldcpp.git
cd koboldcpp

# Build (CPU only)
make

# Build with CUDA support (NVIDIA GPU)
make LLAMA_CUBLAS=1

# Build with CLBlast (AMD/Intel GPU)
make LLAMA_CLBLAST=1
```

#### macOS
```bash
git clone https://github.com/LostRuins/koboldcpp.git
cd koboldcpp
make LLAMA_METAL=1    # Apple Silicon GPU acceleration
```

### Downloading Models

KoboldCPP uses **GGUF** format models. Download from HuggingFace:

1. Go to https://huggingface.co/models
2. Filter by: **GGUF** in the search
3. Popular model repositories:
   - https://huggingface.co/TheBloke (thousands of quantized models)
   - https://huggingface.co/bartowski (newer models)

**Direct download examples:**

```bash
# Create a models directory
mkdir -p ~/ai-models && cd ~/ai-models

# Download a small model (TinyLlama — 637 MB)
wget https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf

# Download Mistral 7B (4.4 GB)
wget https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q4_K_M.gguf

# Download Phi-3 Mini (2.2 GB)
wget https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf

# Download Llama 3.1 8B (4.9 GB)
wget https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf
```

### Starting the Server

```bash
# Basic start (CPU only)
./koboldcpp --model ~/ai-models/mistral-7b-instruct-v0.2.Q4_K_M.gguf --port 5001

# With GPU layers (NVIDIA)
./koboldcpp --model ~/ai-models/mistral-7b-instruct-v0.2.Q4_K_M.gguf --port 5001 --gpulayers 35

# With specific context size
./koboldcpp --model ~/ai-models/mistral-7b-instruct-v0.2.Q4_K_M.gguf --port 5001 --contextsize 4096

# Windows
koboldcpp.exe --model C:\models\mistral-7b-instruct-v0.2.Q4_K_M.gguf --port 5001

# With all common options
./koboldcpp \
  --model ~/ai-models/mistral-7b-instruct-v0.2.Q4_K_M.gguf \
  --port 5001 \
  --contextsize 4096 \
  --threads 4 \
  --gpulayers 35 \
  --usemirostat 2 0.1 0.1
```

**Launch GUI mode (opens a browser config page):**
```bash
./koboldcpp --config      # Opens configuration GUI in browser
```

### Verify It's Working

```bash
# Check server (KoboldCPP native API)
curl http://localhost:5001/api/v1/model

# Check via OpenAI-compatible endpoint
curl http://localhost:5001/v1/models

# Test chat (OpenAI-compatible)
curl http://localhost:5001/v1/chat/completions -H "Content-Type: application/json" -d '{
  "model": "koboldcpp",
  "messages": [{"role": "user", "content": "Hello!"}]
}'
```

### KoboldCPP Tips
- **No installation needed on Windows** — single `.exe` file
- Supports GGUF, GGML model formats
- Has a built-in web UI at `http://localhost:5001`
- Popular in the AI roleplay community but works for any task
- Can run **fully headless** on servers (unlike LM Studio/Jan)
- Use `--gpulayers` to offload layers to GPU for speed
- Very efficient CPU inference with AVX2 support

---

## Innovate Hub Configuration

### Default Configuration (No Changes Needed)

Innovate Hub **auto-detects** all 5 services every 60 seconds. Just start any service and it will appear automatically.

### Custom Port Configuration

If you run services on non-default ports, edit your `.env` file:

```env
# Ollama (default: 11434)
OLLAMA_BASE_URL=http://localhost:11434

# LM Studio (default: 1234)
LM_STUDIO_URL=http://localhost:1234

# GPT4All (default: 4891)
GPT4ALL_URL=http://localhost:4891

# Jan.ai (default: 1337)
JAN_AI_URL=http://localhost:1337

# KoboldCPP (default: 5001)
KOBOLDCPP_URL=http://localhost:5001
```

### How Auto-Detection Works

1. On startup, Innovate Hub scans all 5 service URLs
2. Every 60 seconds, it re-scans for newly started/stopped services
3. When a service is detected, its models appear in the AI chat
4. When a service stops, its models are marked unavailable
5. The fallback chain tries: Cloud APIs → Ollama → Other local services → Built-in responses

### Server Logs

When services are detected, you'll see:
```
[Ollama] Auto-detected with 2 models: qwen2.5:0.5b, tinyllama:latest
[LM Studio] Auto-detected with 3 models: llama-3.1-8b, mistral-7b, phi-3
[Jan] Auto-detected with 1 models: mistral-7b-instruct
[GPT4All] Auto-detected with 2 models: mistral-7b, orca-mini
[KoboldCPP] Auto-detected with 1 models: koboldcpp
```

---

## Running Multiple Services Together

You CAN run multiple services simultaneously, but each model loaded uses RAM:

```
Service overhead:    ~100-200 MB each
Per loaded model:    Model file size × 1.2 (approximate)
```

**Example: 16 GB RAM machine**
- Ollama with Mistral 7B loaded: ~5 GB
- LM Studio with Phi-3 loaded: ~3 GB
- System + Innovate Hub: ~3 GB
- Total: ~11 GB — fits with room to spare ✅

**Recommendation**: Run **one or two services** at a time to avoid memory issues.

---

## Troubleshooting

### Service won't start
| Problem | Solution |
|---------|----------|
| Port already in use | Change the port or stop the conflicting service |
| Model too large | Use a smaller quantization (Q4_K_M instead of Q8) |
| Out of memory | Close other applications, use a smaller model |
| Permission denied (Linux) | Use `chmod +x` on the binary |

### Innovate Hub doesn't detect the service
1. Verify the service is running: `curl http://localhost:<port>/v1/models`
2. Check the port matches your `.env` configuration
3. Restart the Innovate Hub server: `npm start`
4. Wait up to 60 seconds for the next auto-detection scan
5. Check server logs: `tail -f /tmp/server.log`

### Slow responses
- **Use GPU acceleration** — CPU-only is 10-20x slower
- **Use smaller models** — 3B instead of 7B
- **Reduce context length** — Shorter context = faster
- **Use quantized models** — Q4_K_M is fast with minimal quality loss
- **Close other memory-heavy apps**

### Model crashes / gets killed
- The model file is larger than available RAM
- Try a smaller model or smaller quantization
- Enable swap space: `sudo fallocate -l 8G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`

---

## Model Quality Comparison

From worst to best quality (within the same parameter size):

| Quantization | Size vs Original | Quality Loss | Speed |
|-------------|-----------------|--------------|-------|
| Q2_K | ~25% | Noticeable | Fastest |
| Q3_K_M | ~35% | Some | Fast |
| **Q4_K_M** | **~45%** | **Minimal** ⭐ | **Good** |
| Q5_K_M | ~55% | Very little | Moderate |
| Q6_K | ~65% | Negligible | Slower |
| Q8_0 | ~80% | None | Slowest |
| F16 | 100% | None | Very slow |

**Recommendation**: Always use **Q4_K_M** — best balance of quality, speed, and size.

---

## Quick Start Cheat Sheet

```bash
# Start Innovate Hub
cd /workspaces/Innovate-Hub
npm start

# Then start ANY of these (in a separate terminal):

# Option 1: Ollama (easiest)
ollama serve                    # Start server
ollama pull llama3.2            # Download a model

# Option 2: LM Studio
# Open the desktop app → Discover → Download model → Developer → Start Server

# Option 3: GPT4All
# Open the desktop app → Download model → Settings → Enable API Server

# Option 4: Jan.ai  
# Open the desktop app → Hub → Download model → Settings → Start API Server

# Option 5: KoboldCPP
./koboldcpp --model your-model.gguf --port 5001
```

That's it! Innovate Hub will automatically detect whichever service you start. 🚀
