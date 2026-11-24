# TALK — a model on your computer that keeps its own memory

The door types a link into ChatGPT, Claude and the rest, because those sites
own the conversation. Talk owns the conversation, so it does what the
Sapphire video does instead: the model is given three tools and uses them
when **it** decides to. Nothing is pasted.

| Tool       | What the model can do                                              |
|------------|--------------------------------------------------------------------|
| `remember` | save a fact to its own memory                                      |
| `recall`   | search its memory, what you told every AI, and what AIs share      |
| `forget`   | drop something it kept, by id or exact wording (only its own)      |

Each model is its own AI. `qwen3:8b` and `llama3.1:8b` get separate memories,
in the same pool the door uses (`<hub>/minds/minds.jsonl`), next to
`chatgpt.com` and `claude.ai`. A memory reaches other AIs only when 3
different AIs keep it on their own. Every conversation is recorded against
the model it went to, and kept in `<hub>/talk/`.

## Set it up (Windows)

1. Install Ollama from <https://ollama.com/download/windows> (no admin needed).
2. Get a model that can use tools. In PowerShell:

   ```
   ollama pull qwen3:8b
   ```

   `qwen3:4b` is lighter for a PC without a big graphics card; `llama3.1:8b`
   also works. Models without tools (gemma3, phi) still work — they save by
   writing `REMEMBER:` lines instead.
3. Start Talk:

   ```
   cd "F:\Users\misfi\Downloads\Forge-Federation"
   node bin\talk.js
   ```

   or double-click `door\start-talk.cmd`. Open <http://127.0.0.1:4850>.

LM Studio instead of Ollama: `node bin\talk.js --api http://127.0.0.1:1234/v1`.

## Safety

- Listens on 127.0.0.1 only. The Host must be loopback (no DNS rebinding).
- A request from any other web page's origin is refused, so a website you
  visit cannot drive the model or read its memory.
- If `--api` points off this computer, the start-up banner says so: your
  words go wherever the model runs.

## Thinking and phones

Thinking models (qwen3, qwen3.5) normally reason to themselves before they answer.
On a phone or a small PC that can take minutes, so Talk turns it off by asking
the server for `reasoning_effort: "none"` (Ollama's switch on its OpenAI-compatible
endpoint). Start with `node bin/talk.js --think` to let the model think first.
A server that does not understand the field is simply asked again without it.

On a narrow screen the page stacks: the chat first, then the conversations and
the model picker, then the memory panel.
