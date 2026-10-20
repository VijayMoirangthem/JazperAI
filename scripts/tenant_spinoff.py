"""Tenant spin-off (Plan V2 G4): package one tenant (company) so it can run on its own.

  python scripts/tenant_spinoff.py baeit            # export + verify in a scratch database (dropped afterwards)
  python scripts/tenant_spinoff.py baeit --keep-db  # keep the restored database jasper_spinoff_baeit for inspection

Produces storage/spinoffs/<tenant>-<stamp>/ with schema.dump (pg_dump -Fc of the tenant schema), bots.json (the tenant's bot
definitions + org placement), manifest.json (row counts per table, sha256, source) and README.txt. The live database is only read.
Tenants: co (Create Origins), baeit, boardmint. Needs the jasper-postgres container running.
"""
import argparse
import hashlib
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GROUP_OF = {"co": "create_origins", "baeit": "baeit", "boardmint": "boardmint"}
PG = "jasper-postgres"


def sh(script: str, stdin: str | None = None) -> str:
    r = subprocess.run(["docker", "exec", "-i", PG, "sh", "-c", script], input=stdin, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"command failed: {script[:80]}\n{r.stderr[:400]}")
    return r.stdout


def psql(sql: str, db: str = '"$POSTGRES_DB"') -> str:
    return sh(f'psql -tA -F "|" -U "$POSTGRES_USER" -d {db}', sql).strip()


def counts(schema: str, db: str) -> dict[str, int]:
    tables = [t for t in psql(f"SELECT tablename FROM pg_tables WHERE schemaname='{schema}' ORDER BY 1", db).splitlines() if t]
    return {t: int(psql(f'SELECT count(*) FROM "{schema}"."{t}"', db)) for t in tables}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("tenant", choices=sorted(GROUP_OF))
    ap.add_argument("--keep-db", action="store_true")
    a = ap.parse_args()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = ROOT / "storage" / "spinoffs" / f"{a.tenant}-{stamp}"
    out.mkdir(parents=True)

    sh(f'pg_dump -U "$POSTGRES_USER" -Fc -n {a.tenant} -f /tmp/spin.dump "$POSTGRES_DB"')
    subprocess.run(["docker", "cp", f"{PG}:/tmp/spin.dump", str(out / "schema.dump")], check=True, capture_output=True)
    sh("rm -f /tmp/spin.dump")

    group = GROUP_OF[a.tenant]
    bots = psql("SELECT json_agg(row_to_json(t)) FROM (SELECT d.*, o.org_group, o.department, o.position, o.sort_order FROM shared.bot_definitions d "
                f"JOIN shared.bot_org o USING (slug) WHERE o.org_group='{group}' ORDER BY d.slug) t")
    (out / "bots.json").write_text(bots if bots and bots != "null" else "[]")

    src = counts(a.tenant, '"$POSTGRES_DB"')
    manifest = {"tenant": a.tenant, "org_group": group, "created": stamp, "tables": src, "bots": len(json.loads((out / "bots.json").read_text())),
                "sha256": {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in out.iterdir() if f.is_file()}}

    scratch = f"jasper_spinoff_{a.tenant}"
    sh(f'psql -q -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS {scratch}" -c "CREATE DATABASE {scratch}"')
    subprocess.run(["docker", "cp", str(out / "schema.dump"), f"{PG}:/tmp/spin.dump"], check=True, capture_output=True)
    sh(f"pg_restore -U \"$POSTGRES_USER\" -d {scratch} --no-owner /tmp/spin.dump; rm -f /tmp/spin.dump")
    restored = counts(a.tenant, scratch)
    manifest["verified"] = restored == src
    manifest["restored_database"] = scratch if a.keep_db else None
    if not a.keep_db:
        sh(f'psql -q -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE {scratch}"')
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    (out / "README.txt").write_text(
        f"Tenant spin-off package for {a.tenant}.\nRestore: createdb <name>; pg_restore -d <name> --no-owner schema.dump\n"
        "bots.json lists the bot definitions and org placement to import into the new deployment's shared.bot_definitions / shared.bot_org.\n"
        "Secrets are NOT included: re-enter provider keys and connector credentials in the new vault.\n")
    print(json.dumps({"package": str(out), "tables": len(src), "rows": sum(src.values()), "bots": manifest["bots"], "verified": manifest["verified"]}))
    sys.exit(0 if manifest["verified"] else 1)


if __name__ == "__main__":
    main()
