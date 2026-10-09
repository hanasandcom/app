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

extension DesktopAgentModel {

    func refreshLocalStatus() async {
        currentTaskState = "Checking this Mac"
        do {
            let loaded: AgentStatus = try await requestJSON(settings.desktopAgentBaseURL.normalizedBaseURL.appendingPathComponent("status"))
            status = loaded
            append(meta: "This Mac", body: "\(loaded.hostname) · \(loaded.platform) · \(Int(loaded.uptimeSeconds / 60)) min", kind: .command)
            recordRun(title: "This Mac", detail: loaded.message, kind: .command)
        } catch {
            status = AgentStatus.ready(ok: false, message: error.localizedDescription)
            append(meta: "This Mac", body: error.localizedDescription, kind: .error)
            recordRun(title: "This Mac error", detail: error.localizedDescription, kind: .error)
        }
        currentTaskState = "Idle"
    }

    func loadMailOverview(silent: Bool = false) async {
        guard hasHanasandAuth else {
            mailSummary = "Setup needed."
            if silent {
                mailBackgroundIssue = mailSummary
            } else {
                append(meta: "Mail", body: mailSummary, kind: .error)
            }
            return
        }

        do {
            let overview: MailOverviewEnvelope = try await requestJSON(
                mailOverviewURL(),
                authenticated: true
            )
            mailOverview = overview
            selectedMailAccountUser = overview.mailboxUser ?? selectedMailAccountUser
            selectedMailboxID = overview.selectedMailboxId ?? selectedMailboxID
            selectedMailMessageID = overview.selectedMessage?.id ?? overview.messages.first?.id ?? selectedMailMessageID
            selectedMailMessageIDs = selectedMailMessageIDs.intersection(Set(overview.messages.map(\.id)))
            if let mailboxName = overview.mailboxes.first(where: { $0.id == selectedMailboxID })?.displayName, mailMoveTargetMailboxName.isEmpty {
                mailMoveTargetMailboxName = mailboxName
            }
            mailLastSuccessAt = Date()
            mailBackgroundIssue = ""
            mailSummary = "\(overview.messages.count) messages · \(overview.mailboxes.count) mailboxes"
            if !silent {
                append(meta: "Mail", body: mailSummary, kind: .command)
            }
        } catch {
            if silent {
                mailBackgroundIssue = error.localizedDescription
            } else {
                mailSummary = error.localizedDescription
                append(meta: "Mail", body: error.localizedDescription, kind: .error)
            }
        }
    }

    func selectMailbox(_ mailbox: MailOverviewEnvelope.Mailbox) async {
        selectedMailboxID = mailbox.id
        selectedMailMessageID = ""
        selectedMailMessageIDs = []
        mailMoveTargetMailboxName = mailbox.displayName
        await loadMailOverview()
    }

    func selectMailAccount(_ account: MailOverviewEnvelope.Account) async {
        selectedMailAccountUser = account.id
        selectedMailboxID = ""
        selectedMailMessageID = ""
        selectedMailMessageIDs = []
        mailOverview = nil
        mailSummary = "Loading \(account.address)"
        append(meta: "Mail account", body: account.address, kind: .command)
        await loadMailOverview()
    }

    func selectMailMessage(_ message: MailOverviewEnvelope.Message) async {
        selectedMailMessageID = message.id
        await loadMailOverview()
    }

    func toggleMailSelection(_ message: MailOverviewEnvelope.Message) {
        if selectedMailMessageIDs.contains(message.id) {
            selectedMailMessageIDs.remove(message.id)
        } else {
            selectedMailMessageIDs.insert(message.id)
        }
    }

    func selectAllVisibleMailMessages(_ messages: [MailOverviewEnvelope.Message]) {
        selectedMailMessageIDs = Set(messages.map(\.id))
        mailSummary = "Selected \(selectedMailMessageIDs.count) messages"
    }

    func clearMailSelection() {
        selectedMailMessageIDs = []
        mailSummary = "Cleared selection"
    }

    func runSelectedMailAction(_ action: String) async {
        guard let message = selectedMailMessage else { return }
        await runMailAction(action, message: message)
    }

    func toggleSelectedMailReadState() async {
        guard let message = selectedMailMessage else { return }
        await runMailAction(message.isRead == true ? "unread" : "read", message: message)
    }

    func toggleSelectedMailFlagState() async {
        guard let message = selectedMailMessage else { return }
        await runMailAction(message.isFlagged == true ? "unflag" : "flag", message: message)
    }

    func moveSelectedMail(to mailbox: MailOverviewEnvelope.Mailbox) async {
        let messages = selectedMailMessages
        guard !messages.isEmpty else {
            mailMoveTargetMailboxName = mailbox.displayName
            return
        }
        mailMoveTargetMailboxName = mailbox.displayName
        await runBulkMailAction("move", messages: messages, targetMailboxId: mailbox.id, targetMailboxName: mailbox.displayName)
    }

    func runBulkMailAction(_ action: String, messages: [MailOverviewEnvelope.Message]? = nil, targetMailboxId: String? = nil, targetMailboxName: String? = nil) async {
        let targets = messages ?? selectedMailMessages
        guard !targets.isEmpty else {
            mailSummary = "Select messages first."
            return
        }
        for message in targets {
            await runMailAction(action, message: message, targetMailboxId: targetMailboxId, targetMailboxName: targetMailboxName, reload: false)
        }
        selectedMailMessageIDs = []
        mailSummary = "\(action.capitalized) applied to \(targets.count) messages"
        await loadMailOverview()
    }

    var selectedMailMessages: [MailOverviewEnvelope.Message] {
        guard let overview = mailOverview else { return [] }
        return overview.messages.filter { selectedMailMessageIDs.contains($0.id) }
    }
}
