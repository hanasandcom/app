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

    func messageReader(_ overview: MailOverviewEnvelope) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let message = selectedMessage {
                NativeGroupPanel(title: message.subjectLabel, subtitle: message.fromLabel) {
                    HStack(spacing: 8) {
                        ActionButton(title: message.isRead == true ? "Unread" : "Read", icon: message.isRead == true ? "envelope.badge" : "envelope.open") {
                            Task { await model.runMailAction(message.isRead == true ? "unread" : "read", message: message) }
                        }
                        ActionButton(title: message.isFlagged == true ? "Unflag" : "Flag", icon: "flag") {
                            Task { await model.runMailAction(message.isFlagged == true ? "unflag" : "flag", message: message) }
                        }
                        ActionButton(title: "Reply", icon: "arrowshape.turn.up.left") {
                            model.composeReplyToSelectedMail()
                        }
                        ActionButton(title: "Reply all", icon: "arrowshape.turn.up.left.2") {
                            model.composeReplyAllToSelectedMail()
                        }
                        ActionButton(title: "Forward", icon: "arrowshape.turn.up.right") {
                            model.composeForwardSelectedMail()
                        }
                        Menu {
                            ForEach(overview.mailboxes) { mailbox in
                                Button(mailbox.displayName) {
                                    Task { await model.runMailAction("move", message: message, targetMailboxId: mailbox.id, targetMailboxName: mailbox.displayName) }
                                }
                            }
                        } label: {
                            Label("Move", systemImage: "folder")
                        }
                        .buttonStyle(.borderless)
                        ActionButton(title: "Archive", icon: "archivebox") {
                            Task { await model.runMailAction("archive", message: message) }
                        }
                        ActionButton(title: message.isJunk == true ? "Not spam" : "Spam", icon: message.isJunk == true ? "checkmark.shield" : "exclamationmark.octagon") {
                            Task { await model.runMailAction(message.isJunk == true ? "ham" : "junk", message: message) }
                        }
                        if message.isDeleted == true {
                            ActionButton(title: "Restore", icon: "arrow.uturn.backward") {
                                Task { await model.runMailAction("restore", message: message) }
                            }
                        }
                        ActionButton(title: "Trash", icon: "trash", tone: .danger) {
                            Task { await model.runMailAction("trash", message: message) }
                        }
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("To  \(message.to.isEmpty ? "No recipient listed" : message.to.map(\.displayName).joined(separator: ", "))")
                        if let cc = message.cc, !cc.isEmpty {
                            Text("Cc  \(cc.map(\.displayName).joined(separator: ", "))")
                        }
                        Text("\(message.dateLabel)  ·  Thread \(message.threadId ?? message.id)")
                    }
                    .font(.system(size: 10, weight: .regular))
                    .foregroundStyle(theme.textTertiary)
                    .textSelection(.enabled)

                    if message.hasHTMLBody {
                        MailHTMLBodyView(html: message.renderedHTML(mailboxUser: overview.mailboxUser, apiBaseURL: model.settings.apiBaseURL.normalizedBaseURL))
                            .frame(minHeight: 380)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    } else {
                        ScrollView {
                            Text(message.bodyText.isEmpty ? "No plain text body returned." : message.bodyText)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(theme.textSecondary)
                                .textSelection(.enabled)
                                .lineSpacing(4)
                                .frame(maxWidth: .infinity, alignment: .topLeading)
                                .padding(14)
                        }
                        .frame(minHeight: 315)
                        .background(theme.backgroundElevated.opacity(0.72))
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }

                    if let attachments = message.attachments, !attachments.isEmpty {
                        attachmentPanel(attachments, message: message)
                    }
                }
            } else {
                NativeGroupPanel(title: "No message selected", subtitle: "Select a message from the list") {
                    NativeEmptyState(title: "Mail ready", message: "Pick a message, use arrow keys to navigate, or press Command-Shift-N to compose.")
                }
            }
        }
    }

    func attachmentPanel(_ attachments: [MailOverviewEnvelope.Attachment], message: MailOverviewEnvelope.Message) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Attachments")
                .font(.system(size: 12, weight: .black))
                .foregroundStyle(theme.textTertiary)
                .textCase(.uppercase)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 8)], spacing: 8) {
                ForEach(attachments) { attachment in
                    Button {
                        Task { await model.downloadMailAttachment(attachment, from: message) }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "paperclip")
                            VStack(alignment: .leading, spacing: 2) {
                                Text(attachment.name)
                                    .font(.system(size: 12, weight: .bold))
                                    .lineLimit(1)
                                Text("\(attachment.type ?? "file") · \(formatBytes(attachment.size ?? 0))")
                                    .font(.system(size: 10, weight: .semibold))
                                    .foregroundStyle(theme.textTertiary)
                            }
                            Spacer()
                        }
                        .foregroundStyle(theme.text)
                        .padding(10)
                        .background(theme.cardRaised)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}
