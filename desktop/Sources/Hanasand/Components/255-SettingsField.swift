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

struct SettingsField: View {
    @Environment(\.desktopTheme) var theme
    let label: String
    @Binding var text: String
    var isSecure = false

    var body: some View {
        HStack(spacing: 14) {
            Text(label)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(theme.textSecondary)
                .frame(width: 130, alignment: .leading)
            if isSecure {
                SecureField(label, text: $text)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    .foregroundStyle(theme.text)
            } else {
                TextField(label, text: $text)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    .foregroundStyle(theme.text)
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 40)
        .background(theme.field)
        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
    }
}
