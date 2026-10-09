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

struct FilterChip: View {
    @Environment(\.desktopTheme) var theme
    let title: String
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(active ? theme.background : theme.textSecondary)
                .padding(.horizontal, 11)
                .frame(height: 30)
                .background(active ? theme.accent : theme.field)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}
