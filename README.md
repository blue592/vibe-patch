# Vibe Patch

**Describe a change. Choose Claude, OpenAI, or Gemini. Review it. Apply it.**

An MIT-licensed local CLI for conversational coding with three model providers. Bring your own API keys, select the files to share, and keep control over every write.

## Features

- `chat`: iterate on code and switch providers during a session.
- `propose`: generate complete UTF-8 files from a natural-language request.
- `preview` and `apply`: compare original and proposed contents before typing `APPLY`.
- `undo`: restore originals using a backup ID, with conflict checks.
- `demo`: test the review/apply workflow offline, without API keys.
- Selected context only: no automatic repository upload or hidden file scan.

## Install from source

Requires Node.js 22 or later and npm.

```sh
npm ci
npm link
vibe-patch --help
```

Alternatively, run `node /absolute/path/to/vibe-patch/src/cli.js` instead of `vibe-patch`. This package is not yet published to npm.

## Try it without an API key

```sh
mkdir my-demo
cd my-demo
vibe-patch demo
vibe-patch preview
vibe-patch apply
```

Type `APPLY` to create `vibe-demo.html`, then open it in a browser. The demo is a fixed fixture, not AI generation. The apply command prints an undo ID:

```sh
vibe-patch undo BACKUP_ID
```

## Connect a provider

Copy `.env.example` to a private `.env` file and fill in the keys for the providers you use. Never commit it. Node's `--env-file` can load it without placing keys in command history:

```sh
node --env-file=/private/path/.env /path/to/vibe-patch/src/cli.js chat --provider claude --model YOUR_CLAUDE_MODEL_ID
```

If the variables are already exported in your shell, use:

```sh
vibe-patch chat --provider claude --model YOUR_CLAUDE_MODEL_ID
vibe-patch chat --provider openai --model YOUR_OPENAI_MODEL_ID
vibe-patch chat --provider gemini --model YOUR_GEMINI_MODEL_ID
```

The `YOUR_*_MODEL_ID` strings are placeholders. Use an exact text-generation model ID available to your API account. No time-sensitive default model is hardcoded.

| Product | `--provider` | Environment variable | Model catalog |
| --- | --- | --- | --- |
| Claude | `claude` | `ANTHROPIC_API_KEY` | [Anthropic models](https://platform.claude.com/docs/en/about-claude/models/overview) |
| ChatGPT / OpenAI models | `openai` | `OPENAI_API_KEY` | [OpenAI models](https://developers.openai.com/api/docs/models) |
| Gemini | `gemini` | `GOOGLE_GENERATIVE_AI_API_KEY` | [Google models](https://ai.google.dev/gemini-api/docs/models) |

This tool uses direct provider APIs through AI SDK adapters. It does not log into the ChatGPT, Claude, or Gemini websites. Web subscriptions do not supply API credentials for this tool. Provider usage charges and account limits apply. Keep credentials private; OpenAI recommends loading API keys from environment variables or a key manager ([official authentication documentation](https://developers.openai.com/api/reference/overview)).

## Make changes

Inside your project:

```sh
vibe-patch propose "Create a responsive todo app in index.html with localStorage" --provider gemini --model YOUR_GEMINI_MODEL_ID
vibe-patch apply
```

To modify existing files, explicitly select each file:

```sh
vibe-patch propose "Add keyboard navigation" --provider openai --model YOUR_OPENAI_MODEL_ID --file index.html --file styles.css
vibe-patch apply
```

Use `--root DIRECTORY` to target an existing project folder. All paths supplied with `--file` are relative to that folder. File contents are sent to the selected provider when you submit the request; inspect them for secrets first. The path blocklist is not a secret-content scanner.

## Conversational coding

```sh
vibe-patch chat --provider claude --model YOUR_CLAUDE_MODEL_ID --file index.html
```

Type a request such as `Add a dark-mode toggle and remember the choice`. Review the whole-file comparison, then type `APPLY` or press Enter to skip. Applied files become context for subsequent requests in that session.

Commands inside chat:

```text
/model openai YOUR_OPENAI_MODEL_ID
/model gemini YOUR_GEMINI_MODEL_ID
/model claude YOUR_CLAUDE_MODEL_ID
/files index.html styles.css
/exit
```

Switching providers sends the current selected files to the new provider on the next request. `/files` replaces the selection; use `/files` alone to clear it. For paths containing spaces, use `propose` with quoted repeated `--file` flags. Chat sends the current request and selected file contents each turn; it does not retain prior conversational prose or persist a chat transcript.

## Review and recovery

Proposals are stored locally in `.vibepatch/pending.json`. The comparison prints entire old and new files with `-` and `+` prefixes; it is for human review, not a patch for `git apply`. A new proposal replaces the pending one. API calls do not write project source files.

`apply` requires an interactive terminal and rechecks every file against its original content. Existing files can be changed only if explicitly selected during generation. Each applied change stores originals in `.vibepatch/BACKUP_ID.json`. Keep `.vibepatch/` out of source control; it contains copies of source code. A stale proposal or undo refuses to overwrite newer content.

Use a Git checkpoint before applying. Writes have best-effort rollback on ordinary I/O errors and keep the backup journal. They are not a crash-atomic filesystem transaction, and undo can partially complete on disk failure. Do not run multiple instances or modify the target directory concurrently. The CLI is a local development tool, not a sandbox against another process that can mutate the project at the same time.

## Scope

- Maximum 20 output files and 200 KB total output; selected context is capped at 200 KB.
- UTF-8 text only. No deletion proposals, binary files, or shell/test execution.
- Rejects traversal, symlink components, hard-linked existing files, credential filenames, internal storage, `.git`, and `node_modules` paths.
- Does not automatically read `.gitignore`; only explicitly selected files are read.
- Each API request times out after 120 seconds and has no automatic retries. Invalid or truncated responses are rejected; make a smaller request if necessary.
- Generated code still needs your review and project-specific tests. Suggested commands in the summary are never executed.
- The repository does not bundle an editor UI, autonomous tool loop, deployment service, or API keys.

## Development

```sh
npm ci
npm run check
npm test
npm pack --dry-run
```

Tests cover proposal validation, file conflicts, backups/undo, path containment, CLI demo flow, the real SDK generation pipeline with mock models, and all three provider adapters using intercepted HTTP requests. No live provider calls are made in tests. A successful adapter test does not establish live account access or generated code quality.

See [한국어 사용법](README.ko.md), [contributing](CONTRIBUTING.md), and [security notes](SECURITY.md).
