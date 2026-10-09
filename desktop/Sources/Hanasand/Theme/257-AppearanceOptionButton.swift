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

struct AppearanceOptionButton: View {
    @Environment(\.desktopTheme) var theme
    let option: AppearancePreference
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: option.icon)
                    .font(.system(size: 14, weight: .semibold))
                Text(option.title)
                    .font(.system(size: 13, weight: .bold))
            }
            .foregroundStyle(isSelected ? theme.text : theme.textSecondary)
            .padding(.horizontal, 11)
            .frame(height: 32)
            .background(isSelected ? theme.cardRaised : Color.clear)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}
