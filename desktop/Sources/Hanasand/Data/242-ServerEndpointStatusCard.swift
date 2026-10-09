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

struct ServerEndpointStatusCard: View {
    @Environment(\.desktopTheme) var theme
    let status: ServerEndpointStatus

    var tint: Color {
        switch status.isReachable {
        case .some(true):
            return theme.green
        case .some(false):
            return theme.danger
        case .none:
            return theme.accent
        }
    }

    var icon: String {
        switch status.isReachable {
        case .some(true):
            return "checkmark.circle.fill"
        case .some(false):
            return "xmark.octagon.fill"
        case .none:
            return "questionmark.circle.fill"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 9) {
                Image(systemName: icon)
                    .foregroundStyle(tint)
                Text(status.title)
                    .font(.system(size: 13, weight: .black))
                    .foregroundStyle(theme.text)
                Spacer()
                Text(status.stateLabel)
                    .font(.system(size: 10, weight: .black))
                    .foregroundStyle(tint)
                    .textCase(.uppercase)
            }
            Text(status.target)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(theme.textTertiary)
                .lineLimit(2)
                .textSelection(.enabled)
            Text(status.detail)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.textSecondary)
                .lineLimit(3)
            Text(DateFormatter.localizedString(from: status.checkedAt, dateStyle: .none, timeStyle: .short))
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(theme.textTertiary)
        }
        .padding(13)
        .background(theme.cardRaised)
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(tint.opacity(0.35), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .contextMenu {
            Button("Copy Status") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString("\(status.title): \(status.stateLabel) | \(status.target) | \(status.detail)", forType: .string)
            }
            Button("Copy Target") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(status.target, forType: .string)
            }
        }
    }
}
