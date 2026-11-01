"""Small tests for the task launcher, with only synthetic scratch inputs."""

import contextlib
import json
import os
from pathlib import Path
import secrets
import shutil
import unittest
from unittest.mock import patch

import isolated_check as checks


@contextlib.contextmanager
def synthetic_workspace():
    checks.RUNTIME.mkdir(exist_ok=True)
    token = secrets.token_hex(12)
    owner = checks.RUNTIME / f"selftest-{token[:8]}"
    app = owner / "app"
    app.mkdir(parents=True)
    checks.write_json(owner / "owner.json", {"kind": checks.OWNER_KIND, "token": token, "workspace": str(app)})
    for folder in ["tools", "home", "temp", "receipts"]:
        (owner / folder).mkdir()
    (app / ".env.example").write_text("PUBLIC_EXAMPLE=placeholder\n", encoding="utf-8", newline="\n")
    (owner / "home/empty.npmrc").write_text("", encoding="utf-8")
    shutil.copy2(checks.CHECKS / "deny_env.cjs", owner / "tools/deny_env.cjs")
    try:
        yield app
    finally:
        if owner.exists():
            checks.cleanup_workspace(app)


class IsolationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.node = checks.node_executable()

    def test_environment_is_filtered_before_node_launch(self):
        with synthetic_workspace() as workspace, patch.dict(os.environ, {
            "NODE_OPTIONS": "--require C:/not-allowed-preload.cjs", "NODE_PATH": "C:/not-allowed-modules",
            "AWS_SECRET_ACCESS_KEY": "synthetic-secret", "S3_SECRET_ACCESS_KEY": "synthetic-secret",
            "HTTP_PROXY": "https://not-allowed.invalid", "DATABASE_URL": "https://not-allowed.invalid",
            "APP_URL": "https://not-allowed.invalid",
        }):
            env = checks.clean_environment(workspace, "test", self.node)
            self.assertNotIn("APP_URL", env)
            self.assertNotIn("HTTP_PROXY", env)
            self.assertNotIn("AWS_SECRET_ACCESS_KEY", env)
            self.assertNotIn("NODE_PATH", env)
            self.assertIn("127.0.0.1:1/", env["DATABASE_URL"])
            self.assertNotIn("not-allowed", env["NODE_OPTIONS"])
            self.assertTrue(checks.within(Path(env["HOME"]), workspace.parent))
            report = checks.run_bounded(workspace, [str(self.node), str(checks.CHECKS / "guard_selftest.cjs")], env, 30, "guard")
            self.assertEqual(report["exitCode"], 0, Path(report["stderr"]).read_text())

    def test_build_environment_is_separate(self):
        with synthetic_workspace() as workspace:
            env = checks.clean_environment(workspace, "build", self.node)
            self.assertEqual(env["NODE_ENV"], "production")
            self.assertEqual(env["APP_URL"], "https://homepage-validation.invalid")
            self.assertNotIn("APP_URL", checks.clean_environment(workspace, "test", self.node))

    def test_prisma_diagnostic_refuses_network_before_any_connection(self):
        with synthetic_workspace() as workspace:
            guard = workspace.parent / "tools/prisma_no_network.cjs"
            shutil.copy2(checks.CHECKS / "prisma_no_network.cjs", guard)
            env = checks.clean_environment(workspace, "build", self.node)
            env["NODE_OPTIONS"] += f' --require "{guard.as_posix()}"'
            code = "const a=require('node:assert/strict'); const error={code:'HOMEPAGE_CHECK_NETWORK_DISABLED'}; a.throws(()=>require('node:net').connect({host:'127.0.0.1',port:1}),error); a.rejects(fetch('https://homepage-no-download.invalid'),error).catch(()=>process.exit(1));"
            report = checks.run_bounded(workspace, [str(self.node), "-e", code], env, 10, "no-network")
            self.assertEqual(report["exitCode"], 0, Path(report["stderr"]).read_text())

    def test_exit_code_output_and_deadline_are_preserved(self):
        with synthetic_workspace() as workspace:
            env = checks.clean_environment(workspace, "test", self.node)
            failed = checks.run_bounded(workspace, [str(self.node), "-e", "console.log('finite'); process.exit(7)"], env, 10, "exit")
            self.assertEqual(failed["exitCode"], 7)
            self.assertEqual(Path(failed["stdout"]).read_text().strip(), "finite")
            timeout = checks.run_bounded(workspace, [str(self.node), "-e", "setInterval(()=>{},1000)"], env, 1, "timeout")
            self.assertEqual(timeout["exitCode"], 124)
            self.assertTrue(timeout["timedOut"])

    def test_source_capture_has_exact_public_example_exception(self):
        with synthetic_workspace() as workspace:
            (workspace / ".env").write_text("must-not-copy", encoding="utf-8")
            (workspace / ".npmrc").write_text("must-not-copy", encoding="utf-8")
            (workspace / "src").mkdir()
            (workspace / "src/.env.example").write_text("must-not-copy", encoding="utf-8")
            (workspace / "src/valid.ts").write_text("export {};", encoding="utf-8")
            self.assertEqual([p.relative_to(workspace).as_posix() for p in checks.source_files(workspace)], [".env.example", "src/valid.ts"])

    def test_dependency_links_are_retargeted_and_files_are_not_shared(self):
        with synthetic_workspace() as workspace:
            source = workspace / "source-modules"
            package = source / ".pnpm/pkg/node_modules/pkg"
            package.mkdir(parents=True)
            (package / "index.js").write_text("original", encoding="utf-8")
            if os.name == "nt":
                import _winapi
                _winapi.CreateJunction(str(package), str(source / "pkg"))
            else:
                os.symlink(package, source / "pkg", target_is_directory=True)
            destination = workspace / "copied-modules"
            report = checks.copy_dependencies(source, destination)
            self.assertEqual(report["internalLinks"], 1)
            (destination / "pkg/index.js").write_text("isolated", encoding="utf-8")
            self.assertEqual((package / "index.js").read_text(), "original")
            self.assertTrue(checks.within(destination / "pkg", destination))

    def test_owner_checks_refuse_wrong_roots_and_modified_markers(self):
        with synthetic_workspace() as workspace:
            with self.assertRaises(ValueError):
                checks.cleanup_workspace(checks.PROJECT)
            with checks.workspace_lock(workspace):
                with self.assertRaises(ValueError):
                    checks.cleanup_workspace(workspace)
                with self.assertRaises(FileExistsError):
                    with checks.workspace_lock(workspace):
                        self.fail("Duplicate owner lock accepted")
            marker = workspace.parent / "owner.json"
            original = marker.read_text()
            value = json.loads(original)
            value["token"] = "wrong"
            checks.write_json(marker, value)
            with self.assertRaises(ValueError):
                checks.cleanup_workspace(workspace)
            marker.write_text(original)

    def test_cleanup_refuses_outside_junction(self):
        with synthetic_workspace() as workspace:
            link = workspace / "outside"
            if os.name == "nt":
                import _winapi
                _winapi.CreateJunction(str(checks.PROJECT / "public"), str(link))
            else:
                os.symlink(checks.PROJECT / "public", link, target_is_directory=True)
            try:
                with self.assertRaises(ValueError):
                    checks.cleanup_workspace(workspace)
            finally:
                if os.name == "nt":
                    os.rmdir(link)
                else:
                    link.unlink()


if __name__ == "__main__":
    unittest.main(verbosity=2)
