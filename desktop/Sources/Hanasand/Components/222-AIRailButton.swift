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

struct AIRailButton: View {
    @Environment(\.desktopTheme) var theme
    let title: String
    let subtitle: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(theme.accent)
                    .frame(width: 30, height: 30)
                    .background(theme.accentSoft.opacity(0.72))
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(theme.text)
                    Text(subtitle)
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(theme.textTertiary)
                }
                Spacer(minLength: 0)
            }
            .padding(10)
            .background(theme.card.opacity(0.74))
            .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
