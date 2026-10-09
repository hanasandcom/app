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

struct IDEProblemRow: View {
    @Environment(\.desktopTheme) var theme
    let marker: IDEProblemMarker
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: marker.icon)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(marker.severity == "error" ? theme.danger : theme.accent)
                    .frame(width: 16)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(URL(fileURLWithPath: marker.filePath).lastPathComponent):\(marker.line)")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(theme.text)
                        .lineLimit(1)
                    Text(marker.detail)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 9)
            .frame(height: 36)
            .background(theme.field)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
