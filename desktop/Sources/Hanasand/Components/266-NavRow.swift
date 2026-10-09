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

struct NavRow: View {
    @Environment(\.desktopTheme) var theme
    @FocusState private var isFocused: Bool
    let icon: String
    let title: String
    var isSelected = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 11) {
                Image(systemName: icon)
                    .foregroundStyle(isSelected ? theme.accent : theme.textSecondary)
                    .frame(width: 18)
                Text(title)
                    .foregroundStyle(isSelected ? theme.text : theme.textSecondary)
                Spacer(minLength: 0)
            }
            .font(.system(size: 13, weight: isSelected ? .semibold : .regular))
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, minHeight: 34, alignment: .leading)
            .background(isSelected ? theme.sidebarSelected : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .stroke(theme.accent.opacity(isFocused ? 0.8 : 0), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .focused($isFocused)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
