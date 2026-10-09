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

struct IDEEditorTabButton: View {
    @Environment(\.desktopTheme) var theme
    let file: IDEShareFile
    let selected: Bool
    let select: () -> Void
    let close: () -> Void

    var body: some View {
        Button(action: select) {
            HStack(spacing: 8) {
                Image(systemName: file.icon)
                    .font(.system(size: 11, weight: .bold))
                Text(file.title)
                    .lineLimit(1)
                    .frame(maxWidth: 150, alignment: .leading)
                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(theme.textTertiary)
                }
                .buttonStyle(.plain)
            }
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(selected ? theme.text : theme.textSecondary)
            .padding(.horizontal, 10)
            .frame(height: 30)
            .background(selected ? theme.commandBar : theme.card.opacity(0.72))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
