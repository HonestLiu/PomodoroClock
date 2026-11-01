import SwiftUI
import WidgetKit

struct FocusEntry: TimelineEntry {
    let date: Date
    let snapshot: FocusSnapshot
}
struct FocusProvider: TimelineProvider {
    func placeholder(in context: Context) -> FocusEntry { .init(date: Date(), snapshot: .preview) }
    func getSnapshot(in context: Context, completion: @escaping (FocusEntry) -> Void) {
        completion(.init(date: Date(), snapshot: context.isPreview ? .preview : WidgetStorage.read() ?? .empty))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<FocusEntry>) -> Void) {
        let snapshot = WidgetStorage.read() ?? .empty
        let now = Date()
        var dates = [now]
        // At expiry show an honest ended state; widgets never archive or advance a session.
        if snapshot.running, snapshot.mode != "stopwatch", let end = snapshot.endAt {
            let expiry = Date(timeIntervalSince1970: end / 1000)
            if expiry > now { dates.append(expiry) }
        }
        let midnight = Calendar.current.startOfDay(for: Calendar.current.date(byAdding: .day, value: 1, to: now)!)
        dates.append(midnight)
        completion(Timeline(entries: dates.sorted().map { .init(date: $0, snapshot: snapshot) }, policy: .after(now.addingTimeInterval(900))))
    }
}

struct FocusWidgetView: View {
    let entry: FocusEntry
    var previewFamily: WidgetFamily? = nil
    @Environment(\.widgetFamily) private var widgetFamily
    private var family: WidgetFamily { previewFamily ?? widgetFamily }
    @Environment(\.colorScheme) private var scheme
    private var data: FocusSnapshot { entry.snapshot }
    private var expired: Bool { data.expired(at: entry.date) }
    private var minutes: Int { data.minutes(at: entry.date) }
    private var sessions: Int { data.sessions(at: entry.date) }
    private var progress: Double { data.progress(at: entry.date) }
    private var accent: Color { data.isBreak ? Color(red: 0.19, green: 0.53, blue: 0.61) : Color(red: 0.84, green: 0.25, blue: 0.29) }
    private var ink: Color { scheme == .dark ? Color(white: 0.95) : Color(red: 0.16, green: 0.18, blue: 0.21) }

