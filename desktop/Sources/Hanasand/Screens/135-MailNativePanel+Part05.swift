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

    func composeSheet(_ overview: MailOverviewEnvelope) -> some View {
        NativeGroupPanel(title: "Compose", subtitle: overview.settings?.smtpHost ?? overview.mailboxAddress ?? "SMTP") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 10)], spacing: 10) {
                mailField("To", text: $model.mailComposeTo, placeholder: "name@example.com")
                mailField("Cc", text: $model.mailComposeCc, placeholder: "optional")
                mailField("Bcc", text: $model.mailComposeBcc, placeholder: "optional")
                mailField("Reply-To", text: $model.mailComposeReplyTo, placeholder: "optional")
            }
            mailField("Subject", text: $model.mailComposeSubject, placeholder: "Subject")
            if let recipients = overview.recentRecipients, !recipients.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(recipients.prefix(12)) { recipient in
                            Button {
                                model.addRecentRecipientToCompose(recipient)
                            } label: {
                                Label(recipient.displayName, systemImage: "person.crop.circle.badge.plus")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(theme.textSecondary)
                                    .padding(.horizontal, 10)
                                    .frame(height: 30)
                                    .background(theme.cardRaised)
                                    .clipShape(Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            TextField("Message", text: $model.mailComposeBody, axis: .vertical)
                .textFieldStyle(.plain)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.text)
                .lineLimit(6...12)
                .padding(11)
                .background(theme.field)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            if !model.mailDraftAttachments.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: 8)], spacing: 8) {
                    ForEach(model.mailDraftAttachments) { attachment in
                        HStack(spacing: 8) {
                            Image(systemName: "paperclip")
                            VStack(alignment: .leading, spacing: 2) {
                                Text(attachment.name)
                                    .font(.system(size: 12, weight: .bold))
                                    .lineLimit(1)
                                Text("\(attachment.type) · \(formatBytes(attachment.size))")
                                    .font(.system(size: 10, weight: .semibold))
                                    .foregroundStyle(theme.textTertiary)
                            }
                            Spacer()
                            Button("Remove") { model.removeMailAttachment(attachment) }
                                .buttonStyle(.plain)
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(theme.danger)
                        }
                        .padding(10)
                        .background(theme.cardRaised)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
            }

            HStack(spacing: 10) {
                ActionButton(title: "Attach", icon: "paperclip") {
                    model.addMailAttachment()
                }
                ActionButton(title: "Send", icon: "paperplane.fill") {
                    Task { await model.sendComposedMail() }
                }
                ActionButton(title: "Discard", icon: "xmark.circle", tone: .danger) {
                    model.mailComposerExpanded = false
                    model.mailDraftAttachments = []
                }
                Spacer()
                Text(overview.settings.map { "\($0.smtpHost ?? "SMTP"):\($0.smtpPort ?? 0)" } ?? "Ready")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.textTertiary)
            }
        }
    }

    func mailField(_ label: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 11, weight: .black))
                .foregroundStyle(theme.textTertiary)
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.text)
                .padding(11)
                .background(theme.field)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    func mailboxTools(_ overview: MailOverviewEnvelope) -> some View {
        NativeGroupPanel(title: "Folders", subtitle: "Create and move quickly") {
            HStack(spacing: 8) {
                TextField("New mailbox", text: $model.mailNewMailboxName)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.text)
                    .padding(10)
                    .background(theme.field)
                    .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                ActionButton(title: "Create", icon: "folder.badge.plus") {
                    Task { await model.createMailMailbox() }
                }
            }
            Menu {
                ForEach(overview.mailboxes) { mailbox in
                    Button(mailbox.displayName) {
                        Task { await model.moveSelectedMail(to: mailbox) }
                    }
                }
            } label: {
                Label("Move selected", systemImage: "folder")
            }
            .disabled(model.selectedMailMessageIDs.isEmpty)
        }
    }
}
