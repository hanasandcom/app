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

struct SettingsDisclosurePanel<Content: View>: View {
    @Environment(\.desktopTheme) var theme
    let title: String
    let subtitle: String
    let icon: String
    @Binding var isExpanded: Bool
    @ViewBuilder let content: Content

    var body: some View {
        NativeGroupPanel(title: title, subtitle: subtitle) {
            VStack(alignment: .leading, spacing: 12) {
                Button {
                    withAnimation(.easeInOut(duration: 0.16)) {
                        isExpanded.toggle()
                    }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: icon)
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(theme.accent)
                            .frame(width: 32, height: 32)
                            .background(theme.accentSoft)
                            .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                        Text(isExpanded ? "Hide fields" : "Show fields")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(theme.text)
                        Spacer()
                        Image(systemName: "chevron.down")
                            .font(.system(size: 11, weight: .black))
                            .foregroundStyle(theme.textTertiary)
                            .rotationEffect(.degrees(isExpanded ? 180 : 0))
                    }
                    .padding(10)
                    .background(theme.field)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)

                if isExpanded {
                    content
                }
            }
        }
    }
}
