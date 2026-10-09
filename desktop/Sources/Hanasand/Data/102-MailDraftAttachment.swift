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

struct MailDraftAttachment: Identifiable, Hashable {
    struct Payload: Encodable {
        let name: String
        let type: String
        let contentBase64: String
        let size: Int
    }

    let id = UUID()
    let name: String
    let type: String
    let size: Int
    let contentBase64: String

    var payload: Payload {
        Payload(name: name, type: type, contentBase64: contentBase64, size: size)
    }
}
