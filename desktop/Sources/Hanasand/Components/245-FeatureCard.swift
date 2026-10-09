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

struct FeatureCard: View {
    @Environment(\.desktopTheme) var theme
    let title: String
    let value: String
    let icon: String

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(theme.textSecondary)
                .frame(width: 26, height: 26)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(theme.textTertiary)
                    .textCase(.uppercase)
                Text(value)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
                    .textSelection(.enabled)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, minHeight: 62, alignment: .leading)
        .background(theme.card)
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(theme.divider.opacity(0.7), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
