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

struct PasswordResetCodeBoxes: View {
    @Environment(\.desktopTheme) var theme
    @Binding var code: String
    let isBusy: Bool
    @FocusState var codeFieldFocused: Bool

    var characters: [Character] {
        Array(code)
    }

    var body: some View {
        ZStack {
            HStack(spacing: 8) {
                ForEach(0..<6, id: \.self) { index in
                    codeBox(at: index)
                }
            }

            TextField("", text: $code)
                .textFieldStyle(.plain)
                .font(.system(size: 1))
                .foregroundStyle(.clear)
                .accentColor(.clear)
                .frame(width: 1, height: 1)
                .opacity(0.01)
                .focused($codeFieldFocused)
                .disabled(isBusy)
        }
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .onTapGesture {
            codeFieldFocused = true
        }
        .onAppear {
            DispatchQueue.main.async {
                codeFieldFocused = true
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("6 digit code")
        .accessibilityValue("\(code.count) digits entered")
    }

    func codeBox(at index: Int) -> some View {
        let value = index < characters.count ? String(characters[index]) : ""
        let activeIndex = min(code.count, 5)
        let isActive = codeFieldFocused && (index == activeIndex || code.count == 6)

        return Text(value)
            .font(.system(size: 18, weight: .semibold, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(theme.text)
            .frame(width: 80, height: 46)
            .background(theme.field)
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(isActive ? theme.accent : theme.divider, lineWidth: isActive ? 1.4 : 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .shadow(color: .black.opacity(0.14), radius: 8, x: 0, y: 5)
    }
}
