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

struct CodePane: View {
    @Environment(\.desktopTheme) var theme
    let rows: [(String, String, Bool)]
    let fill: Color
    let marker: Color

    var body: some View {
        VStack(spacing: 0) {
            ForEach(rows, id: \.0) { row in
                HStack(spacing: 12) {
                    Text(row.0)
                        .frame(width: 28, alignment: .trailing)
                        .foregroundStyle(row.2 ? marker : theme.textSecondary)
                    Text(row.1)
                        .foregroundStyle(row.2 ? theme.text : theme.textSecondary)
                    Spacer()
                }
                .font(.system(size: 14, weight: .semibold, design: .monospaced))
                .padding(.horizontal, 10)
                .frame(maxWidth: .infinity, minHeight: 22, alignment: .leading)
                .background(row.2 ? fill : Color.clear)
            }
        }
        .frame(maxWidth: .infinity)
    }
}
