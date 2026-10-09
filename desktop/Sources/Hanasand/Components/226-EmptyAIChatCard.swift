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

struct EmptyAIChatCard: View {
    @Environment(\.desktopTheme) var theme

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "briefcase")
                .font(.system(size: 22, weight: .medium))
                .foregroundStyle(theme.textSecondary)
                .frame(width: 58, height: 58)
                .background(theme.card.opacity(0.82))
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            VStack(spacing: 8) {
                Text("Start with the task, not the tooling.")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(theme.text)
                Text("Ask for a feature, a bug fix, or an app. Add context only when it helps.")
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(theme.textTertiary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }
}
