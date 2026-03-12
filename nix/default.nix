{
  inputs,
  pkgs,
  ...
}:

let
  shared = import ./shared.nix {
    inherit inputs pkgs;
  };
in
{
  outputs = {
    pp = shared.ppCli;
    pp-cli = shared.ppCli;
    pp-core = shared.workspacePpCli;
    pp-cli-built = shared.workspacePpCli;
    pp-automation = shared.ppAutomationCli;
    pp-automation-cli = shared.ppAutomationCli;
    pw-core = shared.pwRuntime;

    pp-e2e = pkgs.writeShellApplication {
      name = "pp-e2e";
      runtimeInputs = [
        shared.node
        pkgs.chromium
      ];
      text = ''
        set -euo pipefail
        NODE_PATH=${shared.workspaceAutomationCli}/node_modules \
          node ${shared.workspaceAutomationCli}/dist/automation_cli.js run-e2e --playwright-root ${shared.pwRuntime} --chromium-bin "$(command -v chromium)"
      '';
    };

    pp-demos = pkgs.writeShellApplication {
      name = "pp-demos";
      runtimeInputs = [
        shared.node
        pkgs.chromium
      ];
      text = ''
        set -euo pipefail
        workdir="$(mktemp -d)"
        outdir="$workdir/demos"

        NODE_PATH=${shared.workspaceAutomationCli}/node_modules \
          node ${shared.workspaceAutomationCli}/dist/automation_cli.js run-demos --playwright-root ${shared.pwRuntime} --chromium-bin "$(command -v chromium)" --output-dir "$outdir"

        echo "demo artifacts: $outdir"
        cat "$outdir/summary.json"
      '';
    };

    pp-specs = pkgs.writeShellApplication {
      name = "pp-specs";
      runtimeInputs = [
        shared.node
        pkgs.chromium
        pkgs.fontconfig
        pkgs.dejavu_fonts
      ];
      text = ''
        set -euo pipefail
        workdir="$(mktemp -d)"
        cp -R ${shared.workspaceRoot} "$workdir/workspace"
        chmod -R u+w "$workdir/workspace"
        cp -R ${shared.workspacePpCli}/node_modules "$workdir/workspace/node_modules"

        cd "$workdir/workspace"
        export XDG_CACHE_HOME="$workdir/xdg-cache"
        export XDG_CONFIG_HOME="$workdir/xdg-config"
        export XDG_DATA_HOME="$workdir/xdg-data"
        export FONTCONFIG_FILE=${shared.fontsConf}
        export CHROMIUM_BIN="$(command -v chromium)"
        ./node_modules/.bin/playwright test --config=playwright.config.ts
      '';
    };
  };
}
