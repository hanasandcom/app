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

struct BrowserAddressField: View {
    @Environment(\.desktopTheme) var theme
    @Binding var address: String
    var isFocused: FocusState<Bool>.Binding
    let submit: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(theme.textTertiary)
            TextField("Open surface, search, or paste URL", text: $address)
                .textFieldStyle(.plain)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.text)
                .focused(isFocused)
                .onSubmit(submit)
        }
        .padding(.horizontal, 12)
        .frame(height: 32)
        .background(theme.field)
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(isFocused.wrappedValue ? theme.accent.opacity(0.62) : theme.divider, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}
