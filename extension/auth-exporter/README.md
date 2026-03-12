# PP Auth Exporter Extension

Chrome extension that exports cookies as Playwright `storageState` JSON.

## Load Extension

1. Open `chrome://extensions`.
2. Enable developer mode.
3. Click load unpacked.
4. Select `extension/auth-exporter`.

## Export Cookies

1. Open the extension popup.
2. Add/select domains. The current tab hostname is prefilled.
3. Click `Download storageState JSON`.
4. Save the downloaded file, for example `chatgpt_com.state.json`.

The downloaded file is Playwright storage state JSON with this shape:

```json
{
  "cookies": [],
  "origins": []
}
```

## Use Exported Auth State

Load it into a Playwright-backed persistent profile with `pw-cli`:

```bash
export PP_PROFILE=chatgpt-profile
export PP_USER_DATA_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/pp/profiles/${PP_PROFILE}/browser-state/v1/linux"

pw-cli open https://chatgpt.com --headed --persistent --profile "$PP_USER_DATA_DIR"
pw-cli state-load ./chatgpt_com.state.json
pw-cli reload
pw-cli close

pp send --profile "$PP_PROFILE" "Reply with AUTH_OK"
```

You can also import/export the same file with Playwright code using
`browser.newContext({ storageState })` and `context.storageState({ path })`.
