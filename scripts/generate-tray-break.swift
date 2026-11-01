// 生成休息状态的菜单栏图标。使用系统 CoreGraphics，不依赖第三方绘图库。
// swift -module-cache-path /tmp/pomodoro-icon-cache scripts/generate-tray-break.swift
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

func blue(_ hex: UInt32) -> CGColor {
    CGColor(red: CGFloat((hex >> 16) & 255) / 255,
            green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: 1)
}
func context(_ size: Int) -> CGContext {
    CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
              bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(),
              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
}
func drawLeaves(_ ctx: CGContext, size: Int) {
    let scale = CGFloat(size) / 64
    ctx.saveGState()
    ctx.translateBy(x: 0, y: CGFloat(size))
    ctx.scaleBy(x: scale, y: -scale)
    ctx.setAllowsAntialiasing(true)
    ctx.setShouldAntialias(true)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)

    // 向上舒展的枝干，与专注时的番茄保持相近的视觉重量。
    let stem = CGMutablePath()
    stem.move(to: CGPoint(x: 27, y: 54))
    stem.addCurve(to: CGPoint(x: 42, y: 28), control1: CGPoint(x: 27, y: 43), control2: CGPoint(x: 33, y: 35))
    ctx.addPath(stem)
    ctx.setStrokeColor(blue(0x406DCC))
    ctx.setLineWidth(4.5)
    ctx.strokePath()

    let left = CGMutablePath()
    left.move(to: CGPoint(x: 30, y: 42))
    left.addCurve(to: CGPoint(x: 9, y: 17), control1: CGPoint(x: 13, y: 43), control2: CGPoint(x: 6, y: 32))
    left.addCurve(to: CGPoint(x: 30, y: 42), control1: CGPoint(x: 25, y: 17), control2: CGPoint(x: 34, y: 27))
    left.closeSubpath()
    ctx.addPath(left)
    ctx.setFillColor(blue(0x7DA7EE))
    ctx.fillPath()

    let right = CGMutablePath()
    right.move(to: CGPoint(x: 29, y: 44))
    right.addCurve(to: CGPoint(x: 56, y: 9), control1: CGPoint(x: 23, y: 23), control2: CGPoint(x: 36, y: 10))
    right.addCurve(to: CGPoint(x: 29, y: 44), control1: CGPoint(x: 59, y: 29), control2: CGPoint(x: 48, y: 44))
    right.closeSubpath()
    ctx.addPath(right)
    ctx.setFillColor(blue(0x4A7DE0))
    ctx.fillPath()

    // 仅保留一条主叶脉，缩至 16–18px 时仍清楚，避免细节糊在一起。
    let vein = CGMutablePath()
    vein.move(to: CGPoint(x: 33, y: 37))
    vein.addQuadCurve(to: CGPoint(x: 46, y: 22), control: CGPoint(x: 37, y: 28))
    ctx.addPath(vein)
    ctx.setStrokeColor(blue(0xD9E7FF))
    ctx.setLineWidth(2.8)
    ctx.strokePath()
    ctx.restoreGState()
}
func writePNG(_ image: CGImage, at url: URL) throws {
    guard let writer = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        throw NSError(domain: "TrayIcon", code: 1)
    }
    CGImageDestinationAddImage(writer, image, nil)
    guard CGImageDestinationFinalize(writer) else { throw NSError(domain: "TrayIcon", code: 2) }
}
let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let high = context(256)
drawLeaves(high, size: 256)
let output = context(64)
output.interpolationQuality = .high
output.draw(high.makeImage()!, in: CGRect(x: 0, y: 0, width: 64, height: 64))
let icon = output.makeImage()!
try writePNG(icon, at: root.appendingPathComponent("src-tauri/icons/tray-break.png"))

// 临时预览：左半为浅色菜单栏、右半为深色菜单栏，分别展示 18 / 24 / 40px。
let preview = CGContext(data: nil, width: 360, height: 96, bitsPerComponent: 8,
    bytesPerRow: 360 * 4, space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
preview.setFillColor(blue(0xF4F4F6))
preview.fill(CGRect(x: 0, y: 0, width: 180, height: 96))
preview.setFillColor(blue(0x24262B))
preview.fill(CGRect(x: 180, y: 0, width: 180, height: 96))
preview.interpolationQuality = .high
for origin in [0, 180] {
    for (x, size) in [(20, 18), (68, 24), (118, 40)] {
        preview.draw(icon, in: CGRect(x: origin + x, y: (96 - size) / 2, width: size, height: size))
    }
}
try writePNG(preview.makeImage()!, at: URL(fileURLWithPath: "/tmp/pomodoro-tray-break-preview.png"))
print("Generated tray-break.png (64×64 RGBA) and /tmp/pomodoro-tray-break-preview.png")
