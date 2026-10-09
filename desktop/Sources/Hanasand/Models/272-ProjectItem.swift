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

struct ProjectItem: Identifiable {
    enum State {
        case normal
        case folder
        case active
        case live
        case syncing
    }

    let id = UUID()
    let title: String
    var state: State = .normal
    var age: String?

    static func folder(_ title: String) -> ProjectItem {
        ProjectItem(title: title, state: .folder)
    }
}
