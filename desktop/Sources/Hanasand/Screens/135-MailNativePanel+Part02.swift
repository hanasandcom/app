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

    var accountSetupPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                CompactInfoCard(title: "Account", lines: [overview?.mailboxAddress ?? (model.selectedMailAccountUser.isEmpty ? "No mailbox selected" : model.selectedMailAccountUser)])
                CompactInfoCard(title: "IMAP", lines: [mailServerLine(kind: "imap")])
                CompactInfoCard(title: "SMTP", lines: [mailServerLine(kind: "smtp")])
            }
            if let health = overview?.health {
                HStack(spacing: 10) {
                    CompactInfoCard(title: "Connection", lines: [health.status.capitalized, health.checkedAt.map { formatDateText($0, fallback: $0) } ?? "Not checked"])
                    CompactInfoCard(title: "Queue", lines: ["\(health.queueDepth ?? 0) pending", health.smtpBannerLatencyMs.map { "SMTP \($0) ms" } ?? "SMTP latency unknown"])
                }
                if let checks = health.checks, !checks.isEmpty {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 10)], spacing: 10) {
                        ForEach(checks) { check in
                            CompactInfoCard(title: check.label ?? check.id, lines: [check.status?.capitalized ?? "Unknown", check.detail ?? "No detail"])
                        }
                    }
                }
            }
            Text("External mailbox connection is currently server-managed. Add/rotate accounts through Hanasand user provisioning; this client switches any mailbox exposed by the API.")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.textTertiary)
        }
    }

    func mailServerLine(kind: String) -> String {
        guard let settings = overview?.settings else { return "Not configured" }
        if kind == "imap" {
            return "\(settings.imapHost ?? settings.host ?? "imap"):\(settings.imapPort ?? 0)"
        }
        return "\(settings.smtpHost ?? settings.host ?? "smtp"):\(settings.smtpPort ?? 0)"
    }

    func mailboxSidebar(_ overview: MailOverviewEnvelope) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            NativeGroupPanel(title: "Mailboxes", subtitle: overview.mailboxAddress ?? overview.mailboxUser ?? "Account") {
                LazyVStack(alignment: .leading, spacing: 7) {
                    ForEach(overview.mailboxes) { mailbox in
                        mailboxButton(mailbox, selected: mailbox.id == model.selectedMailboxID || mailbox.id == overview.selectedMailboxId)
                    }
                }
            }

            if let accounts = overview.accessibleAccounts, !accounts.isEmpty {
                NativeGroupPanel(title: "Accounts", subtitle: "Switch mailbox") {
                    LazyVStack(alignment: .leading, spacing: 7) {
                        ForEach(accounts.prefix(10)) { account in
                            accountButton(account, currentUser: overview.mailboxUser)
                        }
                    }
                }
            }

            mailboxTools(overview)
            filtersPanel(overview)
        }
    }

    func mailboxButton(_ mailbox: MailOverviewEnvelope.Mailbox, selected: Bool) -> some View {
        Button {
            Task { await model.selectMailbox(mailbox) }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: mailboxIcon(mailbox))
                    .frame(width: 18)
                    .foregroundStyle(selected ? theme.accent : theme.textTertiary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(mailbox.displayName)
                        .font(.system(size: 12, weight: .black))
                        .foregroundStyle(theme.text)
                        .lineLimit(1)
                    Text(mailbox.countLabel)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(theme.textTertiary)
                }
                Spacer()
                if let unread = mailbox.unreadEmails, unread > 0 {
                    Text("\(unread)")
                        .font(.system(size: 10, weight: .black))
                        .foregroundStyle(theme.background)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(theme.accent)
                        .clipShape(Capsule())
                }
            }
            .padding(10)
            .background(selected ? theme.accentSoft : theme.cardRaised)
            .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Move selected here") {
                Task { await model.moveSelectedMail(to: mailbox) }
            }
            Button("Refresh") {
                Task { await model.selectMailbox(mailbox) }
            }
        }
    }

    func mailboxIcon(_ mailbox: MailOverviewEnvelope.Mailbox) -> String {
        switch mailbox.role?.lowercased() {
        case "inbox": return "tray.full"
        case "archive": return "archivebox"
        case "trash": return "trash"
        case "junk": return "exclamationmark.octagon"
        case "sent": return "paperplane"
        case "drafts": return "doc.text"
        default: return mailbox.parentId == nil ? "folder" : "folder.fill"
        }
    }

    func accountButton(_ account: MailOverviewEnvelope.Account, currentUser: String?) -> some View {
        let isActive = account.id == currentUser || account.id == model.selectedMailAccountUser
        return Button {
            Task { await model.selectMailAccount(account) }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: isActive ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isActive ? theme.accent : theme.textTertiary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(account.name ?? account.id)
                        .font(.system(size: 11, weight: .black))
                        .foregroundStyle(theme.text)
                        .lineLimit(1)
                    Text(account.address)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(1)
                }
                Spacer()
            }
            .padding(9)
            .background(isActive ? theme.accentSoft : theme.cardRaised)
            .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
