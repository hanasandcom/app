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

struct ControlRun: Identifiable {
    let id = UUID()
    let title: String
    let detail: String
    let date: Date
    let kind: AgentEvent.Kind

    init(title: String, detail: String, date: Date = Date(), kind: AgentEvent.Kind) {
        self.title = title
        self.detail = detail
        self.date = date
        self.kind = kind
    }
}
