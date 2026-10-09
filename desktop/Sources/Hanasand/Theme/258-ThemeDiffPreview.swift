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

struct ThemeDiffPreview: View {
    @Environment(\.desktopTheme) var theme

    let rows = [
        ("1", #"const themePreview: ThemeConfig = {"#, false),
        ("2", #"  surface: "sidebar-elevated","#, true),
        ("3", ##"  accent: "#0ea5e9","##, true),
        ("4", #"  contrast: 68,"#, true),
        ("5", #"};"#, false),
    ]

    var body: some View {
        HStack(spacing: 0) {
            CodePane(rows: rows, fill: theme.danger.opacity(0.14), marker: theme.danger)
            Rectangle()
                .fill(theme.green)
                .frame(width: 5)
            CodePane(rows: rows, fill: theme.green.opacity(0.14), marker: theme.green)
        }
        .frame(height: 110)
        .background(Color.black.opacity(theme.isLight ? 0.80 : 0.34))
    }
}
