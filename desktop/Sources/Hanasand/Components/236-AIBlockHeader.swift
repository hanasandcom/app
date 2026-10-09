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

struct AIBlockHeader: View {
    @Environment(\.desktopTheme) var theme
    let language: String
    let copyText: String

    var body: some View {
        HStack(spacing: 8) {
            Text(language.lowercased())
                .font(.system(size: 11, weight: .black, design: .monospaced))
                .foregroundStyle(theme.textTertiary)
            Spacer()
            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(copyText, forType: .string)
            } label: {
                Image(systemName: "doc.on.doc")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(theme.textTertiary)
                    .frame(width: 26, height: 24)
            }
            .buttonStyle(.plain)
            .help("Copy")
            .accessibilityLabel("Copy \(language) block")
        }
        .padding(.leading, 14)
        .padding(.trailing, 8)
        .frame(height: 32)
        .background(theme.commandBar.opacity(0.78))
    }
}
