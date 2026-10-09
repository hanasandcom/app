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

struct NativeEmptyState: View {
    @Environment(\.desktopTheme) var theme
    let title: String
    let message: String

    var body: some View {
        NativeGroupPanel(title: title, subtitle: "") {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: "tray")
                    .font(.system(size: 16, weight: .black))
                    .foregroundStyle(theme.accent)
                    .frame(width: 38, height: 38)
                    .background(theme.accentSoft)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                Text(message)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer()
            }
        }
    }
}
