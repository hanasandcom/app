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

struct DashboardSectionHeader: View {
    @Environment(\.desktopTheme) var theme
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(theme.text)
            Text(subtitle)
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(theme.textTertiary)
        }
        .padding(.top, 2)
    }
}