    var body: some View {
        Group {
            if family == .systemSmall { small }
            else if family == .systemMedium { medium }
            else { large }
        }
        .foregroundStyle(ink)
        .containerBackground(for: .widget) { scheme == .dark ? Color(red: 0.11, green: 0.12, blue: 0.14) : Color(red: 0.98, green: 0.98, blue: 0.97) }
        .widgetURL(URL(string: "focuspomodoro://timer"))
    }
    private var header: some View {
        HStack(spacing: 6) {
            Image(systemName: data.isBreak ? "leaf.fill" : "circle.lefthalf.filled")
                .foregroundStyle(accent).font(.system(size: 12, weight: .semibold))
            Text(data.status(at: entry.date)).font(.system(size: 12, weight: .semibold))
            Spacer(minLength: 0)
            if data.updatedAt == 0 { Image(systemName: "arrow.up.forward.app").foregroundStyle(.secondary) }
        }
        .accessibilityElement(children: .combine)
    }
    @ViewBuilder private var clock: some View {
        if data.running && !expired, data.mode == "stopwatch", let start = data.startAt {
            Text(Date(timeIntervalSince1970: start / 1000), style: .timer)
        } else if data.running && !expired, let end = data.endAt {
            Text(timerInterval: entry.date...max(entry.date, Date(timeIntervalSince1970: end / 1000)), countsDown: true)
        } else {
            let ms = expired ? 0 : data.ready ? (data.mode == "stopwatch" ? 0 : data.isBreak ? data.frozenMs : Double(data.focusMinutes * 60_000)) : data.frozenMs
            let seconds = max(0, Int(ms / 1000))
            Text(String(format: "%02d:%02d", seconds / 60, seconds % 60))
        }
    }
    private var timerFace: some View {
        clock.font(.system(size: family == .systemSmall ? 36 : 43, weight: .light, design: .rounded))
            .monospacedDigit().minimumScaleFactor(0.6).lineLimit(1)
            .accessibilityLabel(data.text("计时", "Timer"))
    }
    private var taskTitle: some View {
        Text(data.updatedAt == 0 ? data.text("打开应用，同步专注进度", "Open app to sync progress") : data.taskTitle ?? data.text("留一点时间，专注当下", "Make room to focus"))
            .font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
    }
    private var small: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Spacer(minLength: 8)
            timerFace
            taskTitle.padding(.top, 3)
            Spacer(minLength: 8)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(data.text("今日", "Today")).foregroundStyle(.secondary)
                Text("\(minutes)").fontWeight(.semibold)
                Text(data.text("分钟", "min")).foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.right").foregroundStyle(accent)
            }.font(.system(size: 11))
            goalTrack.padding(.top, 6)
        }
    }
    private var medium: some View {
        HStack(spacing: 20) {
            VStack(alignment: .leading, spacing: 0) {
                header
                Spacer(minLength: 6)
                timerFace
                taskTitle.padding(.top, 3)
                Spacer(minLength: 0)
            }.frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 7) {
                goalRing.frame(width: 56, height: 56)
                Text(data.text("今日 \(minutes) / \(data.targetMinutes) 分钟", "Today \(minutes) / \(data.targetMinutes) min"))
                    .font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
                Text(data.tasks.first(where: { $0.title != data.taskTitle })?.title ?? data.text("打开应用，安排下一步", "Open app to plan your next step"))
                    .font(.system(size: 11, weight: .medium)).lineLimit(1)
            }.frame(width: 122, alignment: .leading)
        }
    }
    private var large: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 5) { header; timerFace; taskTitle }
                Spacer(minLength: 0)
                goalRing.frame(width: 64, height: 64).padding(.top, 7)
            }
            HStack {
                Text(data.text("今日 \(minutes) 分钟", "Today \(minutes) min")).fontWeight(.medium)
                Spacer()
                Text(data.text("\(sessions) 次专注", "\(sessions) sessions")).foregroundStyle(.secondary)
            }.font(.system(size: 11))
            goalTrack
            VStack(alignment: .leading, spacing: 9) {
                Text(data.text("接下来", "Up next")).font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
                if data.tasks.isEmpty {
                    Text(data.text("暂无待办，在应用中添加任务", "No tasks. Add one in the app."))
                        .font(.system(size: 12)).foregroundStyle(.secondary)
                } else {
                    ForEach(data.tasks.prefix(3)) { task in
                        HStack(spacing: 8) {
                            Circle().strokeBorder(ink.opacity(0.25), lineWidth: 1).frame(width: 11, height: 11)
                            Text(task.title).font(.system(size: 12)).lineLimit(1)
                        }
                    }
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 0)
            weekChart
        }
    }
    private var goalTrack: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(ink.opacity(0.08))
                Capsule().fill(accent).frame(width: geometry.size.width * progress)
            }
        }.frame(height: 3).accessibilityLabel(data.text("今日目标完成 \(Int(progress * 100))%", "Daily goal \(Int(progress * 100))%"))
    }
    private var goalRing: some View {
        ZStack {
            Circle().stroke(ink.opacity(0.07), lineWidth: 4)
            Circle().trim(from: 0, to: progress).stroke(accent, style: StrokeStyle(lineWidth: 4, lineCap: .round)).rotationEffect(.degrees(-90))
            VStack(spacing: 1) {
                Text("\(Int(progress * 100))").font(.system(size: 19, weight: .medium, design: .rounded))
                Text("%").font(.system(size: 9)).foregroundStyle(.secondary)
            }
        }.accessibilityElement(children: .ignore).accessibilityLabel(data.text("今日目标完成 \(Int(progress * 100))%", "Daily goal \(Int(progress * 100))%"))
    }
    private var weekChart: some View {
        HStack(alignment: .bottom, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(data.text("近七天", "Last 7 days")).font(.system(size: 11, weight: .semibold))
                Text(data.text("每一段专注都算数", "Every session counts")).font(.system(size: 9)).foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            let maxValue = max(1, data.week.map(\.minutes).max() ?? 1)
            ForEach(data.week) { day in
                RoundedRectangle(cornerRadius: 2).fill(accent.opacity(day.date == data.day ? 1 : 0.24))
                    .frame(width: 9, height: max(3, 30 * Double(day.minutes) / Double(maxValue)))
                    .accessibilityLabel("\(day.date): \(day.minutes) min")
            }
        }.frame(height: 32)
    }
}

#if !WIDGET_PREVIEW
struct FocusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetStorage.kind, provider: FocusProvider()) { entry in FocusWidgetView(entry: entry) }
            .configurationDisplayName("专注时光 · FocusPomodoro")
            .description("当前计时、今日目标与接下来的任务。")
            .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

@main
struct FocusWidgetsBundle: WidgetBundle {
    var body: some Widget { FocusWidget() }
}
#endif
