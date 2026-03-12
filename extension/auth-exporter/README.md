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

Load it into a named `pp` profile:

```bash
export PP_PROFILE=chatgpt-profile

pp state-load --profile "$PP_PROFILE" ./chatgpt_com.state.json

pp send --profile "$PP_PROFILE" "Reply with AUTH_OK"
```

`pp state-load` installs the JSON as a profile-scoped auth bootstrap file.
Later `pp --profile "$PP_PROFILE" ...` commands reapply that auth when opening
the session.

If you need the real browser user-data-dir for debugging, run:

```bash
pp profile-path --profile "$PP_PROFILE"
```

You can also import/export the same file with Playwright code using
`browser.newContext({ storageState })` and `context.storageState({ path })`.
