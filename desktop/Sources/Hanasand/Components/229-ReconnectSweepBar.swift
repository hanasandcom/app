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

struct ReconnectSweepBar: View {
    @Environment(\.desktopTheme) var theme
    let startedAt: Date
    let now: Date

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let progress = now.timeIntervalSince(startedAt).truncatingRemainder(dividingBy: 1.4) / 1.4
            let sweepWidth = max(42, width * 0.24)
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(theme.text.opacity(0.16))
                Capsule()
                    .fill(.white.opacity(0.92))
                    .frame(width: sweepWidth)
                    .offset(x: -sweepWidth + (width + sweepWidth * 2) * progress)
            }
            .clipShape(Capsule())
        }
    }
}
