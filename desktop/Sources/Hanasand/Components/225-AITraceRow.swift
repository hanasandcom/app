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

struct AITraceRow: View {
    @Environment(\.desktopTheme) var theme
    let event: AITraceEvent

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: event.kind.icon)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(event.kind == .error ? theme.danger : theme.accent)
                Text(event.title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
            }
            Text(event.detail)
                .font(.system(size: 11, weight: .regular))
                .foregroundStyle(theme.textSecondary)
                .lineLimit(4)
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
