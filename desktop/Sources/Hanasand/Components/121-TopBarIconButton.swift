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

struct TopBarIconButton: View {
    @Environment(\.desktopTheme) var theme
    let icon: String
    let label: String
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if active {
                    Circle()
                        .fill(theme.accent)
                        .frame(width: 6, height: 6)
                }
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .bold))
                Text(label)
                    .font(.system(size: 12, weight: .bold))
            }
            .foregroundStyle(active ? theme.text : theme.textSecondary)
            .frame(height: 28)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(label)
        .accessibilityLabel(label)
    }
}
