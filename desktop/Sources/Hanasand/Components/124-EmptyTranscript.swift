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

struct EmptyTranscript: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Ready")
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(theme.text)
            HStack(spacing: 12) {
                AgentFact(label: "Host", value: model.status.hostname)
                AgentFact(label: "Platform", value: model.status.platform)
                AgentFact(label: "Agent", value: model.status.ok ? "Online" : "Offline")
            }
        }
        .padding(18)
        .background(theme.card)
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(theme.divider, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
