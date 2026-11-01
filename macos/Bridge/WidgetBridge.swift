import Foundation
import WidgetKit

// Rust owns the database; the extension receives only this small, read-only projection.
// Return an error instead of writing outside the entitled shared container.
@_cdecl("focus_widget_publish")
public func focusWidgetPublish(_ bytes: UnsafePointer<UInt8>?, _ length: Int) -> Int32 {
    guard let bytes, length > 0, let file = WidgetStorage.file else { return 1 }
    do {
        let data = Data(bytes: bytes, count: length)
        _ = try JSONDecoder().decode(FocusSnapshot.self, from: data)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: file, options: .atomic)
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetStorage.kind)
        return 0
    } catch { return 2 }
}
