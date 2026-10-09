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

struct MailMailboxPayload: Encodable {
    let mailboxUser: String?
    let name: String
    let parentId: String?
}
