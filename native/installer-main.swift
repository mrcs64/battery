import Foundation
import Darwin

struct InstallFailure: Error, CustomStringConvertible {
    let description: String
    init(_ text: String) { description = text }
}
let bootstrap = "/Library/Application Support/battery-native-bootstrap"
func trusted(_ path: String, _ directory: Bool) throws {
    var value = stat()
    guard lstat(path, &value) == 0, value.st_uid == 0, value.st_mode & 0o022 == 0,
          value.st_mode & S_IFMT == (directory ? S_IFDIR : S_IFREG) else {
        throw InstallFailure("Untrusted installer path: \(path)")
    }
}
func installMain() throws {
    guard geteuid() == 0 else { throw InstallFailure("Administrator invocation required; no password is requested by this executable") }
    // The documented bootstrap uses only Apple's install utility to place this compiled
    // binary here. No Python or shell from a user-writable directory runs as root.
    for path in ["/Library", "/Library/Application Support", bootstrap] { try trusted(path, true) }
    let executable = "\(bootstrap)/battery-installer"
    guard URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.path == executable else {
        throw InstallFailure("Copy the compiled installer to the documented root-owned bootstrap location first")
    }
    try trusted(executable, false)
    let script = "\(bootstrap)/installer-\(payloadHash).py"
    let fd = open(script, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    if fd >= 0 {
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        try handle.write(contentsOf: installerPayload)
        try handle.synchronize()
        try handle.close()
    } else if errno != EEXIST { throw InstallFailure("Cannot stage embedded installer") }
    try trusted(script, false)
    guard try Data(contentsOf: URL(fileURLWithPath: script)) == installerPayload else {
        throw InstallFailure("Embedded installer mismatch; refusing execution")
    }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
    process.arguments = ["-I", script] + Array(CommandLine.arguments.dropFirst())
    process.environment = ["HOME": "/var/root", "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LC_ALL": "C"]
    try process.run(); process.waitUntilExit()
    guard process.terminationReason == .exit else { throw InstallFailure("Installer terminated abnormally") }
    exit(process.terminationStatus)
}
do { try installMain() } catch {
    FileHandle.standardError.write(Data("battery-installer: \(error)\n".utf8)); exit(1)
}
