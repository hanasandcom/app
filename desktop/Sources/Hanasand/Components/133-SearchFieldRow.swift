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

struct SearchFieldRow: View {
    @Environment(\.desktopTheme) var theme
    let placeholder: String
    @Binding var text: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(theme.textTertiary)
            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.text)
            Spacer()
            if !text.isEmpty {
                Button("Clear") {
                    text = ""
                }
                .buttonStyle(.plain)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(theme.accent)
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 40)
        .background(theme.field)
        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
    }
}
