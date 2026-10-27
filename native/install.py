#!/usr/bin/env python3
"""Explicit administrator tool. Never invoked by the GUI. No network operations."""
import argparse
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import signal
import stat
import subprocess
import sys
import time

BASE = Path("/Library/Application Support/battery-native-install")
STATE = Path("/Library/Application Support/battery-native")
CLI = Path("/usr/local/co.palokaj.battery/battery")
LINK = Path("/usr/local/bin/battery")
HELPER = Path("/usr/local/libexec/battery-native")
APP = Path("/Applications/battery.app")
POLICY = Path("/private/etc/sudoers.d/battery-native")
LEGACY = Path("/private/etc/sudoers.d/battery")
TARGETS = (CLI, LINK, HELPER, APP, POLICY, LEGACY)
INSTALL_UID = 0
EXPECTED = {}  # replaced with build hashes in the compiled bootstrap payload
ENV = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": "/var/root", "LC_ALL": "C"}


def run(*args, check=True):
    return subprocess.run(args, check=check, text=True, capture_output=True, env=ENV)


def exists(path):
    return os.path.lexists(path)


def safe_parent(path, create=False):
    """Every ancestor is root controlled; macOS /var and /etc aliases are avoided."""
    for parent in reversed(path.parents):
        if not exists(parent) and create:
            parent.mkdir(mode=0o755)
            os.chown(parent, 0, 0)
            os.chmod(parent, 0o755)
        st = parent.lstat()
        # /Applications is normally root:admin 775. It holds no sudo-authorized
        # executable; all app staging stays in BASE, never this writable parent.
        applications = (path == APP and parent == Path("/Applications") and
                        st.st_gid == grp.getgrnam("admin").gr_gid and st.st_mode & 0o022 == 0o020)
        if not stat.S_ISDIR(st.st_mode) or st.st_uid != 0 or (st.st_mode & 0o022 and not applications):
            raise RuntimeError(f"Unsafe ancestor: {parent}")


def check_target(path):
    safe_parent(path)
    if not exists(path):
        return
    st = path.lstat()
    allowed_owners = (0, INSTALL_UID) if path == APP else (0,)
    if st.st_uid not in allowed_owners or (not stat.S_ISLNK(st.st_mode) and st.st_mode & 0o022):
        raise RuntimeError(f"Target is not root controlled: {path}")
    if stat.S_ISLNK(st.st_mode):
        if path != LINK or os.readlink(path) not in (str(CLI), "../co.palokaj.battery/battery"):
            raise RuntimeError(f"Refusing unexpected symlink: {path}")
    elif path == APP:
        if not stat.S_ISDIR(st.st_mode):
            raise RuntimeError(f"Expected app directory: {path}")
    elif not stat.S_ISREG(st.st_mode):
        raise RuntimeError(f"Expected regular file: {path}")


def validate_tree(path):
    """Allow Electron's internal relative framework symlinks, never external links."""
    if path.is_symlink():
        raise RuntimeError(f"Source cannot be a symlink: {path}")
    root = path.resolve()
    for entry in [path, *path.rglob("*")] if path.is_dir() else [path]:
        st = entry.lstat()
        if stat.S_ISLNK(st.st_mode):
            if os.path.isabs(os.readlink(entry)) or not entry.resolve().is_relative_to(root):
                raise RuntimeError(f"External or escaping app symlink: {entry}")
        elif not (stat.S_ISREG(st.st_mode) or stat.S_ISDIR(st.st_mode)):
            raise RuntimeError(f"Special file rejected: {entry}")


def own_tree(path):
    for entry in [path, *path.rglob("*")] if path.is_dir() and not path.is_symlink() else [path]:
        os.chown(entry, 0, 0, follow_symlinks=False)
        if not entry.is_symlink():
            mode = entry.stat().st_mode
            os.chmod(entry, stat.S_IMODE(mode) & ~0o022)


