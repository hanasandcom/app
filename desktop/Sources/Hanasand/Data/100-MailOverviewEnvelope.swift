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

struct MailOverviewEnvelope: Decodable {
    let mailboxUser: String?; let mailboxAddress: String?; let accessibleAccounts: [Account]?; let mailboxes: [Mailbox]

    let selectedMailboxId: String?; let messages: [Message]; let selectedMessage: Message?; let filters: [Filter]?

    let recentRecipients: [RecentRecipient]?; let health: Health?; let settings: Settings?
}
