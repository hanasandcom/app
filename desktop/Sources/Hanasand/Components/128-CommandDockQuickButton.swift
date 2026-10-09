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

struct CommandDockQuickButton: View {
    @Environment(\.desktopTheme) var theme
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 10, weight: .semibold))
                Text(title)
            }
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(theme.textSecondary)
            .padding(.horizontal, 8)
            .frame(height: 26)
            .background(theme.cardRaised.opacity(0.82))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(theme.divider, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .help(title)
    }
}
