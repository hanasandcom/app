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

struct AIMessageContentView: View {
    @Environment(\.desktopTheme) var theme
    let content: String
    let isError: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(AIChatContentParser.segments(from: content)) { segment in
                switch segment.kind {
                case .text:
                    Text(segment.content)
                        .font(.system(size: 14, weight: .regular))
                        .foregroundStyle(isError ? theme.danger : theme.text)
                        .textSelection(.enabled)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                case .json:
                    AIJSONCodeBlock(content: segment.content, language: segment.language)
                case .code:
                    AICodeBlock(content: segment.content, language: segment.language)
                }
            }
        }
    }
}
