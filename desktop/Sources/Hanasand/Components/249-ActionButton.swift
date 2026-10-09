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

struct ActionButton: View {
    @Environment(\.desktopTheme) var theme
    let title: String
    let icon: String
    var tone: ActionTone = .normal
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                Image(systemName: icon)
                Text(title)
            }
            .font(.system(size: 13, weight: .black))
            .foregroundStyle(tone == .danger ? theme.danger : theme.text)
            .padding(.horizontal, 13)
            .frame(height: 34)
            .background(tone == .danger ? theme.danger.opacity(0.12) : theme.cardRaised)
            .overlay(
                Capsule()
                    .stroke(tone == .danger ? theme.danger.opacity(0.28) : theme.divider.opacity(0.8), lineWidth: 1)
            )
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}
