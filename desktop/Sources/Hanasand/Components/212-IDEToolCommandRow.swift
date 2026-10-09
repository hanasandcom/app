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

struct IDEToolCommandRow: View {
    @Environment(\.desktopTheme) var theme
    let command: IDEQuickCommand
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: command.icon)
                    .font(.system(size: 11, weight: .bold))
                    .frame(width: 16)
                VStack(alignment: .leading, spacing: 2) {
                    Text(command.title)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(theme.text)
                        .lineLimit(1)
                    Text(command.command)
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 9)
            .frame(height: 38)
            .background(theme.field)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
