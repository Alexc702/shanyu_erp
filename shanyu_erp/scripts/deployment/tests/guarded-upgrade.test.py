"""Local command-orchestration tests: synthetic files and mocked Docker, never SSH."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True

SCRIPTS = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("manifest", SCRIPTS / "release-manifest.py")
MANIFEST = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MANIFEST)

MOCK = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
args=sys.argv[1:]; name=pathlib.Path(sys.argv[0]).name
root=pathlib.Path(os.environ['FIXTURE']); fault=os.environ.get('FAULT','')
def fail(phase):
    if fault==phase: sys.exit(3)
if name=='cat' and args==['/etc/machine-id']: print('a'*32); sys.exit()
if name=='cat': os.execv('/bin/cat',['cat',*args])
if name=='realpath': print(pathlib.Path(args[-1]).resolve(strict=True)); sys.exit()
if name=='mv':
    if args[0].endswith('preview.pending'): fail('archive')
    os.execv('/bin/mv',['mv',*args])
if name=='stat': print('600' if args[1]=='%a' else '600:1000:1000'); sys.exit()
if name=='flock': fail('lock'); sys.exit()
if name=='df': print('Filesystem 1M-blocks Used Available Use% Mounted\nfixture 9999 1 9998 1% /'); sys.exit()
if name=='sudo': os.execvp(args[0],args)
if name=='curl': fail('health'); print('{"status":"ok"}'); sys.exit()
with (root/'commands').open('a') as f: f.write(' '.join(args)+'\n')
if args[0]=='image':
    fail('image'); service='api' if 'api:' in args[-1] else 'web'
    print('sha256:'+('b' if service=='api' else 'c')*64+' amd64 '+'d'*40); sys.exit()
if args[0]=='wait': print('0'); sys.exit()
if args[0]=='inspect':
    template=args[2]; service=args[-1]
    if '.Destination' in template: print('shanyu-erp_postgres_data' if service=='postgres' else 'shanyu-erp_quotation_exports')
    elif '.Health.Status' in template: print('healthy false 0')
    elif '.Image' in template: print('sha256:'+('c' if service=='web' else 'b')*64)
    else: print('true' if service=='postgres' else 'false')
    sys.exit()
if 'config' in args:
    if '--format' in args:
        print(json.dumps({'name':'shanyu-erp','services':{
          'postgres':{'volumes':[{'type':'volume','target':'/var/lib/postgresql','source':'postgres_data'}]},
          'api':{'volumes':[{'type':'volume','target':'/app/export-files','source':'quotation_exports'}]},
          'web':{},'export-storage-init':{'volumes':[{'type':'volume','target':'/app/export-files','source':'quotation_exports'}]},
          'export-worker':{'volumes':[{'type':'volume','target':'/app/export-files','source':'quotation_exports'}]}},
          'volumes':{'postgres_data':{'name':'shanyu-erp_postgres_data'},'quotation_exports':{'name':'shanyu-erp_quotation_exports'}}}))
elif 'ps' in args: print(args[-1])
elif 'run' in args:
    if 'scripts/run-migrations.mjs' in args: fail('migration')
    elif 'scripts/deployment-data-baseline.mjs' in args:
        if args[-1]=='snapshot': print('{}')
        else: sys.stdin.read(); fail('baseline'); print('{"verified":true}')
    elif 'scripts/reconcile-main-material-drafts.mjs' in args:
        phase='apply' if '--apply' in args else 'preview'; fail(phase)
        if fault=='invalid-preview': print('incomplete json'); sys.exit()
        print(json.dumps({'targetCatalogId':'32323232-3232-4232-8232-323232323232','targetCatalogHash':'e'*64,
          'planHash':'f'*64,'policy':'zero-impact-v1','entries':[], 'summary':{'UPDATED':0}, 'mode':phase}))
elif 'exec' in args and any('SELECT count(*)' in a for a in args): print('0')
'''


class UpgradeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="shanyu-guarded-test-")
        self.root = Path(self.temp.name)
        self.bundle = self.root / "bundle"
        self.live = self.root / "live"
        self.bin = self.root / "bin"
        self.scripts = self.bundle / "scripts/deployment"
        self.scripts.mkdir(parents=True)
        self.live.mkdir()
        self.bin.mkdir()
        for filename in ("server-upgrade.sh", "server-guarded-upgrade.sh", "server-common.sh", "release-manifest.py", "upgrade-evidence.py"):
            shutil.copy(SCRIPTS / filename, self.scripts / filename)
        for directory in (self.bundle, self.live):
            (directory / "compose.prod.yaml").write_text("name: shanyu-erp\n")
            (directory / "Caddyfile").write_text(":80 {}\n")
        (self.live / ".env.production").write_text("SHANYU_DEPLOYMENT_ENVIRONMENT=test\nSHANYU_BACKUP_MODE=local\nWEB_ORIGIN=http://115.159.50.166\n")
        (self.live / ".env.production").chmod(0o600)
        (self.live / ".release.env").write_text("API_IMAGE=old-api\nWEB_IMAGE=old-web\nRELEASE_VERSION=old\n")
        self.value = {"schema": 1, "environment": "test", "origin": "http://115.159.50.166", "release": "test-next",
                      "previousRelease": "old", "commit": "d" * 40, "machineId": "a" * 32,
                      "api": {"ref": "shanyu-erp-api:test-next", "id": "sha256:" + "b" * 64},
                      "web": {"ref": "shanyu-erp-web:test-next", "id": "sha256:" + "c" * 64},
                      "catalog": {"id": "32323232-3232-4232-8232-323232323232", "sha256": "e" * 64},
                      "postgresVolume": "shanyu-erp_postgres_data", "exportsVolume": "shanyu-erp_quotation_exports"}
        self.manifest = self.root / "release.json"
        self.manifest.write_text(json.dumps(self.value))
        for command in ("docker", "sudo", "curl", "cat", "stat", "flock", "df", "realpath", "mv"):
            path = self.bin / command
            path.write_text(MOCK)
            path.chmod(0o755)
        # macOS has shasum rather than sha256sum.
        path = self.bin / "sha256sum"
        path.write_text('#!/usr/bin/env python3\nimport hashlib,sys\nfor p in sys.argv[1:]:\n print(hashlib.sha256(open(p,"rb").read()).hexdigest()+"  "+p)\n')
        path.chmod(0o755)
        backup = self.scripts / "server-backup.sh"
        backup.write_text('''#!/usr/bin/env bash
set -eu
[ "${FAULT:-}" != backup ]
if [[ "$SHANYU_BACKUP_RESULT_FILE" == */after.path ]]; then [ "${FAULT:-}" != post-backup ]; fi
mkdir -p "$SHANYU_DEPLOY_ROOT/backups"
p="$SHANYU_DEPLOY_ROOT/backups/$(basename "$SHANYU_BACKUP_RESULT_FILE").dump"
printf 'synthetic dump' >"$p"
printf 'format=test' >"$p.meta"
sha256sum "$p" "$p.meta" >"$p.sha256"
printf '%s\\n' "$p" >"$SHANYU_BACKUP_RESULT_FILE"
if [ "${FAKE_COS_OK:-0}" = 1 ]; then printf 'synthetic COS readback marker' >"$p.cos"; fi
''')
        self.env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}", "FIXTURE": str(self.root), "SHANYU_DEPLOY_ROOT": str(self.live)}

    def tearDown(self):
        self.temp.cleanup()

    def run_upgrade(self, fault=""):
        return subprocess.run(["bash", str(self.scripts / "server-upgrade.sh"), str(self.manifest), self.value["environment"] + ":test-next"],
                              env={**self.env, "FAULT": fault}, capture_output=True, text=True)

    def test_success_order_reports_permissions_and_repeat(self):
        before = (self.live / ".env.production").read_bytes()
        result = self.run_upgrade()
        self.assertEqual(result.returncode, 0, result.stderr)
        commands = (self.root / "commands").read_text()
        self.assertLess(commands.index("stop -t 120"), commands.index("scripts/run-migrations.mjs"))
        self.assertLess(commands.index("--dry-run"), commands.index("--apply"))
        self.assertIn("--plan-hash=" + "f" * 64, commands)
        self.assertNotIn(" build ", commands)
        self.assertNotIn(" down ", commands)
        report = next((self.live / "deployment-reports").iterdir())
        for name in ("preview.json", "apply.json", "before.json", "after.json", "before.path", "after.path", "status"):
            self.assertTrue((report / name).is_file(), name)
            self.assertEqual((report / name).stat().st_mode & 0o077, 0)
        self.assertEqual(report.stat().st_mode & 0o777, 0o700)
        self.assertEqual(before, (self.live / ".env.production").read_bytes())
        previous = (self.live / ".release.previous.env").read_bytes()
        self.assertEqual(self.run_upgrade().returncode, 0)
        self.assertEqual(previous, (self.live / ".release.previous.env").read_bytes())

    def test_failure_stops_and_preserves_evidence_no_database_restore(self):
        for fault in ("backup", "migration", "baseline", "preview", "invalid-preview", "archive", "apply", "post-backup", "health"):
            with self.subTest(fault=fault):
                if (self.live / ".upgrade-maintenance").exists():
                    (self.live / ".upgrade-maintenance").unlink()  # synthetic test fixture only
                result = self.run_upgrade(fault)
                self.assertNotEqual(result.returncode, 0)
                self.assertTrue((self.live / ".upgrade-maintenance").exists())
                report = Path((self.live / ".upgrade-maintenance").read_text().strip())
                expected = {"backup": "pre-backup", "baseline": "migration-baseline", "health": "public-health", "invalid-preview": "preview", "archive": "preview"}.get(fault, fault)
                self.assertIn("FAILED phase=" + expected, (report / "status").read_text())
                if expected == "preview": self.assertFalse((report / "apply.pending").exists())
                self.assertTrue((report / "failure-stop.log").exists())
                self.assertNotEqual(self.run_upgrade().returncode, 0, "unresolved maintenance must block retries")
        self.assertNotIn("pg_restore --clean", (self.root / "commands").read_text())

    def test_wrong_target_lock_and_image_fail_before_maintenance(self):
        for fault in ("lock", "image"):
            self.assertNotEqual(self.run_upgrade(fault).returncode, 0)
            self.assertFalse((self.live / ".upgrade-maintenance").exists())
        self.value["catalog"]["sha256"] = "wrong"
        self.manifest.write_text(json.dumps(self.value))
        self.assertNotEqual(self.run_upgrade().returncode, 0)
        self.assertFalse((self.live / ".upgrade-maintenance").exists())

    def test_manifest_rejects_wrong_environment_injection_and_missing_pin(self):
        MANIFEST.validate(self.value)
        for field, value in (("origin", "https://124.223.104.225"), ("release", "$(touch bad)"), ("machineId", "")):
            with self.assertRaises(ValueError):
                MANIFEST.validate({**self.value, field: value})
        with self.assertRaises(KeyError):
            MANIFEST.validate({**self.value, "catalog": {"id": self.value["catalog"]["id"]}})

    def test_production_requires_cos_evidence_and_https(self):
        self.value.update(environment="production", origin="https://shanyuerp.art")
        self.manifest.write_text(json.dumps(self.value))
        (self.live / ".env.production").write_text("SHANYU_DEPLOYMENT_ENVIRONMENT=production\nSHANYU_BACKUP_MODE=cos\nWEB_ORIGIN=https://shanyuerp.art\nSESSION_COOKIE_SECURE=true\n")
        self.assertNotEqual(self.run_upgrade().returncode, 0, "missing COS evidence must block migration")
        report = Path((self.live / ".upgrade-maintenance").read_text().strip())
        self.assertIn("phase=pre-backup", (report / "status").read_text())
        (self.live / ".upgrade-maintenance").unlink()  # reset only the synthetic fixture
        self.env["FAKE_COS_OK"] = "1"
        result = self.run_upgrade()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--environment=production", (self.root / "commands").read_text())


if __name__ == "__main__":
    unittest.main(verbosity=2)
