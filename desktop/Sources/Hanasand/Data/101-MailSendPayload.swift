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

struct MailSendPayload: Encodable {
    let mailboxUser: String?
    let to: String
    let cc: String?
    let bcc: String?
    let replyTo: String?
    let subject: String
    let textBody: String
    let attachments: [MailDraftAttachment.Payload]
}
