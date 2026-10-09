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

struct ControlStateChip: View {
    @Environment(\.desktopTheme) var theme
    let title: String
    let value: String
    let icon: String

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(theme.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 10, weight: .black))
                    .foregroundStyle(theme.textTertiary)
                    .textCase(.uppercase)
                Text(value)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .frame(height: 48)
        .frame(maxWidth: .infinity)
        .background(theme.cardRaised)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
