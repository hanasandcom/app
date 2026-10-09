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

struct TopBar: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    @State var confirmLogout = false

    var body: some View {
        HStack(spacing: 12) {
            Text(model.selectedSection == .command ? model.selectedProject : model.selectedSection.title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.text)
            Spacer()
            AgentStatusPill(status: model.status)
            UpdateStatusPill(status: model.updateStatus)
            if model.selectedSection == .command {
                TopBarIconButton(
                    icon: model.aiRightRailMode == .hidden ? "sidebar.right" : "eye.slash",
                    label: model.aiRightRailMode == .hidden ? "Tools" : "Hide",
                    active: model.aiRightRailMode != .hidden
                ) {
                    model.toggleAIRightRailFromHeader()
                }
            }
            Menu {
                Button("Settings", systemImage: "gearshape") {
                    model.recordCommand("open_section_settings")
                }
                Divider()
                Button("Log out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                    confirmLogout = true
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.textSecondary)
                    .frame(width: 30, height: 30)
                    .background(theme.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            .menuStyle(.borderlessButton)
            .help("More options")
            .accessibilityLabel("More options")
        }
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(theme.textSecondary)
        .padding(.horizontal, 16)
        .frame(height: 48)
        .background(theme.commandBar)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(theme.divider)
                .frame(height: 1)
        }
        .confirmationDialog("Log out of Hanasand?", isPresented: $confirmLogout) {
            Button("Log out", role: .destructive) {
                Task { await model.logoutFromHanasand() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This clears the desktop app session and returns to the login screen.")
        }
    }
}
