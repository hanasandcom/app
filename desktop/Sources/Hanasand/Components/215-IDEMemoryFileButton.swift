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

struct IDEMemoryFileButton: View {
    @Environment(\.desktopTheme) var theme
    let file: IDEShareFile
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: icon)
                    .font(.system(size: 10, weight: .bold))
                    .frame(width: 14)
                VStack(alignment: .leading, spacing: 1) {
                    Text(file.title)
                        .font(.system(size: 10, weight: .bold))
                        .lineLimit(1)
                    Text(file.path)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(1)
                }
                Spacer()
            }
            .foregroundStyle(theme.textSecondary)
            .padding(.horizontal, 8)
            .frame(height: 32)
            .background(theme.field)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