def copy(source, destination, source_fd=None):
    # Never follow source links, including a link swapped in after inspection.
    st = os.stat(source, dir_fd=source_fd, follow_symlinks=False)
    if stat.S_ISLNK(st.st_mode):
        destination.symlink_to(os.readlink(source, dir_fd=source_fd))
    elif stat.S_ISDIR(st.st_mode):
        fd = os.open(source, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=source_fd)
        try:
            destination.mkdir(mode=0o700)
            for name in os.listdir(fd):
                copy(name, destination / name, fd)
            os.chmod(destination, stat.S_IMODE(st.st_mode))
        finally:
            os.close(fd)
    elif stat.S_ISREG(st.st_mode):
        fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=source_fd)
        with os.fdopen(fd, "rb") as stream:
            st = os.fstat(stream.fileno())
            if not stat.S_ISREG(st.st_mode):
                raise RuntimeError(f"Source changed type: {source}")
            out = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(out, "wb") as output:
                shutil.copyfileobj(stream, output)
                output.flush()
                os.fsync(output.fileno())
                os.fchmod(output.fileno(), stat.S_IMODE(st.st_mode))
    else:
        raise RuntimeError(f"Special file rejected: {source}")


def metadata(path):
    result = []
    for entry in [path, *path.rglob("*")] if path.is_dir() and not path.is_symlink() else [path]:
        st = entry.lstat()
        result.append({"name": str(entry.relative_to(path)), "uid": st.st_uid, "gid": st.st_gid,
                       "mode": stat.S_IMODE(st.st_mode), "symlink": stat.S_ISLNK(st.st_mode)})
    return result


def restore_metadata(path, entries):
    for item in entries:
        relative = Path(item["name"])
        if relative.is_absolute() or ".." in relative.parts:
            raise RuntimeError("Invalid metadata path")
        target = path / relative
        # Symlink entries themselves may be restored; none of their descendants may.
        parent = target.parent
        while parent != path.parent:
            if parent.is_symlink():
                raise RuntimeError("Symlink ancestor in backup metadata")
            parent = parent.parent
        os.chown(target, item["uid"], item["gid"], follow_symlinks=False)
        if not target.is_symlink():
            os.chmod(target, item["mode"])


def remove(path):
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    elif exists(path):
        path.unlink()


def digest(path):
    h = hashlib.sha256()
    for entry in [path, *sorted(path.rglob("*"))] if path.is_dir() and not path.is_symlink() else [path]:
        h.update(str(entry.relative_to(path)).encode())
        if entry.is_symlink():
            h.update(b"link" + os.readlink(entry).encode())
        elif entry.is_file():
            h.update(b"file" + entry.read_bytes())
        else:
            h.update(b"dir")
    return h.hexdigest()


def policy(user):
    # No shell, defaults, notifyutil, wildcard, SETENV, or user-writable executable.
    args = ["restore", "status", "status_csv"] + [f"set {n}" for n in range(1, 101)]
    return "# Native battery fork: exact helper arguments only\n" + ", ".join(
        f"{user} ALL=(root) NOPASSWD: {HELPER} {arg}" if i == 0 else f"{HELPER} {arg}"
        for i, arg in enumerate(args)) + "\n"


def controllers(user):
    """Read actual argv text, never trust a user-owned pidfile or a broad pkill."""
    found = []
    pattern = re.compile(r"^(?:/bin/bash )?/usr/local/(?:bin/battery|co[.]palokaj[.]battery/battery) maintain_synchronous (?:recover|[1-9][0-9]?|100)$")
    for line in run("/bin/ps", "-axo", "pid=,uid=,command=").stdout.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) != 3:
            continue
        pid, uid, command = parts
        if pattern.fullmatch(command) and int(uid) in (0, user.pw_uid):
            found.append((int(pid), command))
        elif re.match(r"^(?:/(?:bin|usr/bin)/(?:bash|sh) )?(?:/[^ ]*/)?(?:battery|batterycharging) (?:maintain_synchronous|_loop)(?: |$)", command) and int(pid) != os.getpid():
            # Fail closed on unknown legacy controllers; do not terminate other tools.
            raise RuntimeError(f"Unrecognized competing controller PID {pid}: stop it explicitly before installing")
        if command == "/Applications/battery.app/Contents/MacOS/battery" or command.startswith("/Applications/battery.app/Contents/MacOS/battery "):
            raise RuntimeError("Quit the existing battery GUI before installation/rollback")
    return found


