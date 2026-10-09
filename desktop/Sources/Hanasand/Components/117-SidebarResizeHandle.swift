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

struct SidebarResizeHandle: View {
    @Environment(\.desktopTheme) var theme
    @Binding var width: Double
    @State var dragStartWidth: Double?

    var body: some View {
        Rectangle()
            .fill(theme.divider.opacity(0.6))
            .frame(width: 5)
            .overlay(
                Rectangle()
                    .fill(theme.accent.opacity(0.0))
                    .frame(width: 2)
            )
            .contentShape(Rectangle())
            .gesture(
                DragGesture()
                    .onChanged { value in
                        let start = dragStartWidth ?? width
                        dragStartWidth = start
                        width = min(max(start + value.translation.width, 210), 380)
                    }
                    .onEnded { _ in
                        dragStartWidth = nil
                    }
            )
            .onHover { hovering in
                if hovering {
                    NSCursor.resizeLeftRight.push()
                } else {
                    NSCursor.pop()
                }
            }
            .help("Drag to resize sidebar")
    }
}
