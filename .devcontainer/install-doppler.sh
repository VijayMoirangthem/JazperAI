#!/usr/bin/env bash
# Installs the Doppler CLI from Doppler's signed apt repository.
# Secure: signing key fingerprint is verified before it is trusted.
# Reproducible: CLI version is pinned. Bump DOPPLER_VERSION deliberately.
# Never reads or prints DOPPLER_TOKEN or any secret.
set -euo pipefail

DOPPLER_VERSION="3.77.1"
KEY_FPR="BD8F51EC1320748CED4E6E3BDE2A7741A397C129"
KEY_URL="https://packages.doppler.com/public/cli/gpg.DE2A7741A397C129.key"
KEYRING="/usr/share/keyrings/doppler-archive-keyring.gpg"

if command -v doppler >/dev/null 2>&1 && [ "$(doppler --version | tr -d v)" = "$DOPPLER_VERSION" ]; then
  echo "doppler $DOPPLER_VERSION already installed"; exit 0
fi

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
curl -fsSL --tlsv1.2 --proto "=https" --retry 3 -o "$tmp/key.asc" "$KEY_URL"

actual="$(gpg --show-keys --with-colons "$tmp/key.asc" | awk -F: '/^fpr:/{print $10; exit}')"
if [ "$actual" != "$KEY_FPR" ]; then
  echo "Doppler signing key fingerprint mismatch; aborting." >&2; exit 1
fi

gpg --dearmor < "$tmp/key.asc" | sudo tee "$KEYRING" >/dev/null
echo "deb [signed-by=$KEYRING] https://packages.doppler.com/public/cli/deb/debian any-version main" \
  | sudo tee /etc/apt/sources.list.d/doppler-cli.list >/dev/null
sudo apt-get update -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/doppler-cli.list \
  -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0
sudo apt-get install -y "doppler=$DOPPLER_VERSION"
doppler --version
