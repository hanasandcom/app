import AppKit
import ApplicationServices
import Combine
import CryptoKit
import Darwin
import Foundation
import Network
import PDFKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

extension NSImage {
    func rotated(clockwise: Bool) -> NSImage? {
        let nextSize = NSSize(width: size.height, height: size.width)
        let next = NSImage(size: nextSize)
        next.lockFocus()
        guard let context = NSGraphicsContext.current?.cgContext else {
            next.unlockFocus()
            return nil
        }
        context.translateBy(x: nextSize.width / 2, y: nextSize.height / 2)
        context.rotate(by: clockwise ? -.pi / 2 : .pi / 2)
        draw(in: NSRect(x: -size.width / 2, y: -size.height / 2, width: size.width, height: size.height), from: .zero, operation: .copy, fraction: 1)
        next.unlockFocus()
        return next
    }
}
