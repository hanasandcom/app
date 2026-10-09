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

extension MailNativePanel {

    var overview: MailOverviewEnvelope? { model.mailOverview }

    var selectedMessage: MailOverviewEnvelope.Message? { model.selectedMailMessage }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            headerBar

            if let overview {
                HStack(alignment: .top, spacing: 0) {
                    mailboxSidebar(overview)
                        .frame(width: 238)

                    Divider()
                        .overlay(theme.divider)
                        .padding(.horizontal, 10)

                    threadedMessageList(overview)
                        .frame(minWidth: 330, idealWidth: 390, maxWidth: 440)

                    Divider()
                        .overlay(theme.divider)
                        .padding(.horizontal, 10)

                    messageReader(overview)
                        .frame(maxWidth: .infinity)
                }
                .frame(minHeight: 590)

                mailSyncBanner

                if model.mailComposerExpanded {
                    composeSheet(overview)
                }
        } else {
            NativeGroupPanel(title: "Connect Mail", subtitle: "Inbox, compose, accounts") {
                    HStack(spacing: 10) {
                        ActionButton(title: "Load inbox", icon: "tray.full") {
                            Task { await model.loadMailOverview() }
                        }
                        ActionButton(title: "Setup", icon: "gearshape") {
                            showAccountSetup.toggle()
                        }
                    }
                    NativeEmptyState(title: "No mailbox", message: "Add API settings, then Load inbox.")
                }
            }
        }
        .focusable()
        .onKeyPress(.downArrow) {
            Task { await model.selectNextMailMessage(offset: 1) }
            return .handled
        }
        .onKeyPress(.upArrow) {
            Task { await model.selectNextMailMessage(offset: -1) }
            return .handled
        }
        .task {
            if model.mailOverview == nil {
                await model.loadMailOverview()
            }
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 10_000_000_000)
                now = Date()
                guard model.mailAutoRefreshEnabled, model.mailOverview != nil else { continue }
                await model.loadMailOverview(silent: true)
            }
        }
    }

    var headerBar: some View {
        NativeGroupPanel(title: "Mail", subtitle: model.mailSummary) {
            HStack(spacing: 12) {
                Label("\(overview?.messages.count ?? 0) messages", systemImage: "envelope")
                Label("\(overview?.messages.filter { $0.isRead != true }.count ?? 0) unread", systemImage: "envelope.badge")
                Label("\(model.selectedMailMessageIDs.count) selected", systemImage: "checkmark.circle")
                Label(overview?.health?.status.capitalized ?? "Offline", systemImage: connectionIcon)
                    .foregroundStyle(overview?.health?.status.lowercased() == "healthy" ? theme.green : theme.textSecondary)
            }
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(theme.textSecondary)

            HStack(spacing: 10) {
                SearchFieldRow(placeholder: "Search mail", text: $searchText)
                    .focused($searchFocused)
                ActionButton(title: "Refresh", icon: "arrow.clockwise") {
                    Task { await model.loadMailOverview() }
                }
                ActionButton(title: "Compose", icon: "square.and.pencil") {
                    model.mailComposerExpanded.toggle()
                }
                Button {
                    model.mailAutoRefreshEnabled.toggle()
                } label: {
                    Label(model.mailAutoRefreshEnabled ? "Live" : "Paused", systemImage: model.mailAutoRefreshEnabled ? "arrow.triangle.2.circlepath" : "pause.circle")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(model.mailAutoRefreshEnabled ? theme.green : theme.textSecondary)
                        .padding(.horizontal, 12)
                        .frame(height: 38)
                        .background(theme.cardRaised)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                ActionButton(title: "Setup", icon: "gearshape") {
                    showAccountSetup.toggle()
                }
            }

            if showAccountSetup {
                accountSetupPanel
            }
        }
    }

    @ViewBuilder

    var mailSyncBanner: some View {
        if let last = model.mailLastSuccessAt {
            let age = now.timeIntervalSince(last)
            if age > 300 || !model.mailBackgroundIssue.isEmpty {
                NativeGroupPanel(title: "Mail sync", subtitle: model.mailAutoRefreshEnabled ? "Background refresh" : "Paused") {
                    HStack(spacing: 10) {
                        Image(systemName: model.mailBackgroundIssue.isEmpty ? "clock.badge.exclamationmark" : "exclamationmark.triangle")
                            .foregroundStyle(model.mailBackgroundIssue.isEmpty ? theme.accent : theme.danger)
                        Text(model.mailBackgroundIssue.isEmpty ? "Last refreshed \(relativeAge(age)) ago." : "Background sync issue: \(model.mailBackgroundIssue)")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(theme.textSecondary)
                        Spacer()
                        ActionButton(title: "Refresh now", icon: "arrow.clockwise") {
                            Task { await model.loadMailOverview() }
                        }
                    }
                }
            }
        }
    }

    func relativeAge(_ seconds: TimeInterval) -> String {
        if seconds < 60 { return "\(max(0, Int(seconds)))s" }
        if seconds < 3600 { return "\(Int(seconds / 60))m" }
        return "\(Int(seconds / 3600))h"
    }

    var connectionIcon: String {
        switch overview?.health?.status.lowercased() {
        case "healthy": return "checkmark.icloud"
        case "warning": return "exclamationmark.icloud"
        case "error": return "xmark.icloud"
        default: return "icloud.slash"
        }
    }
}
