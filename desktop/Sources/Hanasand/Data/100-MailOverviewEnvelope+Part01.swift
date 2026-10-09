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

extension MailOverviewEnvelope {
    struct MailAddress: Decodable, Hashable {
        let email: String
        let name: String?

        var displayName: String {
            let cleanName = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return cleanName.isEmpty ? email : "\(cleanName) <\(email)>"
        }
    }

    struct Mailbox: Decodable, Identifiable {
        let id: String
        let name: String
        let role: String?
        let parentId: String?
        let unreadEmails: Int?
        let totalEmails: Int?

        enum CodingKeys: String, CodingKey {
            case id
            case name
            case role
            case parentId
            case unreadEmails
            case totalEmails
        }

        var displayName: String {
            name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? id : name
        }

        var countLabel: String {
            if let unreadEmails, unreadEmails > 0 {
                return "\(unreadEmails) unread"
            }
            if let totalEmails {
                return "\(totalEmails) total"
            }
            return role ?? "folder"
        }
    }

    struct Attachment: Decodable, Identifiable {
        let blobId: String
        let name: String
        let type: String?
        let size: Int?
        let disposition: String?
        let cid: String?
        let isInline: Bool?

        var id: String { blobId }
    }

    struct Message: Decodable, Identifiable {
        let id: String
        let threadId: String?
        let mailboxIds: [String]?
        let subject: String
        let preview: String?
        let receivedAt: String?
        let sentAt: String?
        let from: [MailAddress]
        let to: [MailAddress]
        let cc: [MailAddress]?
        let bcc: [MailAddress]?
        let replyTo: [MailAddress]?
        let hasAttachment: Bool?
        let isRead: Bool?
        let isFlagged: Bool?
        let isAnswered: Bool?
        let isDraft: Bool?
        let isJunk: Bool?
        let isDeleted: Bool?
        let textBody: String?
        let htmlBody: String?
        let attachments: [Attachment]?

        enum CodingKeys: String, CodingKey {
            case id
            case threadId
            case mailboxIds
            case subject
            case preview
            case receivedAt
            case sentAt
            case from
            case to
            case cc
            case bcc
            case replyTo
            case hasAttachment
            case isRead
            case isFlagged
            case isAnswered
            case isDraft
            case isJunk
            case isDeleted
            case textBody
            case htmlBody
            case attachments
        }

        var subjectLabel: String {
            subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "(No subject)" : subject
        }

        var fromLabel: String {
            from.first?.displayName ?? "Unknown sender"
        }

        var dateLabel: String {
            formatDateText(receivedAt, fallback: formatDateText(sentAt, fallback: "No timestamp"))
        }

        var bodyText: String {
            let text = textBody?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !text.isEmpty { return text }
            return preview?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        }

        var hasHTMLBody: Bool {
            !(htmlBody?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
        }

        func renderedHTML(mailboxUser: String?, apiBaseURL: URL) -> String {
            var html = htmlBody?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if html.isEmpty {
                html = "<pre>\(bodyText.htmlEscaped)</pre>"
            }
            if let mailboxUser {
                for attachment in attachments ?? [] {
                    guard let cid = attachment.cid, !cid.isEmpty else { continue }
                    let url = apiBaseURL
                        .appendingAPIPath("mail/blob/\(mailboxUser)/\(attachment.blobId)/\(attachment.name)")
                        .absoluteString
                    html = html.replacingOccurrences(of: "cid:\(cid)", with: url)
                    html = html.replacingOccurrences(of: "cid:<\(cid)>", with: url)
                }
            }
            return """
            <!doctype html>
            <html>
            <head>
              <meta charset="utf-8" />
              <meta name="viewport" content="width=device-width, initial-scale=1" />
              <style>
                :root { color-scheme: dark; }
                html, body {
                  margin: 0;
                  padding: 0;
                  background: #0d100d;
                  color: #edf2e7;
                  font: 14px -apple-system, BlinkMacSystemFont, "Aptos", sans-serif;
                  line-height: 1.65;
                }
                body { padding: 24px; overflow-wrap: anywhere; }
                img, iframe, video { max-width: 100%; height: auto; border-radius: 14px; }
                a { color: #f07d33; }
                table { max-width: 100%; border-collapse: collapse; }
                pre, code { white-space: pre-wrap; word-break: break-word; }
              </style>
            </head>
            <body>\(html)</body>
            </html>
            """
        }
    }
}
