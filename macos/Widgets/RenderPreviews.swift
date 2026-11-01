// Offscreen render of the same SwiftUI views shipped in the WidgetKit extension.
import AppKit
import SwiftUI
import WidgetKit

@main
struct RenderPreviews {
    @MainActor static func main() throws {
        let directory = CommandLine.arguments.dropFirst().first ?? "/tmp/focus-widget-previews"
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        let sizes: [(String, WidgetFamily, CGFloat, CGFloat)] = [
            ("small", .systemSmall, 170, 170), ("medium", .systemMedium, 364, 170), ("large", .systemLarge, 364, 382)
        ]
        var english = try JSONSerialization.jsonObject(with: JSONEncoder().encode(FocusSnapshot.preview)) as! [String: Any]
        english["language"] = "en"
        english["taskTitle"] = "Read a very long chapter title and review the most important exercises"
        english["tasks"] = [["id": "next", "title": "Review the next chapter and write down the key ideas"]]
        let longEnglish = try JSONDecoder().decode(FocusSnapshot.self, from: JSONSerialization.data(withJSONObject: english))
        for dark in [false, true] {
            for (name, family, width, height) in sizes {
              for (variant, snapshot) in [("", FocusSnapshot.preview), ("-empty", .empty), ("-english", longEnglish)] {
                let view = FocusWidgetView(entry: .init(date: Date(), snapshot: snapshot), previewFamily: family)
                    .environment(\.colorScheme, dark ? .dark : .light)
                    .frame(width: width - 32, height: height - 32).padding(16)
                    .background(dark ? Color(red: 0.11, green: 0.12, blue: 0.14) : Color(red: 0.98, green: 0.98, blue: 0.97))
                    .clipShape(RoundedRectangle(cornerRadius: 24))
                let renderer = ImageRenderer(content: view)
                renderer.scale = 2
                guard let image = renderer.cgImage else { fatalError("SwiftUI render failed") }
                let bitmap = NSBitmapImageRep(cgImage: image)
                let png = bitmap.representation(using: .png, properties: [:])!
                try png.write(to: URL(fileURLWithPath: "\(directory)/\(name)-\(dark ? "dark" : "light")\(variant).png"))
              }
            }
        }
        print("Rendered 18 native widget previews (all sizes, themes, empty and long English): \(directory)")
    }
}
