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

struct BrowserAgentField: View {
    @Environment(\.desktopTheme) var theme
    let title: String
    @Binding var text: String
    let placeholder: String
    var width: CGFloat?

    var body: some View {
        HStack(spacing: 6) {
            Text(title)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(theme.textTertiary)
                .textCase(.uppercase)
            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .font(.system(size: 11, weight: .semibold, design: title == "Selector" ? .monospaced : .default))
                .foregroundStyle(theme.text)
        }
        .padding(.horizontal, 9)
        .frame(width: width)
        .frame(height: 28)
        .background(theme.field)
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(theme.divider, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}
