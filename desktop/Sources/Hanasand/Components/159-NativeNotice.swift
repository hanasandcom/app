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

enum NativeNoticeTone {
    case error
    case info
    case success
}

struct NativeNotice: View {
    @Environment(\.desktopTheme) var theme
    let message: String
    var title: String = ""
    var tone: NativeNoticeTone = .error

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(accent)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 3) {
                if !title.isEmpty {
                    Text(title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.text)
                }
                Text(message)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(theme.cardRaised.opacity(theme.isLight ? 0.78 : 0.72))
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(accent)
                .frame(width: 2)
                .padding(.vertical, 8)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(theme.divider.opacity(0.7), lineWidth: 1)
        )
    }

    var accent: Color {
        switch tone {
        case .error: return theme.danger
        case .info: return theme.accent
        case .success: return theme.green
        }
    }

    var icon: String {
        switch tone {
        case .error: return "exclamationmark.circle"
        case .info: return "info.circle"
        case .success: return "checkmark.circle"
        }
    }
}
