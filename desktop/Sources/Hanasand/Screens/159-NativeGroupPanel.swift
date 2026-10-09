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

struct NativeGroupPanel<Content: View>: View {
    @Environment(\.desktopTheme) var theme
    let title: String
    let subtitle: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 16, weight: .black))
                    .foregroundStyle(theme.text)
                    .textSelection(.enabled)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(1)
                        .textSelection(.enabled)
                }
            }
            content
        }
        .padding(14)
        .background(theme.card)
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(
                    LinearGradient(colors: [theme.divider.opacity(1.5), theme.divider.opacity(0.45)], startPoint: .topLeading, endPoint: .bottomTrailing),
                    lineWidth: 1
                )
        )
        .shadow(color: .black.opacity(theme.isLight ? 0.05 : 0.20), radius: 18, x: 0, y: 10)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}
