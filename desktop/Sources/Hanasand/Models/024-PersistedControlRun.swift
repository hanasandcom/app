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

struct PersistedControlRun: Codable {
    let title: String
    let detail: String
    let date: Date
    let kind: String

    init(_ run: ControlRun) {
        title = run.title
        detail = run.detail
        date = run.date
        kind = run.kind.persistenceValue
    }

    var controlRun: ControlRun {
        ControlRun(
            title: title,
            detail: detail,
            date: date,
            kind: AgentEvent.Kind(persistenceValue: kind)
        )
    }
}
