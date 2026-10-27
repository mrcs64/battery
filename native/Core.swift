import Foundation

let domain = "com.apple.smartcharging.topoffprotection"
let notification = "com.apple.smartcharging.defaultschanged"
let keys = ["MCLFeatureState", "mclLimitValue"]
struct Failure: Error, CustomStringConvertible {
    let description: String
    init(_ message: String) { description = message }
}
protocol Commands {
    func run(_ executable: String, _ args: [String]) throws -> Data
}
protocol Store {
    func read(_ name: String) throws -> [String: Any]?
    func write(_ name: String, _ value: [String: Any]) throws
    func remove(_ name: String) throws
}
func plist(_ data: Data) throws -> [String: Any] {
    guard let result = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] else {
        throw Failure("Invalid dictionary plist")
    }
    return result
}
func encode(_ value: [String: Any]) throws -> Data {
    try PropertyListSerialization.data(fromPropertyList: value, format: .xml, options: 0)
}
func same(_ lhs: [String: Any], _ rhs: [String: Any]) -> Bool {
    // NSDictionary distinguishes strings, but NSNumber equality conflates bool/int.
    // XML plist tags preserve the exact Foundation plist types.
    guard let a = try? PropertyListSerialization.data(fromPropertyList: lhs, format: .xml, options: .zero),
          let b = try? PropertyListSerialization.data(fromPropertyList: rhs, format: .xml, options: .zero) else { return false }
    return a == b
}
func subset(_ value: [String: Any]) -> [String: Any] {
    value.filter { keys.contains($0.key) }
}
func percentage(_ value: String) throws -> Int {
    guard !value.isEmpty, value.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }),
          let number = Int(value), (1...100).contains(number), String(number) == value else {
        throw Failure("Limit must be a canonical integer from 1 through 100")
    }
    return number
}
final class Backend {
    let commands: Commands
    let store: Store
    let importPath: String
    init(_ commands: Commands, _ store: Store, _ importPath: String) {
        self.commands = commands; self.store = store; self.importPath = importPath
    }
    func readDomain() throws -> [String: Any] {
        // defaults export returns an empty dictionary for a domain with no keys.
        try plist(commands.run("/usr/bin/defaults", ["export", domain, "-"]))
    }
    func notify() throws { _ = try commands.run("/usr/bin/notifyutil", ["-p", notification]) }
    func replaceKeys(_ saved: [String: Any]) throws {
        guard saved.keys.allSatisfy({ keys.contains($0) }) else { throw Failure("Invalid backup keys") }
        // defaults import MERGES keys; it does not delete keys absent from its input.
        // Explicitly delete only our originally absent keys, then import only saved keys.
        let current = try readDomain()
        for key in keys where saved[key] == nil && current[key] != nil {
            _ = try commands.run("/usr/bin/defaults", ["delete", domain, key])
        }
        if !saved.isEmpty {
            try store.write("import", saved)
            _ = try commands.run("/usr/bin/defaults", ["import", domain, importPath])
        }
        guard same(subset(try readDomain()), saved) else { throw Failure("Restore verification failed") }
        try notify()
    }
    func recover() throws {
        if let pending = try store.read("pending") {
            try replaceKeys(pending)
            try store.remove("pending")
        }
    }
    func transaction(_ body: () throws -> Void) throws {
        let before = subset(try readDomain())
        try store.write("pending", before) // durable undo intent before any defaults write
        do {
            try body()
            try store.remove("pending")
        } catch {
            let original = error
            do {
                try replaceKeys(before)
                try store.remove("pending")
            } catch {
                throw Failure("Operation failed: \(original); ROLLBACK FAILED: \(error). Undo journal retained; retry restore.")
            }
            throw Failure("Operation failed: \(original); prior keys restored")
        }
    }
    func set(_ value: String) throws {
        let limit = try percentage(value) // validate before recovery or mutations
        try recover()
        if try store.read("baseline") == nil { try store.write("baseline", subset(try readDomain())) }
        try transaction {
            _ = try commands.run("/usr/bin/defaults", ["write", domain, "MCLFeatureState", "-int", "1"])
            _ = try commands.run("/usr/bin/defaults", ["write", domain, "mclLimitValue", "-int", String(limit)])
            guard same(subset(try readDomain()), [keys[0]: 1, keys[1]: limit]) else {
                throw Failure("Written keys did not read back as the requested integers")
            }
            try notify()
        }
    }
    func restore() throws {
        try recover()
        guard let baseline = try store.read("baseline") else { return }
        try transaction { try replaceKeys(baseline) }
        // Keep the baseline until every restore step succeeded. Removal failures propagate.
        try store.remove("baseline")
    }
    func status() throws -> (Bool, Int?) {
        if try store.read("pending") != nil { throw Failure("Unfinished operation: run maintain stop to recover") }
        let value = try readDomain()
        let enabled = same(value[keys[0]].map { [keys[0]: $0] } ?? [:], [keys[0]: 1])
        let limit = value[keys[1]] as? Int
        if enabled {
            guard let limit = limit, (1...100).contains(limit),
                  same([keys[1]: value[keys[1]]!], [keys[1]: limit]) else {
                throw Failure("Enabled native preference has an invalid integer limit")
            }
        }
        return (enabled, limit)
    }
}
