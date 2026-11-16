# Set up SpellDirector on Windows

This is for anyone who just downloaded `SpellDirector-vX.Y.Z-windows.exe`. You don't need Python, Git or a terminal. It takes about five minutes.

## What you need

- A Windows PC.
- An AI app that can run SpellDirector's director on your computer. Pick one:
  - **Claude Desktop** (easiest): [claude.ai/download](https://claude.ai/download).
  - **Claude Code**, if you already use it.
  - **Codex**, which is inside the ChatGPT desktop app and also comes as the Codex command line and VS Code extension.

The ChatGPT **website** (and ordinary ChatGPT chats) can't run programs on your computer, so it can't be the director. See [ChatGPT](#chatgpt) for what does work there.

## Five steps

1. **Put the app in its own folder.** Make a folder such as `Documents\SpellDirector` and move the downloaded `.exe` into it. The spells you make are saved in a `SpellDirector Library` folder that appears next to it.
2. **Double-click the app.** If Windows says *"Windows protected your PC"*, click **More info**, then **Run anyway** (the app isn't signed with a paid certificate). A black window opens, then the viewer opens in your browser. Keep the black window open while you use the viewer; closing it stops the viewer.
3. **Connect your AI app.** In the viewer, click **? Help**. Under *Connect your AI*, click **Connect** next to Claude Desktop (or Claude Code, or Codex). It adds SpellDirector to that app's settings for you and keeps anything else that was there.
4. **Restart the AI app.** For Claude Desktop, quitting the window isn't enough: right-click the Claude icon in the taskbar's system tray (by the clock) and choose **Quit**, then open Claude again. For Codex, restart the ChatGPT desktop app. For Claude Code, start a new session.
5. **Check it.** In a new chat, type:

   > List the SpellDirector spells.

   The first time can take up to a minute while the app starts. If you get a list of spells, you're done. Now try:

   > Direct a spell: a quick chain shock that jumps between three enemies, side-scroller.

   The director asks you two or three simple choices, saves the spell and gives you a link that opens it in the viewer.

## Updating to a new version

Download the new `.exe` into the **same folder** as the old one and double-click it once. It notices that your AI app was set up for the old version and switches it to the new one (the black window says so). Restart the AI app. You can delete the old `.exe` afterwards. Your spells stay in `SpellDirector Library`.

## Let an AI walk you through it

**If you use Claude Code or Codex** (they can run commands for you), paste this. The Help page fills in the real path to your app; here, replace the path yourself:

> Set up SpellDirector for me. The app is at `C:\Users\me\Documents\SpellDirector\SpellDirector-vX.Y.Z-windows.exe`. Run it once with the `--setup` argument (for example in PowerShell: `& "<that path>" --setup`), show me what it printed, and tell me which apps I need to restart. Don't edit any settings files by hand; `--setup` does that safely and keeps a backup.

**If you're in a chat that can't touch your computer** (ChatGPT, or Claude on the web), paste this so it guides you one step at a time and doesn't guess:

> I'm setting up a Windows app called SpellDirector. I downloaded SpellDirector-vX.Y.Z-windows.exe. I'm not technical, so give me one step at a time and wait for me to say "done" before the next. Here are the facts, don't add steps that aren't here: (1) Move the exe into its own folder, such as Documents\SpellDirector. (2) Double-click it; if Windows SmartScreen warns me, click "More info" then "Run anyway". A black window and a browser page open. (3) In that browser page, click "? Help", then "Connect" next to Claude Desktop (I need Claude Desktop installed from claude.ai/download first). (4) Fully quit Claude Desktop from the system tray icon (right-click, Quit) and open it again. (5) In Claude Desktop, type "List the SpellDirector spells." It can take up to a minute the first time. If something goes wrong, ask me what I see on screen.

## ChatGPT

Here's what works today and what doesn't:

| Where | Works as the director? | How |
|---|---|---|
| **Codex** (in the ChatGPT desktop app, the Codex CLI, the VS Code extension) | Yes | Click **Connect** next to Codex on the Help page, or run the app with `--setup`. It writes `%USERPROFILE%\.codex\config.toml`, which all three share. |
| **ChatGPT website and ordinary ChatGPT chats** | No | ChatGPT only connects to servers on the internet. Reaching a program on your own computer needs OpenAI's enterprise-only tunnel. |

You can still use an ordinary ChatGPT chat **without the connection**. It can't save or check spells for you, but it can write one:

1. On the Help page, under *No connection?*, download the four director files (playbook, vocabulary, template format, schema) and attach them to the chat.
2. Ask: *"Follow director-playbook.md and write a SpellDirector template (JSON) for: <your spell>. Give me only the JSON."*
3. Save the reply as a `.json` file and open it with **Open JSON…** in the viewer. To keep it in the spell list, put it in `SpellDirector Library\templates\<element>\` (for example `templates\lightning\my-spell.json`).

## If something goes wrong

- **The AI says it doesn't have SpellDirector tools.** You probably didn't fully quit the AI app. Quit it from the system tray and open it again. In Claude Desktop, **Settings → Developer** should list `spelldirector` as *running*.
- **"spelldirector" failed to start, or timed out.** The first start unpacks about 70 MB and can take 10 to 40 seconds; antivirus scanning can make it longer. Restart the AI app once and try again. In Claude Code, start it with a longer limit: in PowerShell, `$env:MCP_TIMEOUT=90000; claude`.
- **You moved or renamed the app.** Double-click it once in its new place, or click **Connect** again on the Help page.
- **Windows deleted the app or blocked it.** Some antivirus tools flag unsigned apps. Restore it from quarantine and allow it.
- **Check what's set up.** Run the app with `--setup --status`: it lists each AI app as set up for this copy, set up for another copy, not set up, or not found.

### Doing it by hand

If you'd rather edit the settings yourself, this is everything **Connect** does.

Claude Desktop: in `%APPDATA%\Claude\claude_desktop_config.json` (Settings → Developer → Edit Config opens it), add this inside `"mcpServers"`:

```json
"spelldirector": {
  "command": "C:\\Users\\me\\Documents\\SpellDirector\\SpellDirector-vX.Y.Z-windows.exe",
  "args": ["--mcp"]
}
```

Claude Code, in a terminal:

```
claude mcp add --scope user spelldirector -- "C:\Users\me\Documents\SpellDirector\SpellDirector-vX.Y.Z-windows.exe" --mcp
```

Codex, at the end of `%USERPROFILE%\.codex\config.toml`:

```toml
[mcp_servers.spelldirector]
command = "C:\\Users\\me\\Documents\\SpellDirector\\SpellDirector-vX.Y.Z-windows.exe"
args = ["--mcp"]
startup_timeout_sec = 120
```

To keep your spells somewhere else, add `"--library", "D:\\My Spells"` after `"--mcp"`.
