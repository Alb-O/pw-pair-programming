# PP

Pair programming CLI for ChatGPT navigation and Playwright automation.

The repo also exposes reusable packaged runtimes through devenv/Nix:

- `pp-core`: built package root with `dist/` and bundled `node_modules` for the main `pp` CLI
- `pp-cli`: runnable wrapper binary for `dist/cli.js`
- `pp-cli-built`: alias for the built `pp` package root
- `pw-core`: built `pw` runtime consumed by the automation module

## Ecosystem Modules

- `automation` module: `pw` runtime plus e2e/demo commands
- `pp` module: ChatGPT navigation loop plus auth listener
- `src/cli.ts` is the single CLI entrypoint for both command sets

## Commands

```bash
devenv shell

# build + unit tests
npm run test
# navigator-only unit tests
npm run test:navigator
# navigator playwright specs
npm run test:playwright:navigator
# optional headful playwright run
PP_HEADFUL=1 npm run test:playwright:headful

# bind a project for this shell session (env-only persistence)
export PP_CHATGPT_PROJECT=g-p-abc123
export PP_PROFILE=chatgpt-profile
export PP_BROWSER=chromium
export PP_PROFILE_DIR=${XDG_STATE_HOME:-$HOME/.local/state}/pp/profiles/${PP_PROFILE}

# one-shot send + wait from CLI (logged-in profile)
pp send --profile "$PP_PROFILE" "Reply with PP_OK"
# async loop: send now, wait later
pp send --profile "$PP_PROFILE" --no-wait "Reply with PP_ASYNC_OK" && pp wait --profile "$PP_PROFILE"
# list interpreter sandbox artifacts from active conversation
pp download --profile "$PP_PROFILE" --list
# download last artifact (or choose --index <n>)
pp download --profile "$PP_PROFILE" --output ./artifacts/latest.txt
# create a new chat and default to thinking model
pp new --profile "$PP_PROFILE"
# compose + brief loop
pp brief --profile "$PP_PROFILE" --preamble-file ./docs/preamble.md src/cli.ts src/navigator/runtime/cli_runner.ts:1-180
# compose + brief with attachment(s) in same send
pp brief --profile "$PP_PROFILE" --preamble-file ./docs/preamble.md src/cli.ts --attach ./artifacts/screenshot.png
# brief defaults to uploading selected entries as a tar.gz attachment
pp brief --profile "$PP_PROFILE" --preamble-file ./docs/preamble.md src/cli.ts src/navigator/runtime/cli_runner.ts:1-180
# opt back into inline entry pasting
pp brief --profile "$PP_PROFILE" --preamble-file ./docs/preamble.md --inline-entries src/cli.ts
# attach files + stdin payload and wait for response
cat note.md | pp attach --profile "$PP_PROFILE" a.png --name note.md --send --wait-for-response
# paste stdin as raw composer text (not attachment)
printf "quick note" | pp paste --profile "$PP_PROFILE" --send --clear

# run one-shot send with exported storage-state auth file (no profile dir)
pp send --auth-file ${XDG_STATE_HOME:-$HOME/.local/state}/pp/auth/chatgpt_com.json "Reply with PP_OK"
# show isolation/session metadata
pp isolate --profile "$PP_PROFILE" --json
# run auth listener for extension cookie export
pp auth-listen
# run opt-in live roundtrip spec against chatgpt.com (requires logged-in profile)
PP_CHATGPT_LIVE=1 PP_CHATGPT_PROFILE_DIR="$PP_PROFILE_DIR" npm run test:playwright:navigator -- chatgpt_live_roundtrip.spec.ts
```
