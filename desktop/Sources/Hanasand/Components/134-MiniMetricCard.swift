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

struct MiniMetricCard: View {
    @Environment(\.desktopTheme) var theme
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(theme.textTertiary)
                .textCase(.uppercase)
            Text(value)
                .font(.system(size: 13, weight: .black, design: .monospaced))
                .foregroundStyle(theme.text)
                .lineLimit(1)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.cardRaised)
        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
    }
}
