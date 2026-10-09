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

struct ActionCard: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    let action: DesktopAction

    var body: some View {
        Button {
            action.perform(with: model)
        } label: {
            HStack(alignment: .center, spacing: 10) {
                Image(systemName: action.icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(theme.textSecondary)
                    .frame(width: 24, height: 24)
                VStack(alignment: .leading, spacing: 3) {
                    Text(action.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.text)
                        .lineLimit(1)
                    Text(action.subtitle)
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(theme.textSecondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
                Image(systemName: action.trailingIcon)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(theme.textTertiary)
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
            .background(theme.card)
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(theme.divider.opacity(0.7), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
