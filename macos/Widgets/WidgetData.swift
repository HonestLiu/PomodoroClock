import Foundation

enum WidgetStorage {
    static let kind = "FocusPomodoro.Today"
    static var group: String {
        Bundle.main.object(forInfoDictionaryKey: "FocusWidgetAppGroup") as? String ?? "group.com.focuspomodoro.desktop"
    }
    static var file: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent("focus-widget.json")
    }
    static func read() -> FocusSnapshot? {
        guard let file, let data = try? Data(contentsOf: file),
              let snapshot = try? JSONDecoder().decode(FocusSnapshot.self, from: data),
              snapshot.version == 1 else { return nil }
        return snapshot
    }
}

struct WidgetTask: Codable, Identifiable {
    let id: String
    let title: String
}
struct WidgetDay: Codable, Identifiable {
    let date: String
    let minutes: Int
    var id: String { date }
}
struct FocusSnapshot: Codable {
    let version: Int
    let updatedAt: Double
    let day: String
    let language: String
    let phase: String
    let mode: String
    let running: Bool
    let startAt: Double?
    let endAt: Double?
    let frozenMs: Double
    let focusMinutes: Int
    let targetMinutes: Int
    let todayMinutes: Int
    let todaySessions: Int
    let taskTitle: String?
    let tasks: [WidgetTask]
    let week: [WidgetDay]

    var english: Bool { language == "en" }
    func text(_ zh: String, _ en: String) -> String { english ? en : zh }
    func minutes(at date: Date) -> Int { day == Self.dayKey(date) ? max(0, todayMinutes) : 0 }
    func sessions(at date: Date) -> Int { day == Self.dayKey(date) ? max(0, todaySessions) : 0 }
    func progress(at date: Date) -> Double { min(1, Double(minutes(at: date)) / Double(max(1, targetMinutes))) }
    var isBreak: Bool { phase == "break" }
    func expired(at date: Date) -> Bool { running && mode != "stopwatch" && (endAt ?? .infinity) <= date.timeIntervalSince1970 * 1000 }
    var ready: Bool { phase == "idle" || startAt == nil }
    func status(at date: Date) -> String {
        if expired(at: date) { return text("本轮已结束", "Session ended") }
        if ready { return isBreak ? text("休息一下", "Take a break") : text("准备专注", "Ready to focus") }
        if !running { return text("已暂停", "Paused") }
        return isBreak ? text("休息中", "Resting") : text("专注中", "Focusing")
    }
    static func dayKey(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = .current
        return formatter.string(from: date)
    }
    static var empty: Self {
        Self(version: 1, updatedAt: 0, day: dayKey(Date()), language: "zh", phase: "idle",
             mode: "pomodoro", running: false, startAt: nil, endAt: nil, frozenMs: 1_500_000,
             focusMinutes: 25, targetMinutes: 180, todayMinutes: 0, todaySessions: 0,
             taskTitle: nil, tasks: [], week: [])
    }
    static var preview: Self {
        Self(version: 1, updatedAt: Date().timeIntervalSince1970 * 1000, day: dayKey(Date()),
             language: "zh", phase: "focus", mode: "pomodoro", running: false,
             startAt: Date().timeIntervalSince1970 * 1000 - 420_000,
             endAt: Date().timeIntervalSince1970 * 1000 + 1_080_000, frozenMs: 1_080_000,
             focusMinutes: 25, targetMinutes: 120, todayMinutes: 85, todaySessions: 4,
             taskTitle: "读完今天的章节", tasks: [WidgetTask(id: "1", title: "读完今天的章节"),
             WidgetTask(id: "2", title: "整理本周学习笔记"), WidgetTask(id: "3", title: "完成一组练习")],
             week: (0..<7).map { WidgetDay(date: dayKey(Calendar.current.date(byAdding: .day, value: $0 - 6, to: Date())!), minutes: [40, 75, 25, 110, 60, 95, 85][$0]) })
    }
}
