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

struct ControlApprovalPanel: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    let approval: ControlApproval

    var body: some View {
        NativeGroupPanel(title: approval.title, subtitle: approval.detail) {
            Text(approval.command.isEmpty ? "No command configured." : approval.command)
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundStyle(theme.textSecondary)
                .textSelection(.enabled)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.field)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            HStack(spacing: 10) {
                ActionButton(title: "Cancel", icon: "xmark") {
                    model.cancelPendingApproval()
                }
                if approval.kind != .blocked {
                    ActionButton(title: "Approve", icon: "checkmark", tone: .danger) {
                        model.approvePendingAction()
                    }
                }
            }
        }
    }
}