def agent_fd(user):
    # Anchor every component with O_NOFOLLOW. Root never follows paths in a user's home.
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in (Path(user.pw_dir) / "Library/LaunchAgents").parts[1:]:
            new = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = new
        return fd
    except FileNotFoundError:
        os.close(fd)
        return None
    except BaseException:
        os.close(fd)
        raise


def save_agent(user):
    fd = agent_fd(user)
    if fd is None:
        return None
    try:
        try:
            file = os.open("battery.plist", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        except FileNotFoundError:
            return None
        with os.fdopen(file, "rb") as stream:
            st = os.fstat(stream.fileno())
            if not stat.S_ISREG(st.st_mode) or st.st_uid not in (0, user.pw_uid) or st.st_size > 1024 * 1024:
                raise RuntimeError("Unsafe legacy LaunchAgent")
            data = stream.read()
        import plistlib
        value = plistlib.loads(data)
        argv = value.get("ProgramArguments", [])
        if value.get("Label") != "com.battery.app" or argv not in (
                [str(CLI), "maintain_synchronous", "recover"],
                [str(LINK), "maintain_synchronous", "recover"]):
            raise RuntimeError("Unknown legacy LaunchAgent: review and stop it manually")
        (BASE / "legacy-agent.plist").write_bytes(data)
        return {"uid": st.st_uid, "gid": st.st_gid, "mode": stat.S_IMODE(st.st_mode)}
    finally:
        os.close(fd)


def stop_legacy(user):
    label = f"gui/{user.pw_uid}/com.battery.app"
    if run("/bin/launchctl", "print", label, check=False).returncode == 0:
        run("/bin/launchctl", "bootout", label)
    fd = agent_fd(user)
    if fd is not None:
        try:
            # Unlink itself, never a symlink's target. Saved before mutation.
            if (BASE / "legacy-agent.plist").exists():
                os.unlink("battery.plist", dir_fd=fd)
        finally:
            os.close(fd)
    for pid, command in controllers(user):
        fresh = run("/bin/ps", "-p", str(pid), "-o", "command=", check=False)
        if fresh.returncode == 0 and fresh.stdout.strip() == command:
            os.kill(pid, signal.SIGTERM)
    for _ in range(30):
        if not controllers(user):
            return
        time.sleep(0.1)
    raise RuntimeError("Legacy controller did not stop; installation aborted")


def journal(value):
    temp = BASE / "manifest.tmp"
    with temp.open("w") as stream:
        json.dump(value, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, BASE / "manifest.json")
    fd = os.open(BASE, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def restore_files(manifest):
    # Validate all backups before changing a single target. Whitelist destinations.
    if [item["path"] for item in manifest["files"]] != [str(p) for p in TARGETS]:
        raise RuntimeError("Invalid rollback manifest")
    for i, item in enumerate(manifest["files"]):
        path = Path(item["path"])
        check_target(path)
        if item["present"] and digest(BASE / f"backup-{i}") != item["sha256"]:
            raise RuntimeError(f"Damaged backup for {path}")
    for i, item in enumerate(manifest["files"]):
        path = Path(item["path"])
        staged = BASE / "restore-app" if path == APP else path.with_name(path.name + ".native-restore")
        if exists(staged):
            raise RuntimeError(f"Unexpected staging path: {staged}")
        if item["present"]:
            copy(BASE / f"backup-{i}", staged)
            restore_metadata(staged, item["metadata"])
        remove(path)
        if item["present"]:
            os.rename(staged, path)
    run("/usr/sbin/visudo", "-c")


def rollback(manifest):
    user = pwd.getpwnam(manifest["user"])
    if controllers(user):
        raise RuntimeError("Stop legacy controllers before rollback")
    # Restore native preferences BEFORE removing helper/policy. Errors keep backups.
    if exists(STATE) and not manifest.get("native_restored"):
        recovery_helper = BASE / "new-helper"
        check_target(recovery_helper)
        if hashlib.sha256(recovery_helper.read_bytes()).hexdigest() != manifest["helper_sha256"]:
            raise RuntimeError("Recovery helper damaged; refusing to remove installed components")
        # Root-owned staged copy survives a crash before/after any installed-file rename.
        run(str(recovery_helper), "retire")
        manifest["native_restored"] = True
        journal(manifest)
    restore_files(manifest)
    agent = manifest.get("agent")
    if agent:
        fd = agent_fd(user)
        if fd is None:
            raise RuntimeError("Restore LaunchAgents directory manually; backup retained")
        try:
            data = (BASE / "legacy-agent.plist").read_bytes()
            try:
                file = os.open("battery.plist", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                               agent["mode"], dir_fd=fd)
            except FileExistsError:
                file = os.open("battery.plist", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
                with os.fdopen(file, "rb") as stream:
                    if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode) or stream.read(1048577) != data:
                        raise RuntimeError("LaunchAgent changed; backup retained, refusing overwrite")
            else:
                with os.fdopen(file, "wb") as stream:
                    stream.write(data)
                    os.fchown(stream.fileno(), agent["uid"], agent["gid"])
                    os.fchmod(stream.fileno(), agent["mode"])
                    stream.flush()
                    os.fsync(stream.fileno())
        finally:
            os.close(fd)
    manifest["phase"] = "rolled-back"
    journal(manifest)
    print("Rollback complete. Backups retained. Legacy LaunchAgent restored but not loaded; reopen original app when ready.")


def install(repo, app, user):
    if exists(BASE):
        raise RuntimeError(f"Existing installer state: {BASE}; review/rollback before another installation")
    for path in TARGETS:
        safe_parent(path, create=True)
        check_target(path)
    if exists(STATE):
        raise RuntimeError(f"Existing helper state: {STATE}; review before installation")
    for path in (repo / "battery.sh", repo / "build/battery-native", app):
        validate_tree(path)
    if not (app / "Contents/MacOS/battery").is_file():
        raise RuntimeError("Not a built battery.app")
    # These are code-signature structural checks, not notarization/trust assertions.
    run("/usr/bin/codesign", "--verify", "--deep", "--strict", str(app))
    run("/usr/bin/file", str(repo / "build/battery-native"))
    controllers(user)  # detect unsupported competing tools and open GUI before any cutover
    BASE.mkdir(mode=0o700)
    manifest = {"user": user.pw_name, "phase": "prepared", "published": False, "files": [], "agent": None}
    for i, path in enumerate(TARGETS):
        item = {"path": str(path), "present": exists(path)}
        if item["present"]:
            st = path.lstat()
            if path == APP:
                validate_tree(path)
            attributes = metadata(path)
            copy(path, BASE / f"backup-{i}")
            if path == APP:
                validate_tree(BASE / f"backup-{i}")
            item.update(metadata=attributes, sha256=digest(BASE / f"backup-{i}"))
        manifest["files"].append(item)
    manifest["agent"] = save_agent(user)
    journal(manifest)  # backups usable even if subsequent staging validation fails
    # Stage and validate everything before stopping the existing controller.
    copy(repo / "battery.sh", BASE / "new-cli")
    copy(repo / "build/battery-native", BASE / "new-helper")
    copy(app, BASE / "new-app")
    for name in ("new-cli", "new-helper"):
        if EXPECTED and hashlib.sha256((BASE / name).read_bytes()).hexdigest() != EXPECTED[name]:
            raise RuntimeError(f"Build payload changed: {name}; rebuild the installer")
    manifest["helper_sha256"] = hashlib.sha256((BASE / "new-helper").read_bytes()).hexdigest()
    (BASE / "new-policy").write_text(policy(user.pw_name))
    validate_tree(BASE / "new-app")
    run("/usr/bin/codesign", "--verify", "--deep", "--strict", str(BASE / "new-app"))
    # Backups become root-owned, but manifest retains every original uid/gid/mode.
    own_tree(BASE)
    os.chmod(BASE / "new-cli", 0o755)
    os.chmod(BASE / "new-helper", 0o755)
    os.chmod(BASE / "new-policy", 0o440)
    run("/usr/sbin/visudo", "-cf", str(BASE / "new-policy"))
    journal(manifest)
    try:
        manifest["phase"] = "cutover"
        journal(manifest)
        stop_legacy(user)
        STATE.mkdir(mode=0o700)
        for path, source in ((CLI, "new-cli"), (HELPER, "new-helper"), (APP, "new-app"), (POLICY, "new-policy")):
            check_target(path)
            staged = BASE / "publish-app" if path == APP else path.with_name(path.name + ".native-install")
            if exists(staged):
                raise RuntimeError(f"Unexpected staging path: {staged}")
            copy(BASE / source, staged)
            own_tree(staged)
            remove(path)
            os.rename(staged, path)
        remove(LINK)
        LINK.symlink_to(CLI)
        remove(LEGACY)
        manifest["published"] = True
        journal(manifest)
        run("/usr/sbin/visudo", "-c")
        run(str(HELPER), "status")  # read-only validation; no limit enabled by install
        manifest["phase"] = "installed"
        journal(manifest)
    except BaseException as original:
        try:
            rollback(manifest)
        except BaseException as recovery:
            raise RuntimeError(f"INSTALL FAILED: {original}; ROLLBACK FAILED: {recovery}; backups at {BASE}") from original
        raise RuntimeError(f"Install failed, rollback completed: {original}") from original
    print("Installed. No limit enabled. Run battery fixed60 explicitly. Backups: " + str(BASE))


def main():
    global INSTALL_UID
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("install", "rollback"))
    parser.add_argument("--user")
    parser.add_argument("--app", type=Path)
    parser.add_argument("--repo", type=Path)
    args = parser.parse_args()
    location = Path(__file__)
    if location.parent != Path("/Library/Application Support/battery-native-bootstrap"):
        parser.error("Use the compiled, root-owned battery-installer bootstrap; do not run this script with sudo")
    if os.geteuid() != 0 or sys.platform != "darwin":
        parser.error("Run explicitly as administrator on macOS; this tool never requests a password")
    if run("/usr/bin/sw_vers", "-productVersion").stdout.strip().split(".")[0] != "27":
        parser.error("Only macOS 27 is supported")
    os.umask(0o077)
    if not shutil.rmtree.avoids_symlink_attacks:
        raise RuntimeError("This Python lacks safe fd-based directory removal")
    safe_parent(BASE)
    lock_path = BASE.with_name(BASE.name + ".lock")
    lock = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    lock_stat = os.fstat(lock)
    if not stat.S_ISREG(lock_stat.st_mode) or lock_stat.st_uid != 0 or lock_stat.st_mode & 0o077 or lock_stat.st_nlink != 1:
        raise RuntimeError("Unsafe installer lock")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if args.action == "install":
        if not args.user or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", args.user) or not args.app:
            parser.error("install requires --user SHORTNAME --app PATH")
        user = pwd.getpwnam(args.user)
        if user.pw_uid < 500:
            parser.error("Select a normal local user")
        if not args.repo:
            parser.error("install requires --repo PATH")
        INSTALL_UID = user.pw_uid
        install(args.repo.absolute(), args.app.absolute(), user)
    else:
        st = BASE.lstat()
        if not stat.S_ISDIR(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o077:
            raise RuntimeError("Unsafe installer state")
        file = BASE / "manifest.json"
        if file.is_symlink() or file.stat().st_uid != 0 or file.stat().st_mode & 0o022:
            raise RuntimeError("Unsafe manifest")
        manifest = json.loads(file.read_text())
        if manifest["phase"] == "rolled-back":
            raise RuntimeError("Already rolled back; backups retained")
        INSTALL_UID = pwd.getpwnam(manifest["user"]).pw_uid
        rollback(manifest)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"battery installer: {error}", file=sys.stderr)
        sys.exit(1)
