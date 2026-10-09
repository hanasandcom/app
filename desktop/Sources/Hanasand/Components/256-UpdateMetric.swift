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

struct UpdateMetric: View {
    @Environment(\.desktopTheme) var theme
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(theme.textTertiary)
                .textCase(.uppercase)
            Text(value)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(theme.text)
                .lineLimit(1)
        }
        .padding(.horizontal, 11)
        .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
        .background(theme.cardRaised)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
