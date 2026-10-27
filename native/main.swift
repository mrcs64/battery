import Foundation
import Darwin

let statePath = "/Library/Application Support/battery-native"
let fm = FileManager.default
func secure(_ path: String, directory: Bool) throws {
    var info = stat()
    guard lstat(path, &info) == 0, info.st_uid == 0,
          info.st_mode & 0o022 == 0,
          info.st_mode & S_IFMT == (directory ? S_IFDIR : S_IFREG) else {
        throw Failure("Unsafe ownership, permissions, type or symlink: \(path)")
    }
}
final class Disk: Store {
    func path(_ name: String) -> String { "\(statePath)/\(name).plist" }
    func read(_ name: String) throws -> [String: Any]? {
        let file = path(name)
        var info = stat()
        if lstat(file, &info) != 0 {
            if errno == ENOENT { return nil }
            throw Failure("Cannot inspect \(file)")
        }
        try secure(file, directory: false)
        return try plist(Data(contentsOf: URL(fileURLWithPath: file)))
    }
    func write(_ name: String, _ value: [String: Any]) throws {
        _ = try read(name)
        let file = path(name)
        try encode(value).write(to: URL(fileURLWithPath: file), options: .atomic)
        guard chmod(file, 0o600) == 0 else { throw Failure("chmod failed") }
        let fd = open(file, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else { throw Failure("Cannot sync journal") }
        defer { close(fd) }
        guard fsync(fd) == 0 else { throw Failure("Cannot sync journal") }
        try syncDirectory()
    }
    func syncDirectory() throws {
        let fd = open(statePath, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard fd >= 0 else { throw Failure("Cannot open state directory") }
        defer { close(fd) }
        guard fsync(fd) == 0 else { throw Failure("Cannot sync state directory") }
    }
    func remove(_ name: String) throws {
        if try read(name) != nil { try fm.removeItem(atPath: path(name)); try syncDirectory() }
    }
}
struct SystemCommands: Commands {
    func run(_ executable: String, _ args: [String]) throws -> Data {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = args
        // Never inherit caller-controlled HOME, PATH, DYLD, or defaults host preferences.
        process.environment = ["HOME": "/var/root", "USER": "root", "LOGNAME": "root", "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LC_ALL": "C"]
        let pipe = Pipe()
        process.standardOutput = pipe; process.standardError = pipe
        try process.run()
        let output = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationReason == .exit, process.terminationStatus == 0 else {
            throw Failure("\(executable) \(args) failed (\(process.terminationStatus)): \(String(decoding: output, as: UTF8.self))")
        }
        return output
    }
}
func main() throws {
    let args = Array(CommandLine.arguments.dropFirst())
    guard args == ["status"] || args == ["status_csv"] || args == ["restore"] || args == ["retire"] ||
          (args.count == 2 && args[0] == "set") else { throw Failure("Usage: battery-native set INTEGER | restore | status | status_csv") }
    if args[0] == "set" { _ = try percentage(args[1]) }
    guard geteuid() == 0 else { throw Failure("Helper requires root; use the installed battery CLI") }
    guard ProcessInfo.processInfo.operatingSystemVersion.majorVersion == 27 else { throw Failure("This backend is scoped to macOS 27") }
    for path in ["/Library", "/Library/Application Support", statePath] { try secure(path, directory: true) }
    let lockPath = "\(statePath)/lock"
    let fd = open(lockPath, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
    guard fd >= 0 else { throw Failure("Cannot open lock") }
    defer { close(fd) }
    try secure(lockPath, directory: false)
    guard flock(fd, LOCK_EX | LOCK_NB) == 0 else { throw Failure("Another native operation is running") }
    let backend = Backend(SystemCommands(), Disk(), "\(statePath)/import.plist")
    if args[0] == "set", try Disk().read("retired") != nil { throw Failure("Backend retired by installer; cannot enable a new request") }
    switch args[0] {
    case "set": try backend.set(args[1])
    case "retire":
        // Not granted in sudoers: administrator-only uninstall barrier.
        try Disk().write("retired", ["retired": true])
        try backend.restore()
    case "restore": try backend.restore()
    default:
        let (enabled, limit) = try backend.status()
        if args[0] == "status" {
            print("macOS native limit \(enabled ? "enabled" : "disabled"); configured \(limit.map(String.init) ?? "unset")%. Physical enforcement is not verified.")
            if enabled, let limit = limit { print("Native request configured at \(limit)%") }
        } else {
            let data = try SystemCommands().run("/usr/bin/pmset", ["-g", "batt"])
            let text = String(decoding: data, as: UTF8.self)
            guard let range = text.range(of: #"\d+%"#, options: .regularExpression) else { throw Failure("Cannot parse pmset battery percentage") }
            let percent = text[range].dropLast()
            let time = text.range(of: #"\d+:\d+"#, options: .regularExpression).map { String(text[$0]) } ?? "unknown"
            print("\(percent),\(time),\(text.contains("; charging;") ? "enabled" : "disabled"),not discharging,\(enabled ? limit.map(String.init) ?? "" : "")")
        }
    }
}
do { try main() } catch {
    FileHandle.standardError.write(Data("battery-native: \(error)\n".utf8)); exit(1)
}
