{ pkgs, ... }:

let
  shared = import ../nix/shared.nix { inherit pkgs; };
in
{
  packages = [ shared.ppCli ];
}
