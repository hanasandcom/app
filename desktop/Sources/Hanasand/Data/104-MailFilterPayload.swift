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

struct MailFilterPayload: Encodable {
    struct Criteria: Encodable {
        let field: String
        let contains: String
    }

    struct Action: Encodable {
        let type: String
        let mailboxName: String
        let markRead: Bool
    }

    let mailboxUser: String?
    let name: String
    let enabled: Bool
    let criteria: Criteria
    let action: Action
}
