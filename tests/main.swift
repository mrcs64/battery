import Foundation

final class Memory: Store {
    var files: [String: [String: Any]] = [:]
    var failWrite: String?
    var failRemove: String?
    func read(_ name: String) throws -> [String: Any]? { files[name] }
    func write(_ name: String, _ value: [String: Any]) throws {
        if name == failWrite { throw Failure("disk full") }
        files[name] = value
    }
    func remove(_ name: String) throws {
        if name == failRemove { throw Failure("unlink failed") }
        files.removeValue(forKey: name)
    }
}
final class Mock: Commands {
    var value: [String: Any] = [:]
    var calls: [[String]] = []
    var fail: Set<Int> = []
    var store: Memory
    init(_ store: Memory) { self.store = store }
    func run(_ executable: String, _ args: [String]) throws -> Data {
        calls.append([executable] + args)
        if fail.contains(calls.count) { throw Failure("mock command failure \(calls.count)") }
        if executable == "/usr/bin/notifyutil" {
            assert(args == ["-p", notification]); return Data()
        }
        assert(executable == "/usr/bin/defaults")
        switch args[0] {
        case "export": return try encode(value)
        case "write": value[args[2]] = Int(args[4])!
        case "import": value.merge(store.files["import"]!) { _, new in new }
        case "delete": value.removeValue(forKey: args[2])
        default: fatalError("Unexpected command")
        }
        return Data()
    }
}
var count = 0
func test(_ name: String, _ body: () throws -> Void) {
    do { try body(); count += 1; print("PASS \(name)") }
    catch { fatalError("FAIL \(name): \(error)") }
}
func expectFailure(_ body: () throws -> Void) -> String {
    do { try body() } catch { return String(describing: error) }
    fatalError("Expected failure")
}
func fixture(_ value: [String: Any] = [:]) -> (Memory, Mock, Backend) {
    let disk = Memory(); let command = Mock(disk); command.value = value
    return (disk, command, Backend(command, disk, "/mock/import.plist"))
}
test("strict integer validation has no side effects") {
    for bad in ["", "0", "101", "-1", "060", "1.0", "60;id", " 60", "60\n", "999999999999999999999999999", "６０"] {
        let (disk, command, backend) = fixture()
        _ = expectFailure { try backend.set(bad) }
        assert(command.calls.isEmpty && disk.files.isEmpty)
    }
    for n in 1...100 { let value = try percentage(String(n)); assert(value == n) }
}
test("60 writes exact root defaults commands and posts notification") {
    let (disk, command, backend) = fixture(["other": "keep"])
    try backend.set("60")
    assert(command.calls.contains(["/usr/bin/defaults", "write", domain, "MCLFeatureState", "-int", "1"]))
    assert(command.calls.contains(["/usr/bin/defaults", "write", domain, "mclLimitValue", "-int", "60"]))
    assert(command.calls.last == ["/usr/bin/notifyutil", "-p", notification])
    assert(same(disk.files["baseline"]!, [:]) && disk.files["pending"] == nil)
    assert(command.value["other"] as? String == "keep")
}
test("exact original types values and absent keys restored; unrelated edits survive") {
    let variants: [[String: Any]] = [[:], [keys[0]: false], [keys[1]: "85"], [keys[0]: 0, keys[1]: 87],
        [keys[0]: true, keys[1]: 80.5], [keys[0]: ["a", "b"], keys[1]: Data([0, 1])],
        [keys[0]: Date(timeIntervalSince1970: 100), keys[1]: ["nested": 1]]]
    for original in variants {
        let (disk, command, backend) = fixture(original)
        try backend.set("60")
        try backend.set("70")
        command.value["unrelated"] = "changed"
        try backend.restore()
        assert(same(subset(command.value), original))
        assert(command.value["unrelated"] as? String == "changed")
        assert(disk.files["baseline"] == nil && disk.files["pending"] == nil)
    }
}
test("status preserves integer versus bool types") {
    for value: Any in [true, "1", 1.0] {
        let (_, _, backend) = fixture([keys[0]: value, keys[1]: 60])
        let status = try backend.status(); assert(!status.0)
    }
    let (_, _, backend) = fixture([keys[0]: 1, keys[1]: 60])
    let status = try backend.status(); assert(status.0)
}
test("each set command failure propagates and restores prior keys") {
    // exports: before-baseline, before-transaction, write, write, verify, notification
    for failedCall in 1...6 {
        let (disk, command, backend) = fixture([keys[0]: false, keys[1]: "old"])
        command.fail = [failedCall]
        _ = expectFailure { try backend.set("60") }
        assert(same(subset(command.value), [keys[0]: false, keys[1]: "old"]))
        assert(disk.files["pending"] == nil)
    }
}
test("rollback failure is explicit and recoverable") {
    let (disk, command, backend) = fixture([keys[1]: "old"])
    command.fail = [4, 6] // limit write, then rollback delete
    let message = expectFailure { try backend.set("60") }
    assert(message.contains("ROLLBACK FAILED") && disk.files["pending"] != nil)
    _ = expectFailure { _ = try backend.status() }
    command.fail = []
    try backend.restore()
    assert(same(subset(command.value), [keys[1]: "old"]))
    assert(disk.files["pending"] == nil && disk.files["baseline"] == nil)
}
test("failed restore keeps baseline and rolls back to active request") {
    let (disk, command, backend) = fixture([keys[0]: false])
    try backend.set("60")
    command.fail = [command.calls.count + 6] // restore notify
    _ = expectFailure { try backend.restore() }
    assert(disk.files["baseline"] != nil)
    assert(same(subset(command.value), [keys[0]: 1, keys[1]: 60]))
    command.fail = []; try backend.restore()
    assert(same(command.value, [keys[0]: false]))
}
test("baseline and journal persistence failures prevent writes") {
    for name in ["baseline", "pending"] {
        let (disk, command, backend) = fixture()
        disk.failWrite = name
        _ = expectFailure { try backend.set("60") }
        assert(!command.calls.contains { $0.contains("write") || $0.contains("import") })
    }
}
test("crash journal recovers before next request; baseline unchanged") {
    let (disk, command, backend) = fixture([keys[0]: 1, keys[1]: 60])
    disk.files["baseline"] = [keys[0]: false]
    disk.files["pending"] = [keys[0]: 1, keys[1]: 70]
    try backend.set("80")
    assert(same(disk.files["baseline"]!, [keys[0]: false]))
    try backend.restore()
    assert(same(command.value, [keys[0]: false]))
}
test("restore without baseline is read-only") {
    let (_, command, backend) = fixture([keys[0]: 1, keys[1]: 90])
    try backend.restore()
    assert(command.calls.isEmpty)
}
test("every restore command failure keeps baseline and rolls back active request") {
    for step in 1...6 {
        let (disk, command, backend) = fixture([keys[0]: false])
        try backend.set("60")
        command.fail = [command.calls.count + step]
        _ = expectFailure { try backend.restore() }
        assert(disk.files["baseline"] != nil)
        assert(same(subset(command.value), [keys[0]: 1, keys[1]: 60]))
        command.fail = []; try backend.restore()
        assert(same(command.value, [keys[0]: false]))
    }
}
test("journal cleanup failure never reports success and retains recovery data") {
    let (disk, _, backend) = fixture()
    disk.failRemove = "pending"
    let message = expectFailure { try backend.set("60") }
    assert(message.contains("ROLLBACK FAILED") && disk.files["pending"] != nil)
    disk.failRemove = nil
    try backend.restore()
    assert(disk.files["baseline"] == nil && disk.files["pending"] == nil)
}
test("baseline cleanup failure is retryable after settings restored") {
    let (disk, command, backend) = fixture([keys[0]: false])
    try backend.set("60")
    disk.failRemove = "baseline"
    _ = expectFailure { try backend.restore() }
    assert(disk.files["baseline"] != nil && same(command.value, [keys[0]: false]))
    disk.failRemove = nil; try backend.restore()
    assert(disk.files["baseline"] == nil)
}
print("\(count) native tests passed")

