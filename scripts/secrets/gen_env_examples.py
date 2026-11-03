"""Generate sanitized .env.example templates from config/secrets.manifest.json.
Secrets are always emitted EMPTY; config/public values get their non-sensitive defaults.
  python scripts/secrets/gen_env_examples.py          # write
  python scripts/secrets/gen_env_examples.py --check  # exit 1 if any template is stale (used by CI/tests)
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def render(manifest: dict, service: str) -> str:
    info = manifest["services"][service]
    lines = [f"# {info['title']}", "# GENERATED from config/secrets.manifest.json - edit the manifest, then run",
             "#   python scripts/secrets/gen_env_examples.py",
             "# Names only. Secrets stay empty here and live in the central vault (docs/SECRETS_ARCHITECTURE.md)."]
    if service in ("frontend", "app"):
        lines.append("# Public values only: anything with a NEXT_PUBLIC_/VITE_ prefix is shipped to browsers. Never put a secret here.")
    for kind, head in (("secret", "Secrets (server-only, from the vault)"), ("config", "Config (non-sensitive)"), ("public", "Public (browser-safe)")):
        group = [v for v in manifest["variables"] if service in v["services"] and v["kind"] == kind]
        if not group:
            continue
        lines += ["", f"# --- {head} ---"]
        for v in group:
            req = v.get("required_in")
            tag = f" [required in: {', '.join(req)}]" if req else ""
            note = f" - {v['note']}" if v.get("note") else ""
            if tag or note:
                lines.append(f"# {v['name']}:{tag}{note}")
            lines.append(f"{v['name']}={'' if kind == 'secret' else v.get('default', '')}")
    return "\n".join(lines) + "\n"


def main() -> int:
    manifest = json.loads((ROOT / "config" / "secrets.manifest.json").read_text(encoding="utf-8"))
    stale = []
    for service, info in manifest["services"].items():
        path = ROOT / info["example"]
        text = render(manifest, service)
        if "--check" in sys.argv:
            if not path.exists() or path.read_text(encoding="utf-8") != text:
                stale.append(info["example"])
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8", newline="\n")
            print("wrote", info["example"])
    if stale:
        print("stale templates (run gen_env_examples.py):", ", ".join(stale), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
