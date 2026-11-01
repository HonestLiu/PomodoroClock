import Foundation

@main
struct VerifyWidgetData {
    static func main() throws {
        let original = FocusSnapshot.preview
        let now = Date()
        let encoded = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(FocusSnapshot.self, from: encoded)
        precondition(decoded.tasks.count == 3 && decoded.week.count == 7)
        precondition(decoded.minutes(at: now) == 85 && decoded.sessions(at: now) == 4)
        precondition(decoded.progress(at: now) > 0.70 && decoded.progress(at: now) < 0.71)
        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: now)!
        precondition(decoded.minutes(at: tomorrow) == 0 && decoded.sessions(at: tomorrow) == 0)
        precondition(decoded.progress(at: tomorrow) == 0)
        precondition(decoded.status(at: now) == "已暂停")
        var json = try JSONSerialization.jsonObject(with: encoded) as! [String: Any]
        json["running"] = true
        json["endAt"] = now.addingTimeInterval(60).timeIntervalSince1970 * 1000
        json["language"] = "en"
        var data = try JSONDecoder().decode(FocusSnapshot.self, from: JSONSerialization.data(withJSONObject: json))
        precondition(!data.expired(at: now))
        precondition(data.expired(at: now.addingTimeInterval(61)))
        precondition(data.status(at: now) == "Focusing")
        precondition(data.status(at: now.addingTimeInterval(61)) == "Session ended")
        json["mode"] = "stopwatch"
        data = try JSONDecoder().decode(FocusSnapshot.self, from: JSONSerialization.data(withJSONObject: json))
        precondition(!data.expired(at: tomorrow))
        json["todayMinutes"] = 500
        data = try JSONDecoder().decode(FocusSnapshot.self, from: JSONSerialization.data(withJSONObject: json))
        precondition(data.progress(at: now) == 1)
        precondition(FocusSnapshot.empty.updatedAt == 0 && FocusSnapshot.empty.tasks.isEmpty)
        print("Widget data: decoding, pause, expiry, stopwatch, midnight, goal cap and empty state passed")
    }
}