// Opt-in non-root integration: fixed domain is remapped ONLY in this test executable
// to a fresh plist path inside this checkout. Notification remains mocked.
if CommandLine.arguments.contains("--defaults-integration") {
    final class LiveStore: Store {
        let directory: URL
        init(_ directory: URL) { self.directory = directory }
        func read(_ name: String) throws -> [String: Any]? {
            let file = directory.appendingPathComponent(name + ".plist")
            if !FileManager.default.fileExists(atPath: file.path) { return nil }
            return try plist(Data(contentsOf: file))
        }
        func write(_ name: String, _ value: [String: Any]) throws {
            try encode(value).write(to: directory.appendingPathComponent(name + ".plist"))
        }
        func remove(_ name: String) throws {
            let file = directory.appendingPathComponent(name + ".plist")
            if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
        }
    }
    final class LiveCommands: Commands {
        let testDomain: String
        init(_ path: String) { testDomain = path }
        func run(_ executable: String, _ args: [String]) throws -> Data {
            if executable == "/usr/bin/notifyutil" { return Data() }
            assert(executable == "/usr/bin/defaults")
            let process = Process(); let pipe = Pipe()
            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = args.map { $0 == domain ? testDomain : $0 }
            process.standardOutput = pipe; process.standardError = pipe
            try process.run()
            let output = pipe.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { throw Failure(String(decoding: output, as: UTF8.self)) }
            return output
        }
    }
    test("REAL defaults preserves absence and original types without touching unrelated keys") {
        let directory = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("build/defaults-integration-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LiveStore(directory)
        let commands = LiveCommands(directory.appendingPathComponent("domain").path)
        let backend = Backend(commands, store, directory.appendingPathComponent("import.plist").path)
        try backend.set("60")
        _ = try commands.run("/usr/bin/defaults", ["write", domain, "other", "-string", "keep"])
        try backend.restore()
        let first = try backend.readDomain()
        assert(subset(first).isEmpty && first["other"] as? String == "keep")
        let initial: [String: Any] = [keys[0]: false, keys[1]: "85"]
        try store.write("initial", initial)
        _ = try commands.run("/usr/bin/defaults", ["import", domain, directory.appendingPathComponent("initial.plist").path])
        try backend.set("60"); try backend.restore()
        let restored = try backend.readDomain()
        assert(same(subset(restored), initial) && restored["other"] as? String == "keep")
    }
}
