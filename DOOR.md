# DOOR — any AI, any model, one click

**One sentence:** the door is a small server on your own computer, and the
Forge Federation Link extension is a button that links whatever AI is open in
the tab — ChatGPT, Claude, Gemini, Perplexity — to the Federation, where each
AI keeps its own memory, by its own choice, and the Federation keeps all of
them.

The desk (`bin/desk.js`) only talks to a model on this machine. The door does
not talk to a model at all. It talks to the **page**, so the model behind the
page does not matter.

---

## Set it up once (Windows, Edge or Chrome)

1. **Open the door.** In PowerShell:

   ```powershell
   cd "F:\Users\misfi\Downloads\Forge-Federation-main\Forge-Federation-main"
   node bin/door.js
   ```

   Or double-click `door\start-door.cmd`. Leave the window open. It prints a
   **PAIRING CODE**.

2. **Load the extension.**
   - Edge: go to `edge://extensions`, turn on **Developer mode**, click
     **Load unpacked**, pick the `door\extension` folder.
   - Chrome: same at `chrome://extensions`.

3. **Pair.** The extension's options page opens the first time you click it
   (or right-click the icon → **Extension options**). Paste the pairing code,
   click **Save and test**. It should say `Paired`.

4. **Pin it.** Click the puzzle-piece icon in the toolbar and pin
   **Forge Federation Link** so the button is always visible.

## Every time you use an AI

1. Open the AI in a tab. On ChatGPT, Claude, Gemini, Perplexity, Copilot,
   DeepSeek, Grok and Mistral there is nothing to click: the link is typed
   into the chat box by itself, once per conversation. A conversation that
   already shows `[Forge Federation link]` is left alone. A small bar in the
   corner shows it is on (click it to open the panel).
2. On any other site, click the **Forge Federation Link** button (or press
   **Alt+Shift+F**). The button also re-links by hand anywhere.
3. The link is typed into the chat box. It tells the AI who it is, what it
   remembered last time, what you told every AI, and what several AIs share.
   Add your message under it and send.
4. From then on the AI decides. Any time it writes `REMEMBER: …` or
   `FORGET: …`, that lands in **its own** memory straight away. The panel
   shows each one with **Undo**, in case you disagree.
5. To tell **every** AI something, type it in the panel's box.

Auto-link can be switched off in the extension's options. Arena (arena.ai,
lmarena.ai) is deliberately not on the automatic list: Arena may share
conversations with model providers and publicly, so linking there stays a
choice you make with the button.

---

## How the memory is laid out

```
   ChatGPT        Claude         Gemini        Perplexity
 ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
 │ its own │   │ its own │   │ its own │   │ its own │   each AI reads only
 │  lane   │   │  lane   │   │  lane   │   │  lane   │   its own lane
 └────┬────┘   └────┬────┘   └────┬────┘   └────┬────┘
      └─────────────┴──────┬──────┴─────────────┘
              ┌────────────┴────────────┐
              │  THE POOL  minds.jsonl  │   every memory, every AI,
              │  who · which chat · when│   every conversation, forever
              └────────────┬────────────┘
                           │  remembered on their own by 3 different AIs
                           ▼
                 SHARED — every AI is shown it, labelled shared
```

| | who writes it | who reads it | where it lives |
|---|---|---|---|
| **your memories** | you, in the panel | every AI | `forge-passport/` in the repo, witness `human` |
| **an AI's lane** | that AI, by its own choice | only that AI | `%USERPROFILE%\.forge-federation\minds\minds.jsonl` |
| **shared** | nobody directly — it is earned | every AI | derived from the pool |

**Who an AI is** comes from the tab's web address (`chatgpt.com`, `claude.ai`),
read by the extension — never from anything the page or the model says. A
model cannot pretend to be a different AI by typing a name. It is the same
rule Forge Flight uses: one seat per site.

**Which conversation** is the chat's address (`chatgpt.com/c/…`). Every line in
the pool records the AI and the conversation it came from, so you can always
answer "who said this, in which chat, when".

**Why one AI cannot corrupt another.** A model that gets something wrong, or a
web page that tricks one model, can only write into that model's lane. It
reaches the others only if **3 different AIs** remember the same thing
independently. One AI saying it ten times, in ten chats, is still one AI. That
is the Federation's existing rule for outcomes (`OUTCOME_REPLICATION`):
replication, not agreement.

**Nothing is deleted.** `FORGET` and your **Undo** are new lines that retire a
memory; the old line stays. The pool is append-only and hash-chained.

See it all from PowerShell:

```powershell
node bin/door.js --minds
```

## Why web pages cannot use the door

| guard | what it stops |
|---|---|
| listens on `127.0.0.1` only | nothing off your computer can reach it |
| pairing code in a header on every request except `/health` | a page cannot read the code; only the extension holds it |
| any `http(s)://` Origin is refused, and no CORS header is ever sent | a page that guesses the code still cannot read or write |
| Host header must be loopback | DNS-rebinding tricks |
| 64 KB body, 20 facts per save, 450 characters per fact | flooding the chain |

The pairing code lives in `%USERPROFILE%\.forge-federation\door.token`, never
in the repository. Delete that file and restart the door to issue a new one;
re-paste it in the extension.

The desk was also changed: it now listens on `127.0.0.1` instead of every
network (`0.0.0.0`), and it refuses cross-origin requests instead of sending
`access-control-allow-origin: *` — before, any website you visited could write
into the passport through it.

---

## The API, for anything else that wants in

| | |
|---|---|
| `GET /health` | `{ ok, door, version }` — no code needed, says nothing else |
| `GET /link?url=TAB` | `{ ai, name, conversation, text, memories, own }` — logs the link and returns that AI's briefing. `?full=1` appends PASSPORT.md |
| `POST /remember` `{ facts, url, by: "ai" }` | into that AI's lane, no approval |
| `POST /remember` `{ facts, url, by: "human" }` | into your passport, witness `human` |
| `POST /forget` `{ facts, url }` | retires facts from that AI's own lane only |
| `POST /retract` `{ id }` | you took one back; recorded as `by: human` |
| `GET /minds` | the roster, conversations, shared facts, and a chain check |

All but `/health` need header `x-forge-door: <pairing code>`.

## What it does not do yet

- **Forge Flight / OmniBox seats.** The extension works in Edge and Chrome.
  OmniBox is Electron; a seat needs the same two calls (`/link` before the
  first prompt, `/remember` on a saved line) wired into its own boot block.
- **Auto-link on every site.** Automatic linking covers only the AI sites
  listed in `manifest.json`; anything else needs the button. Adding a site
  means adding it there (the browser will ask for that permission).
- **Meaning, not wording.** "Dwayne drinks dark roast" and "the user likes
  dark roast" are two different memories today. Case, spacing and a final
  full stop are ignored; paraphrase is not. The passport's equation form is
  the way to close that, and is not wired in yet.
- **Several models on one site.** Perplexity or ChatGPT running different
  models count as one AI — the site. Splitting by model would mean trusting
  the page to say which model it is.
- **Firefox and Safari** are untested.
