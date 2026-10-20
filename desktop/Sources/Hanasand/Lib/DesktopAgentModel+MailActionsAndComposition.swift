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

    func runMailAction(_ action: String, message: MailOverviewEnvelope.Message, targetMailboxId: String? = nil, targetMailboxName: String? = nil, reload: Bool = true) async {
        guard hasHanasandAuth else {
            mailSummary = "Setup needed."
            append(meta: "Mail action", body: mailSummary, kind: .error)
            return
        }

        do {
            let payload = [
                "mailboxUser": mailOverview?.mailboxUser ?? "",
                "action": action,
                "targetMailboxId": targetMailboxId ?? "",
                "targetMailboxName": targetMailboxName ?? "",
            ]
            let body = try JSONEncoder().encode(payload)
            let text = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("mail/message/\(message.id)/action"),
                method: "POST",
                body: body,
                authenticated: true
            )
            mailSummary = "Mail action: \(action)"
            append(meta: "Mail action", body: text.isEmpty ? action : String(text.prefix(240)), kind: .change)
            if reload {
                await loadMailOverview()
            }
        } catch {
            mailSummary = error.localizedDescription
            append(meta: "Mail action failed", body: error.localizedDescription, kind: .error)
        }
    }

    func selectNextMailMessage(offset: Int) async {
        guard let messages = mailOverview?.messages, !messages.isEmpty else { return }
        let currentIndex = messages.firstIndex(where: { $0.id == selectedMailMessageID }) ?? 0
        let nextIndex = min(max(currentIndex + offset, 0), messages.count - 1)
        await selectMailMessage(messages[nextIndex])
    }

    func composeReplyToSelectedMail() {
        guard let message = selectedMailMessage else { return }
        let replyAddress = (message.replyTo?.first ?? message.from.first)?.displayName ?? ""
        mailComposeTo = replyAddress
        mailComposeCc = ""
        mailComposeBcc = ""
        mailComposeReplyTo = ""
        mailComposeSubject = message.subjectLabel.lowercased().hasPrefix("re:") ? message.subjectLabel : "Re: \(message.subjectLabel)"
        mailComposeBody = "\n\nOn \(message.dateLabel), \(message.fromLabel) wrote:\n\(quoteMailBody(message.bodyText))"
        mailDraftAttachments = []
        mailComposerExpanded = true
        mailSummary = "Replying to \(message.fromLabel)"
    }

    func composeReplyAllToSelectedMail() {
        guard let message = selectedMailMessage else { return }
        let currentAddress = mailOverview?.mailboxAddress?.lowercased() ?? ""
        let recipients = (message.from + message.to + (message.cc ?? []))
            .filter { !$0.email.lowercased().isEmpty && $0.email.lowercased() != currentAddress }
        mailComposeTo = uniqueMailAddresses(recipients).map(\.displayName).joined(separator: ", ")
        mailComposeCc = ""
        mailComposeBcc = ""
        mailComposeReplyTo = ""
        mailComposeSubject = message.subjectLabel.lowercased().hasPrefix("re:") ? message.subjectLabel : "Re: \(message.subjectLabel)"
        mailComposeBody = "\n\nOn \(message.dateLabel), \(message.fromLabel) wrote:\n\(quoteMailBody(message.bodyText))"
        mailDraftAttachments = []
        mailComposerExpanded = true
        mailSummary = "Replying all to \(message.subjectLabel)"
    }

    func composeForwardSelectedMail() {
        guard let message = selectedMailMessage else { return }
        mailComposeTo = ""
        mailComposeCc = ""
        mailComposeBcc = ""
        mailComposeReplyTo = ""
        mailComposeSubject = message.subjectLabel.lowercased().hasPrefix("fwd:") ? message.subjectLabel : "Fwd: \(message.subjectLabel)"
        mailComposeBody = "\n\nForwarded message:\nFrom: \(message.fromLabel)\nDate: \(message.dateLabel)\nSubject: \(message.subjectLabel)\n\n\(message.bodyText)"
        mailDraftAttachments = []
        mailComposerExpanded = true
        mailSummary = "Forwarding \(message.subjectLabel)"
    }

    func addRecentRecipientToCompose(_ recipient: MailOverviewEnvelope.RecentRecipient) {
        let value = recipient.displayName
        let trimmed = mailComposeTo.trimmingCharacters(in: .whitespacesAndNewlines)
        mailComposeTo = trimmed.isEmpty ? value : "\(trimmed), \(value)"
        mailComposerExpanded = true
    }

    func quoteMailBody(_ body: String) -> String {
        body
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { "> \($0)" }
            .joined(separator: "\n")
    }

    func uniqueMailAddresses(_ addresses: [MailOverviewEnvelope.MailAddress]) -> [MailOverviewEnvelope.MailAddress] {
        var seen: Set<String> = []
        return addresses.filter { address in
            let key = address.email.lowercased()
            guard !seen.contains(key) else { return false }
            seen.insert(key)
            return true
        }
    }

    func sendComposedMail() async {
        guard hasHanasandAuth else {
            mailSummary = "Setup needed."
            append(meta: "Mail send", body: mailSummary, kind: .error)
            return
        }

        let to = mailComposeTo.trimmingCharacters(in: .whitespacesAndNewlines)
        let subject = mailComposeSubject.trimmingCharacters(in: .whitespacesAndNewlines)
        let bodyText = mailComposeBody.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !to.isEmpty, !subject.isEmpty || !bodyText.isEmpty || !mailDraftAttachments.isEmpty else {
            mailSummary = "Add a recipient and a subject or message."
            append(meta: "Mail send", body: mailSummary, kind: .error)
            return
        }

        do {
            let payload = MailSendPayload(
                mailboxUser: mailOverview?.mailboxUser,
                to: to,
                cc: mailComposeCc.trimmingCharacters(in: .whitespacesAndNewlines),
                bcc: mailComposeBcc.trimmingCharacters(in: .whitespacesAndNewlines),
                replyTo: mailComposeReplyTo.trimmingCharacters(in: .whitespacesAndNewlines),
                subject: subject,
                textBody: bodyText,
                attachments: mailDraftAttachments.map(\.payload)
            )
            let text = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("mail/send"),
                method: "POST",
                body: try JSONEncoder().encode(payload),
                authenticated: true
            )
            mailComposeTo = ""
            mailComposeCc = ""
            mailComposeBcc = ""
            mailComposeReplyTo = ""
            mailComposeSubject = ""
            mailComposeBody = ""
            mailDraftAttachments = []
            mailComposerExpanded = false
            mailSummary = "Message sent"
            append(meta: "Mail sent", body: String(text.prefix(240)), kind: .change)
            await loadMailOverview()
        } catch {
            mailSummary = error.localizedDescription
            append(meta: "Mail send failed", body: error.localizedDescription, kind: .error)
        }
    }
}
