{
  lib,
  pkgs,
  ...
}:

let
  shared = import ./nix/shared.nix { inherit pkgs; };
in

{
  imports = [ ./nix ];

  env = {
    CHROMIUM_BIN = lib.getExe pkgs.chromium;
    FONTCONFIG_FILE = shared.fontsConf;
    PP_BROWSER = lib.mkDefault "chromium";
  };

  packages = [
    shared.node
    shared.ppCli
    pkgs.typescript
    pkgs.chromium
    pkgs.fontconfig
    pkgs.dejavu_fonts
    pkgs.git
    pkgs.just
  ];

  scripts = {
    check.exec = lib.mkDefault "npm run check";
    test.exec = lib.mkDefault "npm test";
    test-playwright.exec = lib.mkDefault ''
      export CHROMIUM_BIN="${lib.getExe pkgs.chromium}"
      npm run test:playwright
    '';
  };

  enterShell = ''
    echo "Run: npm install"
    echo "Run: pp"
    echo "Run: check"
    echo "Run: test"
    echo "Run: test-playwright"
  '';

  enterTest = ''
    set -euo pipefail
    node --version
    npm --version
    tsc --version
    chromium --version
  '';

  composer.ownInstructions =
    let
      currentProject = builtins.baseNameOf (toString ./.);
    in
    lib.optionalAttrs (builtins.pathExists ./AGENTS.md) {
      "${currentProject}" = [ (builtins.readFile ./AGENTS.md) ];
    };
}
