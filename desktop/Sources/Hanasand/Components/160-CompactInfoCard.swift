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

struct CompactInfoCard: View {
    @Environment(\.desktopTheme) var theme
    let title: String
    let lines: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title)
                .font(.system(size: 11, weight: .black))
                .foregroundStyle(theme.textTertiary)
                .textCase(.uppercase)
            ForEach(lines, id: \.self) { line in
                Text(line)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(2)
                    .textSelection(.enabled)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.cardRaised)
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(theme.divider.opacity(0.85), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
