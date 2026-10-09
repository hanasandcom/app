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

struct MainWorkspace: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    let commandFocused: FocusState<Bool>.Binding

    var body: some View {
        VStack(spacing: 0) {
            if !model.settings.impersonatingUserID.isEmpty {
                HStack(spacing: 10) {
                    Image(systemName: "person.crop.circle.badge.checkmark")
                        .font(.system(size: 13, weight: .bold))
                    Text("Impersonating \(model.settings.impersonatingUserName.isEmpty ? model.settings.impersonatingUserID : model.settings.impersonatingUserName)")
                        .font(.system(size: 12, weight: .bold))
                        .lineLimit(1)
                    Spacer()
                    Button("Return to own view") {
                        model.returnToOwnDashboardView()
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 12, weight: .black))
                    .foregroundStyle(theme.accent)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(theme.cardRaised)
                .overlay(Rectangle().fill(theme.divider).frame(height: 1), alignment: .bottom)
            }
            switch model.selectedSection {
            case .command:
                AIWorkspace(commandFocused: commandFocused)
            case .control:
                ControlPlaneWorkspace(commandFocused: commandFocused)
            case .dashboard:
                DashboardWorkspace()
            case .browser:
                BrowserWorkspace()
            case .ide:
                IDEWorkspace()
            case .mac:
                MacWorkspace()
            case .mail:
                MailWorkspace()
            case .documents:
                DocumentWorkspace()
            case .images:
                ImageReviewWorkspace()
            case .server:
                ServerWorkspace()
            case .updates:
                UpdatesWorkspace()
            case .settings:
                SettingsWorkspace()
            }
        }
    }
}
