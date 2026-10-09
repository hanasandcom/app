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

struct FeatureWorkspace<Content: View>: View {
    @Environment(\.desktopTheme) var theme
    let title: String
    let subtitle: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            TopBar()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(title)
                            .font(.system(size: 24, weight: .semibold))
                            .foregroundStyle(theme.text)
                        if !subtitle.isEmpty {
                            Text(subtitle)
                                .font(.system(size: 13, weight: .regular))
                                .foregroundStyle(theme.textSecondary)
                                .lineLimit(2)
                                .textSelection(.enabled)
                        }
                    }
                    content
                }
                .frame(maxWidth: 1040, alignment: .leading)
                .padding(.horizontal, 28)
                .padding(.top, 28)
                .padding(.bottom, 32)
                .frame(maxWidth: .infinity)
            }
        }
        .background(theme.background)
    }
}
