"""Derive only musician tokens into the encrypted worker consumer."""

import json
import subprocess
from pathlib import Path

store = Path.home() / "tangled.org/zzstoatzz.io/secrets"
raw = subprocess.run(
    ["sops", "-d", "--output-type", "json", str(store / "prod.yaml")],
    capture_output=True,
    check=True,
)
entries = json.loads(raw.stdout)["atproto"]["agent_musicians"]
subset = {name: {"plyr_token": entry["plyr_token"]} for name, entry in entries.items()}
subset["gemini_api_key"] = json.loads(raw.stdout)["local"]["gemini_api_key"]
current = subprocess.run(
    [
        "ssh",
        "-o",
        "BatchMode=yes",
        "stoat@heavypad",
        "sops -d --output-type json ~/.config/musician-studio/credentials.yaml",
    ],
    capture_output=True,
    check=False,
)
if current.returncode == 0 and json.loads(current.stdout) == subset:
    print("Encrypted musician tokens already current")
    raise SystemExit(0)
encrypted = subprocess.run(
    [
        "sops",
        "--encrypt",
        "--input-type",
        "json",
        "--output-type",
        "yaml",
        "--filename-override",
        str(store / "studio-runtime.yaml"),
        "/dev/stdin",
    ],
    input=json.dumps(subset).encode(),
    capture_output=True,
    check=True,
    cwd=store,
)
result = subprocess.run(
    [
        "ssh",
        "-o",
        "BatchMode=yes",
        "stoat@heavypad",
        "umask 077; mkdir -p ~/.config/musician-studio; cat > ~/.config/musician-studio/credentials.next.yaml && mv ~/.config/musician-studio/credentials.next.yaml ~/.config/musician-studio/credentials.yaml",
    ],
    input=encrypted.stdout,
    capture_output=True,
    check=True,
)
verify = subprocess.run(
    [
        "ssh",
        "-o",
        "BatchMode=yes",
        "stoat@heavypad",
        "sops -d --output-type json ~/.config/musician-studio/credentials.yaml",
    ],
    capture_output=True,
    check=True,
)
assert json.loads(verify.stdout) == subset
print(
    f"{len(entries)} encrypted musician tokens and audio credential provisioned and equality verified on heavypad."
)
