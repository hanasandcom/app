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

struct AIClientRow: View {
    @Environment(\.desktopTheme) var theme
    let client: AIConnectedClient

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "cpu")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(theme.accent)
                .frame(width: 32, height: 32)
                .background(theme.accentSoft)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(client.name)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
                Text(client.statusText)
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(theme.textTertiary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
