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

struct EventBlock: View {
    @Environment(\.desktopTheme) var theme
    let event: AgentEvent

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(event.body)
                .font(.system(size: 16, weight: .semibold))
                .lineSpacing(5)
                .foregroundStyle(event.kind == .error ? theme.danger : theme.text)
                .textSelection(.enabled)
            Text(event.meta)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(event.kind == .change ? theme.green : theme.textSecondary)
        }
    }
}
