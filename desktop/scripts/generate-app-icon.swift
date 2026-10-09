import AppKit
import Foundation

let root = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? FileManager.default.currentDirectoryPath, isDirectory: true)
let resources = root.appendingPathComponent("Resources", isDirectory: true)
let iconset = resources.appendingPathComponent("Hanasand.iconset", isDirectory: true)
let icns = resources.appendingPathComponent("Hanasand.icns")
let fileManager = FileManager.default

try fileManager.createDirectory(at: iconset, withIntermediateDirectories: true)

let sizes: [(String, CGFloat)] = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]

// Derive icons from the same transparent artwork used by the website.
let sourceURL = root.appendingPathComponent("../../frontend/public/hanasand-logo.png").standardizedFileURL
guard let source = NSImage(contentsOf: sourceURL) else {
    fatalError("Could not load Hanasand logo")
}

func drawIcon(size: CGFloat) throws -> Data {
    let pixels = Int(size)
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        fatalError("Could not create icon bitmap")
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    source.draw(in: NSRect(x: 0, y: 0, width: size, height: size),
                from: .zero, operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        fatalError("Could not encode icon")
    }
    return png
}

func appendFourCC(_ value: String, to data: inout Data) {
    data.append(value.data(using: .ascii)!)
}

func appendUInt32(_ value: UInt32, to data: inout Data) {
    var bigEndian = value.bigEndian
    withUnsafeBytes(of: &bigEndian) { data.append(contentsOf: $0) }
}

func writeIcns(chunks: [(type: String, png: Data)], to url: URL) throws {
    var body = Data()
    for chunk in chunks {
        appendFourCC(chunk.type, to: &body)
        appendUInt32(UInt32(chunk.png.count + 8), to: &body)
        body.append(chunk.png)
    }

    var file = Data()
    appendFourCC("icns", to: &file)
    appendUInt32(UInt32(body.count + 8), to: &file)
    file.append(body)
    try file.write(to: url)
}

var rendered: [String: Data] = [:]
for (name, size) in sizes {
    let png = try drawIcon(size: size)
    rendered[name] = png
    try png.write(to: iconset.appendingPathComponent(name))
}

let icnsChunks = [
    ("icp4", "icon_16x16.png"),
    ("icp5", "icon_32x32.png"),
    ("icp6", "icon_32x32@2x.png"),
    ("ic07", "icon_128x128.png"),
    ("ic08", "icon_256x256.png"),
    ("ic09", "icon_512x512.png"),
    ("ic10", "icon_512x512@2x.png"),
].map { type, name in
    guard let png = rendered[name] else {
        fatalError("Missing rendered icon \(name)")
    }
    return (type: type, png: png)
}

try writeIcns(chunks: icnsChunks, to: icns)

print(iconset.path)
