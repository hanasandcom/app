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

struct AgentStatusPill: View {
    @Environment(\.desktopTheme) var theme
    let status: AgentStatus

    var body: some View {
        HStack(spacing: 7) {
            Circle()
                .fill(status.ok ? theme.green : theme.danger)
                .frame(width: 7, height: 7)
            Text(status.message)
                .lineLimit(1)
        }
        .font(.system(size: 11, weight: .bold))
        .padding(.horizontal, 9)
        .frame(height: 28)
        .background(theme.cardRaised)
        .overlay(Capsule().stroke(theme.divider, lineWidth: 1))
        .clipShape(Capsule())
        .fixedSize(horizontal: true, vertical: false)
    }
}
