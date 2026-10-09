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

struct AICodeBlock: View {
    @Environment(\.desktopTheme) var theme
    let content: String
    let language: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            AIBlockHeader(language: language.isEmpty ? "code" : language, copyText: content)
            ScrollView(.horizontal, showsIndicators: false) {
                Text(content)
                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    .foregroundStyle(theme.textSecondary)
                    .textSelection(.enabled)
                    .lineSpacing(5)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
            }
        }
        .background(theme.backgroundElevated.opacity(0.82))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(theme.divider, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
