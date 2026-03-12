{
  inputs,
  pkgs,
  ...
}:

let
  shared = import ../nix/shared.nix {
    inherit inputs pkgs;
  };
in
{
  packages = [ shared.ppCli ];
}
