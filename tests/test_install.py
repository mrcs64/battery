import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("installer", Path(__file__).parents[1] / "native/install.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).parents[1] / "build")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).absolute()

    def test_policy_has_exact_arguments_and_only_named_user(self):
        text = m.policy("tester")
        self.assertNotIn("*", text)
        self.assertNotIn("SETENV", text)
        self.assertNotIn("ALL ALL", text)
        self.assertNotIn("/bin/bash", text)
        self.assertNotIn("defaults ", text)
        self.assertNotIn(" retire", text)
        self.assertEqual(text.count("NOPASSWD"), 1)
        for n in range(1, 101):
            self.assertIn(f"{m.HELPER} set {n}", text)

    def test_symlink_ancestors_and_unknown_target_links_rejected(self):
        target = self.root / "target"
        target.mkdir()
        link = self.root / "link"
        link.symlink_to(target, target_is_directory=True)
        with self.assertRaises(RuntimeError):
            m.safe_parent(link / "file")
        # check_target has its own independent rejection of unexpected symlinks.
        with patch.object(m, "safe_parent"):
            with self.assertRaises(RuntimeError):
                m.check_target(link)

    def test_app_links_must_be_internal(self):
        app = self.root / "app"
        app.mkdir()
        (app / "real").write_text("asset")
        (app / "alias").symlink_to("real")
        m.validate_tree(app)
        (app / "escape").symlink_to("../../outside")
        with self.assertRaises(RuntimeError):
            m.validate_tree(app)

    def test_copy_does_not_follow_links_and_digest_detects_damage(self):
        source = self.root / "source"
        source.mkdir()
        (source / "file").write_text("original")
        (source / "link").symlink_to("file")
        dest = self.root / "backup"
        m.copy(source, dest)
        self.assertTrue((dest / "link").is_symlink())
        before = m.digest(dest)
        (dest / "file").write_text("damage")
        self.assertNotEqual(before, m.digest(dest))

    def test_controller_selection_and_unknown_controller_refusal(self):
        user = types.SimpleNamespace(pw_uid=501)
        result = types.SimpleNamespace(stdout=f"42 501 /bin/bash {m.CLI} maintain_synchronous recover\n", returncode=0)
        with patch.object(m, "run", return_value=result):
            self.assertEqual(m.controllers(user), [(42, f"/bin/bash {m.CLI} maintain_synchronous recover")])
        result.stdout = "43 501 /tmp/other/battery maintain_synchronous recover\n"
        with patch.object(m, "run", return_value=result):
            with self.assertRaisesRegex(RuntimeError, "Unrecognized"):
                m.controllers(user)

    def test_open_installed_gui_prevents_cutover(self):
        result = types.SimpleNamespace(stdout="42 501 /Applications/battery.app/Contents/MacOS/battery --some-flag\n", returncode=0)
        with patch.object(m, "run", return_value=result):
            with self.assertRaisesRegex(RuntimeError, "Quit"):
                m.controllers(types.SimpleNamespace(pw_uid=501))

    def environment(self):
        from contextlib import ExitStack
        stack = ExitStack()
        self.addCleanup(stack.close)
        for name in ("BASE", "STATE", "CLI", "LINK", "HELPER", "APP", "POLICY", "LEGACY"):
            path = self.root / name.lower()
            stack.enter_context(patch.object(m, name, path))
        stack.enter_context(patch.object(m, "TARGETS", (m.CLI, m.LINK, m.HELPER, m.APP, m.POLICY, m.LEGACY)))
        # No privileged calls in tests: command execution, ownership and host paths mocked.
        for name in ("safe_parent", "check_target", "own_tree", "stop_legacy"):
            stack.enter_context(patch.object(m, name))
        stack.enter_context(patch.object(m.os, "chown"))
        stack.enter_context(patch.object(m.os, "fchown"))
        stack.enter_context(patch.object(m, "save_agent", return_value=None))
        stack.enter_context(patch.object(m, "controllers", return_value=[]))
        stack.enter_context(patch.object(m.pwd, "getpwnam", return_value=types.SimpleNamespace(pw_name="tester", pw_uid=501)))
        repo = self.root / "repo"
        (repo / "build").mkdir(parents=True)
        (repo / "battery.sh").write_text("new cli")
        (repo / "build/battery-native").write_text("new helper")
        app = self.root / "source-app"
        (app / "Contents/MacOS").mkdir(parents=True)
        (app / "Contents/MacOS/battery").write_text("new GUI")
        m.CLI.write_text("old cli")
        m.LINK.symlink_to(m.CLI)
        m.LEGACY.write_text("old policy")
        m.APP.mkdir()
        (m.APP / "old").write_text("old GUI")
        return stack, repo, app, types.SimpleNamespace(pw_name="tester", pw_uid=501)

    def test_install_and_rollback_restore_originals_and_absence(self):
        stack, repo, app, user = self.environment()
        calls = []
        def command(*args, **kwargs):
            calls.append(args)
            return types.SimpleNamespace(stdout="", returncode=0)
        stack.enter_context(patch.object(m, "run", side_effect=command))
        m.install(repo, app, user)
        self.assertEqual(m.CLI.read_text(), "new cli")
        self.assertTrue(m.LINK.is_symlink())
        self.assertFalse(m.LEGACY.exists())
        self.assertNotIn((str(m.HELPER), "set", "60"), calls)
        manifest = json.loads((m.BASE / "manifest.json").read_text())
        m.rollback(manifest)
        self.assertEqual(m.CLI.read_text(), "old cli")
        self.assertEqual((m.APP / "old").read_text(), "old GUI")
        self.assertEqual(m.LEGACY.read_text(), "old policy")
        self.assertFalse(m.HELPER.exists())
        self.assertFalse(m.POLICY.exists())
        self.assertTrue((m.BASE / "backup-0").exists())
        self.assertIn((str(m.BASE / "new-helper"), "retire"), calls)

    def test_invalid_staged_policy_does_not_stop_legacy_or_publish(self):
        stack, repo, app, user = self.environment()
        def command(*args, **kwargs):
            if "-cf" in args:
                raise RuntimeError("invalid sudoers")
            return types.SimpleNamespace(stdout="", returncode=0)
        stack.enter_context(patch.object(m, "run", side_effect=command))
        with self.assertRaisesRegex(RuntimeError, "invalid sudoers"):
            m.install(repo, app, user)
        m.stop_legacy.assert_not_called()
        self.assertEqual(m.CLI.read_text(), "old cli")

    def test_post_publish_failure_automatically_rolls_back(self):
        stack, repo, app, user = self.environment()
        def command(*args, **kwargs):
            if args == (str(m.HELPER), "status"):
                raise RuntimeError("status failed")
            return types.SimpleNamespace(stdout="", returncode=0)
        stack.enter_context(patch.object(m, "run", side_effect=command))
        with self.assertRaisesRegex(RuntimeError, "rollback completed"):
            m.install(repo, app, user)
        self.assertEqual(m.CLI.read_text(), "old cli")
        self.assertEqual(json.loads((m.BASE / "manifest.json").read_text())["phase"], "rolled-back")

    def test_native_restore_failure_prevents_removing_helper(self):
        stack, repo, app, user = self.environment()
        command = stack.enter_context(patch.object(m, "run", return_value=types.SimpleNamespace(stdout="", returncode=0)))
        m.install(repo, app, user)
        manifest = json.loads((m.BASE / "manifest.json").read_text())
        command.side_effect = RuntimeError("restore failed")
        with self.assertRaisesRegex(RuntimeError, "restore failed"):
            m.rollback(manifest)
        self.assertEqual(m.HELPER.read_text(), "new helper")
        self.assertTrue(m.POLICY.exists())

    def test_backup_damage_and_forged_destinations_rejected_before_mutation(self):
        stack, repo, app, user = self.environment()
        stack.enter_context(patch.object(m, "run", return_value=types.SimpleNamespace(stdout="", returncode=0)))
        m.install(repo, app, user)
        manifest = json.loads((m.BASE / "manifest.json").read_text())
        (m.BASE / "backup-0").write_text("corrupted")
        with self.assertRaisesRegex(RuntimeError, "Damaged backup"):
            m.restore_files(manifest)
        self.assertEqual(m.CLI.read_text(), "new cli")
        manifest["files"][0]["path"] = "/etc/hosts"
        with self.assertRaisesRegex(RuntimeError, "Invalid rollback"):
            m.restore_files(manifest)


class CLITests(unittest.TestCase):
    def test_invalid_arguments_and_updaters_never_invoke_sudo(self):
        cli = Path(__file__).parents[1] / "battery.sh"
        for args in (("maintain", "60;id"), ("maintain", "060"), ("maintain", "0"),
                     ("maintain", "101"), ("update", "silent"), ("reinstall",),
                     ("maintain_synchronous", "recover"), ("visudo",)):
            result = subprocess.run(["/bin/bash", str(cli), *args], text=True, capture_output=True)
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertNotIn("password", result.stderr)

    def test_cli_passes_literal_arguments_and_propagates_sudo_failure(self):
        root = Path(__file__).parents[1]
        with tempfile.TemporaryDirectory(dir=root / "build") as temp:
            temp = Path(temp)
            mock = temp / "sudo"
            mock.write_text('#!/bin/bash\nprintf "%s\\n" "$@"\nexit 7\n')
            mock.chmod(0o755)
            script = temp / "battery"
            script.write_text((root / "battery.sh").read_text().replace("/usr/bin/sudo", str(mock)))
            for args in (("maintain", "60"), ("fixed60",), ("maintain", "stop"), ("status_csv",)):
                result = subprocess.run(["/bin/bash", str(script), *args], text=True, capture_output=True)
                self.assertEqual(result.returncode, 7)
                self.assertIn("-n\n/usr/local/libexec/battery-native\n", result.stdout)

class RecoveryRegressionTests(unittest.TestCase):
    setUp = InstallerTests.setUp
    environment = InstallerTests.environment
    def test_original_recursive_modes_and_ownership_are_recorded_and_restored(self):
        source = self.root / "original"
        (source / "nested").mkdir(parents=True)
        (source / "nested/file").write_text("content")
        (source / "nested/link").symlink_to("file")
        (source / "nested/file").chmod(0o640)
        attributes = m.metadata(source)
        dest = self.root / "restore"
        m.copy(source, dest)
        (dest / "nested/file").chmod(0o600)
        with patch.object(m.os, "chown") as chown:
            m.restore_metadata(dest, attributes)
        self.assertEqual((dest / "nested/file").stat().st_mode & 0o777, 0o640)
        self.assertEqual(len(chown.call_args_list), len(attributes))
        self.assertTrue((dest / "nested/link").is_symlink())

    def test_metadata_cannot_follow_symlink_ancestor(self):
        root = self.root / "restore"
        root.mkdir()
        (root / "escape").symlink_to(self.root)
        with self.assertRaisesRegex(RuntimeError, "Symlink ancestor"):
            m.restore_metadata(root, [{"name": "escape/victim", "uid": 0, "gid": 0, "mode": 0o600}])

    def test_wrapper_command_text_is_not_a_controller(self):
        result = types.SimpleNamespace(stdout="45 501 /bin/zsh -c echo battery maintain_synchronous recover\n", returncode=0)
        with patch.object(m, "run", return_value=result):
            self.assertEqual(m.controllers(types.SimpleNamespace(pw_uid=501)), [])

    def test_recovery_retires_from_protected_staging_even_before_published_flag(self):
        stack, repo, app, user = self.environment()
        calls = []
        stack.enter_context(patch.object(m, "run", side_effect=lambda *args, **kw: (calls.append(args) or types.SimpleNamespace(stdout="", returncode=0))))
        m.install(repo, app, user)
        manifest = json.loads((m.BASE / "manifest.json").read_text())
        manifest["published"] = False
        m.rollback(manifest)
        self.assertIn((str(m.BASE / "new-helper"), "retire"), calls)

    def test_special_source_files_rejected_without_blocking(self):
        fifo = self.root / "fifo"
        os.mkfifo(fifo)
        with self.assertRaisesRegex(RuntimeError, "Special file"):
            m.copy(fifo, self.root / "copy")

class FinalBoundaryTests(unittest.TestCase):
    setUp = InstallerTests.setUp
    environment = InstallerTests.environment

    def test_selected_user_owned_original_app_is_accepted_but_other_owner_rejected(self):
        app = self.root / "user-app"
        app.mkdir()
        with patch.object(m, "APP", app), patch.object(m, "safe_parent"):
            with patch.object(m, "INSTALL_UID", os.getuid()):
                m.check_target(app)
            if os.getuid() != 0:
                with patch.object(m, "INSTALL_UID", 999999):
                    with self.assertRaises(RuntimeError):
                        m.check_target(app)

    def test_install_and_rollback_failures_both_reach_caller_with_backups(self):
        stack, repo, app, user = self.environment()
        def command(*args, **kw):
            if args == (str(m.HELPER), "status"):
                raise RuntimeError("initial failure")
            if args == (str(m.BASE / "new-helper"), "retire"):
                raise RuntimeError("undo failure")
            return types.SimpleNamespace(stdout="", returncode=0)
        stack.enter_context(patch.object(m, "run", side_effect=command))
        with self.assertRaisesRegex(RuntimeError, "INSTALL FAILED:.*initial failure; ROLLBACK FAILED:.*undo failure"):
            m.install(repo, app, user)
        self.assertTrue((m.BASE / "backup-0").exists())
        self.assertTrue(m.HELPER.exists())
