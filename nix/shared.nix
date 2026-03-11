{
  pkgs,
  ...
}:
let
  fs = pkgs.lib.fileset;
  node = pkgs.nodejs_22;
  workspaceRoot = ../.;
  pwShared = import ../../pw/nix/shared.nix { inherit pkgs; };
  pwRuntime = pwShared.workspaceCli;
  fontsConf = pkgs.makeFontsConf {
    fontDirectories = [ pkgs.dejavu_fonts ];
  };

  mkWorkspaceCli =
    {
      pname,
      src,
    }:
    pkgs.buildNpmPackage {
      inherit pname src;
      version = "0.1.0";
      nodejs = node;
      npmDeps = pkgs.importNpmLock {
        npmRoot = src;
      };
      npmConfigHook = pkgs.importNpmLock.npmConfigHook;
      npmBuildScript = "build";
      doCheck = false;
      installPhase = ''
        runHook preInstall
        mkdir -p "$out"
        cp -R dist node_modules package.json package-lock.json "$out/"
        runHook postInstall
      '';
    };

  workspaceSource = fs.toSource {
    root = workspaceRoot;
    fileset = fs.unions [
      (workspaceRoot + "/package.json")
      (workspaceRoot + "/package-lock.json")
      (workspaceRoot + "/tsconfig.json")
      (workspaceRoot + "/src")
    ];
  };

  workspaceAutomationCli = mkWorkspaceCli {
    pname = "pp-automation-cli";
    src = workspaceSource;
  };

  workspacePpCli = mkWorkspaceCli {
    pname = "pp-cli";
    src = workspaceSource;
  };

  mkRunnableCli =
    {
      name,
      builtCli,
      entrypoint,
    }:
    pkgs.writeShellApplication {
      inherit name;
      runtimeInputs = [ node ];
      text = ''
        export NODE_PATH=${builtCli}/node_modules''${NODE_PATH:+:$NODE_PATH}
        exec node ${builtCli}/${entrypoint} "$@"
      '';
    };

  ppCli = mkRunnableCli {
    name = "pp";
    builtCli = workspacePpCli;
    entrypoint = "dist/cli.js";
  };

  ppAutomationCli = mkRunnableCli {
    name = "pp-automation";
    builtCli = workspaceAutomationCli;
    entrypoint = "dist/automation_cli.js";
  };
in
{
  inherit
    fontsConf
    node
    pwShared
    pwRuntime
    ppAutomationCli
    ppCli
    workspaceAutomationCli
    workspacePpCli
    workspaceRoot
    ;
}
